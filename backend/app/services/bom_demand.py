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

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.engineering import BOM_ROW_FROZEN, BomItem, Drawing
from app.models.initiation import (
    SOURCE_CRAFT_RELEASE,
    SOURCE_DESIGN_RELEASE,
    PurchaseRequest,
)
from app.models.library import Item
from app.models.review import DesignRelease
from app.models.warehouse import MaterialIssue, MaterialIssueLine, StockItem
from app.services import notify
from app.services.bom_math import (
    bom_line_demand,
    cumulative_qty,
    drawing_demand,
    scaled_qty,
)

# 还在跑（没结束）的需求算已覆盖，避免重复进池。
# ★ 去掉死值「已下单」（旧中间态已废弃，迁移 e9c06543ffaa）；补「现场待验收」（直发在途也要占位）
OPEN_STATUS = ("待采购", "在途", "待入库", "现场待验收", "部分到货", "不合格")
# 直发件：货直接到客户现场、**从不进公司库存** → 必须在抵扣里，否则现场验收后会重复进池（08 §8.2 场景 A）
COVER_STATUS = OPEN_STATUS + ("现场已验收",)
# 会被采购的物品类型（05 卷 §5）
BUY_TYPES = ("标准件", "定制件", "外协件", "原材料")


@dataclass
class DemandLine:
    """展开出来的一条需求（物料 + 零件归属 + 数量）。"""

    item_no: str
    part_no: str | None
    qty: float
    unit: str | None


def _stock_available(session: Session) -> dict[str, float]:
    stock: dict[str, float] = {}
    for s in session.scalars(select(StockItem)).all():
        stock[s.item_no] = stock.get(s.item_no, 0.0) + (
            float(s.qty_on_hand or 0) - float(s.qty_locked or 0)
        )
    return stock


def _covered_qty(session: Session, project_no: str | None, equip_no: str | None) -> dict[str, float]:
    """已经买过 / 已计划的需求量（净需求抵扣）。

    ★ 用**整条 `qty`**，不用 `qty − qty_received`：
      `qty_received` 含「待入库 / 现场待验收」的 pending，会让这部分「两头都不覆盖」→ 重复进池
      （08 §8.2 场景 B）。当前系统「一条需求只属于一张单」，所以 `qty` 就是已承诺量
      （一期拆单后才改用 `qty_ordered`）。
    """
    if project_no is None:
        return {}
    covered: dict[str, float] = {}
    stmt = select(PurchaseRequest).where(
        PurchaseRequest.project_no == project_no,
        PurchaseRequest.status.in_(COVER_STATUS),
    )
    if equip_no is not None:
        stmt = stmt.where(PurchaseRequest.equip_no == equip_no)
    for r in session.scalars(stmt):
        covered[r.item_no] = covered.get(r.item_no, 0.0) + float(r.qty or 0)
    return covered


def _issued_to_workshop(
    session: Session, project_no: str | None, equip_no: str | None
) -> dict[str, float]:
    """本项目已领走到车间的量（领料单「已领走」）—— 从净需求视角这些料算已覆盖。

    用 `qty_issued`（实发），不是 `qty_required`（需求）：缺料行实发 0，不能算领到（08 §8.3-c）。
    """
    if project_no is None:
        return {}
    stmt = (
        select(MaterialIssueLine.item_no, func.sum(MaterialIssueLine.qty_issued))
        .join(MaterialIssue, MaterialIssue.id == MaterialIssueLine.issue_id)
        .where(
            MaterialIssue.project_no == project_no,
            MaterialIssue.status.in_(("已领走", "部分领料")),
        )
        .group_by(MaterialIssueLine.item_no)
    )
    if equip_no is not None:
        stmt = stmt.where(MaterialIssue.equip_no == equip_no)
    return {item_no: float(qty or 0) for item_no, qty in session.execute(stmt).all()}


def _total_cover(session: Session, project_no: str | None, equip_no: str | None) -> dict[str, float]:
    """净需求抵扣总量 = 可用库存 + 已领到车间 + 已承诺/已计划/已直发（08 §8.2 订正公式）。"""
    cover = {item_no: max(qty, 0.0) for item_no, qty in _stock_available(session).items()}
    for source in (
        _covered_qty(session, project_no, equip_no),
        _issued_to_workshop(session, project_no, equip_no),
    ):
        for item_no, qty in source.items():
            cover[item_no] = cover.get(item_no, 0.0) + qty
    return cover


def _cover(
    lines: list[DemandLine], cover: dict[str, float]
) -> tuple[list[tuple[DemandLine, float]], dict]:
    """净需求 = 需求 − 已抵扣量（数量大的行先抵消，保证总数正确、分摊确定）。"""
    plan: list[tuple[DemandLine, float]] = []
    for item_no in sorted({l.item_no for l in lines}):
        remaining_cover = cover.get(item_no, 0.0)
        for line in sorted((x for x in lines if x.item_no == item_no), key=lambda x: -x.qty):
            take = min(line.qty, remaining_cover)
            remaining_cover -= take
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
    cum = cumulative_qty(drawings)
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
        key = (b.child_item_no, b.parent_ref)
        need[key] = need.get(key, 0.0) + bom_line_demand(b, cum)

    # 有图号的「定制件 / 外协件」（图号即物料号）：已发布就计入净需求（总装图除外）
    for d in drawings:
        if d.parent_drawing_no is None:
            continue  # 总装图是装配对象，不是采购件
        if d.status != "已发布" or d.source_type not in ("定制件", "外协件"):
            continue
        item = items.get(d.drawing_no)
        if item is None or item.source_type not in BUY_TYPES:
            continue
        key = (d.drawing_no, d.drawing_no)
        need[key] = need.get(key, 0.0) + drawing_demand(d, cum)

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
    cum = cumulative_qty(drawings)
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
        add(item_no, parent, scaled_qty(entry.get("qty"), parent, cum))

    # ② 机械/电气发布：这次冻结的「定制件（外购）」图纸
    for entry in summary.get("drawings", []):
        d = session.get(Drawing, entry.get("drawing_no"))
        if d is None or d.source_type != "定制件":
            continue
        item = items.get(d.drawing_no)
        if item is None or item.source_type != "定制件":
            continue
        add(d.drawing_no, d.drawing_no, drawing_demand(d, cum))

    # ③ 工艺发布：判定为「外协件 / 定制件」的零件（都要外购，自动进池）
    for entry in summary.get("source_tags", []):
        if entry.get("new") not in ("外协件", "定制件"):
            continue
        d = session.get(Drawing, entry.get("drawing_no"))
        if d is None or items.get(d.drawing_no) is None:
            continue
        add(d.drawing_no, d.drawing_no, drawing_demand(d, cum))

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
    return _cover(lines, _total_cover(session, project_no, equip_no))


def plan_release_purchase(
    session: Session, release: DesignRelease
) -> tuple[list[tuple[DemandLine, float]], dict]:
    """发布批次：这一次冻结内容的净需求。"""
    lines = release_demand(session, release)
    if not lines:
        return [], {"need_lines": 0, "need_qty": 0.0, "buy_lines": 0, "buy_qty": 0.0}
    return _cover(lines, _total_cover(session, release.project_no, release.equip_no))


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
    if created:
        # ★ 站内消息：发布冻结 → 提醒采购（06 卷 §9；一个批次提醒一次）
        notify.notify_role(
            session,
            "PURCHASE",
            type_=notify.TYPE_PURCHASE,
            title=f"{release.release_no} 发布冻结，新增采购需求",
            link="/purchase",
            biz_type="design_release",
            biz_id=release.id,
        )
    return created
