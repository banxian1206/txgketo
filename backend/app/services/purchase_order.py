"""采购单实体化：建单 + 需求状态同步（《08 采购域重构方案》§3/§4 · 一期）。

一期不建审批：PO 建出来直接「已批准」（二期再插两级审批）。

**关键变化**：下单**不再改写 `purchase_request.qty`**（那是需求数量，上游定的），
改为累加 `qty_ordered`；一条需求可拆到多张单的多行（客户口径 #1）。
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.initiation import PurchaseRequest
from app.models.purchase_order import (
    PAY_UNPAID,
    PO_APPROVED,
    PO_LINE_OPEN,
    PurchaseOrder,
    PurchaseOrderLine,
    compute_line_amounts,
)
from app.services.numbering import next_number


class PurchaseOrderError(ValueError):
    """采购单业务规则错误（路由转 400）。"""


def ordered_qty(session: Session, request_id: int) -> float:
    """某条需求的有效已下单量（排除已退货/已取消的行）。"""
    total = session.scalar(
        select(func.coalesce(func.sum(PurchaseOrderLine.qty), 0)).where(
            PurchaseOrderLine.request_id == request_id,
            PurchaseOrderLine.status.not_in(("已退货", "已取消")),
        )
    )
    return float(total or 0)


def sync_request_order_state(session: Session, row: PurchaseRequest) -> float:
    """重算「已下单量」与下单相关状态（待采购 / 部分下单 / 在途）。

    只在需求还处于下单阶段时改状态；已进入收货流程的状态由 `_recalc_request_status` 负责。
    """
    row.qty_ordered = ordered_qty(session, row.id)
    if row.status in ("待采购", "部分下单", "审批中"):
        need = float(row.qty or 0)
        if row.qty_ordered <= 1e-9:
            row.status = "待采购"
        elif row.qty_ordered + 1e-9 >= need:
            row.status = "在途"
        else:
            row.status = "部分下单"
    return row.qty_ordered


def assert_no_over_order(session: Session, request_id: int, add_qty: float) -> float:
    """超拆硬拦（客户口径 #9）：已下单 + 本次 ≤ 需求。返回剩余可下量。"""
    row = session.get(PurchaseRequest, request_id)
    if row is None:
        raise PurchaseOrderError(f"需求不存在：{request_id}")
    need = float(row.qty or 0)
    already = ordered_qty(session, request_id)
    if already + float(add_qty) > need + 1e-9:
        raise PurchaseOrderError(
            f"{row.item_no} 超拆：需求 {need:g}，已下单 {already:g}，本次 {float(add_qty):g}"
        )
    return need - already


def create_order(
    session: Session,
    *,
    supplier_id: int | None,
    supplier_name: str | None,
    order_date: date,
    expect_date: date | None,
    deliver_to: str,
    deliver_address: str | None,
    lines: list[dict],
    actor_id: int | None,
    po_no: str | None = None,
    tax_rate: float | None = None,
    freight: float | None = None,
    discount: float | None = None,
    status: str = PO_APPROVED,
    remark: str | None = None,
) -> PurchaseOrder:
    """建一张采购单（单头 + 多行）并同步各需求的下单状态。

    `lines` 每项：{request_id, qty, unit_price?, tax_incl?, tax_rate?, expect_date?, unit?}
    """
    if not lines:
        raise PurchaseOrderError("至少要有一行")
    po = PurchaseOrder(
        po_no=po_no or next_number(session, "PURCHASE_ORDER"),
        supplier_id=supplier_id,
        supplier_name=supplier_name,
        order_date=order_date,
        expect_date=expect_date,
        deliver_to=deliver_to,
        deliver_address=deliver_address,
        tax_rate=tax_rate,
        freight=freight,
        discount=discount,
        status=status,
        pay_status=PAY_UNPAID,
        round=1,
        created_by=actor_id,
        remark=remark,
    )
    session.add(po)
    session.flush()

    total_incl = 0.0
    total_excl = 0.0
    for ln in lines:
        req = session.get(PurchaseRequest, ln["request_id"]) if ln.get("request_id") else None
        qty = float(ln["qty"] or 0)
        unit_price = ln.get("unit_price")
        incl = bool(ln.get("tax_incl", True))
        rate = ln.get("tax_rate", tax_rate)
        amount_incl, amount_excl = compute_line_amounts(qty, unit_price, incl, rate)
        session.add(
            PurchaseOrderLine(
                po_id=po.id,
                request_id=req.id if req else None,
                item_no=ln.get("item_no") or (req.item_no if req else None),
                part_no=req.part_no if req else None,
                project_no=req.project_no if req else None,
                equip_no=req.equip_no if req else None,
                qty=qty,
                unit=ln.get("unit") or (req.unit if req else None),
                unit_price=unit_price,
                tax_incl=incl,
                tax_rate=rate,
                amount_tax_incl=amount_incl,
                amount_tax_excl=amount_excl,
                expect_date=ln.get("expect_date") or expect_date,
                status=PO_LINE_OPEN,
            )
        )
        if amount_incl is not None:
            total_incl += float(amount_incl)
        if amount_excl is not None:
            total_excl += float(amount_excl)
    session.flush()

    extra = float(freight or 0) - float(discount or 0)
    po.total_tax_incl = round(total_incl + extra, 2)
    po.total_tax_excl = round(total_excl + extra, 2)
    session.flush()

    for rid in {ln["request_id"] for ln in lines if ln.get("request_id")}:
        sync_request_order_state(session, session.get(PurchaseRequest, rid))
    session.flush()
    return po


def sync_request_snapshot(session: Session, row: PurchaseRequest) -> None:
    """把需求上的「单头快照」列同步成它当前订单的样子（过渡兼容层）。

    ★ 这些列（po_no/supplier/ordered_at/unit_price/...）在新结构里本属单头/单行，
    这里只做**展示用快照**：取该需求最近一张单。真正的归属以 `purchase_order_line` 为准。
    `expected_date` 是派生值 = 该需求所有有效行的最小预计到货（08 §3.4）。
    """
    line = session.scalar(
        select(PurchaseOrderLine)
        .where(PurchaseOrderLine.request_id == row.id)
        .order_by(PurchaseOrderLine.id.desc())
    )
    if line is None:
        return
    po = session.get(PurchaseOrder, line.po_id)
    dates = [
        x
        for x in session.scalars(
            select(PurchaseOrderLine.expect_date).where(PurchaseOrderLine.request_id == row.id)
        ).all()
        if x is not None
    ]
    row.expected_date = min(dates) if dates else row.expected_date
    if po is not None:
        row.po_no = po.po_no
        row.supplier_id = po.supplier_id
        row.supplier_name = po.supplier_name
        row.ordered_at = po.order_date
        row.deliver_to = po.deliver_to
        row.deliver_address = po.deliver_address
    row.unit_price = line.unit_price
    row.amount = line.amount_tax_incl
    session.flush()
