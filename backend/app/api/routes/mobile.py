"""移动端接口（03 卷）：仓库/车间用手机的干活动线。

只放「手机端要用的」聚合接口：
· 一条待验收 = 物料 + 供应商 + 采购单 + 电子图纸 + 已有到货单/照片，避免手机连打多个请求
· 内网穿透只透出 `/api/v1/m/*` + 白名单（验收/入库/看图/拍照这些动作路径）

不做扫码、不做工序级报工（客户原则：清单 + 勾选 + 拍照就够了）。
"""

from __future__ import annotations

from datetime import date

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
from app.models.purchase_order import PurchaseOrder, PurchaseOrderLine
from app.models.library import Item
from app.models.platform import POSITION_DIRECTOR, POSITION_LEAD, User
from app.models.production import PROD_DISPATCHED, PROD_DONE, PROD_RUNNING, PROD_WAIT, ProdOrder
from app.models.project import Equipment, Project
from app.models.review import TICKET_PENDING_DIRECTOR, TICKET_PENDING_LEAD, ReviewTicket
from app.models.service import ServiceOrder
from app.models.shipment import Shipment
from app.models.site import SiteCommission, SiteIssue
from app.models.task import Task
from app.models.warehouse import MaterialIssue, MaterialIssueLine
from app.services.notify import unread_count

router = APIRouter(prefix="/m", tags=["移动端"])

TO_INSPECT = ("在途", "部分到货")


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

    # ── 今日任务流（R4 · 2026-10-04）────────────────────────────────────────────
    # ★ 为什么加这一段：手机首页原来是 14 个数字格（其中一大半是 0），用户得自己判断
    #   "今天先干哪件"。给一条**行级**任务流（带编号/名称/去向），首页只放前几条。
    #   每条带 `tab`（属于哪个移动台）→ 前端按**该用户可见的台**过滤，不越权展示。
    tasks: list[dict] = []

    def _add(kind: str, tab: str, to: str, code: str | None, title: str, sub: str,
             tone: str | None = None, extra: int = 0) -> None:
        if len(tasks) >= 8:
            return
        tasks.append({
            "kind": kind, "tab": tab, "to": to, "code": code,
            "title": title, "sub": sub, "tone": tone, "more": extra,
        })

    # ① 待验收（最紧：货到了不进库，车间就等料）—— 超期排最前
    rows = session.execute(
        select(PurchaseRequest)
        .where(
            PurchaseRequest.status.in_(TO_INSPECT),
            PurchaseRequest.deliver_to.in_(("公司仓库", None)),
        )
        .order_by(PurchaseRequest.need_date.asc().nulls_last(), PurchaseRequest.id)
        .limit(3)
    ).scalars().all()
    for r in rows:
        item = session.get(Item, r.item_no)
        overdue = bool(r.need_date and r.need_date < date.today())
        _add("待验收", "/m/warehouse", "/m/warehouse", r.po_no,
             (item.display_name if item else r.item_no),
             f"{r.project_no or '辅料'} {r.equip_no or ''} · 需要 {r.need_date or '—'}".strip(),
             "err" if overdue else None, extra=to_inspect)

    # ② 待入库（验收合格了，定个库位就完事）
    for g in session.execute(
        select(GoodsReceipt)
        .where(GoodsReceipt.status == "待入库", GoodsReceipt.deliver_to == "公司仓库")
        .order_by(GoodsReceipt.id)
        .limit(2)
    ).scalars().all():
        item = session.get(Item, g.item_no)
        _add("待入库", "/m/warehouse", "/m/warehouse", g.receipt_no,
             (item.display_name if item else g.item_no) or "—",
             f"{g.project_no or '辅料'} · 验收 {g.receipt_date or '—'} · 库位必填",
             extra=to_store)

    # ③ 待领料（车间在等；缺料的行要在卡片上说清楚）
    for mi in session.execute(
        select(MaterialIssue)
        .where(MaterialIssue.status.in_(("待备料", "已备料", "部分领料")))
        .order_by(MaterialIssue.id)
        .limit(2)
    ).scalars().all():
        n_lines = _count(
            session, select(func.count()).select_from(MaterialIssueLine).where(MaterialIssueLine.issue_id == mi.id)
        )
        n_short = _count(
            session,
            select(func.count())
            .select_from(MaterialIssueLine)
            .where(MaterialIssueLine.issue_id == mi.id, MaterialIssueLine.shortage.is_(True)),
        )
        _add("领料", "/m/issues", "/m/issues", mi.issue_no,
             f"{mi.project_no} {mi.equip_no or ''}".strip(),
             f"{n_lines} 种物料" + (f" · 缺 {n_short} 种" if n_short else ""),
             "warn" if n_short else None, extra=issues)

    # ④ 制造 / 装配 / 发运 / 现场 / 售后：各自取最早一条，够首页提示"还有别的活"
    for o in session.execute(
        select(ProdOrder).where(ProdOrder.status == PROD_WAIT).order_by(ProdOrder.id).limit(1)
    ).scalars().all():
        _add("待下发", "/m/production", "/m/production", o.order_no, o.item_name or o.item_no,
             f"{o.project_no} {o.equip_no or ''} · 交原材料 + 图纸（拍照）".strip(), extra=to_dispatch)
    for o in session.execute(
        select(ProdOrder).where(ProdOrder.status.in_((PROD_DISPATCHED, PROD_RUNNING))).order_by(ProdOrder.id).limit(1)
    ).scalars().all():
        _add("待验收零件", "/m/production", "/m/production", o.order_no, o.item_name or o.item_no,
             f"计划 {o.plan_end or '—'} · 合格后转运装配区", extra=to_accept)
    for a in session.execute(
        select(AssemblyRecord).where(AssemblyRecord.status == "装配中").order_by(AssemblyRecord.id).limit(1)
    ).scalars().all():
        _add("装配中", "/m/assembly", "/m/assembly", None, f"{a.project_no} {a.equip_no}",
             f"开工时齐套率 {round((a.kitting_rate or 0) * 100)}%", extra=assembling)
    for sh in session.execute(
        select(Shipment).where(Shipment.status.in_(("已指令", "打包中", "已装车"))).order_by(Shipment.id).limit(1)
    ).scalars().all():
        _add("发运待办", "/m/shipping", "/m/shipping", sh.shipment_no, sh.project_no or '',
             f"发货日 {sh.plan_ship_date or '—'} · 状态 {sh.status}", extra=shipments_open)
    for si in session.execute(
        select(SiteIssue).where(SiteIssue.status == "待处理").order_by(SiteIssue.id).limit(1)
    ).scalars().all():
        _add("现场问题", "/m/site", "/m/site", si.project_no, si.title,
             f"{si.project_no} {si.equip_no or ''}".strip(), tone="err", extra=site_open_issues)
    for c in session.execute(
        select(SiteCommission).where(SiteCommission.status == "已申请").order_by(SiteCommission.id).limit(1)
    ).scalars().all():
        _add("待派调试", "/m/site", "/m/site", c.project_no, c.project_no,
             f"派给 {c.dispatch_to or '—'} · 计划 {c.plan_date or '—'}", extra=site_to_dispatch)
    for so in session.execute(
        select(ServiceOrder).where(ServiceOrder.status != "已关闭").order_by(ServiceOrder.id).limit(1)
    ).scalars().all():
        _add("售后工单", "/m/service", "/m/service", so.so_no, so.fault or so.so_no,
             f"{so.project_no} {so.equip_no or ''} · {'在保' if so.in_warranty else '过保'}".strip(),
             "err" if so.status == "待受理" else None, extra=service_open)

    return {
        "user": {
            "id": current.id,
            "name": current.name,
            "profession": current.profession,
            "position": current.position,
        },
        "unread": unread,
        "tasks": tasks,
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
    # ★ N12：拆单时指明这批货是哪张采购单的（不猜）
    po_lines = session.scalars(
        select(PurchaseOrderLine).where(
            PurchaseOrderLine.request_id == request_id,
            PurchaseOrderLine.status.not_in(("已退货", "已取消")),
        )
    ).all()
    po_map = {p.id: p for p in session.scalars(select(PurchaseOrder)).all()}
    order_lines = [
        {
            "po_line_id": ln.id,
            "po_no": po_map[ln.po_id].po_no if ln.po_id in po_map else None,
            "supplier_name": po_map[ln.po_id].supplier_name if ln.po_id in po_map else None,
            "qty": float(ln.qty or 0),
            "received_qty": float(ln.received_qty or 0),
        }
        for ln in po_lines
    ]
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
        "lines": order_lines,
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
