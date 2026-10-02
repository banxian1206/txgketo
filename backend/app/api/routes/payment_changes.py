"""付款计划变更单（2026-09-30 客户拍板）。

成交后改付款计划的**唯一入口**（要审批）—— 口径见 `services/payment_change.py` 顶部注释。
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user, has_permission, require_permission
from app.core.db import get_session
from app.models.payment_change import PAY_CHANGE_OPEN, PaymentChange
from app.models.platform import User
from app.services import audit
from app.services import payment_change as svc

router = APIRouter(tags=["付款计划变更"])


class PayChangeTermIn(BaseModel):
    node_name: str
    trigger_node: str | None = None
    percent: float | None = None
    amount: float | None = None
    expect_date: date | None = None
    condition: str | None = None


class PayChangeIn(BaseModel):
    reason: str = Field(..., description="为什么改（审批人要看依据）")
    terms: list[PayChangeTermIn] = Field(..., min_length=1, description="**只填还没收的节点**")


class DecideIn(BaseModel):
    approve: bool
    note: str | None = None


def _scrub(c: dict, current: User) -> dict:
    """金额分档（06 卷 F 步）：没有 `project:amount` 的人看不到金额。"""
    if has_permission(current, "project:amount"):
        return c
    out = dict(c)
    for t in out.get("before_terms") or []:
        t["amount"] = None
        t["received_amount"] = None
    for t in out.get("terms") or []:
        t["amount"] = None
    return out


@router.get("/payment-changes")
def list_payment_changes(
    scope: str = Query(default="all", description="pending=待我审批 / mine=我提交的 / all"),
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """变更单列表。pending 只返回**该我批**的（商务总监）—— 别的层级看不到，避免点了必 403。"""
    rows = session.scalars(select(PaymentChange).order_by(PaymentChange.id.desc())).all()
    if scope == "pending":
        boss = svc.approver_for(session)
        if boss is None or boss.id != current.id:
            return []
        rows = [r for r in rows if r.status in PAY_CHANGE_OPEN and r.requested_by != current.id]
    elif scope == "mine":
        rows = [r for r in rows if r.requested_by == current.id]
    return [_scrub(svc.change_dict(session, r), current) for r in rows]


@router.get("/projects/{project_no}/payment-changes")
def list_project_payment_changes(
    project_no: str,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """某个项目的付款计划变更记录（项目详情「合同与商务」里看）。"""
    rows = session.scalars(
        select(PaymentChange)
        .where(PaymentChange.project_no == project_no)
        .order_by(PaymentChange.id.desc())
    ).all()
    return [_scrub(svc.change_dict(session, r), current) for r in rows]


@router.post(
    "/projects/{project_no}/payment-changes",
    status_code=status.HTTP_201_CREATED,
)
def create_payment_change(
    project_no: str,
    body: PayChangeIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("payment:edit")),
):
    """发起付款计划变更（只填**还没收**的节点）。"""
    c = svc.submit(
        session,
        project_no=project_no,
        reason=body.reason,
        terms=[t.model_dump() for t in body.terms],
        actor=current,
    )
    audit.log(
        session,
        user=current,
        action="submit",
        object_type="payment_change",
        object_ref=c.change_no,
        summary=f"付款计划变更 {c.change_no}（{project_no}）：{body.reason}（{len(body.terms)} 个未收节点）",
        ip=client_ip(request),
    )
    session.commit()
    return svc.change_dict(session, c)


@router.get("/payment-changes/{change_id}")
def get_payment_change(
    change_id: int,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    c = session.get(PaymentChange, change_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "变更单不存在")
    return _scrub(svc.change_dict(session, c), current)


@router.post("/payment-changes/{change_id}/decide")
def decide_payment_change(
    change_id: int,
    body: DecideIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("payment:edit")),
):
    """商务总监审批：批准 = 未收节点按新计划替换（已收的原样保留）；否决必填理由。"""
    c = session.get(PaymentChange, change_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "变更单不存在")
    svc.decide(session, c, approve=body.approve, note=body.note, actor=current)
    audit.log(
        session,
        user=current,
        action="approve" if body.approve else "reject",
        object_type="payment_change",
        object_ref=c.change_no,
        summary=f"付款计划变更 {c.change_no} {'已批准' if body.approve else '已否决'}"
        + (f"：{body.note}" if body.note else ""),
        ip=client_ip(request),
    )
    session.commit()
    return svc.change_dict(session, c)


@router.post("/payment-changes/{change_id}/withdraw")
def withdraw_payment_change(
    change_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("payment:edit")),
):
    """提交人撤回（待审 → 已撤销）。"""
    c = session.get(PaymentChange, change_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "变更单不存在")
    svc.withdraw(session, c, actor=current)
    audit.log(
        session,
        user=current,
        action="withdraw",
        object_type="payment_change",
        object_ref=c.change_no,
        summary=f"付款计划变更 {c.change_no} 已撤回",
        ip=client_ip(request),
    )
    session.commit()
    return svc.change_dict(session, c)
