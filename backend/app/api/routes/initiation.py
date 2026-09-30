"""立项相关接口：团队 / 设备清单 / 节点计划 / 长周期采购 / 立项动作（00 卷 §3 S1）。"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import (
    client_ip,
    get_current_user,
    has_permission,
    require_any_permission,
    require_permission,
    scrub_money,
)
from app.core.config import settings
from app.core.db import get_session
from app.models.engineering import Drawing
from app.services.files import guess_media_type, save_upload
from app.models.initiation import (
    ATTRIBUTIONS,
    DEFAULT_MILESTONES,
    DELIVER_TO,
    EQUIPMENT_KINDS,
    MILESTONE_STATUS,
    PROJECT_ROLES,
    REQUEST_DONE,
    REQUEST_STATUS,
    SOURCE_LONG_LEAD,
    SOURCE_MANUAL,
    SOURCE_REGULAR,
    SOURCE_RETRY,
    GoodsReceipt,
    Milestone,
    ProjectMember,
    PurchaseRequest,
)
from app.models.library import Item
from app.models.platform import User
from app.models.project import Equipment, Project
from app.models.review import DesignRelease
from app.models.purchase_order import PurchaseApproval, PurchaseOrder, PurchaseOrderLine
from app.services import audit, bom_demand, notify, project_stage
from app.services.numbering import (
    make_equip_no,
    next_letter,
    next_number,
    year_scope_key,
)

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
    current: User = Depends(require_permission("project:edit")),
):
    _get_project(session, project_no)
    if body.project_role not in PROJECT_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"项目角色必须是：{'/'.join(PROJECT_ROLES)}")
    user = session.get(User, body.user_id)
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "用户不存在")
    # ★ 任命「项目经理」时同步 project.pm_id（所有“通知项目经理”靠它定位；此前从未赋值 → 通知静默丢失）
    if body.project_role == "项目经理":
        project = session.get(Project, project_no)
        if project is not None:
            project.pm_id = body.user_id

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
    current: User = Depends(require_permission("project:edit")),
):
    row = session.get(ProjectMember, member_id)
    if row is None or row.project_no != project_no:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "团队成员不存在")
    user = session.get(User, row.user_id)
    if row.project_role == "项目经理":
        project = session.get(Project, project_no)
        if project is not None and project.pm_id == row.user_id:
            project.pm_id = None
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
    current: User = Depends(require_permission("project:edit")),
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
    # ★ 同型设备：若母机已有设计，立即复制一份（2026-09-22 产品决策·确认1）
    if body.same_as:
        from app.services import equipment_clone

        equipment_clone.clone_same_type_design(session, project_no, body.same_as, None, current.id)
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
    current: User = Depends(require_permission("project:edit")),
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
    current: User = Depends(require_permission("project:edit")),
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
    current: User = Depends(require_permission("project:edit")),
):
    """按标准节点一键生成：按合同周期均分出每个节点的计划起止（可再手工调整）。已存在的不动。"""
    project = _get_project(session, project_no)
    existing = {
        m.name
        for m in session.scalars(select(Milestone).where(Milestone.project_no == project_no)).all()
    }
    # 时间轴：有合同周期用合同周期；只有交期天数用交期天数；都没有按今天起 120 天兜底
    start = project.period_start or date.today()
    end = project.period_end or (
        start + timedelta(days=project.delivery_days or 120)
    )
    total_days = max((end - start).days, len(DEFAULT_MILESTONES))
    seg = total_days / len(DEFAULT_MILESTONES)
    created = []
    for i, name in enumerate(DEFAULT_MILESTONES, start=1):
        if name in existing:
            continue
        seg_start = start + timedelta(days=round((i - 1) * seg))
        seg_end = start + timedelta(days=round(i * seg)) if i < len(DEFAULT_MILESTONES) else end
        session.add(Milestone(project_no=project_no, seq=i, name=name,
                              plan_start=seg_start, plan_end=seg_end, status="未开始"))
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
    _: User = Depends(require_permission("project:edit")),
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
    current: User = Depends(require_permission("project:edit")),
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
    _: User = Depends(require_permission("project:edit")),
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
    unit_price: float | None = Field(default=None, ge=0, description="单价（选填，填了就能算金额）")
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
        "qty_ordered": float(r.qty_ordered) if r.qty_ordered is not None else None,
        "qty_rejected": float(r.qty_rejected) if r.qty_rejected is not None else None,
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
    current: User = Depends(require_any_permission("purchase:edit", "project:edit")),
):
    """登记长周期采购件（从标准库选）。填下单日期 → 已下单，预计到货 = 下单 + 周期。

    ★ AZ-01：这是「立即下单 + 发号 + 置在途」的写动作，必须 `purchase:edit`
      （此前只校验登录，现场账号 `site1` 能凭空下一张 ¥54,000 采购单）。
    """
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
        attribution="项目",
        item_no=body.item_no,
        qty=body.qty,
        unit=body.unit or item.unit,
        source=SOURCE_LONG_LEAD,
        lead_days=body.lead_days,
        supplier_name=body.supplier_name,
        need_date=body.need_date,
        expected_date=expected,
        ordered_at=ordered_at,
        po_no=next_number(session, "PURCHASE_ORDER"),
        unit_price=body.unit_price,
        amount=(float(body.unit_price) * float(body.qty)) if body.unit_price else None,
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
    current: User = Depends(require_any_permission("purchase:edit", "project:edit")),
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
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_any_permission("purchase:edit", "project:edit")),
):
    """删除一条采购需求：**只允许还没进入采购流程的需求**。

    ★ AZ-02：此前只校验登录、无审计、无状态守卫 —— 任何账号可硬删（含已下单/在途）。
      三重修复：① `purchase:edit`；② 状态守卫；③ 落 `audit_log`（铁律 5）。
      已下单的需求不再提供删除，如需终止请走采购单「取消 / 退货」。
    """
    row = session.get(PurchaseRequest, request_id)
    if row is None or row.project_no != project_no:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购需求不存在")
    if row.status not in ("待采购", "已取消"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{row.item_no} 当前状态是「{row.status}」，不能删除（已进入采购流程）。"
            "如不再需要，请在采购单上「取消」或走退货。",
        )
    if session.scalar(select(GoodsReceipt.id).where(GoodsReceipt.request_id == row.id).limit(1)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "这条需求已有到货单，不能删除")
    audit.log(
        session,
        user=current,
        action="delete",
        object_type="purchase_request",
        object_ref=project_no,
        summary=f"删除采购需求 {row.item_no} × {float(row.qty or 0):g}（{row.status}）",
        detail={"request_id": row.id, "item_no": row.item_no, "qty": float(row.qty or 0)},
        ip=client_ip(request),
    )
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
    current: User = Depends(require_permission("project:edit")),
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
    from app.models.engineering import Drawing
    from app.services.numbering import EMPTY, compose_mech_drawing_no

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
    from app.models.task import Task

    tasks = session.scalars(select(Task).where(Task.project_no == project_no)).all()
    if not tasks:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "还不能立项：任务还没生成 —— 立项后设计要分到机械/电气/程序经理手上，采购要分到采购员手上",
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
    # ★ G2（09 卷 §3 · 客户口径 2026-09-29）：立项 → **提醒商务部收「预收款」**（只提醒，不卡流程）
    from app.services import payment as payment_svc
    reminded = payment_svc.trigger_for_initiate(session, project_no, actor_id=current.id)
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
        + (f"（其中 {len(not_ordered)} 项未下单）" if not_ordered else "")
        + (f"；已提醒商务部收预收款（{reminded} 个节点）" if reminded else ""),
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
    _: User = Depends(require_permission("project:edit")),
):
    session.execute(delete(Milestone).where(Milestone.project_no == project_no))
    session.commit()
    return {"ok": True}


# ============================================================================
# 采购流程：下单 → 供应商发货 → 到货 → 仓库验收
# ============================================================================


def _resolve_expected(
    given: date | None, ordered_at: date | None, lead_days: int | None, *, base: date | None = None
) -> date:
    """预计到货日（客户口径 O3-A）：**下单/换货必须有**——要么直接填，要么由「下单日 + 采购周期」算出来。

    两者都空就报错：没有预计到货日，采购台的「到货跟踪」就无法排序/超期红/临期黄，催货没有依据。
    （设计发布/工艺发布/长周期需求带 lead_days，会自动算出，不强迫多填一格）
    """
    if given:
        return given
    anchor = base or ordered_at  # 下单用下单日；换货/重排期用基准日（今天）
    if anchor and lead_days:
        return anchor + timedelta(days=int(lead_days))
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        "必须填「预计到货日期」（或填采购周期由系统推算）—— 到货跟踪、超期预警、催货都以它为凭",
    )


class OrderIn(BaseModel):
    """下单：采购员真正去下采购单，把这些填回来。"""

    supplier_id: int | None = Field(default=None, description="从供应商主数据里选")
    supplier_name: str | None = None
    deliver_to: str = Field(default="公司仓库", description="公司仓库 / 直发客户现场")
    deliver_address: str | None = Field(default=None, description="送货地址（直发现场必填）")
    po_no: str | None = Field(default=None, description="采购单号")
    unit_price: float | None = Field(default=None, gt=0, description="单价")
    tax_incl: bool = Field(..., description="这个价含税 / 不含税（采购员必选）")
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
    current: User = Depends(require_permission("purchase:edit")),
):
    """采购员下单 → 建采购单（草稿）+ 提交审批，需求转「审批中」，并同步采购任务。"""
    from app.models.purchasing import Supplier
    from app.services import purchase_order as po_svc

    row = session.get(PurchaseRequest, request_id)
    if row is None or row.project_no != project_no:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购需求不存在")
    if row.status not in ("待采购", "部分下单", "审批中"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"当前状态是「{row.status}」，不能重复下单")
    if body.deliver_to not in DELIVER_TO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"收货地点只能是：{'/'.join(DELIVER_TO)}")
    if body.deliver_to == "直发客户现场" and not body.deliver_address:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "直发客户现场必须填送货地址")
    if not body.supplier_id and not body.supplier_name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "下单必须写供应商（从供应商主数据选或填名称）")
    sup = session.get(Supplier, body.supplier_id) if body.supplier_id else None
    if body.supplier_id and sup is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "供应商不存在")

    remaining = float(row.qty or 0) - po_svc.ordered_qty(session, row.id)
    qty = float(body.qty) if body.qty else remaining
    if qty <= 1e-9:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{row.item_no} 没有可下单的剩余量")
    try:
        po_svc.assert_no_over_order(session, row.id, qty)
    except po_svc.PurchaseOrderError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    expect = _resolve_expected(body.expected_date, body.ordered_at, row.lead_days)

    try:
        po = po_svc.create_order(
            session,
            supplier_id=sup.id if sup else None,
            supplier_name=sup.name if sup else body.supplier_name,
            order_date=body.ordered_at,
            expect_date=body.expected_date or expect,
            deliver_to=body.deliver_to,
            deliver_address=body.deliver_address,
            lines=[
                {
                    "request_id": row.id,
                    "qty": qty,
                    "unit_price": body.unit_price,
                    "tax_incl": body.tax_incl,
                    "expect_date": expect,
                }
            ],
            actor_id=current.id,
            po_no=body.po_no,
            status="草稿",
        )
        po_svc.submit_order(session, po, current)  # ★ 二期：下单即提交审批
    except po_svc.PurchaseOrderError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    po_svc.sync_request_snapshot(session, row)
    item = session.get(Item, row.item_no)
    audit.log(
        session,
        user=current,
        action="order",
        object_type="purchase_request",
        object_ref=f"{project_no}/{row.item_no}",
        summary=f"采购下单 {item.display_name if item else row.item_no}："
        f"供应商 {po.supplier_name or '—'} · 单号 {po.po_no}（{po.status}）· "
        f"数量 {qty:g} · 单价 ¥{body.unit_price or '—'} · "
        f"下单 {body.ordered_at} · 预计到货 {row.expected_date or '—'}",
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


def _line_failed_receipts(session: Session, ln: PurchaseOrderLine) -> list[GoodsReceipt]:
    """本行的「不合格」到货单（优先按 `po_line_id`；旧数据为空时按 `request_id` 兜底）。"""
    gs = session.scalars(select(GoodsReceipt).where(GoodsReceipt.status == "不合格")).all()
    return [
        g
        for g in gs
        if g.po_line_id == ln.id or (g.po_line_id is None and g.request_id == ln.request_id)
    ]


def _ok_qty(g: GoodsReceipt) -> float:
    """到货单的合格数（部分合格时用 qty_ok；旧数据没有就取 qty）。"""
    return float(g.qty_ok if g.qty_ok is not None else (g.qty or 0))


def _rejected_qty_of(g: GoodsReceipt) -> float:
    """到货单的不合格数。"""
    return float(g.qty_rejected if g.qty_rejected is not None else (g.qty or 0))


def _recalc_request_status(session: Session, row: PurchaseRequest) -> str:
    """由到货单反推采购需求状态（分批到货时看「已验收多少、还差多少」）。"""
    if row.status in ("已取消", "已退货", "待采购"):
        return row.status
    gs = _request_receipts(session, row.id)
    stored = sum(_ok_qty(g) for g in gs if g.status == "已入库")
    site = sum(_ok_qty(g) for g in gs if g.status == "现场已验收")
    pending = sum(_ok_qty(g) for g in gs if g.status in ("待入库", "现场待验收"))
    rejected = sum(_rejected_qty_of(g) for g in gs if g.status in ("不合格", "已换货", "已退货"))
    row.qty_received = stored + site + pending  # 有效到货（合格部分；不合格/退回的不算）
    row.qty_rejected = rejected
    qty = float(row.qty or 0)
    if any(g.status == "不合格" for g in gs):
        row.status = "不合格"
    elif pending > 0:
        pending_rows = [g for g in gs if g.status in ("待入库", "现场待验收")]
        # 全是直发现场的货 → 等「现场待验收」，不要误导成要仓库入库
        row.status = (
            "现场待验收"
            if pending_rows and all(g.deliver_to == "直发客户现场" for g in pending_rows)
            else "待入库"
        )
    elif qty <= 0:
        row.status = "已退货" if any(g.status == "已退货" for g in gs) else "已取消"
    elif stored + site >= qty - 1e-6:
        row.status = "现场已验收" if site > 0 and stored <= 0 else "已入库"
    elif stored + site > 0:
        row.status = "部分到货"
    else:
        row.status = "在途"
    return row.status


def _ensure_site_pending_receipt(
    session: Session, row: PurchaseRequest, actor_id: int, line: PurchaseOrderLine | None = None
) -> GoodsReceipt | None:
    """R2-01（口径①）：直发客户现场下单即建「现场待验收」到货单，现场立即可清点。

    - 幂等：同一条**采购单行**已有「现场待验收」单就不再建（拆单时每行各一张）。
    - 需求状态保持「在途」：「在途」在净需求 OPEN_STATUS 里，不会算漏（避免重复采购）。
    """
    if (row.deliver_to or "") != "直发客户现场":
        return None
    cond = (
        (GoodsReceipt.po_line_id == line.id)
        if line is not None
        else (GoodsReceipt.request_id == row.id)
    )
    existing = session.scalar(
        select(GoodsReceipt).where(cond, GoodsReceipt.status == "现场待验收").limit(1)
    )
    if existing is not None:
        return existing
    item = session.get(Item, row.item_no)
    # ★ N13：直发到货单数量取【本行订购量】，不是需求总量（一条需求拆给多家时各记各的）
    q_ = float(line.qty or 0) if line is not None else float(row.qty or 0)
    gr = GoodsReceipt(
        receipt_no=next_number(session, "RECEIPT", scope_key=year_scope_key()),
        project_no=row.project_no,
        request_id=row.id,
        item_no=row.item_no,
        qty=q_,
        qty_ok=q_,
        unit=row.unit or (item.unit if item else None),
        receipt_date=None,
        deliver_to="直发客户现场",
        status="现场待验收",
        inspect_note="下单即生成：直发客户现场，等现场清点",
    )
    session.add(gr)
    session.flush()
    _attach_po(session, [gr], line)  # 挂到采购单/行（交期留痕/对账靠它）
    project = session.get(Project, row.project_no) if row.project_no else None
    if project is not None and project.pm_id:
        notify.notify(
            session,
            [project.pm_id],
            type_=notify.TYPE_WAREHOUSE,
            title=f"直发件已下单，待现场清点：{row.item_no} × {float(row.qty or 0):g}",
            body=f"{row.project_no} {row.equip_no or ''}（{gr.receipt_no}）—— 货到现场后请清点验收",
            link="/site",
            biz_type="goods_receipt",
            biz_id=gr.id,
            actor_id=actor_id,
        )
    return gr


def _resolve_location(session: Session, location: str | None):
    """入库库位：填了就找/建，没填用「待定」。"""
    from app.models.warehouse import WarehouseLocation

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
    """验收：货到了就验。

    ★ 部分合格（08 §2 洞②）：填 `qty_ok`/`qty_rejected`（两者之和 = `qty`）→ 生成两条到货单
    （合格→待入库、不合格→不合格，同 `batch_no`）；不填则按整批 `result` 处理。
    """

    receipt_date: date = Field(..., description="到货日期")
    qty: float = Field(..., gt=0, description="本次到货总数（= 合格数 + 不合格数）")
    result: str = Field(..., description="合格 / 不合格（整批口径）")
    qty_ok: float | None = Field(default=None, ge=0, description="合格数（部分合格时填）")
    qty_rejected: float | None = Field(default=None, ge=0, description="不合格数（部分合格时填）")
    po_line_id: int | None = Field(
        default=None, description="这批货是哪张采购单的行（一条需求拆给多家时必填）"
    )
    note: str | None = Field(default=None, description="不合格时说明原因")


def _resolve_po_line(
    session: Session, row: PurchaseRequest, po_line_id: int | None
) -> PurchaseOrderLine | None:
    """确定这批货属于哪张采购单的行（★ 系统不猜实物归属，与「OCR 只作候选」同一哲学）。

    - 传了 `po_line_id`：校验它属于本需求
    - 未传且只有一行：用那一行（非拆单，前端不用改）
    - 未传但拆成多行：400，让仓库指明是哪张单
    - 一行都没有（长周期件登记未建 PO）：None（照旧只记需求）
    """
    lines = list(
        session.scalars(
            select(PurchaseOrderLine)
            .where(
                PurchaseOrderLine.request_id == row.id,
                PurchaseOrderLine.status.not_in(("已退货", "已取消")),
            )
            .order_by(PurchaseOrderLine.id)
        ).all()
    )
    if po_line_id is not None:
        match = next((x for x in lines if x.id == po_line_id), None)
        if match is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "指定的采购单行不属于这条需求（或已取消）"
            )
        return match
    if len(lines) == 1:
        return lines[0]
    if len(lines) > 1:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "这条需求拆给了多家供应商 —— 请指明这批货是哪张采购单的（传 po_line_id）",
        )
    return None


def _attach_po(
    session: Session, receipts: list[GoodsReceipt], line: PurchaseOrderLine | None
) -> None:
    """把到货单挂到**确定的**采购单行（不再猜「最新一行」；line 为空则不挂）。"""
    if line is None:
        return
    for g in receipts:
        g.po_id = line.po_id
        g.po_line_id = line.id


def _recalc_po_delivery(session: Session, po_id: int) -> None:
    """交期留痕（08 §7）：实际到货 = 最后一批到货日；delay_days = 实际 − 承诺（>0 逾期）。

    口径：货到了（待入库/已入库/现场待验收/现场已验收）就算实际到货。实现在 `services.purchase_order`。
    """
    from app.services import purchase_order as po_svc

    po_svc.recalc_delivery(session, po_id)


def _bump_line_on_receipt(
    session: Session, line: PurchaseOrderLine | None, *, ok: float, rejected: float
) -> None:
    """到货验收后同步**指定**采购单行的已收/不合格与状态（不再猜行）。"""
    if line is None:
        return
    line.received_qty = float(line.received_qty or 0) + float(ok)
    line.rejected_qty = float(line.rejected_qty or 0) + float(rejected)
    if rejected > 0:
        line.status = "不合格"
    elif line.received_qty + 1e-9 >= float(line.qty or 0):
        line.status = "已入库"
    elif line.received_qty > 0:
        line.status = "部分到货"
    po = session.get(PurchaseOrder, line.po_id)
    if po is not None and po.status in ("已批准",):
        po.status = "执行中"
    _recalc_po_delivery(session, line.po_id)


def _perform_inspect(
    session: Session,
    row: PurchaseRequest,
    body: AcceptanceIn,
    current: User,
    request: Request,
) -> dict:
    """仓库验收核心（分批可多次）：合格 → 待入库；不合格 → 采购「验收不合格」里协商。

    项目号取 `row.project_no`（可为空：辅料 / 办公用品 / 其他类采购，P-02）。
    """
    project_no = row.project_no
    if body.result not in ("合格", "不合格"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "验收结果只能是 合格 / 不合格")
    if body.result == "不合格" and not (body.note or "").strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "验收不合格必须写明原因")
    if row.status in ("已取消", "已退货"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"这一行已经结束了（{row.status}），不能再验收")
    if row.status not in ("在途", "部分到货", "待入库", "不合格"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"当前状态是「{row.status}」，不能验收")

    # ★ R2-01：直发单在下单时已生成「现场待验收」单 —— 仓库不再重复验收，直接返回该单
    if (row.deliver_to or "") == "直发客户现场":
        existing = session.scalar(
            select(GoodsReceipt)
            .where(GoodsReceipt.request_id == row.id, GoodsReceipt.status == "现场待验收")
            .limit(1)
        )
        if existing is not None:
            return {
                "receipt_id": existing.id,
                "receipt_no": existing.receipt_no,
                "receipt_status": existing.status,
                "request_status": row.status,
                "qty_received": float(row.qty_received or 0),
            }

    # ★ N12：先确定这批货属于哪张采购单的行（拆单时如果没指明就 400，不再猜）
    line = _resolve_po_line(session, row, body.po_line_id)
    if line is not None:
        line_remaining = float(line.qty or 0) - float(line.received_qty or 0)
        if float(body.qty) > line_remaining + 1e-6:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"本批到货 {body.qty:g} 超过该采购单行（{line.po_id}）的未到数量 {line_remaining:g}"
                f"（订购 {float(line.qty or 0):g}，已到 {float(line.received_qty or 0):g}）",
            )

    # ★ 超额验收硬拦（2026-09-22 产品决策）：到货数量不得超过「订购 − 有效到货」
    receipts = _request_receipts(session, row.id)
    received = sum(
        float(g.qty or 0)
        for g in receipts
        if g.status in ("已入库", "现场已验收", "待入库", "现场待验收")
    )
    remaining = float(row.qty or 0) - received
    if float(body.qty) > remaining + 1e-6:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"到货数量 {body.qty:g} 超过未到数量 {remaining:g}"
            f"（订购 {float(row.qty or 0):g}，有效到货 {received:g}）——"
            "多送的请走换货/退货，或先改采购需求数量",
        )

    to = row.deliver_to or "公司仓库"
    item = session.get(Item, row.item_no)
    # ★ 部分合格（08 §2 洞②）：本批 = 合格数 + 不合格数，拆成两条到货单（同 batch_no）
    if body.qty_ok is None and body.qty_rejected is None:
        ok = float(body.qty) if body.result == "合格" else 0.0
        rejected = 0.0 if body.result == "合格" else float(body.qty)
    else:
        ok = float(body.qty_ok or 0)
        rejected = float(body.qty_rejected or 0)
        if abs(ok + rejected - float(body.qty)) > 1e-6:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "合格数 + 不合格数 必须等于本批到货数"
            )
    if rejected > 0 and not (body.note or "").strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "有不合格的必须写明原因")

    batch_no = next_number(session, "RECEIPT", scope_key=year_scope_key())
    created: list[GoodsReceipt] = []
    if ok > 0:
        st = "现场待验收" if to == "直发客户现场" else "待入库"
        created.append(
            GoodsReceipt(
                receipt_no=batch_no if rejected == 0 else f"{batch_no}-A",
                project_no=project_no,
                request_id=row.id,
                item_no=row.item_no,
                qty=ok,
                qty_ok=ok,
                unit=row.unit or (item.unit if item else None),
                receipt_date=body.receipt_date,
                deliver_to=to,
                status=st,
                inspected_by=current.id,
                inspected_at=datetime.now(UTC),
                batch_no=batch_no,
            )
        )
    if rejected > 0:
        created.append(
            GoodsReceipt(
                receipt_no=batch_no if ok == 0 else f"{batch_no}-B",
                project_no=project_no,
                request_id=row.id,
                item_no=row.item_no,
                qty=rejected,
                qty_rejected=rejected,
                unit=row.unit or (item.unit if item else None),
                receipt_date=body.receipt_date,
                deliver_to=to,
                status="不合格",
                inspected_by=current.id,
                inspected_at=datetime.now(UTC),
                inspect_note=body.note,
                batch_no=batch_no,
            )
        )
    for g in created:
        session.add(g)
    _attach_po(session, created, line)
    row.arrived_at = body.receipt_date
    session.flush()  # autoflush=False：先把到货单落库，状态重算才看得到
    _recalc_request_status(session, row)
    _bump_line_on_receipt(session, line, ok=ok, rejected=rejected)
    gr = created[0]
    if row.status in REQUEST_DONE:
        _sync_purchase_task(session, row, "已完成", f"验收合格并办完（{gr.receipt_no}）")
    elif ok > 0:
        _sync_purchase_task(session, row, "进行中", f"验收合格 {ok:g}，待入库")
    if rejected > 0:
        _sync_purchase_task(
            session, row, "进行中", f"验收不合格 {rejected:g}：{body.note or '等采购协商换货/退货'}"
        )
    audit.log(
        session,
        user=current,
        action="acceptance",
        object_type="goods_receipt",
        object_ref=batch_no,
        summary=f"到货验收 {batch_no}（{row.item_no} × {body.qty:g}）：合格 {ok:g} / 不合格 {rejected:g}"
        + ("，待入库" if ok > 0 and to != "直发客户现场" else "")
        + ("，现场待验收" if ok > 0 and to == "直发客户现场" else "")
        + (f"，不合格原因：{body.note}" if rejected > 0 and body.note else ""),
        ip=client_ip(request),
    )
    if ok > 0 and to == "直发客户现场":
        project = session.get(Project, project_no)
        if project is not None and project.pm_id:
            notify.notify(
                session,
                [project.pm_id],
                type_=notify.TYPE_WAREHOUSE,
                title=f"直发现场已到货待清点：{row.item_no} × {ok:g}",
                body=f"{project_no} {row.equip_no or ''}（{gr.receipt_no}）—— 请现场清点验收",
                link="/site",
                biz_type="goods_receipt",
                biz_id=gr.id,
                actor_id=current.id,
            )
    elif ok > 0:
        notify.notify_role(
            session,
            "WAREHOUSE",
            type_=notify.TYPE_WAREHOUSE,
            title=f"有货待入库：{row.item_no} × {ok:g}",
            body=f"{gr.receipt_no}（{project_no}）",
            link="/warehouse",
            biz_type="goods_receipt",
            biz_id=gr.id,
            actor_id=current.id,
        )
    if rejected > 0:
        notify.notify_role(
            session,
            "PURCHASE",
            type_=notify.TYPE_PURCHASE,
            title=f"验收不合格：{batch_no}（{row.item_no} × {rejected:g}）",
            body=body.note,
            link="/purchase",
            biz_type="goods_receipt",
            biz_id=created[-1].id,
            actor_id=current.id,
        )
    session.commit()
    return {
        "receipt_id": gr.id,
        "receipt_no": gr.receipt_no,
        "receipt_status": gr.status,
        "request_status": row.status,
        "qty_received": float(row.qty_received or 0),
        "qty_rejected": float(row.qty_rejected or 0),
        "batch_no": batch_no,
        "po_line_id": line.id if line is not None else None,
        "receipts": [
            {"receipt_no": x.receipt_no, "status": x.status, "qty": float(x.qty or 0)}
            for x in created
        ],
    }


@router.post("/purchase-requests/{request_id}/inspect")
def inspect_purchase_request(
    project_no: str,
    request_id: int,
    body: AcceptanceIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("warehouse:edit")),
):
    """仓库验收（项目内）：路径带项目号。"""
    row = session.get(PurchaseRequest, request_id)
    if row is None or row.project_no != project_no:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购需求不存在")
    return _perform_inspect(session, row, body, current, request)


@purchase_router.post("/purchase-requests/{request_id}/inspect")
def inspect_purchase_request_any(
    request_id: int,
    body: AcceptanceIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("warehouse:edit")),
):
    """仓库验收（不依赖项目号）：辅料 / 办公用品 / 其他类采购用它（P-02）。"""
    row = session.get(PurchaseRequest, request_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购需求不存在")
    return _perform_inspect(session, row, body, current, request)


class StoreIn(BaseModel):
    location: str = Field(..., description="入库库位（如 深圳仓 A-01-01）—— 入库必须定库位")
    note: str | None = None


@purchase_router.post("/goods-receipts/{receipt_id}/store")
def store_receipt(
    receipt_id: int,
    body: StoreIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("warehouse:edit")),
):
    """入库：验收合格（待入库）的货 → 选库位入库，记库存与流水。分批入库就一批一批来。"""
    from app.models.warehouse import MOVE_IN, StockItem, StockMove

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
    if gr.po_id:
        _recalc_po_delivery(session, gr.po_id)  # 交期留痕（08 §7）
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
    # ★ 站内消息（06 卷 §9）：入库完成 → 提醒采购（跟单闭环）+ 项目经理（进度）
    notify.notify_role(
        session,
        "PURCHASE",
        type_=notify.TYPE_PURCHASE,
        title=f"已入库：{gr.item_no} × {gr.qty:g} → {gr.location}",
        body=f"{gr.receipt_no}（{gr.project_no} {row.equip_no if row and row.equip_no else ''}）",
        link="/purchase",
        biz_type="goods_receipt",
        biz_id=gr.id,
        actor_id=current.id,
    )
    project = session.get(Project, gr.project_no)
    if project is not None and project.pm_id:
        notify.notify(
            session,
            [project.pm_id],
            type_=notify.TYPE_WAREHOUSE,
            title=f"货已入库：{gr.item_no} × {gr.qty:g}",
            body=f"{gr.project_no} {row.equip_no if row and row.equip_no else ''} → {gr.location}",
            link="/warehouse",
            biz_type="goods_receipt",
            biz_id=gr.id,
            actor_id=current.id,
        )
    session.commit()
    return {
        "receipt_no": gr.receipt_no,
        "status": gr.status,
        "location": gr.location,
        "request_status": row.status if row else None,
    }



@purchase_router.post("/goods-receipts/{receipt_id}/photos", status_code=status.HTTP_201_CREATED)
async def upload_receipt_photos(
    receipt_id: int,
    request: Request,
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("warehouse:edit")),
):
    """验收拍照（手机端）：一次可传多张，存到到货单上（03 卷：清单 + 勾选 + 拍照）。"""
    gr = session.get(GoodsReceipt, receipt_id)
    if gr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "到货单不存在")
    photos = list(gr.photos or [])
    folder = Path(settings.upload_dir) / (gr.project_no or "_GENERAL") / "receipts" / gr.receipt_no
    for f in files[:20]:
        stored, name = await save_upload(f, folder)
        photos.append(
            {
                "filename": name,
                "stored_path": stored,
                "by": current.name,
                "at": datetime.now(UTC).isoformat(),
            }
        )
    gr.photos = photos
    audit.log(
        session,
        user=current,
        action="photos",
        object_type="goods_receipt",
        object_ref=gr.receipt_no,
        summary=f"到货验收拍照 {gr.receipt_no}：新增 {min(len(files), 20)} 张（共 {len(photos)} 张）",
        ip=client_ip(request),
    )
    session.commit()
    return {
        "count": len(photos),
        "photos": [
            {"filename": p.get("filename"), "by": p.get("by"), "at": p.get("at"), "url": f"/goods-receipts/{receipt_id}/photos/{i}"}
            for i, p in enumerate(photos)
        ],
    }


@purchase_router.get("/goods-receipts/{receipt_id}/photos/{idx}")
def get_receipt_photo(
    receipt_id: int,
    idx: int,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """看验收照片。"""
    gr = session.get(GoodsReceipt, receipt_id)
    if gr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "到货单不存在")
    photos = gr.photos or []
    if idx < 0 or idx >= len(photos):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "照片不存在")
    photo = photos[idx]
    path = Path(photo.get("stored_path") or "")
    if not path.exists():
        raise HTTPException(status.HTTP_410_GONE, "照片文件已不存在")
    return FileResponse(
        path, media_type=guess_media_type(photo.get("filename")), filename=photo.get("filename")
    )


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
            "attribution": reqs[g.request_id].attribution if g.request_id in reqs else None,
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
            "photos": [
                {
                    "filename": p.get("filename"),
                    "by": p.get("by"),
                    "at": p.get("at"),
                    "url": f"/goods-receipts/{g.id}/photos/{i}",
                }
                for i, p in enumerate(g.photos or [])
            ],
            "stored_by": names.get(g.stored_by) if g.stored_by else None,
            "stored_at": g.stored_at,
            "resolve_note": g.resolve_note,
            "resolved_by": names.get(g.resolved_by) if g.resolved_by else None,
            "resolved_at": g.resolved_at,
            "retries": _retry_brief(retries.get(g.request_id or 0, [])),
        }
        for g in rows
    ]


@purchase_router.get("/purchase/to-vehicle")
def purchase_to_vehicle(session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    """★ §2.2（09 卷）采购待办：**待叫车**的发运批次（跨项目）。

    客户口径：“PM 发出指令需要叫车服务，**采购**就去采购车辆回来，发运就开始装车。”
    —— 一条指令、两个部门：PM 下指令（含发货日）后，**采购这里就多一个待办**。
    装货的人看 `vehicle_count` 知道“当天要装几车”。
    """
    from app.models.shipment import VEHICLE_PENDING, Shipment

    projects = {p.project_no: p.project_name for p in session.scalars(select(Project)).all()}
    rows = session.scalars(
        select(Shipment)
        .where(Shipment.vehicle_status == VEHICLE_PENDING, Shipment.status.in_(("已指令", "发货中")))
        .order_by(Shipment.plan_ship_date, Shipment.id)
    ).all()
    return [
        {
            "id": s.id,
            "shipment_no": s.shipment_no,
            "project_no": s.project_no,
            "project_name": projects.get(s.project_no),
            "plan_ship_date": s.plan_ship_date,
            "status": s.status,
            "instruct_at": s.instruct_at,
        }
        for s in rows
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
    order = {"不合格": 0, "待采购": 1, "在途": 2, "待入库": 4, "现场待验收": 4, "部分到货": 5}
    return sorted(out, key=lambda x: (order.get(x["status"], 9), x.get("need_date") or "9999"))


def _sync_purchase_task(session: Session, req: PurchaseRequest, status: str, note: str) -> None:
    """采购需求状态一变，对应的采购任务跟着变（任务是指派到人的那件事）。"""
    from app.models.task import Task

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
def purchase_pool(
    project_no: str | None = Query(None, description="★ G5：跨项目采购池，可按项目收窄"),
    session: Session = Depends(get_session), _: User = Depends(get_current_user),
):
    """采购池：所有「待采购」的需求，**按物料归拢**，标出哪些可以合并。

    各设计小组下单节点不一样，但东西大差不差 —— 攒一攒一起买，量大了价格才谈得下来。
    """
    rows = session.scalars(
        select(PurchaseRequest).where(PurchaseRequest.status == "待采购")
    ).all()
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    projects = {p.project_no: p.project_name for p in session.scalars(select(Project)).all()}
    names = {u.id: u.name for u in session.scalars(select(User)).all()}

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
                "attribution": r.attribution,
                "requester_id": r.requester_id,
                "requester_name": names.get(r.requester_id) if r.requester_id else None,
                "source_release_id": r.source_release_id,
                "lead_days": r.lead_days,
                "origin_request_id": r.origin_request_id,
                "remark": r.remark,
            }
        )

    out = list(groups.values())
    # ★ G5：单据视角是采购/仓库的工作口（按物料归拢），**保留项目筛选**
    if project_no:
        out = [g for g in out if any(x.get("project_no") == project_no for x in g["requests"])]
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
    # 来源发布批次：设计发布/工艺发布的需求能追到哪一次冻结
    rel_ids = {
        x["source_release_id"] for g in out for x in g["requests"] if x.get("source_release_id")
    }
    rel_nos = (
        {
            r.id: r.release_no
            for r in session.scalars(select(DesignRelease).where(DesignRelease.id.in_(rel_ids)))
        }
        if rel_ids
        else {}
    )
    for g in out:
        for x in g["requests"]:
            x["source_release_no"] = rel_nos.get(x.get("source_release_id"))
    for g in out:
        g["request_count"] = len(g["requests"])
        g["mergeable"] = len(g["requests"]) > 1  # ★ 可合并
        g["requests"].sort(key=lambda x: x["need_date"] or date.max)
    # 可合并的排前面（那是要攒的），其次按最紧急的需要到货日
    out.sort(key=lambda g: (not g["mergeable"], g["earliest_need"] or date.max))
    return out


class ManualPurchaseIn(BaseModel):
    """手工采购申请（05 卷 §6）：任何部门/个人可提，免审核直入池。"""

    attribution: str = Field(description="项目 / 辅料 / 办公用品 / 其他")
    project_no: str | None = None
    equip_no: str | None = None
    item_no: str
    qty: float = Field(gt=0)
    unit: str | None = None
    need_date: date | None = None
    note: str | None = None


@purchase_router.post("/purchase/manual-request", status_code=status.HTTP_201_CREATED)
def create_manual_purchase_request(
    body: ManualPurchaseIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """手工申请：提交即进采购池，不需要审批（不合理由采购退回并记原因）。"""
    if body.attribution not in ATTRIBUTIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"归属只能是：{'/'.join(ATTRIBUTIONS)}")
    if body.attribution == "项目" and not body.project_no:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "归属「项目」时必须选项目")
    if body.project_no and session.get(Project, body.project_no) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"项目不存在：{body.project_no}")
    item = session.get(Item, body.item_no)
    if item is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"标准库里没有 {body.item_no} —— 先去标准库把它建出来，再回来选",
        )
    row = PurchaseRequest(
        project_no=body.project_no,
        equip_no=body.equip_no,
        attribution=body.attribution,
        requester_id=current.id,
        item_no=body.item_no,
        qty=body.qty,
        unit=body.unit or item.unit,
        source=SOURCE_MANUAL,
        status="待采购",
        need_date=body.need_date,
        is_long_lead=False,
        remark=body.note,
    )
    session.add(row)
    session.flush()
    audit.log(
        session,
        user=current,
        action="create",
        object_type="purchase_request",
        object_ref=str(row.id),
        summary=f"手工采购申请（{body.attribution}）：{item.display_name} × {body.qty}"
        + (f"，用于 {body.note}" if body.note else ""),
        ip=client_ip(request),
    )
    session.commit()
    return {
        "id": row.id,
        "item_no": row.item_no,
        "display_name": item.display_name,
        "qty": float(row.qty or 0),
        "unit": row.unit,
        "attribution": row.attribution,
        "source": row.source,
        "status": row.status,
    }


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
    current: User = Depends(require_permission("design:edit")),
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
            attribution="项目",
            part_no=line.part_no,
            item_no=line.item_no,
            qty=qty,
            unit=line.unit,
            source=SOURCE_REGULAR,
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
    tax_incl: bool = Field(..., description="这个价含税 / 不含税（采购员必选）")


class MergeOrderIn(BaseModel):
    """合并下单：把采购池里勾中的若干条，合并成一张采购单下给同一个供应商。"""

    supplier_id: int
    ordered_at: date
    expected_date: date | None = None
    deliver_to: str = Field(default="公司仓库", description="公司仓库 / 直发客户现场")
    deliver_address: str | None = Field(default=None, description="直发现场时必填")
    po_no: str | None = Field(default=None, description="不填则自动发号 PO{YY}{NNN}")
    tax_rate: float | None = Field(default=None, description="整单参考税率 %")
    freight: float | None = Field(default=None, description="运费")
    discount: float | None = Field(default=None, description="整单折扣")
    lines: list[MergeLineIn]
    remark: str | None = None


@purchase_router.post("/purchase/merge-order")
def merge_order(
    body: MergeOrderIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("purchase:edit")),
):
    """合并下单：多条需求下给同一个供应商，共用一张采购单（支持一条需求拆多行/多单）。"""
    from app.models.purchasing import Supplier, SupplierQuote
    from app.services import purchase_order as po_svc

    sup = session.get(Supplier, body.supplier_id)
    if sup is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "供应商不存在")
    if body.deliver_to not in DELIVER_TO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"收货地点只能是：{'/'.join(DELIVER_TO)}")
    if body.deliver_to == "直发客户现场" and not body.deliver_address:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "直发客户现场必须填送货地址")
    if not body.lines:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "至少要勾一条需求")

    # 组装下单行：qty 缺省 = 剩余待下单量；★ 不再改写需求 qty（08 §2 洞①）
    lines_in: list[dict] = []
    for ln in body.lines:
        row = session.get(PurchaseRequest, ln.request_id)
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"需求不存在：{ln.request_id}")
        if row.status not in ("待采购", "部分下单", "审批中"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"{row.item_no} 当前状态是「{row.status}」，不能合并下单",
            )
        remaining = float(row.qty or 0) - po_svc.ordered_qty(session, row.id)
        qty = float(ln.qty) if ln.qty else remaining
        if qty <= 1e-9:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{row.item_no} 没有可下单的剩余量")
        try:
            po_svc.assert_no_over_order(session, row.id, qty)
        except po_svc.PurchaseOrderError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
        lines_in.append(
            {
                "request_id": row.id,
                "qty": qty,
                "unit_price": ln.unit_price,
                "tax_incl": ln.tax_incl,
                "expect_date": _resolve_expected(body.expected_date, body.ordered_at, row.lead_days),
            }
        )

    try:
        po = po_svc.create_order(
            session,
            supplier_id=sup.id,
            supplier_name=sup.name,
            order_date=body.ordered_at,
            expect_date=body.expected_date or lines_in[0]["expect_date"],
            deliver_to=body.deliver_to,
            deliver_address=body.deliver_address,
            lines=lines_in,
            actor_id=current.id,
            po_no=body.po_no,
            tax_rate=body.tax_rate,
            freight=body.freight,
            discount=body.discount,
            status="草稿",
            remark=body.remark,
        )
        # ★ 二期：下单即提交审批（采购经理 → 采购总监）；需求转「审批中」，通过后才在途
        po_svc.submit_order(session, po, current)
    except po_svc.PurchaseOrderError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    done: list[str] = []
    for x in lines_in:
        row = session.get(PurchaseRequest, x["request_id"])
        po_svc.sync_request_snapshot(session, row)
        item = session.get(Item, row.item_no)
        done.append(f"{item.display_name if item else row.item_no} × {x['qty']:g}")

    total = float(po.total_tax_incl or 0)
    session.flush()
    audit.log(
        session,
        user=current,
        action="merge_order",
        object_type="purchase_order",
        object_ref=po.po_no,
        summary=f"合并下单 {po.po_no} → {sup.name}：{len(done)} 条需求已提交审批（{po.status}），"
        f"合计 ¥{total:,.0f}，收货 {body.deliver_to}"
        + (f"（{body.deliver_address}）" if body.deliver_address else "")
        + "；" + "、".join(done[:4])
        + ("…" if len(done) > 4 else ""),
        detail={"po_no": po.po_no, "request_ids": [x["request_id"] for x in lines_in], "total": total},
        ip=client_ip(request),
    )
    session.commit()
    return {
        "po_no": po.po_no,
        "count": len(done),
        "total": total,
        "supplier": sup.name,
        "status": po.status,
    }


class ApproveOrderIn(BaseModel):
    action: str = Field(..., description="通过 / 退回")
    note: str | None = Field(default=None, description="退回必填说明")


def _activate_order(session: Session, po: PurchaseOrder, actor: User) -> None:
    """审批通过后才发生（08 §4.2）：需求转在途/部分下单、直发建到货单、成交价落库、任务联动。"""
    from app.models.purchasing import SupplierQuote
    from app.services import purchase_order as po_svc

    for ln in _po_lines(session, po.id):
        if not ln.request_id:
            continue
        row = session.get(PurchaseRequest, ln.request_id)
        po_svc.sync_request_order_state(session, row)
        po_svc.sync_request_snapshot(session, row)
        # ★ R2-01：直发客户现场 → 通过后建「现场待验收」到货单（挂到本行）
        _ensure_site_pending_receipt(session, row, actor.id, ln)
        if ln.unit_price and po.supplier_id:
            session.add(
                SupplierQuote(
                    item_no=ln.item_no,
                    supplier_id=po.supplier_id,
                    project_no=ln.project_no,
                    price=ln.unit_price,
                    tax_incl=ln.tax_incl,
                    qty=ln.qty,
                    unit=ln.unit,
                    lead_days=row.lead_days,
                    price_type="成交",
                    quote_date=po.order_date or date.today(),
                    source=po.po_no,
                    recorded_by=actor.id,
                )
            )
        _sync_purchase_task(session, row, "进行中", f"已批准 {po.po_no}（{po.supplier_name or '—'}），等货")
    session.flush()


@purchase_router.post("/purchase/orders/{key}/submit")
def submit_purchase_order(
    key: str,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("purchase:edit")),
):
    """提交审批（草稿/已退回 → 待经理审；经理本人提交则跳过一级）。"""
    from app.services import purchase_order as po_svc

    po = session.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == key))
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    try:
        po_svc.submit_order(session, po, current)
    except po_svc.PurchaseOrderError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    audit.log(
        session,
        user=current,
        action="submit_order",
        object_type="purchase_order",
        object_ref=key,
        summary=f"采购单 {key} 提交审批 → {po.status}",
        ip=client_ip(request),
    )
    session.commit()
    return {"status": po.status}


def _po_price_snapshot(session: Session, po: PurchaseOrder) -> dict:
    """审批时看到的价格参考快照（08 §3.3）：每行按同 `tax_incl` 口径取历史成交 stats。

    留档后能回答「当时审核人参考的是什么价」，且历史库变了也不会失真。
    """
    from app.models.purchasing import SupplierQuote

    out: dict = {}
    for ln in _po_lines(session, po.id):
        deals = list(
            session.scalars(
                select(SupplierQuote)
                .where(SupplierQuote.item_no == ln.item_no, SupplierQuote.price_type == "成交")
                .order_by(SupplierQuote.quote_date.desc())
            ).all()
        )
        seg = [float(q.price) for q in deals if bool(q.tax_incl) == bool(ln.tax_incl)]
        out[ln.item_no] = {
            "tax_incl": ln.tax_incl,
            "this_price": float(ln.unit_price) if ln.unit_price is not None else None,
            "last_price": seg[0] if seg else None,
            "min_price": min(seg) if seg else None,
            "max_price": max(seg) if seg else None,
            "avg_price": round(sum(seg) / len(seg), 2) if seg else None,
            "deal_count": len(seg),
        }
    return out


@purchase_router.post("/purchase/orders/{key}/approve")
def approve_purchase_order(
    key: str,
    body: ApproveOrderIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("purchase:edit")),
):
    """两级审批：通过 / 退回（退回必填说明）。总监通过 → 已批准 → ★ 激活（三件事才发生）。"""
    from app.services import purchase_order as po_svc

    po = session.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == key))
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    try:
        new_status = po_svc.approve_order(
            session, po, current, body.action, body.note,
            price_snapshot=_po_price_snapshot(session, po),
        )
    except po_svc.PurchaseOrderError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if new_status == "已批准":
        _activate_order(session, po, current)
    audit.log(
        session,
        user=current,
        action="approve_order",
        object_type="purchase_order",
        object_ref=key,
        summary=f"采购单 {key} 审批「{body.action}」→ {po.status}"
        + (f"：{body.note}" if body.note else ""),
        ip=client_ip(request),
    )
    session.commit()
    return {"status": po.status}


@purchase_router.post("/purchase/orders/{key}/withdraw")
def withdraw_purchase_order(
    key: str,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("purchase:edit")),
):
    """提交人撤回（待经理审/待总监审 → 草稿，解锁可改）。"""
    from app.services import purchase_order as po_svc

    po = session.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == key))
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    try:
        po_svc.withdraw_order(session, po, current)
    except po_svc.PurchaseOrderError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    audit.log(
        session,
        user=current,
        action="withdraw_order",
        object_type="purchase_order",
        object_ref=key,
        summary=f"采购单 {key} 撤回 → {po.status}",
        ip=client_ip(request),
    )
    session.commit()
    return {"status": po.status}


@purchase_router.get("/purchase/orders/{key}/approvals")
def list_po_approvals(
    key: str, session: Session = Depends(get_session), _: User = Depends(get_current_user)
):
    """审批留档（多轮多级）。"""
    po = session.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == key))
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    names = {u.id: u.name for u in session.scalars(select(User)).all()}
    rows = session.scalars(
        select(PurchaseApproval).where(PurchaseApproval.po_id == po.id).order_by(PurchaseApproval.id)
    ).all()
    return [
        {
            "round_no": r.round_no,
            "level": r.level,
            "reviewer_id": r.reviewer_id,
            "reviewer_name": names.get(r.reviewer_id),
            "action": r.action,
            "note": r.note,
            "price_flags": r.price_flags,
            "acted_at": r.acted_at,
        }
        for r in rows
    ]


class PoLinePatchIn(BaseModel):
    id: int
    qty: float | None = None
    unit_price: float | None = None
    tax_incl: bool | None = None


class PoPatchIn(BaseModel):
    supplier_id: int | None = None
    expect_date: date | None = None
    deliver_to: str | None = None
    deliver_address: str | None = None
    tax_rate: float | None = None
    freight: float | None = None
    discount: float | None = None
    remark: str | None = None
    lines: list[PoLinePatchIn] | None = None


@purchase_router.patch("/purchase/orders/{key}")
def patch_purchase_order(
    key: str,
    body: PoPatchIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("purchase:edit")),
):
    """改草稿/已退回的单（08 §5.4）：供应商/交期/收货地/税率/运费折扣/备注 + 行的数量单价口径。

    ★ 物料/需求总量/零件归属不允许改（那是上游决定的，错了走退回上游 ECN）。
    """
    from app.models.purchase_order import compute_line_amounts
    from app.models.purchasing import Supplier
    from app.services import purchase_order as po_svc

    po = session.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == key))
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    if po.status not in ("草稿", "已退回"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"当前状态是「{po.status}」，不能编辑（只有草稿/已退回能改）"
        )
    if body.supplier_id is not None:
        sup = session.get(Supplier, body.supplier_id)
        if sup is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "供应商不存在")
        po.supplier_id = sup.id
        po.supplier_name = sup.name
    for field in ("expect_date", "deliver_to", "deliver_address", "tax_rate", "freight", "discount", "remark"):
        val = getattr(body, field)
        if val is not None:
            setattr(po, field, val)
    for lp in body.lines or []:
        ln = session.get(PurchaseOrderLine, lp.id)
        if ln is None or ln.po_id != po.id:
            continue
        if lp.qty is not None:
            ln.qty = lp.qty
        if lp.unit_price is not None:
            ln.unit_price = lp.unit_price
        if lp.tax_incl is not None:
            ln.tax_incl = lp.tax_incl
        incl, excl = compute_line_amounts(
            float(ln.qty or 0), ln.unit_price, ln.tax_incl, ln.tax_rate or po.tax_rate
        )
        ln.amount_tax_incl = incl
        ln.amount_tax_excl = excl
    session.flush()
    po_svc.recalc_order_total(session, po)
    for ln in _po_lines(session, po.id):
        if ln.request_id:
            po_svc.sync_request_order_state(session, session.get(PurchaseRequest, ln.request_id))
    audit.log(
        session,
        user=current,
        action="patch_order",
        object_type="purchase_order",
        object_ref=key,
        summary=f"编辑采购单 {key}（{po.status}）",
        ip=client_ip(request),
    )
    session.commit()
    return {"status": po.status}


class MarkPaidIn(BaseModel):
    """批量标记已付款（客户口径 #11：财务线下付款 → 采购在系统标记 + 传截图）。"""

    po_ids: list[int]
    paid_at: date | None = Field(default=None, description="财务实际付款日（可回填）")
    paid_amount: float | None = Field(default=None, description="不填默认=单额")
    note: str | None = None
    vouchers: list[str] | None = Field(default=None, description="付款截图 stored_path（可选，共享）")


@purchase_router.post("/purchase/orders/mark-paid")
def mark_orders_paid(
    body: MarkPaidIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("purchase:payment")),
):
    """批量标记已付款 + 付款截图（客户口径 #11/#12/#13）：一单付一次，pay_status 二态。"""
    if not body.po_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "至少选一张采购单")
    pos = session.scalars(select(PurchaseOrder).where(PurchaseOrder.id.in_(body.po_ids))).all()
    if not pos:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    now = datetime.now(UTC)
    paid = 0
    skipped = 0
    for po in pos:
        # 一单付一次（客户口径 #12）：已作废 / 已标记付款的跳过，不覆盖付款日
        if po.status == "已作废" or po.pay_status == "已付款":
            skipped += 1
            continue
        # ★ 付款凭证必填（客户口径 #11：「标记已付款 + 上传付款截图」）：
        #   本次带的 或 之前已传的，至少要有一张，否则不许标记
        vouchers = list(po.paid_vouchers or [])
        if body.vouchers:
            vouchers.extend(
                {"stored_path": v, "by": current.name, "at": now.isoformat()} for v in body.vouchers
            )
        if not vouchers:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"{po.po_no} 必须上传付款凭证（截图）才能标记已付款",
            )
        po.paid_vouchers = vouchers
        po.pay_status = "已付款"
        po.paid_at = body.paid_at or date.today()
        po.paid_amount = body.paid_amount if body.paid_amount is not None else po.total_tax_incl
        po.paid_by = current.id
        po.paid_marked_at = now
        po.paid_note = body.note
        paid += 1
    audit.log(
        session,
        user=current,
        action="mark_paid",
        object_type="purchase_order",
        object_ref=",".join(po.po_no for po in pos),
        summary=f"批量标记已付款：{paid} 张单"
        + (f"，{skipped} 张已付/已作废跳过" if skipped else "")
        + (f"（付款日 {body.paid_at}）" if body.paid_at else "")
        + (f"，{len(body.vouchers)} 张凭证" if body.vouchers else ""),
        detail={"po_ids": body.po_ids},
        ip=client_ip(request),
    )
    session.commit()
    return {
        "paid": paid,
        "skipped": skipped,
        "skipped_reason": "已付款/已作废跳过（一单付一次）" if skipped else None,
    }


@purchase_router.post("/purchase/orders/{key}/vouchers", status_code=status.HTTP_201_CREATED)
async def upload_po_vouchers(
    key: str,
    request: Request,
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("purchase:payment")),
):
    """采购单付款凭证（截图）：一次可传多张。"""
    po = session.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == key))
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    vouchers = list(po.paid_vouchers or [])
    folder = Path(settings.upload_dir) / "purchase" / po.po_no
    for f in files[:10]:
        stored, name = await save_upload(f, folder)
        vouchers.append(
            {
                "filename": name,
                "stored_path": stored,
                "by": current.name,
                "at": datetime.now(UTC).isoformat(),
            }
        )
    po.paid_vouchers = vouchers
    audit.log(
        session,
        user=current,
        action="vouchers",
        object_type="purchase_order",
        object_ref=key,
        summary=f"采购单 {key} 上传付款凭证 {len(files)} 张",
        ip=client_ip(request),
    )
    session.commit()
    return {"count": len(vouchers)}


# ============================================================================
# ★ 采购单视图：一张采购单 + 各项目/设备的需求明细（合并单的「归属」）
#   00 卷 §3.1②：累计合并不丢来源 —— 这 10 个方通分别是谁家的，单子上要看得到。
# ============================================================================


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


def _order_maps(session: Session):
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    projects = {p.project_no: p.project_name for p in session.scalars(select(Project)).all()}
    equips = {
        (e.project_no, e.equip_no): e.equip_name
        for e in session.scalars(select(Equipment)).all()
    }
    return items, projects, equips


def _po_lines(session: Session, po_id: int) -> list[PurchaseOrderLine]:
    return list(
        session.scalars(
            select(PurchaseOrderLine)
            .where(PurchaseOrderLine.po_id == po_id)
            .order_by(PurchaseOrderLine.id)
        ).all()
    )


def _po_display_status(po: PurchaseOrder, lines: list[PurchaseOrderLine]) -> str:
    """单头状态的**展示口径**：审批中的单展示真实审批态，别伪装成「在途」（08 §4.2）。"""
    if po.status in ("已作废",):
        return "已取消"
    # 还没批准的单：显示真实状态（草稿/待经理审/待总监审/已退回），不要落到「在途」
    if po.status in ("草稿", "待经理审", "待总监审", "已退回"):
        return po.status
    active = [ln for ln in lines if ln.status != "已取消"] or lines
    st = {ln.status for ln in active}
    if "不合格" in st:
        return "不合格"
    if st and st <= {"已入库"}:
        return "已完成"
    if st & {"已入库", "部分到货"}:
        return "部分到货"
    if st and st <= {"已退货"}:
        return "已退货"
    return "在途"


def _po_order_summary(
    po: PurchaseOrder,
    lines: list[PurchaseOrderLine],
    projects: dict,
    equips: dict,
    agg: dict[int, dict[str, float]],
    can_approve: bool = False,
) -> dict:
    projs: list[dict] = []
    eqs: list[dict] = []
    for ln in lines:
        if ln.project_no and ln.project_no not in [p["project_no"] for p in projs]:
            projs.append({"project_no": ln.project_no, "project_name": projects.get(ln.project_no)})
        if ln.equip_no and not any(
            e["project_no"] == ln.project_no and e["equip_no"] == ln.equip_no for e in eqs
        ):
            eqs.append(
                {
                    "project_no": ln.project_no,
                    "equip_no": ln.equip_no,
                    "equip_name": equips.get((ln.project_no, ln.equip_no)),
                }
            )
    rids = [ln.request_id for ln in lines if ln.request_id]
    return {
        "id": po.id,
        "key": po.po_no,
        "po_no": po.po_no,
        "supplier_id": po.supplier_id,
        "supplier_name": po.supplier_name,
        "ordered_at": po.order_date,
        "expected_date": po.expect_date,
        "deliver_to": po.deliver_to,
        "deliver_address": po.deliver_address,
        "status": _po_display_status(po, lines),
        "po_status": po.status,
        # ★ 当前这一级是不是**我**能批（后端单一口径，前端不再按 position 猜 —— P2-1）
        "can_approve": can_approve,
        "pay_status": po.pay_status,
        "line_count": len(lines),
        "item_kinds": len({ln.item_no for ln in lines}),
        "total_amount": float(po.total_tax_incl or 0),
        "exchanged_qty": round(sum(agg.get(r, {}).get("exchanged", 0.0) for r in rids), 3),
        "returned_qty": round(sum(agg.get(r, {}).get("returned", 0.0) for r in rids), 3),
        "projects": projs,
        "equipments": eqs,
        "request_ids": rids,
    }


def _po_line_payload(
    ln: PurchaseOrderLine,
    req: PurchaseRequest | None,
    item: Item | None,
    projects: dict,
    equips: dict,
    part_titles: dict,
    by_req: dict[int, list[GoodsReceipt]],
    agg: dict[int, dict[str, float]],
    retries: dict[int, list[PurchaseRequest]],
    names: dict[int, str],
) -> dict:
    rid = ln.request_id
    a = agg.get(rid, {}) if rid else {}
    receipts = by_req.get(rid or 0, [])
    if req is not None:
        base = _request_dict(req, item)
    else:
        base = {
            "id": None,
            "po_no": None,
            "unit_price": None,
            "amount": None,
            "shipped_at": None,
            "deliver_to": None,
            "deliver_address": None,
            "arrived_at": None,
            "qty_received": None,
            "project_no": ln.project_no,
            "equip_no": ln.equip_no,
            "part_no": ln.part_no,
            "item_no": ln.item_no,
            "item_name": item.display_name if item else ln.item_no,
            "model": None,
            "brand": item.brand if item else None,
            "spec_text": item.spec_text if item else None,
            "qty": None,
            "unit": ln.unit,
            "source": None,
            "lead_days": None,
            "supplier_id": None,
            "supplier_name": None,
            "need_date": None,
            "expected_date": None,
            "ordered_at": None,
            "status": None,
            "is_long_lead": False,
            "origin_request_id": None,
            "remark": ln.remark,
        }
    base.update(
        {
            "id": ln.id,
            "po_line_id": ln.id,
            "request_id": rid,
            "project_no": ln.project_no,
            "equip_no": ln.equip_no,
            "part_no": ln.part_no,
            "item_no": ln.item_no,
            "item_name": item.display_name if item else ln.item_no,
            "model": (item.mfr_model or (item.spec or {}).get("model")) if item else None,
            "brand": item.brand if item else None,
            "spec_text": item.spec_text if item else None,
            "qty": float(ln.qty) if ln.qty is not None else None,
            "unit": ln.unit,
            "unit_price": float(ln.unit_price) if ln.unit_price is not None else None,
            "amount": float(ln.amount_tax_incl) if ln.amount_tax_incl is not None else None,
            "tax_incl": ln.tax_incl,
            "expected_date": ln.expect_date,
            "status": ln.status,
            "qty_received": float(ln.received_qty or 0),
            "project_name": projects.get(ln.project_no),
            "equip_name": equips.get((ln.project_no, ln.equip_no)),
            "part_title": part_titles.get(ln.part_no),
            "qty_original": float(ln.qty or 0) + a.get("returned", 0.0),
            "qty_returned": a.get("returned", 0.0),
            "qty_exchanged": a.get("exchanged", 0.0),
            "receipts": [
                {
                    "receipt_no": g.receipt_no,
                    "status": g.status,
                    "qty": float(g.qty) if g.qty is not None else None,
                    "qty_ok": float(g.qty_ok) if g.qty_ok is not None else None,
                    "qty_rejected": float(g.qty_rejected) if g.qty_rejected is not None else None,
                    "batch_no": g.batch_no,
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
                    "retries": _retry_brief(retries.get(rid, [])) if rid else [],
                }
                for g in receipts
            ],
        }
    )
    return base


@purchase_router.get("/purchase/orders")
def list_purchase_orders(
    project_no: str | None = Query(None, description="★ G5：采购/仓库按单看，但保留项目筛选（别人来问也能查）"),
    status: str | None = Query(None),
    session: Session = Depends(get_session), current: User = Depends(get_current_user)
):
    """采购单列表（真表：按 purchase_order 单头；一条需求可拆多单）。"""
    _, projects, equips = _order_maps(session)
    pos = session.scalars(select(PurchaseOrder).order_by(PurchaseOrder.id.desc())).all()
    by_po: dict[int, list[PurchaseOrderLine]] = {}
    for ln in session.scalars(select(PurchaseOrderLine)).all():
        by_po.setdefault(ln.po_id, []).append(ln)
    rids = [ln.request_id for lns in by_po.values() for ln in lns if ln.request_id]
    agg = _receipt_qty_map(session, rids)
    from app.services import purchase_order as po_svc

    # 「待我审批」的归属只算**审批中**的单（其余状态 can_approve 永远 False，不必查库）
    approvable = {p.id for p in pos if p.status in ("待经理审", "待总监审")}
    out = [
        _po_order_summary(
            po,
            by_po.get(po.id, []),
            projects,
            equips,
            agg,
            can_approve=po.id in approvable and po_svc.can_approve(session, po, current),
        )
        for po in pos
    ]
    out.sort(key=lambda o: (o["ordered_at"] or date.min, o["key"]), reverse=True)
    # ★ G5：单据视角是采购/仓库的日常工作口，但**保留项目筛选**（“这个项目的件验收/入库没有”要能查）
    if project_no:
        out = [o for o in out if any(p.get("project_no") == project_no for p in o.get("projects", []))]
    if status:
        out = [o for o in out if o.get("status") == status]
    if not has_permission(current, "purchase:price"):
        return scrub_money(out)
    return out


@purchase_router.get("/purchase/orders/{key}")
def get_purchase_order(
    key: str, session: Session = Depends(get_session), current: User = Depends(get_current_user)
):
    """采购单详情（真表）：单头 + 每行（项目/设备/物料/价格/状态/到货单）。"""
    po = session.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == key))
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    items, projects, equips = _order_maps(session)
    names = {u.id: u.name for u in session.scalars(select(User)).all()}
    po_lines = _po_lines(session, po.id)
    rids = [ln.request_id for ln in po_lines if ln.request_id]
    reqs = (
        {r.id: r for r in session.scalars(select(PurchaseRequest).where(PurchaseRequest.id.in_(rids)))}
        if rids
        else {}
    )
    receipts = (
        session.scalars(select(GoodsReceipt).where(GoodsReceipt.request_id.in_(rids))).all()
        if rids
        else []
    )
    by_req: dict[int, list[GoodsReceipt]] = {}
    for g in receipts:
        by_req.setdefault(g.request_id or 0, []).append(g)
    agg = _receipt_qty_map(session, rids)
    retries = _retry_map(session, rids)
    part_nos = {ln.part_no for ln in po_lines if ln.part_no}
    part_titles = (
        {
            d.drawing_no: d.title
            for d in session.scalars(select(Drawing).where(Drawing.drawing_no.in_(part_nos)))
        }
        if part_nos
        else {}
    )
    result = {
        "order": _po_order_summary(po, po_lines, projects, equips, agg),
        "lines": [
            _po_line_payload(
                ln,
                reqs.get(ln.request_id),
                items.get(ln.item_no),
                projects,
                equips,
                part_titles,
                by_req,
                agg,
                retries,
                names,
            )
            for ln in po_lines
        ],
    }
    if not has_permission(current, "purchase:price"):
        return scrub_money(result)
    return result


class CancelOrderIn(BaseModel):
    request_ids: list[int] | None = Field(default=None, description="不填=整单可取消的行")
    reason: str | None = None


@purchase_router.post("/purchase/orders/{key}/cancel")
def cancel_purchase_order(
    key: str,
    body: CancelOrderIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("purchase:edit")),
):
    """取消采购（行级，08 §10）：取消「还没到」的部分；已到货的按实际留着。

    ★ 行级：一条需求拆到多张单时，只取消本单这一行，不影响别的单。
    """
    from app.services import purchase_order as po_svc

    po = session.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == key))
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    lines = _po_lines(session, po.id)
    eligible = [ln for ln in lines if ln.status in ("在途", "部分到货")]
    want = set(body.request_ids) if body.request_ids else None
    target = [ln for ln in eligible if want is None or ln.request_id in want]
    if not target:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "这张单没有可取消的行（已到货、待入库、已入库的要走换货/退货或入库）",
        )

    affected: set[int] = set()
    for ln in target:
        keep = float(ln.received_qty or 0)
        cancel_qty = max(0.0, float(ln.qty or 0) - keep)
        if ln.request_id:
            req = session.get(PurchaseRequest, ln.request_id)
            req.qty = max(0.0, float(req.qty or 0) - cancel_qty)  # 取消的是「还没到的部分」
            affected.add(ln.request_id)
        if keep <= 1e-9:
            ln.qty = 0.0
            ln.status = "已取消"
        else:
            ln.qty = keep
            ln.status = "部分到货"
    session.flush()
    for rid in affected:
        row = session.get(PurchaseRequest, rid)
        row.qty_ordered = po_svc.ordered_qty(session, rid)
        session.flush()
        _recalc_request_status(session, row)
        _sync_purchase_task(session, row, "进行中", f"取消未到的部分（{key}），已到的按实际留着")
    session.flush()
    po_svc.recalc_order_status(session, po)
    audit.log(
        session,
        user=current,
        action="cancel_order",
        object_type="purchase_order",
        object_ref=key,
        summary=f"取消采购 {key}：{len(target)} 行"
        + (f"（{body.reason}）" if body.reason else ""),
        detail={"line_ids": [ln.id for ln in target], "skipped": len(lines) - len(target)},
        ip=client_ip(request),
    )
    session.commit()
    return {"cancelled": len(target), "skipped": len(lines) - len(target)}


class VoidOrderIn(BaseModel):
    reason: str | None = None


@purchase_router.post("/purchase/orders/{key}/void")
def void_purchase_order(
    key: str,
    body: VoidOrderIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("purchase:edit")),
):
    """作废采购单（08 §4.1）：还没执行的整单作废，★ 需求全部回「待采购」回池（PU-13）。"""
    from app.services import purchase_order as po_svc

    po = session.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == key))
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    if po.status in ("执行中", "已完成", "已作废", "已关闭"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"当前状态是「{po.status}」，不能作废（已有到货的请走「整批退货关闭」）",
        )
    lines = _po_lines(session, po.id)
    for ln in lines:
        # ★ N12：只拦「本行真有到货」的，不能拿兄弟行的到货挡住（已按行判定）
        if float(ln.received_qty or 0) > 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"{ln.item_no} 这张单已经有到货，不能作废；请走「整批退货关闭」",
            )
    po.status = "已作废"
    for ln in lines:
        ln.status = "已取消"
    session.flush()
    for rid in {ln.request_id for ln in lines if ln.request_id}:
        row = session.get(PurchaseRequest, rid)
        row.qty_ordered = po_svc.ordered_qty(session, rid)
        need = float(row.qty or 0)
        if row.qty_ordered <= 1e-9:
            row.status = "待采购"
        elif row.qty_ordered + 1e-9 >= need:
            row.status = "在途"
        else:
            row.status = "部分下单"
        _sync_purchase_task(
            session, row, "待采购", f"采购单 {key} 作废（{body.reason or '—'}），需求已回采购池"
        )
    audit.log(
        session,
        user=current,
        action="void_order",
        object_type="purchase_order",
        object_ref=key,
        summary=f"作废采购单 {key}：{len(lines)} 行，需求已回池"
        + (f"（{body.reason}）" if body.reason else ""),
        ip=client_ip(request),
    )
    session.commit()
    return {"voided": len(lines), "status": po.status}


class CloseReturnIn(BaseModel):
    note: str | None = None


@purchase_router.post("/purchase/orders/{key}/close-return")
def close_return_purchase_order(
    key: str,
    body: CloseReturnIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("purchase:edit")),
):
    """整批退货关闭（08 §4.1）：跟供应商不合作了，到货单全转「已退货」，★ 需求回池重采（PU-14）。"""
    po = session.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == key))
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    if po.status in ("已作废", "已关闭", "已完成"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"当前状态是「{po.status}」，不能关闭")
    now = datetime.now(UTC)
    lines = _po_lines(session, po.id)
    retry_ids: list[int] = []
    for ln in lines:
        ln.status = "已退货"
        if not ln.request_id:
            continue
        req = session.get(PurchaseRequest, ln.request_id)
        for g in _request_receipts(session, req.id):
            g.status = "已退货"
            g.resolve_note = body.note
            g.resolved_by = current.id
            g.resolved_at = now
        qty_back = float(ln.qty or 0)
        req.qty = 0.0
        session.flush()
        _recalc_request_status(session, req)
        retry = PurchaseRequest(
            project_no=req.project_no,
            equip_no=req.equip_no,
            attribution=req.attribution,
            item_no=req.item_no,
            qty=qty_back,
            unit=req.unit,
            source=SOURCE_RETRY,
            lead_days=req.lead_days,
            need_date=req.need_date,
            status="待采购",
            is_long_lead=req.is_long_lead,
            origin_request_id=req.id,
            remark=f"整批退货关闭重采（原 {key}）" + (f"：{body.note}" if body.note else ""),
        )
        session.add(retry)
        session.flush()
        retry_ids.append(retry.id)
        _sync_purchase_task(
            session, req, "已完成", f"整批退货关闭，需求已回池重采（新需求 #{retry.id}）"
        )
    po.status = "已关闭"
    audit.log(
        session,
        user=current,
        action="close_return",
        object_type="purchase_order",
        object_ref=key,
        summary=f"整批退货关闭 {key}：{len(lines)} 行，新建 {len(retry_ids)} 条待采购回池"
        + (f"（{body.note}）" if body.note else ""),
        detail={"retry_ids": retry_ids},
        ip=client_ip(request),
    )
    session.commit()
    return {"closed": len(lines), "retry_ids": retry_ids, "status": po.status}


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
    current: User = Depends(require_permission("purchase:edit")),
):
    """更改供应商（08 §10）：改**单头**一个字段（一单一供应商）；已有到货的行不能换。"""
    from app.models.purchase_order import compute_line_amounts
    from app.models.purchasing import Supplier, SupplierQuote
    from app.services import purchase_order as po_svc

    sup = session.get(Supplier, body.supplier_id)
    if sup is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "供应商不存在")
    po = session.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == key))
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    if po.status in ("已作废", "已关闭", "已完成"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"当前状态是「{po.status}」，不能更改供应商")
    lines = _po_lines(session, po.id)
    if any(float(ln.received_qty or 0) > 0 for ln in lines):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "这张单已经有到货的行，不能整单改供应商（请走换货/退货）"
        )

    price_map = {ln.request_id: ln.unit_price for ln in (body.lines or [])}
    only = set(price_map) if body.lines else None
    target = [ln for ln in lines if only is None or ln.request_id in only]
    if not target:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "这张单没有可换供应商的行")

    po.supplier_id = sup.id
    po.supplier_name = sup.name
    quote_at = date.today()
    for ln in target:
        if price_map.get(ln.request_id):
            ln.unit_price = price_map[ln.request_id]
            incl, excl = compute_line_amounts(
                float(ln.qty or 0), ln.unit_price, ln.tax_incl, ln.tax_rate
            )
            ln.amount_tax_incl = incl
            ln.amount_tax_excl = excl
            req0 = session.get(PurchaseRequest, ln.request_id) if ln.request_id else None
            session.add(
                SupplierQuote(
                    item_no=ln.item_no,
                    supplier_id=sup.id,
                    project_no=ln.project_no,
                    price=ln.unit_price,
                    unit=ln.unit,
                    lead_days=req0.lead_days if req0 else None,
                    price_type="成交",
                    quote_date=quote_at,
                    source=po.po_no,
                    recorded_by=current.id,
                )
            )
        if ln.request_id:
            row = session.get(PurchaseRequest, ln.request_id)
            po_svc.sync_request_snapshot(session, row)
            _sync_purchase_task(session, row, "进行中", f"更改供应商 → {sup.name}，等货")
    session.flush()
    po_svc.recalc_order_total(session, po)
    audit.log(
        session,
        user=current,
        action="change_supplier",
        object_type="purchase_order",
        object_ref=key,
        summary=f"采购单 {key} 更改供应商 → {sup.name}：{len(target)} 行"
        + (f"（{body.note}）" if body.note else ""),
        detail={"line_ids": [ln.id for ln in target], "supplier_id": sup.id},
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
    current: User = Depends(require_permission("purchase:edit")),
):
    """验收不合格的回采购处理（行级）：换货（行回等补发）或退货（行减量、需求回池重采）。"""
    from app.services import purchase_order as po_svc

    po = session.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == key))
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购单不存在")
    if body.action not in ("换货", "退货"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "处理方式只能是 换货 / 退货")
    lines = _po_lines(session, po.id)
    want = set(body.request_ids)
    # ★ N12：只处理「本行真有不合格到货」的行（拆单时不能把兄弟行一起拉进来）
    target = [ln for ln in lines if ln.request_id in want and _line_failed_receipts(session, ln)]
    if not target:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "这张单没有可处理的不合格行")

    today = date.today()
    replaced = returned = 0
    retry_ids: list[int] = []
    for ln in target:
        req = session.get(PurchaseRequest, ln.request_id)
        failed = _line_failed_receipts(session, ln)
        if not failed:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{ln.item_no} 没有「不合格」的到货单")
        failed_qty = sum(
            float(g.qty_rejected if g.qty_rejected is not None else (g.qty or 0)) for g in failed
        )
        for g in failed:
            g.status = "已换货" if body.action == "换货" else "已退货"
            g.resolve_note = body.note
            g.resolved_by = current.id
            g.resolved_at = datetime.now(UTC)
        if body.action == "换货":
            ln.status = "部分到货"
            ln.expect_date = _resolve_expected(body.expected_date, None, req.lead_days, base=today)
            session.flush()
            _recalc_request_status(session, req)
            _sync_purchase_task(
                session,
                req,
                "进行中",
                f"换货中：{body.note or '等供应商补发'}（预计 {ln.expect_date or '—'}）",
            )
            replaced += 1
        else:
            # ★ 退货：这家供应商的货退回去，不再等他；但需求不能丢 ——
            #   新建一条「待采购」需求回到采购池（换供应商重买，可再合并）
            ln.status = "已退货"
            ln.qty = max(0.0, float(ln.qty or 0) - failed_qty)
            req.qty = max(0.0, float(req.qty or 0) - failed_qty)
            session.flush()
            _recalc_request_status(session, req)
            retry = PurchaseRequest(
                project_no=req.project_no,
                equip_no=req.equip_no,
                attribution=req.attribution,
                item_no=req.item_no,
                qty=failed_qty,
                unit=req.unit,
                source=SOURCE_RETRY,
                lead_days=req.lead_days,
                need_date=req.need_date,
                status="待采购",
                is_long_lead=req.is_long_lead,
                origin_request_id=req.id,
                remark=f"退货重采（原 {po.po_no} / {'、'.join(g.receipt_no for g in failed)}）"
                + (f"：{body.note}" if body.note else ""),
            )
            session.add(retry)
            session.flush()
            retry_ids.append(retry.id)
            if req.status == "已退货":
                _sync_purchase_task(
                    session, req, "已完成", f"已退货，需求已回采购池重采（新需求 #{retry.id}）"
                )
            elif req.status in REQUEST_DONE:
                _sync_purchase_task(
                    session,
                    req,
                    "已完成",
                    f"部分退货 {failed_qty:g}（已回池重采 #{retry.id}），剩余 {req.qty:g} 已验收入库",
                )
            else:
                _sync_purchase_task(
                    session,
                    req,
                    "进行中",
                    f"部分退货 {failed_qty:g}（已回池重采 #{retry.id}），剩余 {req.qty:g} 继续",
                )
            returned += 1
    session.flush()
    po_svc.recalc_order_status(session, po)
    audit.log(
        session,
        user=current,
        action="negotiate",
        object_type="purchase_order",
        object_ref=key,
        summary=f"采购单 {key} 验收不合格处理：{body.action} {len(target)} 行"
        + (f"（{body.note}）" if body.note else "")
        + (f"；退货 {len(retry_ids)} 份需求已回采购池重采" if retry_ids else ""),
        detail={
            "line_ids": [ln.id for ln in target],
            "action": body.action,
            "retry_request_ids": retry_ids,
        },
        ip=client_ip(request),
    )
    session.commit()
    return {"replaced": replaced, "returned": returned, "retry_request_ids": retry_ids}
