"""BOM → 净需求 → 待采购池（05 卷 §5）。

两条通道：
  ① 常规件（**发布触发**）：评审发布冻结 → 按这一次冻结的内容展开 → 扣库存/在跑 → 进池
     · 机械/电气发布 → 标准件、定制件（外购）
     · 工艺发布    → 原材料、外协件（判定为外协的零件）
     · 程序发布    → 不采购（PLC 硬件在电气 BOM 里）
  ② 设备面手动补跑：把这台设备的**已冻结** BOM 展开（幂等，重复点不会重复进池）

长周期件在立项阶段就下单，不走这里（00 卷 §3.1②）。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.engineering import BOM_ROW_FROZEN, BomItem, Drawing
from app.models.initiation import (
    SOURCE_CRAFT_RELEASE,
    SOURCE_DESIGN_RELEASE,
    PurchaseRequest,
)
from app.models.library import Item
from app.models.review import DesignRelease
from app.models.warehouse import StockItem

# 还在跑（没结束）的需求算已覆盖，避免重复进池
OPEN_STATUS = ("待采购", "在途", "已下单", "待入库", "部分到货", "不合格")
# 会被采购的物品类型（05 卷 §5）
BUY_TYPES = ("标准件", "定制件", "外协件", "原材料")


@dataclass
class DemandLine:
    """展开出来的一条需求（物料 + 零件归属 + 数量）。"""

    item_no: str
    part_no: str | None
    qty: float
    unit: str | None


def _cumulative_qty(drawings: list[Drawing]) -> dict[str, float]:
    """图纸在设备上的累计倍数：父子 qty 连乘（子件装 2 个、父件装 3 个 → 6）。"""
    by_no = {d.drawing_no: d for d in drawings}
    cache: dict[str, float] = {}

    def calc(no: str, seen: frozenset[str]) -> float:
        if no in cache:
            return cache[no]
        d = by_no.get(no)
        if d is None or no in seen:
            return 1.0
        q = float(d.qty or 1)
        parent = d.parent_drawing_no
        if parent and parent in by_no:
            q *= calc(parent, seen | {no})
        cache[no] = q
        return q

    for d in drawings:
        calc(d.drawing_no, frozenset())
    return cache


def _stock_available(session: Session) -> dict[str, float]:
    stock: dict[str, float] = {}
    for s in session.scalars(select(StockItem)).all():
        stock[s.item_no] = stock.get(s.item_no, 0.0) + (
            float(s.qty_on_hand or 0) - float(s.qty_locked or 0)
        )
    return stock


def _open_qty(session: Session, project_no: str | None, equip_no: str | None) -> dict[str, float]:
    """这台设备已经在下单/在途的量（不重复买）。"""
    if project_no is None:
        return {}
    open_qty: dict[str, float] = {}
    stmt = select(PurchaseRequest).where(
        PurchaseRequest.project_no == project_no,
        PurchaseRequest.status.in_(OPEN_STATUS),
    )
    if equip_no is not None:
        stmt = stmt.where(PurchaseRequest.equip_no == equip_no)
    for r in session.scalars(stmt):
        remaining = max(0.0, float(r.qty or 0) - float(r.qty_received or 0))
        open_qty[r.item_no] = open_qty.get(r.item_no, 0.0) + remaining
    return open_qty


def _cover(
    lines: list[DemandLine], stock: dict[str, float], open_qty: dict[str, float]
) -> tuple[list[tuple[DemandLine, float]], dict]:
    """净需求 = 需求 − 库存 − 在跑需求（数量大的行先抵消，保证总数正确、分摊确定）。"""
    plan: list[tuple[DemandLine, float]] = []
    for item_no in sorted({l.item_no for l in lines}):
        cover = max(stock.get(item_no, 0.0), 0.0) + open_qty.get(item_no, 0.0)
        for line in sorted((x for x in lines if x.item_no == item_no), key=lambda x: -x.qty):
            take = min(line.qty, cover)
            cover -= take
            residual = line.qty - take
            if residual > 1e-9:
                plan.append((line, round(residual, 3)))

    need_qty = round(sum(l.qty for l in lines), 3)
    buy_qty = round(sum(q for _, q in plan), 3)
    return plan, {
        "need_lines": len(lines),
        "need_qty": need_qty,
        "buy_lines": len(plan),
        "buy_qty": buy_qty,
        "covered_lines": len(lines) - len(plan),
        "covered_qty": round(need_qty - buy_qty, 3),
    }


def equipment_demand(session: Session, project_no: str, equip_no: str) -> list[DemandLine]:
    """按设备的**已冻结** BOM 展开粗需求（不扣库存）。"""
    drawings = list(
        session.scalars(
            select(Drawing).where(
                Drawing.project_no == project_no, Drawing.equip_no == equip_no
            )
        ).all()
    )
    if not drawings:
        return []
    tree_nos = {d.drawing_no for d in drawings}
    cum = _cumulative_qty(drawings)
    bom_rows = session.scalars(
        select(BomItem).where(
            BomItem.project_no == project_no, BomItem.superseded_by_id.is_(None)
        )
    ).all()
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}

    need: dict[tuple[str, str], float] = {}
    for b in bom_rows:
        if b.parent_ref not in tree_nos:
            continue
        # ★ 只有发布冻结过的 BOM 行才进采购（05 卷 §4/§5）；草稿/审核中的不算数
        if b.status != BOM_ROW_FROZEN:
            continue
        item = items.get(b.child_item_no)
        if item is None or item.source_type not in BUY_TYPES:
            continue
        mult = cum.get(b.parent_ref, 1.0)
        key = (b.child_item_no, b.parent_ref)
        need[key] = need.get(key, 0.0) + float(b.qty or 0) * mult

    lines = [
        DemandLine(item_no=item_no, part_no=part_no, qty=round(qty, 3), unit=items[item_no].unit)
        for (item_no, part_no), qty in need.items()
        if qty > 1e-9
    ]
    lines.sort(key=lambda x: (x.item_no, x.part_no or ""))
    return lines


def release_demand(session: Session, release: DesignRelease) -> list[DemandLine]:
    """按**一次发布冻结批次**展开需求（05 卷 §5）。"""
    if release.profession not in ("机械", "电气", "工艺"):
        return []
    drawings = list(
        session.scalars(
            select(Drawing).where(
                Drawing.project_no == release.project_no,
                Drawing.equip_no == release.equip_no,
            )
        ).all()
    )
    cum = _cumulative_qty(drawings)
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    summary = release.summary or {}
    need: dict[tuple[str, str | None], float] = {}

    def add(item_no: str | None, part_no: str | None, qty: float) -> None:
        if not item_no or qty <= 1e-9:
            return
        key = (item_no, part_no)
        need[key] = need.get(key, 0.0) + qty

    # ① 冻结的 BOM 行（标准件 / 定制件 / 原材料）
    for entry in summary.get("bom_items", []):
        item_no = entry.get("child_item_no")
        item = items.get(item_no)
        if item is None or item.source_type not in BUY_TYPES:
            continue
        parent = entry.get("parent_ref")
        add(item_no, parent, float(entry.get("qty") or 0) * cum.get(parent, 1.0))

    # ② 机械/电气发布：这次冻结的「定制件（外购）」图纸
    for entry in summary.get("drawings", []):
        d = session.get(Drawing, entry.get("drawing_no"))
        if d is None or d.source_type != "定制件":
            continue
        item = items.get(d.drawing_no)
        if item is None or item.source_type != "定制件":
            continue
        add(d.drawing_no, d.drawing_no, cum.get(d.drawing_no, 1.0))

    # ③ 工艺发布：判定为「外协件」的零件
    for entry in summary.get("source_tags", []):
        if entry.get("new") != "外协件":
            continue
        d = session.get(Drawing, entry.get("drawing_no"))
        if d is None or items.get(d.drawing_no) is None:
            continue
        add(d.drawing_no, d.drawing_no, cum.get(d.drawing_no, 1.0))

    lines = [
        DemandLine(item_no=item_no, part_no=part_no, qty=round(qty, 3), unit=items[item_no].unit)
        for (item_no, part_no), qty in need.items()
        if qty > 1e-9
    ]
    lines.sort(key=lambda x: (x.item_no, x.part_no or ""))
    return lines


def plan_equipment_purchase(
    session: Session, project_no: str, equip_no: str
) -> tuple[list[tuple[DemandLine, float]], dict]:
    """设备面手动补跑：已冻结 BOM 的净需求。"""
    lines = equipment_demand(session, project_no, equip_no)
    if not lines:
        return [], {"need_lines": 0, "need_qty": 0.0, "buy_lines": 0, "buy_qty": 0.0}
    return _cover(lines, _stock_available(session), _open_qty(session, project_no, equip_no))


def plan_release_purchase(
    session: Session, release: DesignRelease
) -> tuple[list[tuple[DemandLine, float]], dict]:
    """发布批次：这一次冻结内容的净需求。"""
    lines = release_demand(session, release)
    if not lines:
        return [], {"need_lines": 0, "need_qty": 0.0, "buy_lines": 0, "buy_qty": 0.0}
    return _cover(
        lines, _stock_available(session), _open_qty(session, release.project_no, release.equip_no)
    )


def create_release_demands(session: Session, release: DesignRelease) -> list[PurchaseRequest]:
    """发布（= 冻结）时自动进池（05 卷 §5）：BOM 一发布就进池，能合并就合并。"""
    plan, _stats = plan_release_purchase(session, release)
    source = SOURCE_CRAFT_RELEASE if release.profession == "工艺" else SOURCE_DESIGN_RELEASE
    created: list[PurchaseRequest] = []
    for line, qty in plan:
        row = PurchaseRequest(
            project_no=release.project_no,
            equip_no=release.equip_no,
            attribution="项目",
            part_no=line.part_no,
            item_no=line.item_no,
            qty=qty,
            unit=line.unit,
            source=source,
            source_release_id=release.id,
            status="待采购",
            is_long_lead=False,
            remark=f"{release.release_no} 发布冻结",
        )
        session.add(row)
        session.flush()
        created.append(row)
    return created
