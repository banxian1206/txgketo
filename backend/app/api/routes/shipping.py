"""发运域 API（《00 方案》§3.1⑤ · 《02 数据模型》§8）。

★ PM 勾选要发的设备 → 发货指令 → 打包 → 装车（拍照）→ 发运（分批）→ 现场到货验收。
权限：写 `ship:edit`（项目经理 / 交付发运）；读：登录即可（非金额数据，由菜单按角色显示）。
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user, require_permission
from app.core.db import get_session
from app.models.platform import User
from app.models.shipment import RECEIPT_RESULTS, Shipment
from app.services import audit
from app.services import shipping as shp
from app.services.shipping import SHIP_OPEN

router = APIRouter(prefix="/shipping", tags=["发运"])


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
    current: User = Depends(require_permission("ship:edit")),
):
    from app.services.photos import save_photos

    out = await save_photos(files, project_no=project_no, area="shipping", ref=ref)
    audit.log(
        session, user=current, action="photos", object_type="shipment", object_ref=ref,
        summary=f"发运拍照 {project_no}/{ref or ''}：{len(out)} 张", ip=client_ip(request),
    )
    session.commit()
    return out


@router.get("/photos")
def get_photo(token: str = Query(...), _: User = Depends(get_current_user)):
    from fastapi.responses import FileResponse

    from app.services.photos import media_type_of, resolve_photo

    path = resolve_photo(token)
    return FileResponse(path, media_type=media_type_of(path))


# --------------------------------------------------------------------------
# 待发设备 / 发货指令
# --------------------------------------------------------------------------


@router.get("/to-ship")
def to_ship(
    project_no: str = Query(...),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """待发设备（装配完成且不在未完成批次里）。"""
    return shp.to_ship(session, project_no)


class InstructIn(BaseModel):
    project_no: str
    equip_nos: list[str]
    plan_ship_date: date | None = None
    remark: str | None = None


@router.post("/instructions", status_code=status.HTTP_201_CREATED)
def create_instruction(
    body: InstructIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("ship:edit")),
):
    """下达发货指令（PM 勾选本次要发的设备）。"""
    try:
        sh = shp.create_shipment(
            session,
            project_no=body.project_no,
            equip_nos=body.equip_nos,
            actor_id=current.id,
            plan_ship_date=body.plan_ship_date,
            remark=body.remark,
        )
    except shp.ShippingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="ship_instruction", object_type="shipment",
        object_ref=sh.shipment_no,
        summary=f"发货指令 {sh.shipment_no}：{body.project_no} 本次发 {'、'.join(body.equip_nos)}",
        ip=client_ip(request),
    )
    session.commit()
    return shp.shipment_dict(session, sh)


@router.get("/list")
def list_shipments(
    project_no: str | None = None,
    status_: str | None = Query(default=None, alias="status"),
    limit: int = 200,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    stmt = select(Shipment).order_by(Shipment.id.desc())
    if project_no:
        stmt = stmt.where(Shipment.project_no == project_no)
    if status_:
        stmt = stmt.where(Shipment.status == status_)
    return [shp.shipment_dict(session, s) for s in session.scalars(stmt.limit(min(limit, 500))).all()]


@router.get("/workbench")
def workbench(
    project_no: str | None = None,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    rows = session.scalars(select(Shipment).order_by(Shipment.id.desc()).limit(200)).all()
    if project_no:
        rows = [s for s in rows if s.project_no == project_no]
    return {
        "counts": {
            "instructed": len([s for s in rows if s.status == "已指令"]),
            "packing": len([s for s in rows if s.status == "打包中"]),
            "loaded": len([s for s in rows if s.status == "已装车"]),
            "transit": len([s for s in rows if s.status == "在途"]),
            "arrived": len([s for s in rows if s.status == "已到货"]),
            "signed": len([s for s in rows if s.status == "已签收"]),
            "open": len([s for s in rows if s.status in SHIP_OPEN]),
        },
        "shipments": [shp.shipment_dict(session, s) for s in rows],
    }


@router.get("/{ship_id}")
def get_shipment(
    ship_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    sh = session.get(Shipment, ship_id)
    if sh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "发运批次不存在")
    return shp.shipment_dict(session, sh)


# --------------------------------------------------------------------------
# 打包 / 装车 / 发运 / 到货
# --------------------------------------------------------------------------


class PackingItemIn(BaseModel):
    equip_no: str | None = None
    part_item_no: str
    part_name: str | None = None
    qty: float = 1
    package_no: str | None = None
    weight: float | None = None
    size: str | None = None
    disassembled: bool = False
    photos: list = Field(default_factory=list)
    remark: str | None = None


class PackIn(BaseModel):
    items: list[PackingItemIn]


@router.post("/{ship_id}/pack")
def pack(
    ship_id: int,
    body: PackIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("ship:edit")),
):
    """登记装箱清单（打包含拆解，不拆成两个流程）。"""
    sh = session.get(Shipment, ship_id)
    if sh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "发运批次不存在")
    try:
        rows = shp.add_packing(session, sh, [i.model_dump() for i in body.items], actor_id=current.id)
    except shp.ShippingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="ship_pack", object_type="shipment", object_ref=sh.shipment_no,
        summary=f"装箱 {sh.shipment_no}：{len(rows)} 箱/件", ip=client_ip(request),
    )
    session.commit()
    return shp.shipment_dict(session, sh)


class LoadIn(BaseModel):
    vehicle: str | None = None
    driver: str | None = None
    plate_no: str | None = None
    photos: list = Field(default_factory=list)
    remark: str | None = None


@router.post("/{ship_id}/load")
def load(
    ship_id: int,
    body: LoadIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("ship:edit")),
):
    """装车（拍照）。"""
    sh = session.get(Shipment, ship_id)
    if sh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "发运批次不存在")
    try:
        shp.load(
            session, sh, vehicle=body.vehicle, driver=body.driver, plate_no=body.plate_no,
            photos=body.photos, remark=body.remark,
        )
    except shp.ShippingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="ship_load", object_type="shipment", object_ref=sh.shipment_no,
        summary=f"装车 {sh.shipment_no}：{body.plate_no or body.vehicle or ''}", ip=client_ip(request),
    )
    session.commit()
    return shp.shipment_dict(session, sh)


class DepartIn(BaseModel):
    depart_at: date | None = None
    photos: list = Field(default_factory=list)
    remark: str | None = None


@router.post("/{ship_id}/depart")
def depart(
    ship_id: int,
    body: DepartIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("ship:edit")),
):
    sh = session.get(Shipment, ship_id)
    if sh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "发运批次不存在")
    try:
        shp.depart(session, sh, depart_at=body.depart_at, photos=body.photos, remark=body.remark)
    except shp.ShippingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="ship_depart", object_type="shipment", object_ref=sh.shipment_no,
        summary=f"发运 {sh.shipment_no}（在途）", ip=client_ip(request),
    )
    session.commit()
    return shp.shipment_dict(session, sh)


@router.post("/{ship_id}/arrive")
def arrive(
    ship_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("ship:edit")),
):
    sh = session.get(Shipment, ship_id)
    if sh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "发运批次不存在")
    try:
        shp.arrive(session, sh)
    except shp.ShippingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="ship_arrive", object_type="shipment", object_ref=sh.shipment_no,
        summary=f"到货 {sh.shipment_no}", ip=client_ip(request),
    )
    session.commit()
    return shp.shipment_dict(session, sh)


class ReceiptIn(BaseModel):
    result: str = Field(..., description="齐 / 缺件 / 破损")
    shortage_detail: list = Field(default_factory=list)
    photos: list = Field(default_factory=list)
    remark: str | None = None


@router.post("/{ship_id}/receipt")
def receipt(
    ship_id: int,
    body: ReceiptIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("ship:edit")),
):
    """现场到货验收（与发货指令 / 装箱清单对账）。"""
    sh = session.get(Shipment, ship_id)
    if sh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "发运批次不存在")
    if body.result not in RECEIPT_RESULTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "验收结论只能是 齐 / 缺件 / 破损")
    try:
        shp.site_receipt(
            session, sh, actor_id=current.id, result=body.result,
            shortage_detail=body.shortage_detail, photos=body.photos, remark=body.remark,
        )
    except shp.ShippingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="site_receipt", object_type="shipment", object_ref=sh.shipment_no,
        summary=f"现场到货验收 {sh.shipment_no}：{body.result}", ip=client_ip(request),
    )
    session.commit()
    return shp.shipment_dict(session, sh)
