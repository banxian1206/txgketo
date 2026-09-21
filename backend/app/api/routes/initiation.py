"""立项相关接口：团队 / 设备清单 / 节点计划 / 长周期采购 / 立项动作（00 卷 §3 S1）。"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user
from app.core.db import get_session
from app.models.engineering import Drawing  # noqa: E402
from app.models.library import Item  # noqa: E402
from app.services.numbering import next_number  # noqa: E402
from app.models.initiation import (
    DEFAULT_MILESTONES,
    DELIVER_TO,
    GoodsReceipt,
    EQUIPMENT_KINDS,
    MILESTONE_STATUS,
    PROJECT_ROLES,
    REQUEST_DONE,
    REQUEST_STATUS,
    Milestone,
    ProjectMember,
    PurchaseRequest,
)
from app.models.platform import User
from app.models.project import Equipment, Project  # noqa: F401
from app.services import audit, project_stage
from app.services import bom_demand
from app.services.numbering import make_equip_no, next_letter

router = APIRouter(prefix="/projects/{project_no}", tags=["立项"])
# 跨项目接口（采购工作台 / 到货验收）单独一个 router，不带项目号前缀
purchase_router = APIRouter(tags=["采购"])


def _get_project(session: Session, project_no: str) -> Project:
    project = session.get(Project, project_no)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")
    return project


# ============================================================================
# ① 项目团队
# ============================================================================


class MemberIn(BaseModel):
    user_id: int
    project_role: str
    remark: str | None = None


@router.get("/members")
def list_members(project_no: str, session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    rows = session.scalars(
        select(ProjectMember).where(ProjectMember.project_no == project_no).order_by(ProjectMember.id)
    ).all()
    names = {u.id: u.name for u in session.scalars(select(User)).all()}
    return [
        {
            "id": r.id,
            "user_id": r.user_id,
            "user_name": names.get(r.user_id),
            "project_role": r.project_role,
            "remark": r.remark,
        }
        for r in rows
    ]


@router.post("/members", status_code=status.HTTP_201_CREATED)
def add_member(
    project_no: str,
    body: MemberIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    _get_project(session, project_no)
    if body.project_role not in PROJECT_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"项目角色必须是：{'/'.join(PROJECT_ROLES)}")
    user = session.get(User, body.user_id)
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "用户不存在")

    # 同一个角色只能有一个人：再任命令即换人（留痕）
    exists = session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_no == project_no,
            ProjectMember.project_role == body.project_role,
        )
    )
    if exists:
        old_user = session.get(User, exists.user_id)
        old_name = old_user.name if old_user else str(exists.user_id)
        if exists.user_id == body.user_id:
            return {"id": exists.id}
        exists.user_id = body.user_id
        exists.remark = body.remark
        summary = f"「{body.project_role}」换人：{old_name} → {user.name}"
        action = "update"
        row = exists
    else:
        row = ProjectMember(
            project_no=project_no,
            user_id=body.user_id,
            project_role=body.project_role,
            remark=body.remark,
        )
        session.add(row)
        session.flush()
        summary = f"任命 {user.name} 为「{body.project_role}」"
        action = "create"

    audit.log(
        session,
        user=current,
        action=action,
        object_type="project_member",
        object_ref=project_no,
        summary=summary,
        ip=client_ip(request),
    )
    session.commit()
    return {"id": row.id}


@router.delete("/members/{member_id}")
def remove_member(
    project_no: str,
    member_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    row = session.get(ProjectMember, member_id)
    if row is None or row.project_no != project_no:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "团队成员不存在")
    user = session.get(User, row.user_id)
    session.delete(row)
    audit.log(
        session,
        user=current,
        action="delete",
        object_type="project_member",
        object_ref=project_no,
        summary=f"解除 {user.name if user else row.user_id} 的「{row.project_role}」任命",
        ip=client_ip(request),
    )
    session.commit()
    return {"ok": True}


# ============================================================================
# ② 设备清单（★ 设备号由发号引擎自动生成：01A，同型第二台 01B）
# ============================================================================


class EquipmentIn(BaseModel):
    equip_name: str = Field(..., description="如 升降机 / 点胶机 / 皮带线")
    model: str | None = None
    kind: str | None = Field(default=None, description="单机 / 工位 / 线体")
    line_no: str | None = None
    same_as: str | None = Field(
        default=None,
        description="同型第二台：填已有设备号（如 01A），系统自动发 01B",
    )
    remark: str | None = None


def _equipment_dict(e: Equipment) -> dict:
    return {
        "id": e.id,
        "equip_no": e.equip_no,
        "equip_name": e.equip_name,
        "model": e.model,
        "kind": e.kind,
        "line_no": e.line_no,
        "seq_no": e.seq_no,
        "letter": e.letter,
        "bom_complete": e.bom_complete,
        "remark": e.remark,
    }


@router.get("/equipment")
def list_equipment(project_no: str, session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    rows = session.scalars(
        select(Equipment).where(Equipment.project_no == project_no).order_by(Equipment.equip_no)
    ).all()
    return [_equipment_dict(e) for e in rows]


@router.post("/equipment", status_code=status.HTTP_201_CREATED)
def add_equipment(
    project_no: str,
    body: EquipmentIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """新增设备。设备号自动生成，不允许手工填。"""
    _get_project(session, project_no)
    if body.kind and body.kind not in EQUIPMENT_KINDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"设备类型必须是：{'/'.join(EQUIPMENT_KINDS)}")

    existing = session.scalars(select(Equipment).where(Equipment.project_no == project_no)).all()

    if body.same_as:
        base = next((e for e in existing if e.equip_no == body.same_as), None)
        if base is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"找不到同型设备 {body.same_as}")
        seq = base.seq_no or 1
        used = [e.letter or "" for e in existing if e.seq_no == seq]
        letter = next_letter(used)
    else:
        seq = max([e.seq_no or 0 for e in existing], default=0) + 1
        letter = "A"

    equip_no = make_equip_no(seq, letter)
    row = Equipment(
        project_no=project_no,
        equip_no=equip_no,
        equip_name=body.equip_name,
        model=body.model,
        kind=body.kind,
        line_no=body.line_no,
        seq_no=seq,
        letter=letter,
        remark=body.remark,
    )
    session.add(row)
    session.flush()
    audit.log(
        session,
        user=current,
        action="create",
        object_type="equipment",
        object_ref=f"{project_no}/{equip_no}",
        summary=f"新增设备 {equip_no}（{body.equip_name}）"
        + (f"，与 {body.same_as} 同型" if body.same_as else ""),
        ip=client_ip(request),
    )
    session.commit()
    return _equipment_dict(row)


class EquipmentPatch(BaseModel):
    equip_name: str | None = None
    model: str | None = None
    kind: str | None = None
    line_no: str | None = None
    remark: str | None = None


@router.patch("/equipment/{equip_id}")
def update_equipment(
    project_no: str,
    equip_id: int,
    body: EquipmentPatch,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    row = session.get(Equipment, equip_id)
    if row is None or row.project_no != project_no:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "设备不存在")
    labels = {"equip_name": "设备名称", "model": "型号", "kind": "类型", "line_no": "线体号", "remark": "备注"}
    changes = []
    for field, new_value in body.model_dump(exclude_unset=True).items():
        old = getattr(row, field)
        if old == new_value:
            continue
        changes.append({"field": field, "label": labels.get(field, field), "old": old or "—", "new": new_value or "—"})
        setattr(row, field, new_value)
    if changes:
        audit.log(
            session,
            user=current,
            action="update",
            object_type="equipment",
            object_ref=f"{project_no}/{row.equip_no}",
            summary=f"编辑设备 {row.equip_no}："
            + "；".join(f"{c['label']} {c['old']} → {c['new']}" for c in changes),
            detail={"changes": changes},
            ip=client_ip(request),
        )
    session.commit()
    return _equipment_dict(row)


@router.delete("/equipment/{equip_id}")
def remove_equipment(
    project_no: str,
    equip_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    row = session.get(Equipment, equip_id)
    if row is None or row.project_no != project_no:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "设备不存在")
    session.delete(row)
    audit.log(
        session,
        user=current,
        action="delete",
        object_type="equipment",
        object_ref=f"{project_no}/{row.equip_no}",
        summary=f"删除设备 {row.equip_no}（{row.equip_name}）",
        ip=client_ip(request),
    )
    session.commit()
    return {"ok": True}


# ============================================================================
# ③ 节点计划（每个节点的时间段）
# ============================================================================


class MilestoneIn(BaseModel):
    name: str
    plan_start: date | None = None
    plan_end: date | None = None
    owner_id: int | None = None
    status: str | None = None
    remark: str | None = None


def _milestone_dict(m: Milestone, names: dict[int, str]) -> dict:
    return {
        "id": m.id,
        "seq": m.seq,
        "name": m.name,
        "plan_start": m.plan_start,
        "plan_end": m.plan_end,
        "actual_start": m.actual_start,
        "actual_end": m.actual_end,
        "owner_id": m.owner_id,
        "owner_name": names.get(m.owner_id) if m.owner_id else None,
        "status": m.status,
        "remark": m.remark,
    }


@router.get("/milestones")
def list_milestones(project_no: str, session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    rows = session.scalars(
        select(Milestone).where(Milestone.project_no == project_no).order_by(Milestone.seq, Milestone.id)
    ).all()
    names = {u.id: u.name for u in session.scalars(select(User)).all()}
    return [_milestone_dict(m, names) for m in rows]


@router.post("/milestones/generate")
def generate_milestones(
    project_no: str,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """按标准节点一键生成（日期留空，自己按实际情况填）。已存在的不动。"""
    project = _get_project(session, project_no)
    existing = {
        m.name
        for m in session.scalars(select(Milestone).where(Milestone.project_no == project_no)).all()
    }
    created = []
    for i, name in enumerate(DEFAULT_MILESTONES, start=1):
        if name in existing:
            continue
        session.add(Milestone(project_no=project_no, seq=i, name=name, status="未开始"))
        created.append(name)
    if created:
        audit.log(
            session,
            user=current,
            action="create",
            object_type="milestone",
            object_ref=project_no,
            summary=f"生成标准节点 {len(created)} 个：{'、'.join(created)}",
            ip=client_ip(request),
        )
    session.commit()
    names = {u.id: u.name for u in session.scalars(select(User)).all()}
    rows = session.scalars(
        select(Milestone).where(Milestone.project_no == project_no).order_by(Milestone.seq)
    ).all()
    return {"created": created, "items": [_milestone_dict(m, names) for m in rows], "project": project.project_no}


@router.post("/milestones", status_code=status.HTTP_201_CREATED)
def add_milestone(
    project_no: str,
    body: MilestoneIn,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    _get_project(session, project_no)
    seq = len(session.scalars(select(Milestone).where(Milestone.project_no == project_no)).all()) + 1
    row = Milestone(
        project_no=project_no,
        seq=seq,
        name=body.name,
        plan_start=body.plan_start,
        plan_end=body.plan_end,
        owner_id=body.owner_id,
        status=body.status or "未开始",
        remark=body.remark,
    )
    session.add(row)
    session.commit()
    names = {u.id: u.name for u in session.scalars(select(User)).all()}
    return _milestone_dict(row, names)


class MilestonePatch(BaseModel):
    name: str | None = None
    plan_start: date | None = None
    plan_end: date | None = None
    actual_start: date | None = None
    actual_end: date | None = None
    owner_id: int | None = None
    status: str | None = None
    remark: str | None = None


@router.patch("/milestones/{milestone_id}")
def update_milestone(
    project_no: str,
    milestone_id: int,
    body: MilestonePatch,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    row = session.get(Milestone, milestone_id)
    if row is None or row.project_no != project_no:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "节点不存在")
    if body.status and body.status not in MILESTONE_STATUS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"节点状态必须是：{'/'.join(MILESTONE_STATUS)}")
    labels = {
        "name": "节点名称",
        "plan_start": "计划开始",
        "plan_end": "计划结束",
        "actual_start": "实际开始",
        "actual_end": "实际结束",
        "owner_id": "负责人",
        "status": "状态",
        "remark": "备注",
    }
    changes = []
    for field, new_value in body.model_dump(exclude_unset=True).items():
        old = getattr(row, field)
        if old == new_value:
            continue
        changes.append(
            {"field": field, "label": labels.get(field, field), "old": str(old or "—"), "new": str(new_value or "—")}
        )
        setattr(row, field, new_value)
    if changes:
        audit.log(
            session,
            user=current,
            action="update",
            object_type="milestone",
            object_ref=project_no,
            summary=f"节点「{row.name}」："
            + "；".join(f"{c['label']} {c['old']} → {c['new']}" for c in changes),
            detail={"changes": changes},
            ip=client_ip(request),
        )
    session.commit()
    names = {u.id: u.name for u in session.scalars(select(User)).all()}
    return _milestone_dict(row, names)


@router.delete("/milestones/{milestone_id}")
def remove_milestone(
    project_no: str,
    milestone_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    row = session.get(Milestone, milestone_id)
    if row is None or row.project_no != project_no:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "节点不存在")
    session.delete(row)
    session.commit()
    return {"ok": True}


# ============================================================================
# ④ 长周期采购（立项即下单）
# ============================================================================


class LongLeadIn(BaseModel):
    """★ 关键字段必须填：不填就算不出「赶不赶得上」，这个功能就是摆设。"""

    item_no: str = Field(..., description="标准库物料编码（从标准库里选）")
    qty: float = Field(..., gt=0, description="数量（必填）")
    unit: str | None = None
    lead_days: int = Field(..., ge=0, description="采购周期（天，必填）")
    need_date: date = Field(..., description="需要到货日期（必填）")
    ordered_at: date = Field(..., description="下单日期（必填：长周期件立项即下单）")
    supplier_name: str | None = None
    equip_no: str | None = None
    remark: str | None = None


def _request_dict(r: PurchaseRequest, item: Item | None = None) -> dict:
    return {
        "id": r.id,
        "po_no": r.po_no,
        "unit_price": float(r.unit_price) if r.unit_price is not None else None,
        "amount": float(r.amount) if r.amount is not None else None,
        "shipped_at": r.shipped_at,
        "deliver_to": r.deliver_to,
        "deliver_address": r.deliver_address,
        "arrived_at": r.arrived_at,
        "qty_received": float(r.qty_received) if r.qty_received is not None else None,
        "project_no": r.project_no,
        "equip_no": r.equip_no,
        "part_no": r.part_no,
        "item_no": r.item_no,
        "item_name": item.display_name if item else r.item_no,
        "model": (item.mfr_model or (item.spec or {}).get("model")) if item else None,
        "brand": item.brand if item else None,
        "spec_text": item.spec_text if item else None,
        "qty": float(r.qty) if r.qty is not None else None,
        "unit": r.unit,
        "source": r.source,
        "lead_days": r.lead_days,
        "supplier_id": r.supplier_id,
        "supplier_name": r.supplier_name,
        "need_date": r.need_date,
        "expected_date": r.expected_date,
        "ordered_at": r.ordered_at,
        "status": r.status,
        "is_long_lead": r.is_long_lead,
        "deliver_to": r.deliver_to,
        "deliver_address": r.deliver_address,
        "origin_request_id": r.origin_request_id,
        "remark": r.remark,
    }


@router.get("/purchase-requests")
def list_purchase_requests(
    project_no: str, session: Session = Depends(get_session), _: User = Depends(get_current_user)
):
    rows = session.scalars(
        select(PurchaseRequest)
        .where(PurchaseRequest.project_no == project_no)
        .order_by(PurchaseRequest.id.desc())
    ).all()
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    return [_request_dict(r, items.get(r.item_no)) for r in rows]


@router.post("/purchase-requests", status_code=status.HTTP_201_CREATED)
def add_purchase_request(
    project_no: str,
    body: LongLeadIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """登记长周期采购件（从标准库选）。填下单日期 → 已下单，预计到货 = 下单 + 周期。"""
    _get_project(session, project_no)
    # 合理性校验：下单 + 周期 必须早于「需要到货」，否则这条需求一开始就是不可能完成的
    ordered_at = body.ordered_at
    expected = ordered_at + timedelta(days=body.lead_days) if body.lead_days is not None else None
    if expected and body.need_date and expected > body.need_date:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"这条需求从一开始就赶不上：下单 {ordered_at} + 周期 {body.lead_days} 天 = {expected}，"
            f"但需要到货是 {body.need_date}。要么提前下单、要么改周期/到货日期。",
        )

    item = session.get(Item, body.item_no)
    if item is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"标准库里没有 {body.item_no} —— 请先去标准库把它建出来，再回来选",
        )
    row = PurchaseRequest(
        project_no=project_no,
        equip_no=body.equip_no,
        item_no=body.item_no,
        qty=body.qty,
        unit=body.unit or item.unit,
        source="长周期",
        lead_days=body.lead_days,
        supplier_name=body.supplier_name,
        need_date=body.need_date,
        expected_date=expected,
        ordered_at=ordered_at,
        po_no=next_number(session, "PURCHASE_ORDER"),
        status="在途",  # 立项即下单：下完单就在途（旧「已下单」中间态已废弃）
        is_long_lead=True,
        remark=body.remark,
    )
    session.add(row)
    session.flush()
    audit.log(
        session,
        user=current,
        action="create",
        object_type="purchase_request",
        object_ref=project_no,
        summary=f"登记长周期件 {item.display_name}（{body.item_no}）"
        + (f"·周期 {body.lead_days} 天" if body.lead_days else "")
        + (f"·{'已下单 ' + ordered_at.isoformat() if ordered_at else '待下单'}")
        + (f"，预计到货 {expected.isoformat()}" if expected else ""),
        ip=client_ip(request),
    )
    session.commit()
    return _request_dict(row, item)


class LongLeadPatch(BaseModel):
    qty: float | None = None
    unit: str | None = None
    lead_days: int | None = None
    supplier_name: str | None = None
    need_date: date | None = None
    ordered_at: date | None = None
    status: str | None = None
    equip_no: str | None = None
    remark: str | None = None


@router.patch("/purchase-requests/{request_id}")
def update_purchase_request(
    project_no: str,
    request_id: int,
    body: LongLeadPatch,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    row = session.get(PurchaseRequest, request_id)
    if row is None or row.project_no != project_no:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购需求不存在")
    if body.status and body.status not in REQUEST_STATUS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"状态必须是：{'/'.join(REQUEST_STATUS)}")
    labels = {
        "qty": "数量",
        "unit": "单位",
        "lead_days": "采购周期",
        "supplier_name": "供应商",
        "need_date": "需要到货",
        "ordered_at": "下单日期",
        "status": "状态",
        "equip_no": "设备号",
        "remark": "备注",
    }
    changes = []
    for field, new_value in body.model_dump(exclude_unset=True).items():
        old = getattr(row, field)
        if old == new_value:
            continue
        changes.append(
            {"field": field, "label": labels.get(field, field), "old": str(old or "—"), "new": str(new_value or "—")}
        )
        setattr(row, field, new_value)
    # 下单日期或周期变了 → 重算预计到货
    if row.ordered_at and row.lead_days:
        row.expected_date = row.ordered_at + timedelta(days=row.lead_days)
    if changes:
        audit.log(
            session,
            user=current,
            action="update",
            object_type="purchase_request",
            object_ref=project_no,
            summary=f"长周期件「{row.item_no}」："
            + "；".join(f"{c['label']} {c['old']} → {c['new']}" for c in changes),
            detail={"changes": changes},
            ip=client_ip(request),
        )
    session.commit()
    item = session.get(Item, row.item_no)
    return _request_dict(row, item)


@router.delete("/purchase-requests/{request_id}")
def remove_purchase_request(
    project_no: str,
    request_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    row = session.get(PurchaseRequest, request_id)
    if row is None or row.project_no != project_no:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购需求不存在")
    session.delete(row)
    session.commit()
    return {"ok": True}


# ============================================================================
# ★ 立项动作：阶段 成交待立项 → 执行中
# ============================================================================


@router.post("/initiate")
def initiate_project(
    project_no: str,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """立项。校验三件事做完没有，然后阶段 → 执行中。"""
    project = _get_project(session, project_no)
    try:
        project_stage.assert_transition(project.stage, project_stage.EXECUTING)
    except project_stage.StageError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    equipments = session.scalars(select(Equipment).where(Equipment.project_no == project_no)).all()
    if not equipments:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "还不能立项：设备清单是空的（任务分配：01A/02A… 各是什么设备）"
        )
    milestones = session.scalars(select(Milestone).where(Milestone.project_no == project_no)).all()
    if not milestones:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "还不能立项：节点计划是空的（每个节点的时间段要先定下来）"
        )
    members = session.scalars(select(ProjectMember).where(ProjectMember.project_no == project_no)).all()
    if not members:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "还不能立项：项目团队还没任命")

    # ★ 每台设备一立项就有它的【总装图】(设备编号 + 00-00-00-00)——
    #   设备在立项时就有编号，不能等到第一张图才出现
    from app.models.engineering import Drawing  # noqa: PLC0415
    from app.services.numbering import EMPTY, compose_mech_drawing_no  # noqa: PLC0415

    roots_created = 0
    for eq in equipments:
        root_no = compose_mech_drawing_no(project_no, eq.equip_no, [EMPTY] * 4)
        if session.get(Drawing, root_no) is None:
            session.add(
                Drawing(
                    drawing_no=root_no,
                    project_no=project_no,
                    equip_no=eq.equip_no,
                    l1=EMPTY,
                    l2=EMPTY,
                    l3=EMPTY,
                    l4=EMPTY,
                    parent_drawing_no=None,
                    title=f"{eq.equip_name}总装图",
                    kind="机械",
                    qty=1,
                    unit="台",
                    source_type="自制件",
                    current_version="V1",
                    status="草稿",
                    owner_id=current.id,
                    is_part=False,
                )
            )
            roots_created += 1
    if roots_created:
        session.flush()

    long_lead = [
        r
        for r in session.scalars(select(PurchaseRequest).where(PurchaseRequest.project_no == project_no)).all()
        if r.is_long_lead
    ]
    not_ordered = [r for r in long_lead if not r.ordered_at]

    # 任务必须先分派到人 —— 否则立项完没人知道自己该干什么
    from app.models.task import Task  # noqa: PLC0415

    tasks = session.scalars(select(Task).where(Task.project_no == project_no)).all()
    if not tasks:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "还不能立项：任务还没生成 —— 立项后设计要分到机械/电气/程序设计师手上，采购要分到采购员手上",
        )
    unassigned = [t.task_no for t in tasks if not t.owner_id]
    if unassigned:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"有 {len(unassigned)} 条任务没指派负责人（{', '.join(unassigned[:3])}…）—— "
            "请先在项目团队里把对应的负责人定下来",
        )

    old_stage = project.stage
    project.stage = project_stage.EXECUTING
    audit.log(
        session,
        user=current,
        action="initiate",
        object_type="project",
        object_ref=project_no,
        summary=f"立项 {project_no}：阶段 {old_stage} → 执行中；"
        f"设备 {len(equipments)} 台、节点 {len(milestones)} 个、团队 {len(members)} 人、"
        f"长周期件 {len(long_lead)} 项、已分派任务 {len(tasks)} 条"
        + (f"、生成设备总装图 {roots_created} 张" if roots_created else "")
        + (f"（其中 {len(not_ordered)} 项未下单）" if not_ordered else ""),
        detail={
            "changes": [
                {"field": "stage", "label": "阶段", "old": old_stage, "new": "执行中"},
            ]
        },
        ip=client_ip(request),
    )
    session.commit()
    return {
        "project_no": project_no,
        "stage": project.stage,
        "equipment_count": len(equipments),
        "milestone_count": len(milestones),
        "member_count": len(members),
        "long_lead_count": len(long_lead),
        "long_lead_not_ordered": [r.item_no for r in not_ordered],
        "task_count": len(tasks),
    }


# 兜底：一次性清空某类数据（立项阶段常用）
@router.post("/milestones/clear")
def clear_milestones(
    project_no: str,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    session.execute(delete(Milestone).where(Milestone.project_no == project_no))
    session.commit()
    return {"ok": True}


# ============================================================================
# 采购流程：下单 → 供应商发货 → 到货 → 仓库验收
# ============================================================================


class OrderIn(BaseModel):
    """下单：采购员真正去下采购单，把这些填回来。"""

    supplier_id: int | None = Field(default=None, description="从供应商主数据里选")
    supplier_name: str | None = None
    deliver_to: str = Field(default="公司仓库", description="公司仓库 / 直发客户现场")
    deliver_address: str | None = Field(default=None, description="送货地址（直发现场必填）")
    po_no: str | None = Field(default=None, description="采购单号")
    unit_price: float | None = Field(default=None, gt=0, description="单价")
    ordered_at: date = Field(..., description="下单日期")
    expected_date: date | None = Field(default=None, description="预计到货日期")
    qty: float | None = Field(default=None, gt=0, description="下单数量（可修改）")


@router.post("/purchase-requests/{request_id}/order")
def order(
    project_no: str,
    request_id: int,
    body: OrderIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """采购员下单 → 状态「已下单」，并同步采购任务。"""
    row = session.get(PurchaseRequest, request_id)
    if row is None or row.project_no != project_no:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购需求不存在")
    if row.status not in ("待采购",):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"当前状态是「{row.status}」，不能重复下单")

    item = session.get(Item, row.item_no)
    if body.supplier_id:
        from app.models.purchasing import Supplier  # noqa: PLC0415

        sup = session.get(Supplier, body.supplier_id)
        if sup is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "供应商不存在")
        row.supplier_id = sup.id
        row.supplier_name = sup.name
    elif body.supplier_name:
        row.supplier_name = body.supplier_name
    row.po_no = body.po_no or row.po_no or next_number(session, "PURCHASE_ORDER")
    row.unit_price = body.unit_price or row.unit_price
    row.qty = body.qty or row.qty
    if row.unit_price and row.qty:
        row.amount = float(row.unit_price) * float(row.qty)
    row.ordered_at = body.ordered_at
    row.expected_date = body.expected_date or (
        body.ordered_at + timedelta(days=row.lead_days or 0) if row.lead_days else None
    )
    if body.deliver_to not in DELIVER_TO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"收货地点只能是：{'/'.join(DELIVER_TO)}")
    if body.deliver_to == "直发客户现场" and not body.deliver_address:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "直发客户现场必须填送货地址")
    row.deliver_to = body.deliver_to
    row.deliver_address = body.deliver_address
    row.status = "在途"  # 下完单就是在途（等货）
    # ★ 成交价落进价格库 —— 下次买同一个东西就能看到"上次多少钱"
    if row.unit_price:
        from app.models.purchasing import SupplierQuote  # noqa: PLC0415

        if row.supplier_id:
            session.add(
                SupplierQuote(
                    item_no=row.item_no,
                    supplier_id=row.supplier_id,
                    project_no=project_no,
                    price=row.unit_price,
                    unit=row.unit,
                    lead_days=row.lead_days,
                    price_type="成交",
                    quote_date=body.ordered_at,
                    source=row.po_no,
                    recorded_by=current.id,
                )
            )
    _sync_purchase_task(session, row, "进行中", f"已下单 {row.ordered_at}，供应商 {row.supplier_name or '—'}")
    audit.log(
        session,
        user=current,
        action="order",
        object_type="purchase_request",
        object_ref=f"{project_no}/{row.item_no}",
        summary=f"采购下单 {item.display_name if item else row.item_no}："
        f"供应商 {row.supplier_name or '—'} · 单号 {row.po_no or '—'} · "
        f"单价 ¥{row.unit_price or '—'} × {row.qty or '—'} = ¥{row.amount or '—'} · "
        f"下单 {row.ordered_at} · 预计到货 {row.expected_date or '—'}",
        ip=client_ip(request),
    )
    session.commit()
    return _request_dict(row, item)


# ---------------------------------------------------------------------------
# ★ 仓库只有两个动作：验收（合格 / 不合格）、入库
#   到货 / 验收 / 入库都是分批的：每批走一次，剩下的还算未到货
# ---------------------------------------------------------------------------


def _request_receipts(session: Session, request_id: int) -> list[GoodsReceipt]:
    return list(
        session.scalars(
            select(GoodsReceipt)
            .where(GoodsReceipt.request_id == request_id)
            .order_by(GoodsReceipt.id)
        ).all()
    )


def _recalc_request_status(session: Session, row: PurchaseRequest) -> str:
    """由到货单反推采购需求状态（分批到货时看「已验收多少、还差多少」）。"""
    if row.status in ("已取消", "已退货", "待采购"):
        return row.status
    gs = _request_receipts(session, row.id)
    stored = sum(float(g.qty or 0) for g in gs if g.status == "已入库")
    site = sum(float(g.qty or 0) for g in gs if g.status == "现场已验收")
    pending = sum(float(g.qty or 0) for g in gs if g.status == "待入库")
    row.qty_received = stored + site + pending  # 有效到货（不合格/退回的不算）
    qty = float(row.qty or 0)
    if any(g.status == "不合格" for g in gs):
        row.status = "不合格"
    elif pending > 0:
        row.status = "待入库"
    elif qty <= 0:
        row.status = "已退货" if any(g.status == "已退货" for g in gs) else "已取消"
    elif stored + site >= qty - 1e-6:
        row.status = "现场已验收" if site > 0 and stored <= 0 else "已入库"
    elif stored + site > 0:
        row.status = "部分到货"
    else:
        row.status = "在途"
    return row.status


def _resolve_location(session: Session, location: str | None):
    """入库库位：填了就找/建，没填用「待定」。"""
    from app.models.warehouse import WarehouseLocation  # noqa: PLC0415

    loc = None
    if location:
        wh, _, code = location.partition(" ")
        loc = session.scalar(
            select(WarehouseLocation).where(
                WarehouseLocation.warehouse == (wh or "深圳仓"),
                WarehouseLocation.code == (code or location),
            )
        )
        if loc is None:
            loc = WarehouseLocation(warehouse=wh or "深圳仓", code=code or location)
            session.add(loc)
            session.flush()
    if loc is None:
        loc = session.scalar(select(WarehouseLocation).where(WarehouseLocation.code == "待定"))
    if loc is None:
        loc = WarehouseLocation(warehouse="深圳仓", code="待定", name="未指派库位")
        session.add(loc)
        session.flush()
    return loc


class AcceptanceIn(BaseModel):
    """验收：货到了就验，只有合格 / 不合格。合格 → 待入库，不合格 → 采购协商换货/退货。"""

    receipt_date: date = Field(..., description="到货日期")
    qty: float = Field(..., gt=0, description="本次到货数量（分批到货就填这一批）")
    result: str = Field(..., description="合格 / 不合格")
    note: str | None = Field(default=None, description="不合格时说明原因")


@router.post("/purchase-requests/{request_id}/inspect")
def inspect_purchase_request(
    project_no: str,
    request_id: int,
    body: AcceptanceIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """仓库验收（分批可多次）：合格 → 待入库；不合格 → 采购「验收不合格」里协商。"""
    row = session.get(PurchaseRequest, request_id)
    if row is None or row.project_no != project_no:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购需求不存在")
    if body.result not in ("合格", "不合格"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "验收结果只能是 合格 / 不合格")
    if row.status in ("已取消", "已退货"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"这一行已经结束了（{row.status}），不能再验收")
    if row.status not in ("在途", "部分到货", "待入库", "不合格", "已下单"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"当前状态是「{row.status}」，不能验收")

    to = row.deliver_to or "公司仓库"
    item = session.get(Item, row.item_no)
    if body.result == "不合格":
        receipt_status = "不合格"
    elif to == "直发客户现场":
        receipt_status = "现场已验收"  # 直发的由现场验收（现场模块以后接）
    else:
        receipt_status = "待入库"
    receipt_no = next_number(session, "RECEIPT", scope_key=project_no)
    gr = GoodsReceipt(
        receipt_no=receipt_no,
        project_no=project_no,
        request_id=row.id,
        item_no=row.item_no,
        qty=body.qty,
        unit=row.unit or (item.unit if item else None),
        receipt_date=body.receipt_date,
        deliver_to=to,
        status=receipt_status,
        inspected_by=current.id,
        inspected_at=datetime.now(UTC),
        inspect_note=body.note,
    )
    session.add(gr)
    row.arrived_at = body.receipt_date
    session.flush()  # autoflush=False：先把到货单落库，状态重算才看得到
    _recalc_request_status(session, row)
    if row.status in REQUEST_DONE:
        _sync_purchase_task(session, row, "已完成", f"验收合格并办完（{receipt_no}）")
    elif body.result == "合格":
        _sync_purchase_task(session, row, "进行中", f"验收合格 {body.qty:g}，待入库")
    else:
        _sync_purchase_task(
            session, row, "进行中", f"验收不合格：{body.note or '等采购协商换货/退货'}"
        )
    audit.log(
        session,
        user=current,
        action="acceptance",
        object_type="goods_receipt",
        object_ref=receipt_no,
        summary=f"到货验收 {receipt_no}（{row.item_no} × {body.qty:g}）：{body.result}"
        + ("，待入库" if receipt_status == "待入库" else "")
        + ("，现场已验收" if receipt_status == "现场已验收" else "")
        + ("，等采购协商" if body.result == "不合格" else "")
        + (f"，说明：{body.note}" if body.note else ""),
        ip=client_ip(request),
    )
    session.commit()
    return {
        "receipt_no": receipt_no,
        "receipt_status": gr.status,
        "request_status": row.status,
        "qty_received": float(row.qty_received or 0),
    }


class StoreIn(BaseModel):
    location: str | None = Field(default=None, description="入库库位（如 深圳仓 A-03-12）")
    note: str | None = None


@purchase_router.post("/goods-receipts/{receipt_id}/store")
def store_receipt(
    receipt_id: int,
    body: StoreIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """入库：验收合格（待入库）的货 → 选库位入库，记库存与流水。分批入库就一批一批来。"""
    from app.models.warehouse import MOVE_IN, StockItem, StockMove  # noqa: PLC0415

    gr = session.get(GoodsReceipt, receipt_id)
    if gr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "到货单不存在")
    if gr.status != "待入库":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"这张到货单当前是「{gr.status}」，不能入库")
    if gr.deliver_to != "公司仓库":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "直发客户现场的货由现场验收，不走公司入库")

    loc = _resolve_location(session, body.location)
    st = session.scalar(
        select(StockItem).where(StockItem.item_no == gr.item_no, StockItem.location_id == loc.id)
    )
    if st is None:
        st = StockItem(item_no=gr.item_no, location_id=loc.id, qty_on_hand=0, qty_locked=0)
        session.add(st)
        session.flush()
    st.qty_on_hand = float(st.qty_on_hand or 0) + float(gr.qty or 0)
    gr.location = f"{loc.warehouse} {loc.code}"
    gr.status = "已入库"
    gr.stored_by = current.id
    gr.stored_at = datetime.now(UTC)
    session.add(
        StockMove(
            item_no=gr.item_no,
            move_type=MOVE_IN,
            qty=gr.qty or 0,
            to_location_id=loc.id,
            project_no=gr.project_no,
            ref_type="goods_receipt",
            ref_no=gr.receipt_no,
            operator_id=current.id,
            moved_at=datetime.now(UTC),
            remark=body.note or "验收合格入库",
        )
    )

    row = session.get(PurchaseRequest, gr.request_id) if gr.request_id else None
    if row is not None:
        session.flush()  # 先把「已入库」落库，状态重算才看得到
        _recalc_request_status(session, row)
        if row.status in REQUEST_DONE:
            _sync_purchase_task(session, row, "已完成", f"已入库 {gr.location}")
        else:
            _sync_purchase_task(
                session, row, "进行中", f"已入库 {gr.qty:g}（{gr.location}），剩余还在途"
            )
    audit.log(
        session,
        user=current,
        action="store",
        object_type="goods_receipt",
        object_ref=gr.receipt_no,
        summary=f"入库 {gr.receipt_no}（{gr.item_no} × {gr.qty:g}）→ {gr.location}"
        + (f"，说明：{body.note}" if body.note else ""),
        ip=client_ip(request),
    )
    session.commit()
    return {
        "receipt_no": gr.receipt_no,
        "status": gr.status,
        "location": gr.location,
        "request_status": row.status if row else None,
    }



@purchase_router.get("/goods-receipts")
def list_receipts(
    deliver_to: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """到货单列表（仓库/现场用它做验收：按到货清单逐条勾选）。"""
    stmt = select(GoodsReceipt).order_by(GoodsReceipt.id.desc())
    if deliver_to:
        stmt = stmt.where(GoodsReceipt.deliver_to == deliver_to)
    if status_filter:
        stmt = stmt.where(GoodsReceipt.status == status_filter)
    rows = session.scalars(stmt.limit(300)).all()
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    projects = {p.project_no: p.project_name for p in session.scalars(select(Project)).all()}
    names = {u.id: u.name for u in session.scalars(select(User)).all()}
    reqs = {r.id: r for r in session.scalars(select(PurchaseRequest)).all()}
    equips = {
        (e.project_no, e.equip_no): e.equip_name for e in session.scalars(select(Equipment)).all()
    }
    retries = _retry_map(session, [g.request_id for g in rows if g.request_id])
    return [
        {
            "id": g.id,
            "receipt_no": g.receipt_no,
            "project_no": g.project_no,
            "project_name": projects.get(g.project_no),
            # ★ 这货是哪张采购单、哪个设备的：仓库入库/以后发货都靠这个对单
            "request_id": g.request_id,
            "po_no": reqs[g.request_id].po_no if g.request_id in reqs else None,
            "equip_no": reqs[g.request_id].equip_no if g.request_id in reqs else None,
            "equip_name": (
                equips.get((g.project_no, reqs[g.request_id].equip_no))
                if g.request_id in reqs and reqs[g.request_id].equip_no
                else None
            ),
            "supplier_name": reqs[g.request_id].supplier_name if g.request_id in reqs else None,
            "lead_days": reqs[g.request_id].lead_days if g.request_id in reqs else None,
            "item_no": g.item_no,
            "display_name": items[g.item_no].display_name if g.item_no in items else g.item_no,
            "spec_text": items[g.item_no].spec_text if g.item_no in items else None,
            "qty": float(g.qty) if g.qty is not None else None,
            "unit": g.unit,
            "receipt_date": g.receipt_date,
            "deliver_to": g.deliver_to,
            "status": g.status,
            "inspected_by": names.get(g.inspected_by) if g.inspected_by else None,
            "inspected_at": g.inspected_at,
            "location": g.location,
            "inspect_note": g.inspect_note,
            "stored_by": names.get(g.stored_by) if g.stored_by else None,
            "stored_at": g.stored_at,
            "resolve_note": g.resolve_note,
            "resolved_by": names.get(g.resolved_by) if g.resolved_by else None,
            "resolved_at": g.resolved_at,
            "retries": _retry_brief(retries.get(g.request_id or 0, [])),
        }
        for g in rows
    ]


@purchase_router.get("/purchase/workbench")
def purchase_workbench(session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    """采购工作台：全公司在采购上的待办（跨项目）。"""
    rows = session.scalars(select(PurchaseRequest)).all()
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    projects = {p.project_no: p.project_name for p in session.scalars(select(Project)).all()}
    out = []
    for r in rows:
        # 已入库/现场已验收/已退货 是终态，采购不用再管；未完成前不进工作台
        if r.status in ("已入库", "现场已验收", "已退货", "已取消"):
            continue
        item = items.get(r.item_no)
        out.append(
            {
                **_request_dict(r, item),
                "project_name": projects.get(r.project_no),
                "overdue": bool(
                    r.expected_date
                    and r.need_date
                    and r.expected_date > r.need_date
                ),
            }
        )
    order = {"不合格": 0, "待采购": 1, "在途": 2, "已下单": 3, "待入库": 4, "部分到货": 5}
    return sorted(out, key=lambda x: (order.get(x["status"], 9), x.get("need_date") or "9999"))


def _sync_purchase_task(session: Session, req: PurchaseRequest, status: str, note: str) -> None:
    """采购需求状态一变，对应的采购任务跟着变（任务是指派到人的那件事）。"""
    from app.models.task import Task  # noqa: PLC0415

    t = session.scalar(
        select(Task).where(Task.task_type == "采购", Task.ref_id == req.id, Task.ref_type == "purchase_request")
    )
    if t is None:
        return
    t.status = status
    t.remark = note
    if status == "已完成":
        t.done_at = datetime.now(UTC)


# ============================================================================
# ★ 采购池 + 合并下单（00 卷 §3.1 ②：仓库优先 → 净需求 → 累计合并 → 集中采购）
# ============================================================================


@purchase_router.get("/purchase/pool")
def purchase_pool(session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    """采购池：所有「待采购」的需求，**按物料归拢**，标出哪些可以合并。

    各设计小组下单节点不一样，但东西大差不差 —— 攒一攒一起买，量大了价格才谈得下来。
    """
    rows = session.scalars(
        select(PurchaseRequest).where(PurchaseRequest.status == "待采购")
    ).all()
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    projects = {p.project_no: p.project_name for p in session.scalars(select(Project)).all()}

    groups: dict[str, dict] = {}
    for r in rows:
        item = items.get(r.item_no)
        g = groups.setdefault(
            r.item_no,
            {
                "item_no": r.item_no,
                "display_name": item.display_name if item else r.item_no,
                "spec_text": item.spec_text if item else None,
                "unit": r.unit or (item.unit if item else None),
                "total_qty": 0.0,
                "earliest_need": None,
                "requests": [],
            },
        )
        g["total_qty"] += float(r.qty or 0)
        if r.need_date and (g["earliest_need"] is None or r.need_date < g["earliest_need"]):
            g["earliest_need"] = r.need_date
        g["requests"].append(
            {
                "id": r.id,
                "project_no": r.project_no,
                "project_name": projects.get(r.project_no),
                "equip_no": r.equip_no,
                "part_no": r.part_no,
                "qty": float(r.qty or 0),
                "need_date": r.need_date,
                "source": r.source,
                "lead_days": r.lead_days,
                "origin_request_id": r.origin_request_id,
                "remark": r.remark,
            }
        )

    out = list(groups.values())
    # 退货重采的需求标一下是从哪张单退回来的
    origin_ids = {
        x["origin_request_id"]
        for g in out
        for x in g["requests"]
        if x.get("origin_request_id")
    }
    origins = (
        {r.id: r for r in session.scalars(select(PurchaseRequest).where(PurchaseRequest.id.in_(origin_ids)))}
        if origin_ids
        else {}
    )
    for g in out:
        for x in g["requests"]:
            o = origins.get(x.get("origin_request_id"))
            x["origin_po_no"] = o.po_no if o else None
    # 零件归属：图号之外再带个图名，池里一眼看懂
    part_nos = {x["part_no"] for g in out for x in g["requests"] if x.get("part_no")}
    part_titles = (
        {
            d.drawing_no: d.title
            for d in session.scalars(select(Drawing).where(Drawing.drawing_no.in_(part_nos)))
        }
        if part_nos
        else {}
    )
    for g in out:
        for x in g["requests"]:
            x["part_title"] = part_titles.get(x.get("part_no"))
    for g in out:
        g["request_count"] = len(g["requests"])
        g["mergeable"] = len(g["requests"]) > 1  # ★ 可合并
        g["requests"].sort(key=lambda x: x["need_date"] or date.max)
    # 可合并的排前面（那是要攒的），其次按最紧急的需要到货日
    out.sort(key=lambda g: (not g["mergeable"], g["earliest_need"] or date.max))
    return out


class GeneratePurchaseIn(BaseModel):
    need_date: date | None = Field(default=None, description="需要到货日期；不填用项目周期结束日")
    remark: str | None = None


@router.post("/equipment/{equip_no}/generate-purchase")
def generate_equipment_purchase(
    project_no: str,
    equip_no: str,
    body: GeneratePurchaseIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """★ BOM → 净需求 → 进采购池（常规件通道，00 卷 §3.1②）。

    展开设备完整 BOM（标准件 + 原材料），扣掉仓库可用库存和这台设备在跑的需求，
    剩下的按「物料 + 零件」生成「待采购」需求，进池等合并。
    """
    project = _get_project(session, project_no)
    plan, stats = bom_demand.plan_equipment_purchase(session, project_no, equip_no)
    if stats["need_lines"] == 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "这台设备还没有可采购的 BOM（标准件 / 原材料 BOM 都是空的）",
        )
    if not plan:
        return {
            "created": 0,
            **stats,
            "message": f"BOM 需求 {stats['need_qty']:g} 已被库存/在跑需求覆盖，没有新需求",
        }

    need_date = body.need_date or project.period_end
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    created: list[PurchaseRequest] = []
    for line, qty in plan:
        row = PurchaseRequest(
            project_no=project_no,
            equip_no=equip_no,
            part_no=line.part_no,
            item_no=line.item_no,
            qty=qty,
            unit=line.unit,
            source="常规",
            status="待采购",
            need_date=need_date,
            is_long_lead=False,
            remark=body.remark or "BOM 生成",
        )
        session.add(row)
        session.flush()
        created.append(row)

    audit.log(
        session,
        user=current,
        action="generate_purchase",
        object_type="purchase_request",
        object_ref=f"{project_no}/{equip_no}",
        summary=f"BOM 生成采购需求（{project_no} / {equip_no}）：{len(created)} 条进池，"
        f"合计 {stats['buy_qty']:g}"
        + (f"（库存/在途已覆盖 {stats['covered_qty']:g}）" if stats["covered_qty"] else "")
        + f"；需要到货 {need_date or '待定'}",
        detail={"request_ids": [r.id for r in created], **stats},
        ip=client_ip(request),
    )
    session.commit()
    return {
        "created": len(created),
        **stats,
        "need_date": need_date,
        "requests": [
            {
                "id": r.id,
                "item_no": r.item_no,
                "display_name": items[r.item_no].display_name if r.item_no in items else r.item_no,
                "part_no": r.part_no,
                "qty": float(r.qty or 0),
                "unit": r.unit,
            }
            for r in created
        ],
    }


class MergeLineIn(BaseModel):
    request_id: int
    qty: float | None = Field(default=None, gt=0, description="不填就用需求数量")
    unit_price: float | None = Field(default=None, description="不填就只下单不记价")


class MergeOrderIn(BaseModel):
    """合并下单：把采购池里勾中的若干条，合并成一张采购单下给同一个供应商。"""

    supplier_id: int
    ordered_at: date
    expected_date: date | None = None
    deliver_to: str = Field(default="公司仓库", description="公司仓库 / 直发客户现场")
    deliver_address: str | None = Field(default=None, description="直发现场时必填")
    po_no: str | None = Field(default=None, description="不填则自动发号 PO{YY}{NNN}")
    lines: list[MergeLineIn]
    remark: str | None = None


@purchase_router.post("/purchase/merge-order")
def merge_order(
    body: MergeOrderIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """合并下单：一次把多条需求下给同一个供应商，共用一张采购单号。"""
    from app.models.purchasing import Supplier, SupplierQuote  # noqa: PLC0415

    sup = session.get(Supplier, body.supplier_id)
    if sup is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "供应商不存在")
    if body.deliver_to not in DELIVER_TO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"收货地点只能是：{'/'.join(DELIVER_TO)}")
    if body.deliver_to == "直发客户现场" and not body.deliver_address:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "直发客户现场必须填送货地址")
    if not body.lines:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "至少要勾一条需求")

    po_no = body.po_no or next_number(session, "PURCHASE_ORDER")
    total = 0.0
    done: list[str] = []
    for ln in body.lines:
        row = session.get(PurchaseRequest, ln.request_id)
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"需求不存在：{ln.request_id}")
        if row.status != "待采购":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"{row.item_no} 当前状态是「{row.status}」，不能合并下单",
            )
        item = session.get(Item, row.item_no)
        if ln.qty:
            row.qty = ln.qty
        row.supplier_id = sup.id
        row.supplier_name = sup.name
        row.po_no = po_no
        row.ordered_at = body.ordered_at
        row.unit_price = ln.unit_price
        if ln.unit_price and row.qty:
            row.amount = float(ln.unit_price) * float(row.qty)
            total += float(row.amount)
        row.expected_date = body.expected_date or (
            body.ordered_at + timedelta(days=row.lead_days) if row.lead_days else None
        )
        row.deliver_to = body.deliver_to
        row.deliver_address = body.deliver_address
        row.status = "在途"
        _sync_purchase_task(
            session, row, "进行中", f"已合并下单 {po_no}（{sup.name}），{body.deliver_to}，等货"
        )
        # 成交价落进价格库
        if ln.unit_price:
            session.add(
                SupplierQuote(
                    item_no=row.item_no,
                    supplier_id=sup.id,
                    project_no=row.project_no,
                    price=ln.unit_price,
                    unit=row.unit,
                    lead_days=row.lead_days,
                    price_type="成交",
                    quote_date=body.ordered_at,
                    source=po_no,
                    recorded_by=current.id,
                )
            )
        done.append(f"{item.display_name if item else row.item_no} × {row.qty:g}")

    session.flush()
    audit.log(
        session,
        user=current,
        action="merge_order",
        object_type="purchase_order",
        object_ref=po_no,
        summary=f"合并下单 {po_no} → {sup.name}：{len(done)} 条需求合并，"
        f"合计 ¥{total:,.0f}，收货 {body.deliver_to}"
        + (f"（{body.deliver_address}）" if body.deliver_address else "")
        + "；" + "、".join(done[:4])
        + ("…" if len(done) > 4 else ""),
        detail={"po_no": po_no, "request_ids": [x.request_id for x in body.lines], "total": total},
        ip=client_ip(request),
    )
    session.commit()
    return {"po_no": po_no, "count": len(done), "total": total, "supplier": sup.name}


# ============================================================================
# ★ 采购单视图：一张采购单 + 各项目/设备的需求明细（合并单的「归属」）
#   00 卷 §3.1②：累计合并不丢来源 —— 这 10 个方通分别是谁家的，单子上要看得到。
# ============================================================================


# 可继续操作的行：未到货部分（取消 / 改供应商）；到货落地后不能动
ORDER_ACTIVE_STATUS = ("待采购", "在途", "已下单", "部分到货")
# 验收不合格：由采购协商 → 换货（回在途）/ 退货（结束）
ORDER_FAILED_STATUS = ("不合格",)
# 已落地（验收中/已入库/已退）：取消、改供应商都动不了
ORDER_BLOCKED_STATUS = ("待入库", "已入库", "现场已验收", "已退货", "已取消")


def _order_rows(session: Session, key: str) -> list[PurchaseRequest]:
    """key 是采购单号；历史遗留的单条单没发号，用 R{id} 兜底。"""
    if key.startswith("R") and key[1:].isdigit():
        row = session.get(PurchaseRequest, int(key[1:]))
        return [row] if row is not None else []
    return list(
        session.scalars(
            select(PurchaseRequest).where(PurchaseRequest.po_no == key).order_by(PurchaseRequest.id)
        ).all()
    )


def _order_status(rows: list[PurchaseRequest]) -> str:
    """一张单的状态由行汇总：不合格 > 待入库 > 部分到货 > 已完成 > 在途。"""
    active = [r for r in rows if r.status not in ("已取消", "已退货")]
    if not active:
        return "已取消" if any(r.status == "已取消" for r in rows) else "已退货"
    st = {r.status for r in active}
    if "不合格" in st:
        return "不合格"
    if "待入库" in st:
        return "待入库"
    done = {"已入库", "现场已验收"}
    if st <= done:
        return "已完成"
    if st & done or "部分到货" in st:
        return "部分到货"
    return "在途"


def _receipt_qty_map(session: Session, request_ids: list[int]) -> dict[int, dict[str, float]]:
    """每行的到货情况汇总：已验收 / 已换货 / 已退货 数量（退换货记录用）。"""
    out: dict[int, dict[str, float]] = {}
    for g in session.scalars(
        select(GoodsReceipt).where(GoodsReceipt.request_id.in_(request_ids))
    ):
        d = out.setdefault(g.request_id, {"accepted": 0.0, "exchanged": 0.0, "returned": 0.0})
        q = float(g.qty or 0)
        if g.status in ("待入库", "已入库", "现场已验收"):
            d["accepted"] += q
        elif g.status == "已换货":
            d["exchanged"] += q
        elif g.status == "已退货":
            d["returned"] += q
    return out


def _retry_map(session: Session, request_ids: list[int]) -> dict[int, list[PurchaseRequest]]:
    """退货重采：原需求 id → 新建的待采购需求（同一行可能退过多次）。"""
    out: dict[int, list[PurchaseRequest]] = {}
    if not request_ids:
        return out
    for r in session.scalars(
        select(PurchaseRequest).where(PurchaseRequest.origin_request_id.in_(request_ids))
    ):
        out.setdefault(r.origin_request_id, []).append(r)
    return out


def _retry_brief(rs: list[PurchaseRequest]) -> list[dict]:
    return [{"id": r.id, "status": r.status, "po_no": r.po_no} for r in rs]


def _order_summary(
    key: str,
    rows: list[PurchaseRequest],
    items: dict,
    projects: dict,
    equips: dict,
    agg: dict[int, dict[str, float]] | None = None,
) -> dict:
    agg = agg or {}
    active = [r for r in rows if r.status != "已取消"] or rows
    first = active[0]
    ordered = [r.ordered_at for r in rows if r.ordered_at]
    expected = [r.expected_date for r in active if r.expected_date]
    suppliers = {r.supplier_name for r in active if r.supplier_name}
    projs = []
    for r in rows:
        if r.project_no not in [p["project_no"] for p in projs]:
            projs.append({"project_no": r.project_no, "project_name": projects.get(r.project_no)})
    eqs = []
    for r in rows:
        if not r.equip_no:
            continue
        if any(e["project_no"] == r.project_no and e["equip_no"] == r.equip_no for e in eqs):
            continue
        eqs.append(
            {
                "project_no": r.project_no,
                "equip_no": r.equip_no,
                "equip_name": equips.get((r.project_no, r.equip_no)),
            }
        )
    return {
        "key": key,
        "po_no": first.po_no,
        "supplier_id": first.supplier_id if len(suppliers) <= 1 else None,
        "supplier_name": (
            next(iter(suppliers)) if len(suppliers) == 1 else (f"{len(suppliers)} 家供应商" if suppliers else None)
        ),
        "ordered_at": max(ordered) if ordered else None,
        "expected_date": min(expected) if expected else None,
        "deliver_to": first.deliver_to,
        "deliver_address": first.deliver_address,
        "status": _order_status(rows),
        "line_count": len(rows),
        "item_kinds": len({r.item_no for r in rows}),
        "total_amount": round(sum(float(r.amount or 0) for r in rows), 2),
        "exchanged_qty": round(sum(agg.get(r.id, {}).get("exchanged", 0.0) for r in rows), 3),
        "returned_qty": round(sum(agg.get(r.id, {}).get("returned", 0.0) for r in rows), 3),
        "projects": projs,
        "equipments": eqs,
        "request_ids": [r.id for r in rows],
    }


def _order_maps(session: Session):
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    projects = {p.project_no: p.project_name for p in session.scalars(select(Project)).all()}
    equips = {
        (e.project_no, e.equip_no): e.equip_name
        for e in session.scalars(select(Equipment)).all()
    }
    return items, projects, equips


@purchase_router.get("/purchase/orders")
def list_purchase_orders(session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    """采购单列表（合并单按 po_no 归拢；没号的历史单条单各自成单）。"""
    rows = session.scalars(
        select(PurchaseRequest)
        .where(or_(PurchaseRequest.po_no.isnot(None), PurchaseRequest.ordered_at.isnot(None)))
        .order_by(PurchaseRequest.id.desc())
    ).all()
    items, projects, equips = _order_maps(session)
    groups: dict[str, list[PurchaseRequest]] = {}
    for r in rows:
        groups.setdefault(r.po_no or f"R{r.id}", []).append(r)
    agg = _receipt_qty_map(session, [r.id for r in rows])
    out = [_order_summary(key, mrs, items, projects, equips, agg) for key, mrs in groups.items()]
    out.sort(key=lambda o: (o["ordered_at"] or date.min, o["key"]), reverse=True)
    return out


@purchase_router.get("/purchase/orders/{key}")
def get_purchase_order(key: str, session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    """采购单详情：单头 + 每行需求（项目/设备/物料/价格/状态/到货单）。"""
    rows = _order_rows(session, key)
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    items, projects, equips = _order_maps(session)
    names = {u.id: u.name for u in session.scalars(select(User)).all()}
    receipts = session.scalars(
        select(GoodsReceipt).where(GoodsReceipt.request_id.in_([r.id for r in rows]))
    ).all()
    by_req: dict[int, list[GoodsReceipt]] = {}
    for g in receipts:
        by_req.setdefault(g.request_id or 0, []).append(g)
    agg = _receipt_qty_map(session, [r.id for r in rows])
    retries = _retry_map(session, [r.id for r in rows])
    part_nos = {r.part_no for r in rows if r.part_no}
    part_titles = (
        {
            d.drawing_no: d.title
            for d in session.scalars(select(Drawing).where(Drawing.drawing_no.in_(part_nos)))
        }
        if part_nos
        else {}
    )

    lines = []
    for r in rows:
        item = items.get(r.item_no)
        a = agg.get(r.id, {})
        lines.append(
            {
                **_request_dict(r, item),
                "project_name": projects.get(r.project_no),
                "equip_name": equips.get((r.project_no, r.equip_no)),
                "part_title": part_titles.get(r.part_no),
                # ★ 退换货留痕：原订购多少、退了多少、换过多少（当前 qty 是退货后的有效数）
                "qty_original": float(r.qty or 0) + a.get("returned", 0.0),
                "qty_returned": a.get("returned", 0.0),
                "qty_exchanged": a.get("exchanged", 0.0),
                "receipts": [
                    {
                        "receipt_no": g.receipt_no,
                        "status": g.status,
                        "qty": float(g.qty) if g.qty is not None else None,
                        "unit": g.unit,
                        "receipt_date": g.receipt_date,
                        "deliver_to": g.deliver_to,
                        "location": g.location,
                        "inspect_note": g.inspect_note,
                        "inspected_by": names.get(g.inspected_by) if g.inspected_by else None,
                        "inspected_at": g.inspected_at,
                        "stored_by": names.get(g.stored_by) if g.stored_by else None,
                        "stored_at": g.stored_at,
                        "resolve_note": g.resolve_note,
                        "resolved_by": names.get(g.resolved_by) if g.resolved_by else None,
                        "resolved_at": g.resolved_at,
                        "retries": _retry_brief(retries.get(r.id, [])),
                    }
                    for g in by_req.get(r.id, [])
                ],
            }
        )
    return {
        "order": _order_summary(key, rows, items, projects, equips, agg),
        "lines": lines,
    }


class CancelOrderIn(BaseModel):
    request_ids: list[int] | None = Field(default=None, description="不填=整单可取消的行")
    reason: str | None = None


@purchase_router.post("/purchase/orders/{key}/cancel")
def cancel_purchase_order(
    key: str,
    body: CancelOrderIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """取消采购：没到货的可以取消；已到货/入库的部分按实际留着，不合格的走换货/退货。"""
    rows = _order_rows(session, key)
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    eligible = [r for r in rows if r.status in ORDER_ACTIVE_STATUS]
    want = set(body.request_ids) if body.request_ids else None
    target = [r for r in eligible if want is None or r.id in want]
    if not target:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "这张单没有可取消的行（已到货、待入库、已入库的要走换货/退货或入库）",
        )

    for r in target:
        # 已经到货/入库的部分不能被「取消」抹掉：取消的是还没到的，数量收到货量
        gs = _request_receipts(session, r.id)
        delivered = sum(
            float(g.qty or 0)
            for g in gs
            if g.status in ("待入库", "已入库", "现场已验收")
        )
        if delivered > 0:
            r.qty = delivered
            if r.unit_price:
                r.amount = float(r.unit_price) * delivered
            session.flush()
            _recalc_request_status(session, r)
            _sync_purchase_task(
                session, r, "进行中", f"取消未到的部分，已到 {delivered:g} 按实际留着"
            )
        else:
            r.status = "已取消"
            _sync_purchase_task(session, r, "已取消", f"采购取消：{body.reason or '—'}")
    audit.log(
        session,
        user=current,
        action="cancel_order",
        object_type="purchase_order",
        object_ref=key,
        summary=f"取消采购 {key}：{len(target)} 行"
        + (f"（{body.reason}）" if body.reason else ""),
        detail={"request_ids": [r.id for r in target], "skipped": len(rows) - len(target)},
        ip=client_ip(request),
    )
    session.commit()
    return {"cancelled": len(target), "skipped": len(rows) - len(target)}


class SupplierPriceLine(BaseModel):
    request_id: int
    unit_price: float | None = Field(default=None, gt=0, description="改供应商时顺便改价（可选）")


class ChangeSupplierIn(BaseModel):
    """更改供应商：还没到的行一起换（可顺便改价）。"""

    supplier_id: int
    note: str | None = None
    lines: list[SupplierPriceLine] | None = None


@purchase_router.post("/purchase/orders/{key}/change-supplier")
def change_order_supplier(
    key: str,
    body: ChangeSupplierIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    from app.models.purchasing import Supplier, SupplierQuote  # noqa: PLC0415

    sup = session.get(Supplier, body.supplier_id)
    if sup is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "供应商不存在")
    rows = _order_rows(session, key)
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")

    price_map = {ln.request_id: ln.unit_price for ln in (body.lines or [])}
    only = set(price_map) if body.lines else None
    eligible = [r for r in rows if r.status in ("在途", "已下单")]
    target = [r for r in eligible if only is None or r.id in only]
    if not target:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "这张单没有可换供应商的行（只有还没到的货能换）"
        )

    quote_at = date.today()
    for r in target:
        r.supplier_id = sup.id
        r.supplier_name = sup.name
        if r.id in price_map and price_map[r.id]:
            r.unit_price = price_map[r.id]
            if r.qty:
                r.amount = float(price_map[r.id]) * float(r.qty)
            session.add(
                SupplierQuote(
                    item_no=r.item_no,
                    supplier_id=sup.id,
                    project_no=r.project_no,
                    price=price_map[r.id],
                    unit=r.unit,
                    lead_days=r.lead_days,
                    price_type="成交",
                    quote_date=quote_at,
                    source=r.po_no or key,
                    recorded_by=current.id,
                )
            )
        _sync_purchase_task(session, r, "进行中", f"更改供应商 → {sup.name}，等货")

    audit.log(
        session,
        user=current,
        action="change_supplier",
        object_type="purchase_order",
        object_ref=key,
        summary=f"采购单 {key} 更改供应商 → {sup.name}：{len(target)} 行"
        + (f"（{body.note}）" if body.note else ""),
        detail={"request_ids": [r.id for r in target], "supplier_id": sup.id},
        ip=client_ip(request),
    )
    session.commit()
    return {"changed": len(target)}


class NegotiateIn(BaseModel):
    """验收不合格的处理：换货（等供应商补发）/ 退货（不等了，数量减掉）。"""

    request_ids: list[int]
    action: str = Field(..., description="换货 / 退货")
    expected_date: date | None = Field(default=None, description="换货时新的预计到货日期")
    note: str | None = None


@purchase_router.post("/purchase/orders/{key}/negotiate")
def negotiate_failed_lines(
    key: str,
    body: NegotiateIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """验收不合格的回采购处理：换货（回「在途」等补发）或退货（数量减掉、结束）。"""
    rows = _order_rows(session, key)
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    if body.action not in ("换货", "退货"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "处理方式只能是 换货 / 退货")
    want = set(body.request_ids)
    target = [r for r in rows if r.id in want]
    if not target:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "没有要处理的行")
    bad = [r for r in target if r.status not in ORDER_FAILED_STATUS]
    if bad:
        names = "、".join(f"{r.item_no}#{r.id}" for r in bad)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"这些行不是「验收不合格」，不能这样处理：{names}")

    today = date.today()
    replaced = returned = 0
    retry_ids: list[int] = []
    for r in target:
        failed = [g for g in _request_receipts(session, r.id) if g.status == "不合格"]
        if not failed:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{r.item_no} 没有「不合格」的到货单")
        failed_qty = sum(float(g.qty or 0) for g in failed)
        for g in failed:
            g.status = "已换货" if body.action == "换货" else "已退货"
            g.resolve_note = body.note
            g.resolved_by = current.id
            g.resolved_at = datetime.now(UTC)
        session.flush()  # 到货单处理结果先落库，状态重算才看得到
        if body.action == "换货":
            r.expected_date = body.expected_date or (
                today + timedelta(days=r.lead_days) if r.lead_days else None
            )
            _recalc_request_status(session, r)
            _sync_purchase_task(
                session,
                r,
                "进行中",
                f"换货中：{body.note or '等供应商补发'}（预计 {r.expected_date or '—'}）",
            )
            replaced += 1
        else:
            # ★ 退货：这家供应商的货退回去，不再等他；但需求不能丢 ——
            #   新建一条「待采购」需求回到采购池（换供应商重买，可再合并）
            origin_no = r.po_no or f"R{r.id}"
            r.qty = max(0.0, float(r.qty or 0) - failed_qty)
            if r.unit_price:
                r.amount = float(r.unit_price) * r.qty if r.qty else 0.0
            retry = PurchaseRequest(
                project_no=r.project_no,
                equip_no=r.equip_no,
                item_no=r.item_no,
                qty=failed_qty,
                unit=r.unit,
                source="退货重采",
                lead_days=r.lead_days,
                need_date=r.need_date,
                status="待采购",
                is_long_lead=r.is_long_lead,
                origin_request_id=r.id,
                remark=f"退货重采（原 {origin_no} / {'、'.join(g.receipt_no for g in failed)}）"
                + (f"：{body.note}" if body.note else ""),
            )
            session.add(retry)
            session.flush()
            retry_ids.append(retry.id)
            _recalc_request_status(session, r)
            if r.status == "已退货":
                _sync_purchase_task(
                    session, r, "已完成", f"已退货，需求已回采购池重采（新需求 #{retry.id}）"
                )
            elif r.status in REQUEST_DONE:
                _sync_purchase_task(
                    session,
                    r,
                    "已完成",
                    f"部分退货 {failed_qty:g}（已回池重采 #{retry.id}），剩余 {r.qty:g} 已验收入库",
                )
            else:
                _sync_purchase_task(
                    session,
                    r,
                    "进行中",
                    f"部分退货 {failed_qty:g}（已回池重采 #{retry.id}），剩余 {r.qty:g} 继续",
                )
            returned += 1

    audit.log(
        session,
        user=current,
        action="negotiate",
        object_type="purchase_order",
        object_ref=key,
        summary=f"采购单 {key} 验收不合格处理：{body.action} {len(target)} 行"
        + (f"（{body.note}）" if body.note else "")
        + (f"；退货 {len(retry_ids)} 份需求已回采购池重采" if retry_ids else ""),
        detail={"request_ids": [r.id for r in target], "action": body.action, "retry_request_ids": retry_ids},
        ip=client_ip(request),
    )
    session.commit()
    return {"replaced": replaced, "returned": returned, "retry_request_ids": retry_ids}
