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

from app.api.deps import client_ip, get_current_user, has_permission, require_permission
from app.core.db import get_session
from app.models.platform import User
from app.models.shipment import Shipment, ShipmentItem
from app.services import audit
from app.services import shipping as shp
from app.services.shipping import SHIP_OPEN

router = APIRouter(prefix="/shipping", tags=["发运"])


# --------------------------------------------------------------------------
# 照片
# --------------------------------------------------------------------------


def _can_receive(current: User = Depends(get_current_user)) -> User:
    """现场到货验收：交付发运（ship:edit）或现场（site:edit）都能做。"""
    if not (has_permission(current, "ship:edit") or has_permission(current, "site:edit")):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "没有权限：ship:edit / site:edit")
    return current




@router.post("/photos", status_code=status.HTTP_201_CREATED)
async def upload_photos(
    request: Request,
    project_no: str = Query(...),
    ref: str | None = Query(default=None),
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    current: User = Depends(_can_receive),
):
    """发货/清点拍照：交付（ship:edit）或现场（site:edit）都可上传。"""
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
            "to_vehicle": len(
                [
                    s
                    for s in rows
                    if s.vehicle_status == "待叫车"
                    and s.status in (SHIP_INSTRUCTED, SHIP_SHIPPING)
                ]
            ),
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


class ItemSaveIn(BaseModel):
    equip_no: str | None = None
    ref: str
    parent_ref: str | None = None
    name: str | None = None
    kind: str = "零件"
    source: str = "结构"
    qty: float = 1
    unit: str | None = None


@router.get("/{ship_id}/items")
def list_items(
    ship_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    sh = session.get(Shipment, ship_id)
    if sh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "发运批次不存在")
    return shp.shipment_dict(session, sh).get("items", [])


@router.post("/{ship_id}/items/generate", status_code=status.HTTP_201_CREATED)
def generate_items(
    ship_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("ship:edit")),
):
    """按设备结构生成本批发运清单（组件→零件→标准件/原材料）。"""
    sh = session.get(Shipment, ship_id)
    if sh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "发运批次不存在")
    try:
        rows = shp.sync_items(session, sh, shp.generate_items(session, sh), actor_id=current.id)
    except shp.ShippingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="ship_items_generate", object_type="shipment",
        object_ref=sh.shipment_no, summary=f"按结构生成发运清单 {sh.shipment_no}：{len(rows)} 行",
        ip=client_ip(request),
    )
    session.commit()
    return shp.shipment_dict(session, sh)


class ManualItemIn(BaseModel):
    equip_no: str | None = None
    name: str
    qty: float = 1
    remark: str | None = None


@router.post("/{ship_id}/items/manual", status_code=status.HTTP_201_CREATED)
def add_manual_item(
    ship_id: int,
    body: ManualItemIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("ship:edit")),
):
    """结构外补充项：说明书 / 备件 / 随机工具等。"""
    sh = session.get(Shipment, ship_id)
    if sh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "发运批次不存在")
    try:
        row = shp.add_manual_item(session, sh, actor_id=current.id,
                                  equip_no=body.equip_no, name=body.name,
                                  qty=body.qty, remark=body.remark)
    except shp.ShippingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(session, user=current, action="ship_item_manual", object_type="shipment",
              object_ref=sh.shipment_no, summary=f"补充发运项：{body.name} ×{body.qty}",
              ip=client_ip(request))
    session.commit()
    return {"id": row.id}


class ShipItemsIn(BaseModel):
    item_ids: list[int]
    photos: list = Field(default_factory=list)


@router.post("/items/ship")
def mark_items_shipped(
    body: ShipItemsIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("ship:edit")),
):
    """勾选「已发」：可勾组件（子树全勾）；可拍照。"""
    n = 0
    items = session.scalars(select(ShipmentItem).where(ShipmentItem.id.in_(body.item_ids))).all()
    sh_ids = {i.shipment_id for i in items}
    try:
        for sid in sh_ids:
            sh = session.get(Shipment, sid)
            n += shp.mark_shipped(session, sh, actor_id=current.id, item_ids=body.item_ids, photos=body.photos)
    except shp.ShippingError as e:
        # R5-02：状态不允许是业务错（400），不能当服务器错（500）抛给前端
        session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(session, user=current, action="ship_mark", object_type="shipment",
              summary=f"标记已发 {n} 项", ip=client_ip(request))
    session.commit()
    return {"marked": n}


class PlacePhotoIn(BaseModel):
    place_photos: list = Field(default_factory=list)


@router.post("/items/{item_id}/place")
def set_place_photos(
    item_id: int,
    body: PlacePhotoIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("ship:edit")),
):
    """记录摆放位置照片（可后补）。"""
    it = session.get(ShipmentItem, item_id)
    if it is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "发运项不存在")
    it.place_photos = list(it.place_photos or []) + list(body.place_photos)
    audit.log(session, user=current, action="ship_place", object_type="shipment_item",
              object_ref=str(item_id), summary="登记摆放位置照片", ip=client_ip(request))
    session.commit()
    return {"ok": True}


class LoadIn(BaseModel):
    vehicle: str | None = None
    driver: str | None = None
    plate_no: str | None = None
    photos: list = Field(default_factory=list)
    remark: str | None = None


class RequestVehicleIn(BaseModel):
    """★ §2.2：采购叫车。车辆服务**不进价格库**，只填本次价格。"""

    count: int = Field(description="几辆车（装货的人要知道当天装几车）")
    fee: float | None = None  # 本次运费（不进价格库）
    note: str | None = Field(default=None, description="承运商 / 备注")


@router.post("/{ship_id}/request-vehicle")
def request_vehicle(
    ship_id: int,
    body: RequestVehicleIn,
    request: Request,
    session: Session = Depends(get_session),
    # ★ §2.2：叫车是**采购**做的事（一条指令、两个部门）—— 不是发运/项目
    current: User = Depends(require_permission("purchase:edit")),
):
    """采购叫车（按 PM 定的发货日，当天把车叫回来）。

    叫完之后发运才能装车；同时通知发运“可以装车了”。
    """
    sh = session.get(Shipment, ship_id)
    if sh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "发运批次不存在")
    shp.request_vehicle(
        session, sh, count=body.count, fee=body.fee, note=body.note, operator_id=current.id
    )
    audit.log(
        session,
        user=current,
        action="ship_vehicle",
        object_type="shipment",
        object_ref=sh.shipment_no,
        summary=f"采购叫车 {sh.shipment_no}：{sh.vehicle_count} 车"
        + (f"，本次运费 {sh.vehicle_fee}" if sh.vehicle_fee is not None else "")
        + (f"；{sh.vehicle_note}" if sh.vehicle_note else ""),
        ip=client_ip(request),
    )
    session.commit()
    return shp.shipment_dict(session, sh)


@router.post("/{ship_id}/load")
def load(
    ship_id: int,
    body: LoadIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("ship:edit")),
):
    """装车（拍照）。★ §2.2：**采购叫完车**才能装车。"""
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
        shp.depart(session, sh, depart_at=body.depart_at, photos=body.photos, remark=body.remark, actor_id=current.id)
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


class ReceiptCheckIn(BaseModel):
    item_id: int
    result: str = Field(..., description="到 / 缺 / 损")
    received_qty: float | None = None
    reason: str | None = None


class ReceiptIn(BaseModel):
    checks: list[ReceiptCheckIn]
    photos: list = Field(default_factory=list)
    remark: str | None = None


@router.post("/{ship_id}/receipt")
def receipt(
    ship_id: int,
    body: ReceiptIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(_can_receive),
):
    """现场清点：按发运清单逐项勾「到 / 缺 / 损」，结论系统自动判定（齐/缺件/破损）。"""
    sh = session.get(Shipment, ship_id)
    if sh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "发运批次不存在")
    # ★ 发货与收货一致：只要求清点本批「已勾发」的项（未发的件不在本次交付内）
    all_items = shp.shipment_dict(session, sh)["items"]
    shipped_count = len([i for i in all_items if i.get("shipped")])
    if shipped_count and len(body.checks) != shipped_count:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"本批已勾「已发」{shipped_count} 项，必须逐项清点（当前 {len(body.checks)} 项）",
        )
    try:
        shp.site_receipt(
            session, sh, actor_id=current.id,
            checks=[c.model_dump() for c in body.checks],
            photos=body.photos, remark=body.remark,
        )
    except shp.ShippingError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="site_receipt", object_type="shipment", object_ref=sh.shipment_no,
        summary=f"现场清点 {sh.shipment_no}：{len(body.checks)} 项清点完成", ip=client_ip(request),
    )
    session.commit()
    return shp.shipment_dict(session, sh)
