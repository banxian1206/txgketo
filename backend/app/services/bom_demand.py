"""BOM → 净需求 → 待采购池（S3 常规件通道，00 卷 §3.1②）。

展开一台设备的完整 BOM：
  · 标准件：挂在图纸树任意节点上的 BomItem（设计 BOM）
  · 原材料：挂在图纸上的 BomItem（材料 BOM）
数量 = BOM 行数量 × 图纸在树上的累计倍数（父子 qty 连乘）。
再扣掉「仓库可用库存」和「这台设备已经在跑的需求」，剩下的才进池。

★ 零件归属：每条需求记住 part_no（挂在哪个图纸/零件下），
  合并下单后仍能看出「这 10 个方通分别是谁家的」。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.engineering import BOM_ROW_FROZEN, BomItem, Drawing
from app.models.initiation import PurchaseRequest
from app.models.library import Item
from app.models.warehouse import StockItem

# 还在跑（没结束）的需求算已覆盖，避免重复进池
OPEN_STATUS = ("待采购", "在途", "已下单", "待入库", "部分到货", "不合格")
# 会被采购的物品类型（自制件在车间做、外协件走外协链，不在这里买）
BUY_TYPES = ("标准件", "原材料")


@dataclass
class DemandLine:
    """BOM 展开出来的一条需求（物料 + 零件归属 + 数量）。"""

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


def equipment_demand(session: Session, project_no: str, equip_no: str) -> list[DemandLine]:
    """按设备的完整 BOM 展开粗需求（不扣库存）。"""
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
    bom_rows = session.scalars(select(BomItem).where(BomItem.project_no == project_no)).all()
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


def plan_equipment_purchase(
    session: Session, project_no: str, equip_no: str
) -> tuple[list[tuple[DemandLine, float]], dict]:
    """净需求 = BOM 需求 − 仓库可用库存 − 这台设备在跑的需求。

    返回 (要买的行, 统计)。库存/在途按「数量大的行先抵消」分摊到各零件行，
    保证总数正确、分摊确定。
    """
    lines = equipment_demand(session, project_no, equip_no)
    if not lines:
        return [], {"need_lines": 0, "need_qty": 0.0, "buy_lines": 0, "buy_qty": 0.0}

    # 仓库优先：可用库存是全局的（哪个项目先用谁先用）
    stock: dict[str, float] = {}
    for s in session.scalars(select(StockItem)).all():
        stock[s.item_no] = stock.get(s.item_no, 0.0) + (
            float(s.qty_on_hand or 0) - float(s.qty_locked or 0)
        )
    # 这台设备已在下单/在途的量（不重复买）
    open_qty: dict[str, float] = {}
    for r in session.scalars(
        select(PurchaseRequest).where(
            PurchaseRequest.project_no == project_no,
            PurchaseRequest.equip_no == equip_no,
            PurchaseRequest.status.in_(OPEN_STATUS),
        )
    ):
        remaining = max(0.0, float(r.qty or 0) - float(r.qty_received or 0))
        open_qty[r.item_no] = open_qty.get(r.item_no, 0.0) + remaining

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
