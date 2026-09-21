"""任务接口：立项后生成任务、我的任务、任务状态流转。"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user
from app.core.db import get_session
from app.models.initiation import Milestone, ProjectMember, PurchaseRequest
from app.models.library import Item
from app.models.platform import User
from app.models.project import Equipment, Project
from app.models.task import PROFESSIONS, ROLE_BY_TASK, TASK_STATUS, Task
from app.services import audit
from app.services.numbering import next_number

router = APIRouter(tags=["任务"])


def _task_dict(t: Task, names: dict[int, str]) -> dict:
    return {
        "id": t.id,
        "task_no": t.task_no,
        "project_no": t.project_no,
        "equip_no": t.equip_no,
        "task_type": t.task_type,
        "profession": t.profession,
        "title": t.title,
        "content": t.content,
        "owner_id": t.owner_id,
        "owner_name": names.get(t.owner_id) if t.owner_id else None,
        "plan_start": t.plan_start,
        "plan_end": t.plan_end,
        "status": t.status,
        "done_at": t.done_at,
        "ref_type": t.ref_type,
        "ref_id": t.ref_id,
        "ref_no": t.ref_no,
        "remark": t.remark,
    }


def _names(session: Session) -> dict[int, str]:
    return {u.id: u.name for u in session.scalars(select(User)).all()}


def _role_owner(session: Session, project_no: str, role: str) -> int | None:
    """项目团队里担任某角色的人 → 任务就派给他。"""
    row = session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_no == project_no, ProjectMember.project_role == role
        )
    )
    return row.user_id if row else None


# ============================================================================
# 生成任务（立项页调用）
# ============================================================================


class GenerateTasksIn(BaseModel):
    professions: list[str] = Field(
        default_factory=lambda: ["机械", "电气"],
        description="要生成哪些专业的设计任务（机械/电气/程序/工艺）",
    )
    with_purchase: bool = Field(default=True, description="是否把长周期件生成采购任务")


@router.post("/projects/{project_no}/generate-tasks")
def generate_tasks(
    project_no: str,
    body: GenerateTasksIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """立项后生成并行任务：设备 × 专业 → 设计任务；长周期件 → 采购任务。

    已存在的（同设备+同类型+同专业）不重复生成；负责人取自项目团队。
    """
    project = session.get(Project, project_no)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")

    bad = [p for p in body.professions if p not in PROFESSIONS]
    if bad:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"专业只能是：{'/'.join(PROFESSIONS)}")

    equipments = session.scalars(select(Equipment).where(Equipment.project_no == project_no)).all()
    existing = session.scalars(select(Task).where(Task.project_no == project_no)).all()
    key = {(t.equip_no, t.task_type, t.profession) for t in existing}
    existing_refs = {(t.task_type, t.ref_id) for t in existing}

    # 节点计划里"工程设计"的时间段，作为设计任务的计划时间
    design_ms = session.scalar(
        select(Milestone).where(Milestone.project_no == project_no, Milestone.name == "工程设计")
    )

    created: list[Task] = []
    unassigned: list[str] = []

    for eq in equipments:
        for prof in body.professions:
            if (eq.equip_no, "设计", prof) in key:
                continue
            role = ROLE_BY_TASK.get(("设计", prof))
            if role is None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"「{prof}」没有对应的负责人角色")
            owner = _role_owner(session, project_no, role)
            if owner is None:
                unassigned.append(f"{eq.equip_no} {prof}设计（项目团队里没定「{role}」）")
            task_no = next_number(session, "TASK", scope_key=project_no)
            row = Task(
                task_no=task_no,
                project_no=project_no,
                equip_no=eq.equip_no,
                task_type="设计",
                profession=prof,
                title=f"{eq.equip_no} {eq.equip_name} · {prof}设计",
                content=f"产出 {eq.equip_no} 的{prof}图纸，并给出该设备的{prof}部分 BOM（零件清单）",
                owner_id=owner,
                plan_start=design_ms.plan_start if design_ms else None,
                plan_end=design_ms.plan_end if design_ms else None,
                status="待开始",
                ref_type="equipment",
                ref_id=eq.id,
                ref_no=eq.equip_no,
            )
            session.add(row)
            created.append(row)

    if body.with_purchase:
        requests = session.scalars(
            select(PurchaseRequest).where(PurchaseRequest.project_no == project_no)
        ).all()
        items = {i.item_no: i for i in session.scalars(select(Item)).all()}
        purchase_owner = _role_owner(session, project_no, "采购负责人")
        for r in requests:
            if ("采购", r.id) in existing_refs:
                continue
            item = items.get(r.item_no)
            if purchase_owner is None:
                unassigned.append(f"{item.display_name if item else r.item_no} 采购（没定「采购负责人」）")
            task_no = next_number(session, "TASK", scope_key=project_no)
            row = Task(
                task_no=task_no,
                project_no=project_no,
                equip_no=r.equip_no,
                task_type="采购",
                profession="采购",
                title=f"采购 {item.display_name if item else r.item_no}",
                content=(
                    f"向 {r.supplier_name or '供应商'} 下单："
                    f"{item.spec_text if item else ''}；"
                    f"采购周期 {r.lead_days or '—'} 天，需要到货 {r.need_date or '—'}"
                ),
                owner_id=purchase_owner,
                plan_start=r.ordered_at,
                plan_end=r.need_date,
                status="进行中" if r.ordered_at else "待开始",
                ref_type="purchase_request",
                ref_id=r.id,
                ref_no=r.item_no,
            )
            session.add(row)
            created.append(row)

    session.flush()
    if created:
        audit.log(
            session,
            user=current,
            action="create",
            object_type="task",
            object_ref=project_no,
            summary=f"生成任务 {len(created)} 条："
            + "、".join(sorted({f"{t.task_type}{t.profession or ''}" for t in created})),
            detail={"count": len(created), "unassigned": unassigned},
            ip=client_ip(request),
        )
    session.commit()
    names = _names(session)
    return {
        "created": len(created),
        "unassigned": unassigned,
        "items": [_task_dict(t, names) for t in created],
    }


@router.get("/projects/{project_no}/tasks")
def list_project_tasks(
    project_no: str, session: Session = Depends(get_session), _: User = Depends(get_current_user)
):
    rows = session.scalars(
        select(Task).where(Task.project_no == project_no).order_by(Task.task_type, Task.equip_no, Task.id)
    ).all()
    names = _names(session)
    return [_task_dict(t, names) for t in rows]


# ============================================================================
# 我的任务（工作台）
# ============================================================================


@router.get("/my-tasks")
def my_tasks(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = 100,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """我该干什么：指派给我的任务（采购员看到采购任务，设计师看到设计任务）。"""
    stmt = select(Task).where(Task.owner_id == current.id).order_by(Task.id.desc())
    if status_filter:
        stmt = stmt.where(Task.status == status_filter)
    rows = session.scalars(stmt.limit(min(limit, 300))).all()
    projects = {p.project_no: p.project_name for p in session.scalars(select(Project)).all()}
    names = _names(session)
    out = []
    for t in rows:
        d = _task_dict(t, names)
        d["project_name"] = projects.get(t.project_no)
        out.append(d)
    return out


# ============================================================================
# 任务状态
# ============================================================================


class TaskPatch(BaseModel):
    status: str | None = None
    owner_id: int | None = None
    plan_start: str | None = None
    plan_end: str | None = None
    remark: str | None = None


@router.patch("/tasks/{task_id}")
def update_task(
    task_id: int,
    body: TaskPatch,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    row = session.get(Task, task_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "任务不存在")
    if body.status and body.status not in TASK_STATUS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"任务状态必须是：{'/'.join(TASK_STATUS)}")

    labels = {"status": "状态", "owner_id": "负责人", "plan_start": "计划开始", "plan_end": "计划结束", "remark": "备注"}
    changes = []
    for field, new_value in body.model_dump(exclude_unset=True).items():
        old = getattr(row, field)
        if old == new_value:
            continue
        changes.append(
            {"field": field, "label": labels.get(field, field), "old": str(old or "—"), "new": str(new_value or "—")}
        )
        setattr(row, field, new_value)
    if body.status == "已完成":
        row.done_at = datetime.now(UTC)
    if changes:
        audit.log(
            session,
            user=current,
            action="update",
            object_type="task",
            object_ref=f"{row.project_no}/{row.task_no}",
            summary=f"任务 {row.task_no}（{row.title}）："
            + "；".join(f"{c['label']} {c['old']} → {c['new']}" for c in changes),
            detail={"changes": changes},
            ip=client_ip(request),
        )
    session.commit()
    return _task_dict(row, _names(session))


@router.get("/tasks/summary")
def task_summary(session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    """任务总览（按人）：谁手上还有多少活。"""
    rows = session.scalars(select(Task)).all()
    names = _names(session)
    agg: dict[str, dict] = {}
    for t in rows:
        key = names.get(t.owner_id or 0, "未指派")
        d = agg.setdefault(key, {"owner": key, "total": 0, "done": 0, "doing": 0, "todo": 0})
        d["total"] += 1
        if t.status == "已完成":
            d["done"] += 1
        elif t.status == "进行中":
            d["doing"] += 1
        else:
            d["todo"] += 1
    return sorted(agg.values(), key=lambda x: -x["total"])
