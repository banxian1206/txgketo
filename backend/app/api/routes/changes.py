"""改版申请（ECN）接口（05 卷 §7）：提申请 → 总监裁决 → 下发改版任务 → 修订 → 重审发布。

影响面只读展示（已生成采购需求/已领料），人工处理，不自动改。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user
from app.core.db import get_session
from app.models.change import CR_PENDING, TARGET_LABELS, ChangeRequest
from app.models.platform import User
from app.models.review import DesignRelease
from app.models.task import Task
from app.services import change_flow
from app.services.change_flow import ChangeFlowError

router = APIRouter(tags=["改版申请"])


def _names(session: Session) -> dict[int, str]:
    return {u.id: u.name for u in session.scalars(select(User)).all()}


def _cr_dict(session: Session, cr: ChangeRequest, names: dict[int, str]) -> dict:
    try:
        info = change_flow.target_info(session, cr.target_type, cr.target_ref)
        target_title = info["title"]
        profession = info["profession"]
    except ChangeFlowError:
        target_title = cr.target_ref
        profession = None
    task = session.get(Task, cr.change_task_id) if cr.change_task_id else None
    release = session.get(DesignRelease, cr.new_release_id) if cr.new_release_id else None
    return {
        "id": cr.id,
        "cr_no": cr.cr_no,
        "project_no": cr.project_no,
        "equip_no": cr.equip_no,
        "target_type": cr.target_type,
        "target_label": TARGET_LABELS.get(cr.target_type, cr.target_type),
        "target_ref": cr.target_ref,
        "target_version": cr.target_version,
        "target_title": target_title,
        "profession": profession,
        "part_no": cr.part_no,
        "reason": cr.reason,
        "proposal": cr.proposal,
        "applicant_id": cr.applicant_id,
        "applicant_name": names.get(cr.applicant_id) if cr.applicant_id else None,
        "status": cr.status,
        "decided_by_name": names.get(cr.decided_by) if cr.decided_by else None,
        "decided_at": cr.decided_at,
        "decision_note": cr.decision_note,
        "solution": cr.solution,
        "change_task_id": cr.change_task_id,
        "change_task_no": task.task_no if task else None,
        "change_task_owner_id": task.owner_id if task else None,
        "change_task_owner": names.get(task.owner_id) if task and task.owner_id else None,
        "change_task_status": task.status if task else None,
        "new_release_id": cr.new_release_id,
        "new_release_no": release.release_no if release else None,
        "archived_at": cr.archived_at,
        "created_at": cr.created_at,
        "updated_at": cr.updated_at,
    }


def _get_cr(session: Session, cr_id: int) -> ChangeRequest:
    row = session.get(ChangeRequest, cr_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "改版申请不存在")
    return row


@router.get("/change-requests")
def list_change_requests(
    scope: str = Query(default="all", description="all / pending / mine / todo"),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = 200,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    stmt = select(ChangeRequest).order_by(ChangeRequest.id.desc())
    if scope == "pending":
        stmt = stmt.where(ChangeRequest.status == CR_PENDING)
    elif scope == "mine":
        stmt = stmt.where(ChangeRequest.applicant_id == current.id)
    elif scope == "todo":
        task_ids = select(Task.id).where(
            Task.ref_type == "change_request", Task.owner_id == current.id
        )
        stmt = stmt.where(ChangeRequest.change_task_id.in_(task_ids))
    if status_filter:
        stmt = stmt.where(ChangeRequest.status == status_filter)
    rows = session.scalars(stmt.limit(min(limit, 500))).all()
    names = _names(session)
    return [_cr_dict(session, r, names) for r in rows]


class ChangeRequestIn(BaseModel):
    target_type: str = Field(description="DRAWING / PROGRAM / BOM_ITEM")
    target_ref: str = Field(description="图号 / program_id / bom_item.id")
    reason: str = Field(description="问题是什么")
    proposal: str | None = Field(default=None, description="建议怎么改")


@router.post("/change-requests", status_code=status.HTTP_201_CREATED)
def create_change_request(
    body: ChangeRequestIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """任何部门/个人都能提（05 卷 §0.1#7）。"""
    try:
        cr = change_flow.create_request(
            session, current, body.target_type, body.target_ref, body.reason, body.proposal,
            client_ip(request),
        )
    except ChangeFlowError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    session.commit()
    return _cr_dict(session, cr, _names(session))


@router.get("/change-requests/{cr_id}")
def get_change_request(
    cr_id: int, session: Session = Depends(get_session), _: User = Depends(get_current_user)
):
    return _cr_dict(session, _get_cr(session, cr_id), _names(session))


class DecideIn(BaseModel):
    decision: str = Field(description="批准 / 否决")
    note: str = ""
    solution: str = Field(default="", description="否决时必填：替代方案/处理办法")


@router.post("/change-requests/{cr_id}/decide")
def decide_change_request(
    cr_id: int,
    body: DecideIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    cr = _get_cr(session, cr_id)
    try:
        change_flow.decide(session, cr, current, body.decision, body.note, body.solution, client_ip(request))
    except ChangeFlowError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    session.commit()
    return _cr_dict(session, cr, _names(session))


class DispatchIn(BaseModel):
    assignee_id: int


@router.post("/change-requests/{cr_id}/dispatch")
def dispatch_change_request(
    cr_id: int,
    body: DispatchIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    cr = _get_cr(session, cr_id)
    try:
        change_flow.dispatch(session, cr, current, body.assignee_id, client_ip(request))
    except ChangeFlowError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    session.commit()
    return _cr_dict(session, cr, _names(session))


class ReviseBomIn(BaseModel):
    qty: float | None = Field(default=None, gt=0)
    child_item_no: str | None = None
    pos_no: str | None = None
    remark: str | None = None


@router.post("/change-requests/{cr_id}/revise-bom", status_code=status.HTTP_201_CREATED)
def revise_bom(
    cr_id: int,
    body: ReviseBomIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """BOM 行改版：生成一条草稿替代行（旧行标记被替代；新行随评审发布冻结）。"""
    cr = _get_cr(session, cr_id)
    try:
        new = change_flow.revise_bom(
            session, cr, current, body.qty, body.child_item_no, body.pos_no, body.remark,
            client_ip(request),
        )
    except ChangeFlowError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    session.commit()
    return {"ok": True, "bom_id": new.id, "status": new.status}


@router.get("/change-requests/{cr_id}/impact")
def change_impact(
    cr_id: int, session: Session = Depends(get_session), _: User = Depends(get_current_user)
):
    """影响面：已生成的采购需求 + 已领料（只提示，人工处理）。"""
    return change_flow.impact(session, _get_cr(session, cr_id))
