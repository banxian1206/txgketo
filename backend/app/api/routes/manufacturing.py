"""制造域 API（《00 方案》§3.3 S5 · 《02 数据模型》§6）。

★ 只管两头：下发（原材料 + 图纸，拍照）→ 到期验收（拍照）→ 转运装配区（拍照）。
权限：查看 `mfg:view`，操作 `mfg:edit`（车间/系统专员/质检）。
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user, require_permission
from app.core.db import get_session
from app.models.engineering import Drawing
from app.models.platform import User
from app.models.production import (
    OS_BACK,
    OS_OK,
    OS_SENT,
    OS_WAIT,
    PROD_DISPATCHED,
    PROD_DONE,
    PROD_REWORK,
    PROD_RUNNING,
    PROD_TRANSFERRED,
    PROD_WAIT,
    OutsourceTask,
    ProdOrder,
)
from app.services import audit
from app.services import manufacturing as mfg

router = APIRouter(prefix="/manufacturing", tags=["制造"])

OPEN_STATUS = (PROD_WAIT, PROD_DISPATCHED, PROD_RUNNING, PROD_DONE, PROD_REWORK)


# --------------------------------------------------------------------------
# 照片（下发 / 验收 / 转运 拍照留痕）
# --------------------------------------------------------------------------


@router.post("/photos", status_code=status.HTTP_201_CREATED)
async def upload_photos(
    request: Request,
    project_no: str = Query(...),
    ref: str | None = Query(default=None, description="排产单号/设备号，用于分目录"),
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("mfg:edit")),
):
    """制造拍照上传（下发/验收/转运）：返回 token，前端把它放进 photos 列表。"""
    from app.services.photos import save_photos

    out = await save_photos(files, project_no=project_no, area="manufacturing", ref=ref)
    audit.log(
        session,
        user=current,
        action="photos",
        object_type="prod_order",
        object_ref=ref,
        summary=f"制造拍照 {project_no}/{ref or ''}：{len(out)} 张",
        ip=client_ip(request),
    )
    session.commit()
    return out


@router.get("/photos")
def get_photo(
    token: str = Query(...),
    _: User = Depends(get_current_user),
):
    """按 token 取回制造照片（带鉴权）。"""
    from fastapi.responses import FileResponse

    from app.services.photos import media_type_of, resolve_photo

    path = resolve_photo(token)
    return FileResponse(path, media_type=media_type_of(path))


# --------------------------------------------------------------------------
# 生成排产单
# --------------------------------------------------------------------------


class GenerateIn(BaseModel):
    plan_start: date | None = None
    plan_days: int = Field(default=2, ge=1, le=60)


@router.post(
    "/projects/{project_no}/equipment/{equip_no}/generate-orders",
    status_code=status.HTTP_201_CREATED,
)
def generate_orders(
    project_no: str,
    equip_no: str,
    body: GenerateIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("mfg:edit")),
):
    """按设备的已发布图纸：自制件 → 排产单，外协件 → 外协任务（幂等）。"""
    try:
        result = mfg.generate_orders(
            session,
            project_no=project_no,
            equip_no=equip_no,
            actor_id=current.id,
            plan_start=body.plan_start,
            plan_days=body.plan_days,
        )
    except mfg.ManufacturingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session,
        user=current,
        action="generate_prod_orders",
        object_type="project",
        object_ref=project_no,
        summary=(
            f"生成排产：{project_no} / {equip_no} —— 自制件 {len(result['orders'])} 个、"
            f"外协件 {len(result['outsource'])} 个"
        ),
        ip=client_ip(request),
    )
    session.commit()
    return {
        "orders": [o.order_no for o in result["orders"]],
        "outsource": [o.outsource_no for o in result["outsource"]],
        "order_count": len(result["orders"]),
        "outsource_count": len(result["outsource"]),
    }


# --------------------------------------------------------------------------
# 列表 / 详情 / 工作台
# --------------------------------------------------------------------------


@router.get("/orders")
def list_orders(
    project_no: str | None = None,
    equip_no: str | None = None,
    status_: str | None = Query(default=None, alias="status"),
    overdue_only: bool = False,
    limit: int = 200,
    session: Session = Depends(get_session),
    _: User = Depends(require_permission("mfg:view")),
):
    stmt = select(ProdOrder).order_by(ProdOrder.id.desc())
    if project_no:
        stmt = stmt.where(ProdOrder.project_no == project_no)
    if equip_no:
        stmt = stmt.where(ProdOrder.equip_no == equip_no)
    if status_:
        stmt = stmt.where(ProdOrder.status == status_)
    rows = session.scalars(stmt.limit(min(limit, 500))).all()
    today = date.today()
    out = []
    for o in rows:
        d = mfg.order_dict(session, o)
        d["overdue"] = bool(
            o.plan_end and o.plan_end < today and o.status in (PROD_WAIT, PROD_DISPATCHED, PROD_RUNNING)
        )
        out.append(d)
    if overdue_only:
        out = [d for d in out if d["overdue"]]
    return out


@router.get("/orders/{order_id}")
def get_order(
    order_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(require_permission("mfg:view")),
):
    o = session.get(ProdOrder, order_id)
    if o is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "排产单不存在")
    return mfg.order_dict(session, o)


@router.get("/workbench")
def workbench(
    session: Session = Depends(get_session),
    _: User = Depends(require_permission("mfg:view")),
):
    """车间台：待下发 / 在制 / 待验收 / 待转运 / 返工 / 超期 / 外协。"""
    return mfg.workbench_view(session)


# --------------------------------------------------------------------------
# 下发 / 开工 / 验收 / 转运
# --------------------------------------------------------------------------


class DispatchIn(BaseModel):
    step_name: str = Field(default="下料", max_length=32)
    material_item_no: str | None = None
    material_qty: float | None = None
    issued_to: str | None = None
    photos: list = Field(default_factory=list)
    remark: str | None = None


@router.post("/orders/{order_id}/dispatch")
def dispatch(
    order_id: int,
    body: DispatchIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("mfg:edit")),
):
    """下发到第一道工序：【原材料】+ 图纸 → 拍照确认。"""
    o = session.get(ProdOrder, order_id)
    if o is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "排产单不存在")
    if not body.photos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "下发要拍照确认（原材料 + 图纸）")
    try:
        mfg.dispatch(
            session,
            o,
            actor_id=current.id,
            step_name=body.step_name,
            material_item_no=body.material_item_no,
            material_qty=body.material_qty,
            issued_to=body.issued_to,
            photos=body.photos,
            remark=body.remark,
        )
    except mfg.ManufacturingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session,
        user=current,
        action="dispatch_prod",
        object_type="prod_order",
        object_ref=o.order_no,
        summary=f"下发排产 {o.order_no}（{o.item_no}）→ {body.step_name}，已拍照确认",
        ip=client_ip(request),
    )
    session.commit()
    return mfg.order_dict(session, o)


@router.post("/orders/{order_id}/start")
def start(
    order_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("mfg:edit")),
):
    o = session.get(ProdOrder, order_id)
    if o is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "排产单不存在")
    try:
        mfg.start(session, o)
    except mfg.ManufacturingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="start_prod", object_type="prod_order",
        object_ref=o.order_no, summary=f"开工：{o.order_no}（{o.item_no}）", ip=client_ip(request),
    )
    session.commit()
    return mfg.order_dict(session, o)


class AcceptIn(BaseModel):
    result: str = Field(..., description="合格 / 不合格 / 返工")
    reason: str | None = None
    photos: list = Field(default_factory=list)


@router.post("/orders/{order_id}/accept")
def accept(
    order_id: int,
    body: AcceptIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("mfg:edit")),
):
    """到期验收：合格 → 完工待验收；不合格/返工 → 返工。"""
    o = session.get(ProdOrder, order_id)
    if o is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "排产单不存在")
    if body.result not in ("合格", "不合格", "返工"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "验收结论只能是 合格 / 不合格 / 返工")
    if body.result != "合格" and not (body.reason or "").strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "不合格/返工必须写明原因")
    if not body.photos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "验收要拍照（证明做完了、合格）")
    try:
        mfg.accept(
            session, o, actor_id=current.id, result=body.result,
            reason=body.reason, photos=body.photos,
        )
    except mfg.ManufacturingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="accept_prod", object_type="prod_order",
        object_ref=o.order_no,
        summary=f"验收 {o.order_no}（{o.item_no}）：{body.result}" + (f" — {body.reason}" if body.reason else ""),
        ip=client_ip(request),
    )
    session.commit()
    return mfg.order_dict(session, o)


class TransferIn(BaseModel):
    transfer_to: str = Field(default="装配区", max_length=32)
    photos: list = Field(default_factory=list)


@router.post("/orders/{order_id}/transfer")
def transfer(
    order_id: int,
    body: TransferIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("mfg:edit")),
):
    """验收合格后转运装配区（拍照证明到位）。"""
    o = session.get(ProdOrder, order_id)
    if o is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "排产单不存在")
    try:
        mfg.transfer(session, o, actor_id=current.id, transfer_to=body.transfer_to, photos=body.photos)
    except mfg.ManufacturingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="transfer_prod", object_type="prod_order",
        object_ref=o.order_no, summary=f"转运 {o.order_no}（{o.item_no}）→ {body.transfer_to}",
        ip=client_ip(request),
    )
    session.commit()
    return mfg.order_dict(session, o)


# --------------------------------------------------------------------------
# 外协
# --------------------------------------------------------------------------


def _os_dict(o: OutsourceTask) -> dict:
    return {
        "id": o.id,
        "outsource_no": o.outsource_no,
        "project_no": o.project_no,
        "equip_no": o.equip_no,
        "item_no": o.item_no,
        "item_name": o.item_name,
        "qty": float(o.qty or 0),
        "supplier_id": o.supplier_id,
        "supplier_name": o.supplier_name,
        "material_supplied": o.material_supplied,
        "sent_at": o.sent_at,
        "due_date": o.due_date,
        "returned_at": o.returned_at,
        "status": o.status,
        "photos": o.photos or [],
        "remark": o.remark,
    }


@router.get("/outsource")
def list_outsource(
    project_no: str | None = None,
    status_: str | None = Query(default=None, alias="status"),
    limit: int = 200,
    session: Session = Depends(get_session),
    _: User = Depends(require_permission("mfg:view")),
):
    stmt = select(OutsourceTask).order_by(OutsourceTask.id.desc())
    if project_no:
        stmt = stmt.where(OutsourceTask.project_no == project_no)
    if status_:
        stmt = stmt.where(OutsourceTask.status == status_)
    return [_os_dict(o) for o in session.scalars(stmt.limit(min(limit, 500))).all()]


class OutsourceSendIn(BaseModel):
    supplier_id: int | None = None
    supplier_name: str | None = None
    sent_at: date | None = None
    due_date: date | None = None
    material_supplied: bool | None = None
    photos: list = Field(default_factory=list)
    remark: str | None = None


@router.post("/outsource/{os_id}/send")
def outsource_send(
    os_id: int,
    body: OutsourceSendIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("mfg:edit")),
):
    o = session.get(OutsourceTask, os_id)
    if o is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "外协任务不存在")
    try:
        mfg.outsource_send(
            session, o, actor_id=current.id, supplier_id=body.supplier_id,
            supplier_name=body.supplier_name, sent_at=body.sent_at, due_date=body.due_date,
            material_supplied=body.material_supplied, photos=body.photos, remark=body.remark,
        )
    except mfg.ManufacturingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="outsource_send", object_type="outsource",
        object_ref=o.outsource_no, summary=f"外协发出 {o.outsource_no}（{o.item_no}）→ {o.supplier_name or '—'}",
        ip=client_ip(request),
    )
    session.commit()
    return _os_dict(o)


class OutsourceReturnIn(BaseModel):
    returned_at: date | None = None
    photos: list = Field(default_factory=list)
    remark: str | None = None


@router.post("/outsource/{os_id}/return")
def outsource_return(
    os_id: int,
    body: OutsourceReturnIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("mfg:edit")),
):
    o = session.get(OutsourceTask, os_id)
    if o is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "外协任务不存在")
    try:
        mfg.outsource_return(
            session, o, actor_id=current.id, returned_at=body.returned_at,
            photos=body.photos, remark=body.remark,
        )
    except mfg.ManufacturingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="outsource_return", object_type="outsource",
        object_ref=o.outsource_no, summary=f"外协回厂 {o.outsource_no}（{o.item_no}）待检",
        ip=client_ip(request),
    )
    session.commit()
    return _os_dict(o)


class OutsourceAcceptIn(BaseModel):
    result: str
    reason: str | None = None
    photos: list = Field(default_factory=list)


@router.post("/outsource/{os_id}/accept")
def outsource_accept(
    os_id: int,
    body: OutsourceAcceptIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("mfg:edit")),
):
    o = session.get(OutsourceTask, os_id)
    if o is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "外协任务不存在")
    if body.result not in ("合格", "不合格"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "外协验收结论只能是 合格 / 不合格")
    try:
        mfg.outsource_accept(
            session, o, actor_id=current.id, result=body.result, reason=body.reason, photos=body.photos
        )
    except mfg.ManufacturingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="outsource_accept", object_type="outsource",
        object_ref=o.outsource_no, summary=f"外协验收 {o.outsource_no}：{body.result}",
        ip=client_ip(request),
    )
    session.commit()
    return _os_dict(o)


# --------------------------------------------------------------------------
# 图纸（下发时看版本）
# --------------------------------------------------------------------------


@router.get("/drawings/{project_no}/{equip_no}")
def list_drawings(
    project_no: str,
    equip_no: str,
    session: Session = Depends(get_session),
    _: User = Depends(require_permission("mfg:view")),
):
    """这台设备的图纸（下发时核对版本：车间按哪版干活）。"""
    rows = session.scalars(
        select(Drawing)
        .where(Drawing.project_no == project_no, Drawing.equip_no == equip_no)
        .order_by(Drawing.drawing_no)
    ).all()
    return [
        {
            "drawing_no": d.drawing_no,
            "title": d.title,
            "source_type": d.source_type,
            "version": d.current_version,
            "status": d.status,
            "qty": float(d.qty or 1),
            "unit": d.unit,
        }
        for d in rows
    ]
