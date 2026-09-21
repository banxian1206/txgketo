"""任务接口：立项后生成任务、我的任务、任务状态流转。"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user
from app.core.db import get_session
from app.models.engineering import Drawing
from app.models.initiation import Milestone, ProjectMember, PurchaseRequest
from app.models.library import Item
from app.models.platform import POSITION_DIRECTOR, POSITION_LEAD, User
from app.models.project import Equipment, Project
from app.models.task import PROFESSIONS, TASK_STATUS, Task
from app.services import audit, notify
from app.services.numbering import next_number, year_scope_key
from app.services.reviewers import team_lead_for

router = APIRouter(tags=["任务"])


def _task_dict(t: Task, names: dict[int, str], blocked: str | None = None) -> dict:
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
        "depends_on_id": t.depends_on_id,
        "parent_task_id": t.parent_task_id,
        "plan_start": t.plan_start,
        "plan_end": t.plan_end,
        "status": t.status,
        "done_at": t.done_at,
        "ref_type": t.ref_type,
        "ref_id": t.ref_id,
        "ref_no": t.ref_no,
        "remark": t.remark,
        "blocked": blocked is not None,
        "blocked_reason": blocked,
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


def _first_release_done(session: Session, dep: Task) -> bool:
    """前置任务的产出是否已“首次发布”。

    05 卷 §0.1#17：工艺任务等机械**首次发布**即可开工（不要求机械任务整个完成）。
    P3 起有 design_release 后可改成查发布记录，语义不变。
    """
    if dep.task_type != "设计" or dep.profession != "机械" or not dep.equip_no:
        return False
    return (
        session.scalar(
            select(Drawing.drawing_no)
            .where(
                Drawing.project_no == dep.project_no,
                Drawing.equip_no == dep.equip_no,
                Drawing.kind == "机械",
                Drawing.status == "已发布",
            )
            .limit(1)
        )
        is not None
    )


def _blocked_reason(session: Session, task: Task, dep: Task | None) -> str | None:
    """任务阻塞原因；None = 可开工。"""
    if task.depends_on_id is None or dep is None:
        return None
    if dep.status == "已完成":
        return None
    if _first_release_done(session, dep):
        return None
    return f"等待前置：{dep.task_no} {dep.title}"


def _blocked_map(session: Session, tasks: list[Task]) -> dict[int, str | None]:
    """批量算阻塞（列表用；任务量小，逐个查发布即可）。"""
    deps = {t.id: t for t in tasks}
    missing = {t.depends_on_id for t in tasks if t.depends_on_id} - set(deps)
    if missing:
        for d in session.scalars(select(Task).where(Task.id.in_(missing))).all():
            deps[d.id] = d
    out: dict[int, str | None] = {}
    for t in tasks:
        dep = deps.get(t.depends_on_id) if t.depends_on_id else None
        out[t.id] = _blocked_reason(session, t, dep)
    return out


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
    if "工艺" in body.professions and "机械" not in body.professions:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "工艺挂在机械之后：勾了工艺就必须同时勾机械设计"
        )

    # 固定顺序：机械先建，工艺才能拿到前置任务 id
    order = ["机械", "电气", "程序", "工艺"]
    professions = [p for p in order if p in body.professions]

    equipments = session.scalars(select(Equipment).where(Equipment.project_no == project_no)).all()
    existing = session.scalars(select(Task).where(Task.project_no == project_no)).all()
    key = {(t.equip_no, t.task_type, t.profession) for t in existing if t.parent_task_id is None}
    existing_refs = {(t.task_type, t.ref_id) for t in existing}
    design_by_key: dict[tuple[str | None, str | None], Task] = {
        (t.equip_no, t.profession): t
        for t in existing
        if t.task_type == "设计" and t.parent_task_id is None
    }

    design_content = {
        "机械": "出机械图纸 + 设计 BOM；在「去设计」里勾选提交评审",
        "电气": "出电气图纸 + 电气 BOM；在「去设计」里勾选提交评审",
        "程序": "出 PLC 程序版本；提交评审后发布",
        "工艺": "看机械零件 → 挂原材料 BOM + 判定自制/外协（机械首次发布后开工）",
    }

    # 节点计划里"工程设计"的时间段，作为设计任务的计划时间
    design_ms = session.scalar(
        select(Milestone).where(Milestone.project_no == project_no, Milestone.name == "工程设计")
    )

    created: list[Task] = []
    unassigned: list[str] = []

    for eq in equipments:
        for prof in professions:
            if (eq.equip_no, "设计", prof) in key:
                continue
            # 立项直接派给各专业设计组长（05 卷 §0.1#14），组长再拆给组员
            lead = team_lead_for(session, prof)
            owner = lead.id if lead else None
            if owner is None:
                unassigned.append(f"{eq.equip_no} {prof}设计（工程部没配「{prof}」设计组长）")
            dep_id = None
            if prof == "工艺":
                mech = design_by_key.get((eq.equip_no, "机械"))
                dep_id = mech.id if mech else None
            task_no = next_number(session, "TASK", scope_key=year_scope_key())
            row = Task(
                task_no=task_no,
                project_no=project_no,
                equip_no=eq.equip_no,
                task_type="设计",
                profession=prof,
                title=f"{eq.equip_no} {eq.equip_name} · {prof}设计",
                content=design_content.get(prof),
                owner_id=owner,
                depends_on_id=dep_id,
                plan_start=design_ms.plan_start if design_ms else None,
                plan_end=design_ms.plan_end if design_ms else None,
                status="待开始",
                ref_type="equipment",
                ref_id=eq.id,
                ref_no=eq.equip_no,
            )
            session.add(row)
            session.flush()
            design_by_key[(eq.equip_no, prof)] = row
            created.append(row)
            if owner is not None:
                notify.notify(
                    session,
                    [owner],
                    type_=notify.TYPE_TASK,
                    title=f"任务派给你：{row.title}",
                    body=row.content,
                    link="/my-tasks",
                    biz_type="task",
                    biz_id=row.id,
                    actor_id=current.id,
                )

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
            task_no = next_number(session, "TASK", scope_key=year_scope_key())
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
            if row.owner_id is not None:
                notify.notify(
                    session,
                    [row.owner_id],
                    type_=notify.TYPE_TASK,
                    title=f"采购任务派给你：{row.title}",
                    link="/my-tasks",
                    biz_type="task",
                    biz_id=row.id,
                    actor_id=current.id,
                )

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
    blocked = _blocked_map(session, rows)
    return [_task_dict(t, names, blocked.get(t.id)) for t in rows]


# ============================================================================
# 我的任务（工作台）
# ============================================================================


@router.get("/my-tasks")
def my_tasks(
    status_filter: str | None = Query(default=None, alias="status"),
    scope: str = Query(default="mine", description="mine=我的任务 / team=我组任务（组长台）"),
    limit: int = 100,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """我该干什么：指派给我的任务；组长可切「我组」（05 卷 §2.2 默认筛选）。"""
    if scope == "team":
        if current.position == POSITION_DIRECTOR:
            stmt = select(Task).where(Task.task_type == "设计")
        else:
            member_ids = (
                [
                    u.id
                    for u in session.scalars(
                        select(User).where(User.profession == current.profession)
                    ).all()
                ]
                if current.profession
                else [current.id]
            )
            stmt = select(Task).where(
                or_(
                    Task.owner_id.in_(member_ids),
                    and_(Task.owner_id.is_(None), Task.profession == current.profession),
                )
            )
    else:
        stmt = select(Task).where(Task.owner_id == current.id)
    if status_filter:
        stmt = stmt.where(Task.status == status_filter)
    rows = session.scalars(stmt.order_by(Task.id.desc()).limit(min(limit, 300))).all()
    projects = {p.project_no: p.project_name for p in session.scalars(select(Project)).all()}
    names = _names(session)
    blocked = _blocked_map(session, rows)
    out = []
    for t in rows:
        d = _task_dict(t, names, blocked.get(t.id))
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

    # 前置未完成不能开工（05 卷 §0.1#17）
    if body.status == "进行中" and row.depends_on_id:
        reason = _blocked_reason(session, row, session.get(Task, row.depends_on_id))
        if reason:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{reason}，还不能开工")

    # 转派：任务负责人（组长）或工程总监/超管才能改（05 卷 §0.1#14）
    old_owner_id = row.owner_id
    if body.owner_id is not None and body.owner_id != row.owner_id:
        allowed = (
            current.is_superuser
            or current.id == row.owner_id
            or (current.position == POSITION_LEAD and current.profession == row.profession)
            or current.position == POSITION_DIRECTOR
        )
        if not allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "只有任务负责人（组长）或工程总监才能转派")

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
        # ★ 站内消息：转派给谁就提醒谁（06 卷 §9）
        if old_owner_id is not None and row.owner_id != old_owner_id:
            notify.notify(
                session,
                [row.owner_id],
                type_=notify.TYPE_TASK,
                title=f"任务转派给你：{row.task_no} {row.title}",
                link="/my-tasks",
                biz_type="task",
                biz_id=row.id,
                actor_id=current.id,
            )
    session.commit()
    blocked = _blocked_reason(session, row, session.get(Task, row.depends_on_id)) if row.depends_on_id else None
    return _task_dict(row, _names(session), blocked)


class SplitItem(BaseModel):
    owner_id: int
    title: str | None = None


class SplitTasksIn(BaseModel):
    items: list[SplitItem] = Field(min_length=1)


@router.post("/tasks/{task_id}/split", status_code=status.HTTP_201_CREATED)
def split_task(
    task_id: int,
    body: SplitTasksIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """组长把任务拆给组员（05 卷 §0.1#14）：生成子任务，父任务仍是组长的活。

    子任务继承前置依赖（工艺等机械首次发布），组长在「我组」里盯进度。
    """
    row = session.get(Task, task_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "任务不存在")
    allowed = (
        current.is_superuser
        or current.id == row.owner_id
        or (current.position == POSITION_LEAD and current.profession == row.profession)
        or current.position == POSITION_DIRECTOR
    )
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "只有这条任务的组长能拆给组员")
    if row.parent_task_id is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "子任务不能再拆")

    created: list[Task] = []
    for item in body.items:
        owner = session.get(User, item.owner_id)
        if owner is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"用户不存在：{item.owner_id}")
        task_no = next_number(session, "TASK", scope_key=year_scope_key())
        child = Task(
            task_no=task_no,
            project_no=row.project_no,
            equip_no=row.equip_no,
            task_type=row.task_type,
            profession=row.profession,
            title=item.title or f"{row.title}（{owner.name}）",
            content=row.content,
            owner_id=owner.id,
            plan_start=row.plan_start,
            plan_end=row.plan_end,
            status="待开始",
            ref_type=row.ref_type,
            ref_id=row.ref_id,
            ref_no=row.ref_no,
            parent_task_id=row.id,
            depends_on_id=row.depends_on_id,
        )
        session.add(child)
        session.flush()
        created.append(child)
        notify.notify(
            session,
            [child.owner_id],
            type_=notify.TYPE_TASK,
            title=f"任务派给你：{child.title}",
            link="/my-tasks",
            biz_type="task",
            biz_id=child.id,
            actor_id=current.id,
        )
    audit.log(
        session,
        user=current,
        action="split",
        object_type="task",
        object_ref=f"{row.project_no}/{row.task_no}",
        summary=f"组长拆分任务 {row.task_no} → {len(created)} 条子任务",
        detail={"children": [c.task_no for c in created]},
        ip=client_ip(request),
    )
    session.commit()
    names = _names(session)
    return [_task_dict(c, names) for c in created]


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
