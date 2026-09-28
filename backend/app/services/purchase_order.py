"""采购单实体化：建单 + 需求状态同步（《08 采购域重构方案》§3/§4 · 一期）。

一期不建审批：PO 建出来直接「已批准」（二期再插两级审批）。

**关键变化**：下单**不再改写 `purchase_request.qty`**（那是需求数量，上游定的），
改为累加 `qty_ordered`；一条需求可拆到多张单的多行（客户口径 #1）。
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ForbiddenOperation
from app.models.initiation import PurchaseRequest
from app.models.platform import POSITION_DIRECTOR, POSITION_LEAD, User
from app.models.purchase_order import (
    APPR_LEVEL_DIRECTOR,
    APPR_LEVEL_LEAD,
    PAY_UNPAID,
    PO_APPROVED,
    PO_DONE,
    PO_DRAFT,
    PO_EXECUTING,
    PO_LINE_OPEN,
    PO_PENDING_DIRECTOR,
    PO_PENDING_LEAD,
    PO_RETURNED,
    PurchaseApproval,
    PurchaseOrder,
    PurchaseOrderLine,
    compute_line_amounts,
)
from app.services.numbering import next_number
from app.services.reviewers import director_for, lead_for_dept


class PurchaseOrderError(ValueError):
    """采购单业务规则错误（路由转 400）。"""


# 已生效（供应商即接单）
PO_LIVE_STATUS = (PO_APPROVED, PO_EXECUTING, PO_DONE)


def _now() -> datetime:
    return datetime.now(UTC)


def ordered_qty(session: Session, request_id: int) -> float:
    """某条需求的有效已下单量（排除已退货/已取消的行）。"""
    total = session.scalar(
        select(func.coalesce(func.sum(PurchaseOrderLine.qty), 0)).where(
            PurchaseOrderLine.request_id == request_id,
            PurchaseOrderLine.status.not_in(("已退货", "已取消")),
        )
    )
    return float(total or 0)


def _ordered_and_approved(session: Session, request_id: int) -> tuple[float, bool]:
    rows = session.execute(
        select(PurchaseOrderLine.qty, PurchaseOrder.status)
        .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderLine.po_id)
        .where(
            PurchaseOrderLine.request_id == request_id,
            PurchaseOrderLine.status.not_in(("已退货", "已取消")),
        )
    ).all()
    ordered = sum(float(q or 0) for q, _ in rows)
    approved = any(st in PO_LIVE_STATUS for _, st in rows)
    return ordered, approved


def sync_request_order_state(session: Session, row: PurchaseRequest) -> float:
    """重算需求状态：待采购 / 审批中（有单未批）/ 在途 / 部分下单（已批未下满）。

    只在需求还处于下单阶段时改状态；已进入收货流程的由 `_recalc_request_status` 负责。
    """
    ordered, approved = _ordered_and_approved(session, row.id)
    row.qty_ordered = ordered
    if row.status in ("待采购", "部分下单", "审批中", "在途"):
        need = float(row.qty or 0)
        if ordered <= 1e-9:
            row.status = "待采购"
        elif not approved:
            row.status = "审批中"
        elif ordered + 1e-9 >= need:
            row.status = "在途"
        else:
            row.status = "部分下单"
    return ordered


def resolve_po_chain(session: Session, submitter: User) -> tuple[User | None, User]:
    """返回（一级采购经理 | None, 二级采购总监）。一级 None = 提交人是经理，跳过。"""
    if submitter.position == POSITION_DIRECTOR:
        raise PurchaseOrderError("总监不提交采购单（他负责审批）；请用采购员/经理的账号提交")
    lead = None if submitter.position == POSITION_LEAD else lead_for_dept(session, submitter)
    boss = director_for(session, submitter)
    if boss is None:
        raise PurchaseOrderError("没找到采购总监，先到「用户与权限」配审核人")
    return lead, boss


def submit_order(session: Session, po: PurchaseOrder, submitter: User) -> str:
    """提交审批：草稿 / 已退回 → 待经理审（经理本人提交则直接待总监审，留一条「跳过」）。"""
    if po.status not in (PO_DRAFT, PO_RETURNED):
        raise PurchaseOrderError(f"当前状态是「{po.status}」，不能提交")
    lead, _ = resolve_po_chain(session, submitter)
    if lead is None:
        session.add(
            PurchaseApproval(
                po_id=po.id,
                round_no=po.round,
                level=APPR_LEVEL_LEAD,
                reviewer_id=None,
                action="跳过",
                note="无采购经理，自动跳级给总监",
                acted_at=_now(),
            )
        )
        po.status = PO_PENDING_DIRECTOR
    else:
        po.status = PO_PENDING_LEAD
    session.flush()
    return po.status


def approve_order(
    session: Session,
    po: PurchaseOrder,
    user: User,
    action: str,
    note: str | None,
    price_snapshot: dict | None = None,
) -> str:
    """两级审批：通过 / 退回（退回必填说明，round+1，全部留档）。审批通过 → 已批准。"""
    submitter = session.get(User, po.created_by) if po.created_by else None
    if po.status == PO_PENDING_LEAD:
        lead, _ = resolve_po_chain(session, submitter) if submitter else (None, None)
        if lead is None:
            raise PurchaseOrderError("经理空缺（提交时应已自动跳级）；请让总监审核")
        if lead.id != user.id:
            raise ForbiddenOperation("只有本部门采购经理能审这一级")
        level = APPR_LEVEL_LEAD
    elif po.status == PO_PENDING_DIRECTOR:
        _, boss = resolve_po_chain(session, submitter) if submitter else (None, None)
        if boss is None:
            raise PurchaseOrderError("本部门还没配采购总监——先到「用户与权限」配审核人")
        if boss.id != user.id:
            raise ForbiddenOperation("只有本部门采购总监能审这一级")
        level = APPR_LEVEL_DIRECTOR
    else:
        raise PurchaseOrderError(f"当前状态是「{po.status}」，不在审批中")

    if action == "退回":
        if not (note or "").strip():
            raise PurchaseOrderError("退回必须填写说明")
        po.status = PO_RETURNED
        po.round = int(po.round or 1) + 1
    elif action == "通过":
        po.status = PO_APPROVED if level == APPR_LEVEL_DIRECTOR else PO_PENDING_DIRECTOR
    else:
        raise PurchaseOrderError("审批动作只能是 通过 / 退回")
    session.add(
        PurchaseApproval(
            po_id=po.id,
            round_no=po.round,
            level=level,
            reviewer_id=user.id,
            action=action,
            note=(note or "").strip() or None,
            price_flags=price_snapshot,
            acted_at=_now(),
        )
    )
    session.flush()
    return po.status


def withdraw_order(session: Session, po: PurchaseOrder, user: User) -> str:
    """提交人撤回（待经理审/待总监审 → 草稿，解锁可改）。"""
    if po.status not in (PO_PENDING_LEAD, PO_PENDING_DIRECTOR):
        raise PurchaseOrderError(f"当前状态是「{po.status}」，不能撤回")
    if po.created_by != user.id and not user.is_superuser:
        raise ForbiddenOperation("只有提交人能撤回")
    po.status = PO_DRAFT
    session.add(
        PurchaseApproval(
            po_id=po.id,
            round_no=po.round,
            level=0,
            reviewer_id=user.id,
            action="撤回",
            acted_at=_now(),
        )
    )
    session.flush()
    return po.status


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


def recalc_order_total(session: Session, po: PurchaseOrder) -> None:
    """按单行重算单头含税/不含税合计（+ 运费 − 折扣）。"""
    lines = session.scalars(
        select(PurchaseOrderLine).where(PurchaseOrderLine.po_id == po.id)
    ).all()
    incl = sum(float(x.amount_tax_incl or 0) for x in lines)
    excl = sum(float(x.amount_tax_excl or 0) for x in lines)
    extra = float(po.freight or 0) - float(po.discount or 0)
    po.total_tax_incl = round(incl + extra, 2)
    po.total_tax_excl = round(excl + extra, 2)


def recalc_order_status(session: Session, po: PurchaseOrder) -> None:
    """按单行状态重算单头状态（已作废/已关闭 不动）。"""
    if po.status in ("已作废", "已关闭"):
        return
    lines = session.scalars(
        select(PurchaseOrderLine).where(PurchaseOrderLine.po_id == po.id)
    ).all()
    st = {x.status for x in lines}
    if st and st <= {"已入库", "已退货", "已取消"}:
        po.status = "已完成"
    elif any(float(x.received_qty or 0) > 0 for x in lines) or "不合格" in st:
        po.status = "执行中"


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
