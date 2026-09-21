"""设计评审接口（05 卷 §3）：提交 → 组长 → 总监 → 发布；撤回；评审单查询。

- 提交/审核的规则都在 `services/review_flow.py`，这里只做 HTTP 包装与序列化。
- 「我组任务」在任务接口（`/my-tasks?scope=team`），评审工作台在 `/review-tickets?scope=todo`。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user
from app.core.db import get_session
from app.models.platform import POSITION_DIRECTOR, POSITION_LEAD, User
from app.models.review import (
    REVIEW_ITEM_LABELS,
    TICKET_PENDING_DIRECTOR,
    TICKET_PENDING_LEAD,
    DesignRelease,
    ReviewAction,
    ReviewTicket,
    ReviewTicketItem,
)
from app.models.task import Task
from app.services import review_flow
from app.services.review_flow import ReviewFlowError

router = APIRouter(tags=["设计评审"])


# ---------------------------------------------------------------------------
# 序列化
# ---------------------------------------------------------------------------


def _names(session: Session) -> dict[int, str]:
    return {u.id: u.name for u in session.scalars(select(User)).all()}


def _ticket_brief(
    session: Session, t: ReviewTicket, names: dict[int, str], tasks: dict[int, Task]
) -> dict:
    task = tasks.get(t.task_id)
    return {
        "id": t.id,
        "ticket_no": t.ticket_no,
        "task_id": t.task_id,
        "task_no": task.task_no if task else None,
        "task_title": task.title if task else None,
        "project_no": t.project_no,
        "equip_no": t.equip_no,
        "profession": t.profession,
        "submitter_id": t.submitter_id,
        "submitter_name": names.get(t.submitter_id) if t.submitter_id else None,
        "status": t.status,
        "current_round": t.current_round,
        "created_at": t.created_at,
        "updated_at": t.updated_at,
    }


def _ticket_detail(session: Session, t: ReviewTicket) -> dict:
    names = _names(session)
    tasks = {task.id: task for task in session.scalars(select(Task).where(Task.id == t.task_id)).all()}
    items = session.scalars(
        select(ReviewTicketItem)
        .where(ReviewTicketItem.ticket_id == t.id)
        .order_by(ReviewTicketItem.round_no, ReviewTicketItem.id)
    ).all()
    actions = session.scalars(
        select(ReviewAction)
        .where(ReviewAction.ticket_id == t.id)
        .order_by(ReviewAction.round_no, ReviewAction.id)
    ).all()
    releases = session.scalars(
        select(DesignRelease).where(DesignRelease.ticket_id == t.id).order_by(DesignRelease.id)
    ).all()
    out = _ticket_brief(session, t, names, tasks)
    out["items"] = [
        {
            "id": it.id,
            "round_no": it.round_no,
            "item_type": it.item_type,
            "item_label": REVIEW_ITEM_LABELS.get(it.item_type, it.item_type),
            "item_ref": it.item_ref,
            "version": it.version,
            "snapshot": it.snapshot,
            "submitted_by": it.submitted_by,
            "submitted_by_name": names.get(it.submitted_by) if it.submitted_by else None,
            "submitted_at": it.submitted_at,
        }
        for it in items
    ]
    out["actions"] = [
        {
            "id": a.id,
            "round_no": a.round_no,
            "level": a.level,
            "reviewer_id": a.reviewer_id,
            "reviewer_name": names.get(a.reviewer_id) if a.reviewer_id else None,
            "action": a.action,
            "note": a.note,
            "acted_at": a.acted_at,
        }
        for a in actions
    ]
    out["releases"] = [
        {
            "release_no": r.release_no,
            "round_no": r.round_no,
            "released_by_name": names.get(r.released_by) if r.released_by else None,
            "released_at": r.released_at,
            "summary": r.summary,
        }
        for r in releases
    ]
    return out


def _get_ticket(session: Session, ticket_id: int) -> ReviewTicket:
    row = session.get(ReviewTicket, ticket_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "评审单不存在")
    return row


# ---------------------------------------------------------------------------
# 提交（设计师）
# ---------------------------------------------------------------------------


class SelectionIn(BaseModel):
    item_type: str = Field(description="DRAWING / BOM_DESIGN / BOM_MATERIAL / SOURCE_TAG / PROGRAM")
    item_ref: str = Field(description="图号 / bom_item.id / 程序版本 id")
    source_type: str | None = Field(default=None, description="SOURCE_TAG 用：自制件/外协件/定制件")


class SubmitReviewIn(BaseModel):
    items: list[SelectionIn] = Field(min_length=1)
    note: str = ""


@router.get("/tasks/{task_id}/review-candidates")
def review_candidates(
    task_id: int,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """我这条任务下，还在草稿态、可以勾选提交的内容。"""
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "任务不存在")
    if task.owner_id != current.id and not current.is_superuser:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "只能看自己负责的任务")
    return review_flow.candidates(session, task)


@router.post("/tasks/{task_id}/submit-review", status_code=status.HTTP_201_CREATED)
def submit_review(
    task_id: int,
    body: SubmitReviewIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """勾选提交评审：一张任务级评审单，多轮共用（05 卷 §3.1）。"""
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "任务不存在")
    try:
        ticket = review_flow.submit_round(
            session, task, current, [m.model_dump() for m in body.items], body.note, client_ip(request)
        )
    except ReviewFlowError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    session.commit()
    return _ticket_detail(session, ticket)


# ---------------------------------------------------------------------------
# 评审单查询 / 审核 / 撤回
# ---------------------------------------------------------------------------


@router.get("/tasks/{task_id}/review-ticket")
def ticket_by_task(
    task_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """这条任务的评审单（没有就是 null，说明还没提交过）。"""
    t = review_flow.ticket_for_task(session, task_id)
    return _ticket_detail(session, t) if t else None


@router.get("/review-tickets")
def list_tickets(
    scope: str = Query(default="mine", description="mine=我提交的 / todo=待我审核 / all=全部"),
    status_filter: str | None = Query(default=None, alias="status"),
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    stmt = select(ReviewTicket).order_by(ReviewTicket.id.desc())
    if scope == "todo":
        if current.position == POSITION_DIRECTOR:
            stmt = stmt.where(ReviewTicket.status == TICKET_PENDING_DIRECTOR)
        elif current.position == POSITION_LEAD:
            stmt = stmt.where(
                ReviewTicket.status == TICKET_PENDING_LEAD,
                ReviewTicket.profession == current.profession,
            )
        else:
            stmt = stmt.where(ReviewTicket.id < 0)  # 不是审核人：待办为空
    elif scope == "mine":
        stmt = stmt.where(ReviewTicket.submitter_id == current.id)
    if status_filter:
        stmt = stmt.where(ReviewTicket.status == status_filter)
    rows = session.scalars(stmt.limit(200)).all()
    tasks = {
        t.id: t
        for t in session.scalars(select(Task).where(Task.id.in_({r.task_id for r in rows}))).all()
    }
    names = _names(session)
    return [_ticket_brief(session, r, names, tasks) for r in rows]


@router.get("/review-tickets/{ticket_id}")
def get_ticket(
    ticket_id: int, session: Session = Depends(get_session), _: User = Depends(get_current_user)
):
    return _ticket_detail(session, _get_ticket(session, ticket_id))


class ReviewIn(BaseModel):
    action: str = Field(description="通过 / 退回")
    note: str = ""


@router.post("/review-tickets/{ticket_id}/review")
def review(
    ticket_id: int,
    body: ReviewIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    ticket = _get_ticket(session, ticket_id)
    try:
        review_flow.review_ticket(session, ticket, current, body.action, body.note, client_ip(request))
    except ReviewFlowError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    session.commit()
    return _ticket_detail(session, ticket)


@router.post("/review-tickets/{ticket_id}/withdraw")
def withdraw(
    ticket_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    ticket = _get_ticket(session, ticket_id)
    try:
        review_flow.withdraw_round(session, ticket, current, client_ip(request))
    except ReviewFlowError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    session.commit()
    return _ticket_detail(session, ticket)


# ---------------------------------------------------------------------------
# 设计工作面：我在这台设备上的设计任务 + 评审单
# ---------------------------------------------------------------------------


@router.get("/projects/{project_no}/equipment/{equip_no}/my-design-tasks")
def my_design_tasks(
    project_no: str,
    equip_no: str,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """我在本设备上的设计任务（含评审单状态）——设计工作面「我的提交」卡片用。"""
    rows = session.scalars(
        select(Task)
        .where(
            Task.project_no == project_no,
            Task.equip_no == equip_no,
            Task.task_type == "设计",
            Task.owner_id == current.id,
        )
        .order_by(Task.id)
    ).all()
    names = _names(session)
    out = []
    for t in rows:
        ticket = review_flow.ticket_for_task(session, t.id)
        out.append(
            {
                "task_id": t.id,
                "task_no": t.task_no,
                "title": t.title,
                "profession": t.profession,
                "status": t.status,
                "parent_task_id": t.parent_task_id,
                "ticket": _ticket_brief(session, ticket, names, {t.id: t}) if ticket else None,
            }
        )
    return out
