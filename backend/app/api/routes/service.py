"""售后域 API（《00 方案》§3.3 S11 · 《02 数据模型》§10）。

服务工单：报修受理 → 派工 → 到场 → 处理（备件更换）→ 客户签字 → 关闭。
备件：易损件清单 + 收发记录（领出扣库存、退回/补货加回）。
质保：报修时自动判定在保/过保。
权限：写 `service:edit`（售后），读登录即可。
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user, require_permission
from app.core.db import get_session
from app.models.platform import User
from app.models.project import Project
from app.models.service import SP_ISSUE, SP_MOVE_TYPES, SP_RESTOCK, SP_RETURN, ServiceOrder, SparePart, SparePartMove
from app.services import audit
from app.services import notify
from app.services.numbering import ObjectType, next_number, year_scope_key

router = APIRouter(prefix="/service", tags=["售后"])


def _now() -> datetime:
    return datetime.now(UTC)


def so_dict(session: Session, o: ServiceOrder) -> dict:
    project = session.get(Project, o.project_no)
    return {
        "id": o.id,
        "so_no": o.so_no,
        "project_no": o.project_no,
        "project_name": project.project_name if project else None,
        "equip_no": o.equip_no,
        "reported_at": o.reported_at,
        "fault": o.fault,
        "status": o.status,
        "responded_at": o.responded_at,
        "dispatched_to": o.dispatched_to,
        "arrived_at": o.arrived_at,
        "solution": o.solution,
        "labor_hours": float(o.labor_hours) if o.labor_hours is not None else None,
        "photos": o.photos or [],
        "customer_sign": o.customer_sign,
        "signed_at": o.signed_at,
        "closed_at": o.closed_at,
        "in_warranty": o.in_warranty,
        "warranty_end": project.warranty_end if project else None,
        "remark": o.remark,
    }


def part_dict(p: SparePart) -> dict:
    return {
        "id": p.id,
        "project_no": p.project_no,
        "equip_no": p.equip_no,
        "item_no": p.item_no,
        "item_name": p.item_name,
        "qty_stock": float(p.qty_stock or 0),
        "qty_installed": float(p.qty_installed or 0),
        "min_qty": float(p.min_qty) if p.min_qty is not None else None,
        "remark": p.remark,
    }


# --------------------------------------------------------------------------
# 工单
# --------------------------------------------------------------------------


class CreateIn(BaseModel):
    project_no: str
    equip_no: str | None = None
    fault: str = Field(..., description="故障描述（报修必须写清楚）")
    remark: str | None = None


@router.post("/orders", status_code=status.HTTP_201_CREATED)
def create_order(
    body: CreateIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("service:edit")),
):
    """报修（建工单）：自动判定在保 / 过保。"""
    project = session.get(Project, body.project_no)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")
    in_warranty = bool(project.warranty_end and project.warranty_end >= date.today())
    o = ServiceOrder(
        so_no=next_number(session, ObjectType.SERVICE_ORDER, scope_key=year_scope_key()),
        project_no=body.project_no,
        equip_no=body.equip_no,
        reported_by=current.id,
        reported_at=_now(),
        fault=body.fault,
        status="待受理",
        in_warranty=in_warranty,
        remark=body.remark,
    )
    session.add(o)
    session.flush()
    targets = {current.id}
    if project.pm_id:
        targets.add(project.pm_id)
    notify.notify_role(
        session, "SERVICE", type_="service",
        title=f"新服务工单：{o.so_no}（{body.project_no}{(' / ' + body.equip_no) if body.equip_no else ''}）"
        + ("" if in_warranty else "【过保】"),
        body=body.fault or "",
        link="/service", biz_type="service_order", biz_id=o.id, actor_id=current.id,
    )
    notify.notify(
        session, targets, type_="service",
        title=f"报修已受理：{o.so_no}" + ("" if in_warranty else "（过保，需收费确认）"),
        body=body.fault or "", link="/service", biz_type="service_order", biz_id=o.id, actor_id=current.id,
    )
    audit.log(
        session, user=current, action="so_create", object_type="service_order", object_ref=o.so_no,
        summary=f"报修 {o.so_no}：{body.project_no}{(' / ' + body.equip_no) if body.equip_no else ''}"
        + ("（在保）" if in_warranty else "（过保）"),
        ip=client_ip(request),
    )
    session.commit()
    return so_dict(session, o)


@router.get("/orders")
def list_orders(
    project_no: str | None = None,
    status_: str | None = Query(default=None, alias="status"),
    limit: int = 200,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    stmt = select(ServiceOrder).order_by(ServiceOrder.id.desc())
    if project_no:
        stmt = stmt.where(ServiceOrder.project_no == project_no)
    if status_:
        stmt = stmt.where(ServiceOrder.status == status_)
    return [so_dict(session, o) for o in session.scalars(stmt.limit(min(limit, 500))).all()]


class DispatchIn(BaseModel):
    dispatched_to: str = Field(..., description="派谁去修")


@router.post("/orders/{oid}/dispatch")
def dispatch(
    oid: int,
    body: DispatchIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("service:edit")),
):
    o = session.get(ServiceOrder, oid)
    if o is None or o.status != "待受理":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "工单不存在或已派工")
    o.status = "已派工"
    o.dispatched_to = body.dispatched_to
    o.responded_at = _now()
    audit.log(
        session, user=current, action="so_dispatch", object_type="service_order", object_ref=o.so_no,
        summary=f"派工 {o.so_no} → {body.dispatched_to}", ip=client_ip(request),
    )
    session.commit()
    return so_dict(session, o)


class ArriveIn(BaseModel):
    photos: list = Field(default_factory=list)


@router.post("/orders/{oid}/arrive")
def arrive(
    oid: int,
    body: ArriveIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("service:edit")),
):
    o = session.get(ServiceOrder, oid)
    if o is None or o.status != "已派工":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "工单不在「已派工」状态")
    o.status = "已到场"
    o.arrived_at = _now()
    if body.photos:
        o.photos = list(o.photos or []) + list(body.photos)
    audit.log(
        session, user=current, action="so_arrive", object_type="service_order", object_ref=o.so_no,
        summary=f"到场 {o.so_no}", ip=client_ip(request),
    )
    session.commit()
    return so_dict(session, o)


class FixIn(BaseModel):
    solution: str
    labor_hours: float | None = None
    photos: list = Field(default_factory=list)
    remark: str | None = None


@router.post("/orders/{oid}/fix")
def fix(
    oid: int,
    body: FixIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("service:edit")),
):
    """处理完成（含备件更换记录）→ 待客户签字。"""
    o = session.get(ServiceOrder, oid)
    if o is None or o.status != "已到场":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "工单不在「已到场」状态")
    o.status = "待客户签字"
    o.solution = body.solution
    o.labor_hours = body.labor_hours
    o.fixed_at = _now()
    if body.photos:
        o.photos = list(o.photos or []) + list(body.photos)
    if body.remark:
        o.remark = body.remark
    audit.log(
        session, user=current, action="so_fix", object_type="service_order", object_ref=o.so_no,
        summary=f"处理完成 {o.so_no}：{body.solution[:40]}", ip=client_ip(request),
    )
    session.commit()
    return so_dict(session, o)


class SignIn(BaseModel):
    customer_sign: str = Field(..., description="客户签字人")


@router.post("/orders/{oid}/sign")
def sign(
    oid: int,
    body: SignIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("service:edit")),
):
    o = session.get(ServiceOrder, oid)
    if o is None or o.status != "待客户签字":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "工单不在「待客户签字」状态")
    o.status = "已关闭"
    o.customer_sign = body.customer_sign
    o.signed_at = _now()
    o.closed_at = _now()
    audit.log(
        session, user=current, action="so_close", object_type="service_order", object_ref=o.so_no,
        summary=f"客户签字关单 {o.so_no}（{body.customer_sign}）", ip=client_ip(request),
    )
    session.commit()
    return so_dict(session, o)


@router.get("/workbench")
def workbench(
    project_no: str | None = None,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    rows = session.scalars(select(ServiceOrder).order_by(ServiceOrder.id.desc()).limit(300)).all()
    if project_no:
        rows = [r for r in rows if r.project_no == project_no]
    open_rows = [r for r in rows if r.status != "已关闭"]
    parts = session.scalars(select(SparePart)).all()
    if project_no:
        parts = [p for p in parts if p.project_no == project_no]
    return {
        "counts": {
            "open": len(open_rows),
            "wait": len([r for r in rows if r.status == "待受理"]),
            "in_progress": len([r for r in rows if r.status in ("已派工", "已到场")]),
            "to_sign": len([r for r in rows if r.status == "待客户签字"]),
            "closed": len([r for r in rows if r.status == "已关闭"]),
            "low_parts": len([p for p in parts if p.min_qty is not None and (p.qty_stock or 0) < p.min_qty]),
        },
        "orders": [so_dict(session, o) for o in rows],
    }


# --------------------------------------------------------------------------
# 备件
# --------------------------------------------------------------------------


@router.get("/parts")
def list_parts(
    project_no: str | None = None,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    stmt = select(SparePart).order_by(SparePart.id.desc())
    if project_no:
        stmt = stmt.where(SparePart.project_no == project_no)
    return [part_dict(p) for p in session.scalars(stmt.limit(500)).all()]


class PartIn(BaseModel):
    project_no: str | None = None
    equip_no: str | None = None
    item_no: str
    item_name: str | None = None
    qty_stock: float = 0
    qty_installed: float = 0
    min_qty: float | None = None
    remark: str | None = None


@router.post("/parts", status_code=status.HTTP_201_CREATED)
def create_part(
    body: PartIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("service:edit")),
):
    p = SparePart(**body.model_dump())
    session.add(p)
    audit.log(
        session, user=current, action="spare_part_create", object_type="spare_part", object_ref=body.item_no,
        summary=f"新增备件 {body.item_no}（库存 {body.qty_stock}）", ip=client_ip(request),
    )
    session.commit()
    return part_dict(p)


class MoveIn(BaseModel):
    part_id: int
    move_type: str = Field(..., description="领出 / 退回 / 补货")
    qty: float = Field(..., gt=0)
    service_order_id: int | None = None
    issued_to: str | None = None
    remark: str | None = None


@router.post("/parts/move", status_code=status.HTTP_201_CREATED)
def move_part(
    body: MoveIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("service:edit")),
):
    """备件收发：领出扣库存（工单换件）、退回/补货加回。"""
    p = session.get(SparePart, body.part_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "备件不存在")
    if body.move_type not in SP_MOVE_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "类型只能是 领出 / 退回 / 补货")
    stock = float(p.qty_stock or 0)
    if body.move_type == SP_ISSUE and stock < body.qty:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"备件库存只有 {stock:g}，不够领 {body.qty:g}")
    delta = -body.qty if body.move_type == SP_ISSUE else body.qty
    p.qty_stock = stock + delta
    row = SparePartMove(
        part_id=p.id, move_type=body.move_type, qty=body.qty,
        service_order_id=body.service_order_id, issued_to=body.issued_to,
        operator_id=current.id, moved_at=_now(), remark=body.remark,
    )
    session.add(row)
    audit.log(
        session, user=current, action="spare_part_move", object_type="spare_part", object_ref=p.item_no,
        summary=f"备件{body.move_type} {p.item_no} × {body.qty:g}"
        + (f"（工单关联）" if body.service_order_id else ""),
        ip=client_ip(request),
    )
    session.commit()
    return part_dict(p)


@router.get("/parts/moves")
def list_moves(
    part_id: int | None = None,
    limit: int = 200,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    stmt = select(SparePartMove).order_by(SparePartMove.id.desc())
    if part_id:
        stmt = stmt.where(SparePartMove.part_id == part_id)
    return [
        {
            "id": m.id,
            "part_id": m.part_id,
            "move_type": m.move_type,
            "qty": float(m.qty or 0),
            "service_order_id": m.service_order_id,
            "issued_to": m.issued_to,
            "moved_at": m.moved_at,
            "remark": m.remark,
        }
        for m in session.scalars(stmt.limit(min(limit, 500))).all()
    ]


# --------------------------------------------------------------------------
# 照片
# --------------------------------------------------------------------------


@router.post("/photos", status_code=status.HTTP_201_CREATED)
async def upload_photos(
    request: Request,
    project_no: str = Query(...),
    ref: str | None = Query(default=None),
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("service:edit")),
):
    from app.services.photos import save_photos

    out = await save_photos(files, project_no=project_no, area="service", ref=ref)
    audit.log(
        session, user=current, action="photos", object_type="service_order", object_ref=ref,
        summary=f"售后拍照 {project_no}/{ref or ''}：{len(out)} 张", ip=client_ip(request),
    )
    session.commit()
    return out


@router.get("/photos")
def get_photo(token: str = Query(...), _: User = Depends(get_current_user)):
    from fastapi.responses import FileResponse

    from app.services.photos import media_type_of, resolve_photo

    path = resolve_photo(token)
    return FileResponse(path, media_type=media_type_of(path))
