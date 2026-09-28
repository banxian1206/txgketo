"""移动端接口（03 卷）：仓库/车间用手机的干活动线。

只放「手机端要用的」聚合接口：
· 一条待验收 = 物料 + 供应商 + 采购单 + 电子图纸 + 已有到货单/照片，避免手机连打多个请求
· 内网穿透只透出 `/api/v1/m/*` + 白名单（验收/入库/看图/拍照这些动作路径）

不做扫码、不做工序级报工（客户原则：清单 + 勾选 + 拍照就够了）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_session
from app.models.change import CR_PENDING, ChangeRequest
from app.models.acceptance import Acceptance
from app.models.assembly import AssemblyRecord
from app.models.engineering import Drawing
from app.models.initiation import GoodsReceipt, PurchaseRequest
from app.models.library import Item
from app.models.platform import POSITION_DIRECTOR, POSITION_LEAD, User
from app.models.production import PROD_DISPATCHED, PROD_DONE, PROD_RUNNING, PROD_WAIT, ProdOrder
from app.models.project import Equipment, Project
from app.models.review import TICKET_PENDING_DIRECTOR, TICKET_PENDING_LEAD, ReviewTicket
from app.models.service import ServiceOrder
from app.models.shipment import Shipment
from app.models.site import SiteCommission, SiteIssue
from app.models.task import Task
from app.models.warehouse import MaterialIssue
from app.services.notify import unread_count

router = APIRouter(prefix="/m", tags=["移动端"])

TO_INSPECT = ("在途", "已下单", "部分到货")


def _photos(gr: GoodsReceipt) -> list[dict]:
    return [
        {
            "filename": p.get("filename"),
            "by": p.get("by"),
            "at": p.get("at"),
            "url": f"/goods-receipts/{gr.id}/photos/{i}",
        }
        for i, p in enumerate(gr.photos or [])
    ]


def _count(session: Session, stmt) -> int:
    return int(session.scalar(stmt) or 0)


@router.get("/home")
def mobile_home(session: Session = Depends(get_session), current: User = Depends(get_current_user)):
    """手机端首页：按角色给待办数字（走到哪都能继续干活）。"""
    to_inspect = _count(
        session,
        select(func.count())
        .select_from(PurchaseRequest)
        .where(
            PurchaseRequest.status.in_(TO_INSPECT),
            PurchaseRequest.deliver_to.in_(("公司仓库", None)),
        ),
    )
    to_store = _count(
        session,
        select(func.count())
        .select_from(GoodsReceipt)
        .where(GoodsReceipt.status == "待入库", GoodsReceipt.deliver_to == "公司仓库"),
    )
    issues = _count(
        session,
        select(func.count())
        .select_from(MaterialIssue)
        .where(MaterialIssue.status.in_(("待备料", "已备料", "部分领料"))),
    )
    my_tasks = _count(
        session,
        select(func.count())
        .select_from(Task)
        .where(Task.owner_id == current.id, Task.status.not_in(("已完成", "已取消"))),
    )
    unread = unread_count(session, current.id)
    # 制造 / 装配 / 发运（S5–S7）：手机端也能干活
    to_dispatch = _count(
        session, select(func.count()).select_from(ProdOrder).where(ProdOrder.status == PROD_WAIT)
    )
    to_accept = _count(
        session,
        select(func.count()).select_from(ProdOrder).where(ProdOrder.status.in_((PROD_DISPATCHED, PROD_RUNNING))),
    )
    to_transfer = _count(
        session, select(func.count()).select_from(ProdOrder).where(ProdOrder.status == PROD_DONE)
    )
    assembling = _count(
        session, select(func.count()).select_from(AssemblyRecord).where(AssemblyRecord.status == "装配中")
    )
    to_debug = _count(
        session, select(func.count()).select_from(AssemblyRecord).where(AssemblyRecord.status == "已装配")
    )
    shipments_open = _count(
        session,
        select(func.count()).select_from(Shipment).where(Shipment.status.in_(("已指令", "打包中", "已装车"))),
    )
    shipments_receive = _count(
        session,
        select(func.count()).select_from(Shipment).where(Shipment.status.in_(("在途", "已到货"))),
    )
    site_open_issues = _count(
        session, select(func.count()).select_from(SiteIssue).where(SiteIssue.status == "待处理")
    )
    site_to_dispatch = _count(
        session, select(func.count()).select_from(SiteCommission).where(SiteCommission.status == "已申请")
    )
    acceptance_pending = _count(
        session, select(func.count()).select_from(Acceptance).where(Acceptance.status == "待验收")
    )
    service_open = _count(
        session,
        select(func.count()).select_from(ServiceOrder).where(ServiceOrder.status != "已关闭"),
    )

    if current.position == POSITION_DIRECTOR:
        to_review = _count(
            session,
            select(func.count())
            .select_from(ReviewTicket)
            .where(ReviewTicket.status == TICKET_PENDING_DIRECTOR),
        )
        to_decide = _count(
            session,
            select(func.count()).select_from(ChangeRequest).where(ChangeRequest.status == CR_PENDING),
        )
    elif current.position == POSITION_LEAD:
        to_review = _count(
            session,
            select(func.count())
            .select_from(ReviewTicket)
            .where(
                ReviewTicket.status == TICKET_PENDING_LEAD,
                ReviewTicket.profession == current.profession,
            ),
        )
        to_decide = 0
    else:
        to_review = 0
        to_decide = 0

    return {
        "user": {
            "id": current.id,
            "name": current.name,
            "profession": current.profession,
            "position": current.position,
        },
        "unread": unread,
        "counts": {
            "to_inspect": to_inspect,
            "to_store": to_store,
            "issues": issues,
            "my_tasks": my_tasks,
            "to_review": to_review,
            "to_decide": to_decide,
            "to_dispatch": to_dispatch,
            "to_accept": to_accept,
            "to_transfer": to_transfer,
            "assembling": assembling,
            "to_debug": to_debug,
            "shipments_open": shipments_open,
            "shipments_receive": shipments_receive,
            "site_open_issues": site_open_issues,
            "site_to_dispatch": site_to_dispatch,
            "acceptance_pending": acceptance_pending,
            "service_open": service_open,
        },
    }


@router.get("/materials/{request_id}")
def mobile_material_detail(
    request_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """一条待验收/待入库的详情：物料 + 供应商 + 采购单 + 电子图纸 + 已到货单/照片。"""
    r = session.get(PurchaseRequest, request_id)
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "采购需求不存在")
    item = session.get(Item, r.item_no)
    project = session.get(Project, r.project_no) if r.project_no else None
    equip = (
        session.scalar(
            select(Equipment).where(
                Equipment.project_no == r.project_no, Equipment.equip_no == r.equip_no
            )
        )
        if r.project_no and r.equip_no
        else None
    )
    drawing = session.get(Drawing, r.part_no) if r.part_no else None
    receipts = list(
        session.scalars(
            select(GoodsReceipt).where(GoodsReceipt.request_id == request_id).order_by(GoodsReceipt.id)
        ).all()
    )
    return {
        "id": r.id,
        "project_no": r.project_no,
        "project_name": project.project_name if project else None,
        "equip_no": r.equip_no,
        "equip_name": equip.equip_name if equip else None,
        "item_no": r.item_no,
        "display_name": item.display_name if item else r.item_no,
        "spec_text": item.spec_text if item else None,
        "brand": item.brand if item else None,
        "qty": float(r.qty or 0),
        "qty_received": float(r.qty_received or 0),
        "unit": r.unit,
        "po_no": r.po_no,
        "supplier_name": r.supplier_name,
        "need_date": r.need_date,
        "expected_date": r.expected_date,
        "status": r.status,
        "deliver_to": r.deliver_to,
        "part_no": r.part_no,
        "drawing": (
            {
                "drawing_no": drawing.drawing_no,
                "title": drawing.title,
                "version": drawing.current_version,
                "kind": drawing.kind,
                "file_url": f"/drawings/{drawing.drawing_no}/file",
            }
            if drawing
            else None
        ),
        "receipts": [
            {
                "id": g.id,
                "receipt_no": g.receipt_no,
                "qty": float(g.qty or 0),
                "unit": g.unit,
                "status": g.status,
                "receipt_date": g.receipt_date,
                "location": g.location,
                "inspect_note": g.inspect_note,
                "photos": _photos(g),
            }
            for g in receipts
        ],
    }
