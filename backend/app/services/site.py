"""现场域服务（《00 方案》§3.3 S8 · 《02 数据模型》§9）。

现场（客户工厂）以**手机为唯一终端**：勘测 → 验收来货（含直发）→ 每日汇报 → 申请调试。
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.engineering import Drawing
from app.models.initiation import (
    GoodsReceipt,
    ProjectMember,
    PurchaseRequest,
    SOURCE_SITE_DAMAGED,
    SOURCE_SITE_SHORTAGE,
)
from app.models.library import Item
from app.models.site import (
    COMMISSION_DONE,
    COMMISSION_ONSITE,
    COMMISSION_STARTED,
    COMMISSION_WAIT,
    ISSUE_CLOSED,
    SITE_RECEIPT_DAMAGED,
    SITE_RECEIPT_OK,
    SiteCommission,
    SiteDaily,
    SiteIncoming,
    SiteIssue,
    SiteSurvey,
)
from app.services import notify

SITE_RECEIPT_PENDING = "现场待验收"
SITE_RECEIPT_DONE = "现场已验收"


class SiteError(Exception):
    """现场业务规则错误。"""


# ★ F9（2026-10-04 走查核实）：调试申请「未完成」的三种状态。
#   已有任一条时，再点「申请调试」不新建第二条（原地更新 + 复用），避免重复单/重复通知。
COMMISSION_OPEN = (COMMISSION_WAIT, COMMISSION_ONSITE, COMMISSION_STARTED)


def _now() -> datetime:
    return datetime.now(UTC)


def team_ids(session: Session, project_no: str) -> set[int]:
    return {
        uid
        for uid in session.scalars(
            select(ProjectMember.user_id).where(ProjectMember.project_no == project_no)
        ).all()
        if uid
    }


# --------------------------------------------------------------------------
# ① 勘测
# --------------------------------------------------------------------------


def save_survey(
    session: Session, *, project_no: str, actor_id: int, body: dict
) -> tuple[SiteSurvey, bool]:
    """现场勘测（S8）。★ F9（2026-10-04 走查核实）：**一个项目只保留一条勘测**。

    修前每点一次「现场勘测」就 insert 一条、并发一条通知（实测 4 条 + 4 条重复通知）。
    现在：已有勘测 → **原地更新**（重勘测 = 覆盖同一张事实卡），返回 `(row, reused=True)`；
    仅首次、或「约定入场时间」发生变化时才再发通知（重复点提交不再刷屏）。
    """
    row = session.scalars(
        select(SiteSurvey).where(SiteSurvey.project_no == project_no).order_by(SiteSurvey.id.desc())
    ).first()
    reused = row is not None
    old_enter = row.enter_date if row is not None else None
    if row is None:
        row = SiteSurvey(project_no=project_no)
        session.add(row)
    row.surveyed_by = actor_id
    row.surveyed_at = _now()
    row.contact = body.get("contact")
    row.floor_load = body.get("floor_load")
    row.passage = body.get("passage")
    row.power = body.get("power")
    row.air = body.get("air")
    row.network = body.get("network")
    row.enter_date = body.get("enter_date")
    row.photos = body.get("photos") or []
    row.remark = body.get("remark")
    if body.get("enter_date") and (not reused or body.get("enter_date") != old_enter):
        notify.notify(
            session,
            team_ids(session, project_no),
            type_="site",
            title=f"现场勘测完成：{project_no} 约定入场 {body['enter_date']}",
            body=f"现场负责人：{body.get('contact') or '—'}",
            link="/site",
            biz_type="project",
            actor_id=actor_id,
        )
    session.flush()
    return row, reused


# --------------------------------------------------------------------------
# ② 每日汇报
# --------------------------------------------------------------------------


def add_daily(session: Session, *, project_no: str, actor_id: int, body: dict) -> SiteDaily:
    row = SiteDaily(
        project_no=project_no,
        equip_no=body.get("equip_no"),
        report_date=body.get("report_date") or date.today(),
        stage=body.get("stage") or "安装",
        done_items=body.get("done_items") or [],
        people=body.get("people"),
        photos=body.get("photos") or [],
        videos=body.get("videos") or [],
        problem=body.get("problem"),
        reporter_id=actor_id,
        remark=body.get("remark"),
    )
    session.add(row)
    session.flush()
    return row


# --------------------------------------------------------------------------
# ③ 现场问题（→ 变更）
# --------------------------------------------------------------------------


def _resolve_part(
    session: Session, project_no: str, equip_no: str | None, drawing_no, item_no
) -> tuple[str | None, str | None, str | None]:
    """★ G3（09 卷 §3）：把问题挂到**具体零件**，并校验**归属**。

    客户口径 2026-09-28：“他肯定是反映这个零件…它是有归属的噱。”
    所以：图号必须属于**这个项目 + 这台设备**；物料号必须真实存在。
    :returns (drawing_no, item_no, part_name) —— part_name 自动补全（免回查）。
    """
    dn = (drawing_no or "").strip() or None
    itn = (item_no or "").strip() or None
    name: str | None = None
    if dn:
        d = session.get(Drawing, dn)
        if d is None:
            raise SiteError(f"零件不存在：图号 {dn}")
        if d.project_no != project_no:
            raise SiteError(f"这个零件不属于本项目：{dn}（属于 {d.project_no}）")
        if equip_no and d.equip_no != equip_no:
            raise SiteError(f"这个零件不属于这台设备：{dn}（属于 {d.equip_no}）")
        name = d.title
    if itn:
        item = session.get(Item, itn)
        if item is None:
            raise SiteError(f"零件不存在：物料号 {itn}")
        name = name or item.display_name
    return dn, itn, name


def add_issue(session: Session, *, project_no: str, actor_id: int, body: dict) -> SiteIssue:
    dn, itn, part_name = _resolve_part(
        session, project_no, body.get("equip_no"), body.get("drawing_no"), body.get("item_no")
    )
    row = SiteIssue(
        project_no=project_no,
        equip_no=body.get("equip_no"),
        drawing_no=dn,
        item_no=itn,
        part_name=body.get("part_name") or part_name,
        title=body["title"],
        desc=body.get("desc"),
        photos=body.get("photos") or [],
        status="待处理",
        created_by=actor_id,
    )
    session.add(row)
    session.flush()
    notify.notify(
        session,
        team_ids(session, project_no),
        type_="site",
        title=f"现场问题：{project_no} —— {row.title}",
        body=f"{row.desc or ''}（现场问题一律走变更审批）",
        link="/site",
        biz_type="site_issue",
        biz_id=row.id,
        actor_id=actor_id,
    )
    return row


def link_change(session: Session, row: SiteIssue, change_id: int | None) -> SiteIssue:
    row.status = "已转变更"
    row.related_change_id = change_id
    return row


def close_issue(session: Session, row: SiteIssue) -> SiteIssue:
    row.status = ISSUE_CLOSED
    row.closed_at = _now()
    return row


# --------------------------------------------------------------------------
# ④ 申请调试
# --------------------------------------------------------------------------


def request_commission(
    session: Session, *, project_no: str, actor_id: int, dispatch_to: str | None, plan_date: date | None, remark: str | None
) -> tuple[SiteCommission, bool]:
    """申请调试（S8）。★ F9（2026-10-04 走查核实）：**一个项目只允许一张「未完成」的调试申请**。

    修前重复点提交就多一条（实测 5 条）+ 每次都通知（连着 4 条重复消息）。
    现在：已有未完成（已申请/已到现场/已开始调试）→ **原地更新并复用**（不新建、不重复通知），
    返回 `(row, reused=True)`；推进到「调试完成」后才允许再开下一张（一次调试一批）。
    """
    open_row = session.scalars(
        select(SiteCommission)
        .where(SiteCommission.project_no == project_no, SiteCommission.status.in_(COMMISSION_OPEN))
        .order_by(SiteCommission.id.desc())
    ).first()
    if open_row is not None:
        if dispatch_to:
            open_row.dispatch_to = dispatch_to
        if plan_date:
            open_row.plan_date = plan_date
        if remark is not None:
            open_row.remark = remark
        session.flush()
        return open_row, True
    row = SiteCommission(
        project_no=project_no,
        request_by=actor_id,
        request_at=_now(),
        dispatch_to=dispatch_to,
        plan_date=plan_date,
        status=COMMISSION_WAIT,
        remark=remark,
    )
    session.add(row)
    session.flush()
    notify.notify_role(
        session,
        "ASSY",
        type_="site",
        title=f"申请调试：{project_no}（必须派人到现场）",
        body=f"计划 {plan_date or '待定'}，派 {dispatch_to or '待定'}",
        link="/site",
        biz_type="site_commission",
        biz_id=row.id,
        actor_id=actor_id,
    )
    notify.notify(
        session,
        team_ids(session, project_no),
        type_="site",
        title=f"现场申请调试：{project_no}",
        body=f"计划 {plan_date or '待定'}，派 {dispatch_to or '待定'}",
        link="/site",
        biz_type="site_commission",
        biz_id=row.id,
        actor_id=actor_id,
    )
    return row, False


def commission_arrive(session: Session, row: SiteCommission) -> SiteCommission:
    row.status = COMMISSION_ONSITE
    row.arrived_at = _now()
    return row


def commission_start(session: Session, row: SiteCommission) -> SiteCommission:
    row.status = COMMISSION_STARTED
    return row


def commission_finish(session: Session, row: SiteCommission) -> SiteCommission:
    """调试完成 → 可以申请客户验收（S10）。"""
    row.status = COMMISSION_DONE
    return row


# --------------------------------------------------------------------------
# ⑤ 现场到货验收（直发件）
# --------------------------------------------------------------------------


def accept_incoming(
    session: Session,
    receipt: GoodsReceipt,
    *,
    actor_id: int,
    result: str,
    shortage_detail: list | None,
    photos: list | None,
    remark: str | None = None,
) -> SiteIncoming:
    if not photos:
        raise SiteError("现场到货验收要拍照")
    if receipt.status not in (SITE_RECEIPT_PENDING, "待入库"):
        raise SiteError(f"这张到货单当前是「{receipt.status}」，不需要现场验收")
    row = SiteIncoming(
        project_no=receipt.project_no,
        receipt_id=receipt.id,
        result=result,
        shortage_detail=shortage_detail or [],
        photos=list(photos or []),
        received_by=actor_id,
        received_at=_now(),
        remark=remark,
    )
    session.add(row)
    if receipt.receipt_date is None:
        receipt.receipt_date = date.today()  # 现场清点完成即实际到货（08 §7）
    if result == SITE_RECEIPT_OK:
        receipt.status = SITE_RECEIPT_DONE
        receipt.inspect_note = remark or (receipt.inspect_note or "")
    else:
        # ★ N16：缺件/破损 → 到货单记「实到/缺口」，缺口回流采购侧（与仓库侧同构，不漏采）
        shortage_qty = sum(
            float(x.get("qty") or 0) for x in (shortage_detail or []) if isinstance(x, dict)
        )
        if shortage_qty <= 0:
            shortage_qty = float(receipt.qty or 0)
        receipt.qty_ok = max(0.0, float(receipt.qty or 0) - shortage_qty)
        receipt.qty_rejected = shortage_qty
        receipt.status = SITE_RECEIPT_DONE
        receipt.inspect_note = remark or (receipt.inspect_note or "")
        if receipt.request_id and shortage_qty > 0:
            req = session.get(PurchaseRequest, receipt.request_id)
            if req is not None:
                req.qty = max(0.0, float(req.qty or 0) - shortage_qty)
                retry = PurchaseRequest(
                    project_no=req.project_no,
                    equip_no=req.equip_no,
                    attribution=req.attribution,
                    item_no=req.item_no,
                    qty=shortage_qty,
                    unit=req.unit,
                    source=(SOURCE_SITE_DAMAGED if result == SITE_RECEIPT_DAMAGED else SOURCE_SITE_SHORTAGE),
                    lead_days=req.lead_days,
                    need_date=req.need_date,
                    status="待采购",
                    is_long_lead=req.is_long_lead,
                    origin_request_id=req.id,
                    remark=f"现场{result}重采（{receipt.receipt_no}）"
                    + (f"：{remark}" if remark else ""),
                )
                session.add(retry)
                session.flush()
                notify.notify_role(
                    session,
                    "PURCHASE",
                    type_=notify.TYPE_PURCHASE,
                    title=f"现场{result}，需补采：{req.item_no} × {shortage_qty:g}",
                    body=f"{req.project_no} {req.equip_no or ''}（{receipt.receipt_no}）",
                    link="/purchase",
                    biz_type="purchase_request",
                    biz_id=retry.id,
                    actor_id=actor_id,
                )
        notify.notify(
            session,
            team_ids(session, receipt.project_no),
            type_="site",
            title=f"现场来货{result}：{receipt.project_no} {receipt.receipt_no}",
            body=f"物料 {receipt.item_no}：{remark or '请核对补发'}（缺口 {shortage_qty:g} 已回采购池）",
            link="/site",
            biz_type="goods_receipt",
            biz_id=receipt.id,
            actor_id=actor_id,
        )
    # ★ 交期留痕（08 §7）：现场清点完成 = 实际到货
    from app.models.purchase_order import PurchaseOrderLine
    from app.services.purchase_order import recalc_delivery

    po_id = receipt.po_id
    if po_id is None and receipt.request_id:
        line = session.scalar(
            select(PurchaseOrderLine)
            .where(PurchaseOrderLine.request_id == receipt.request_id)
            .order_by(PurchaseOrderLine.id.desc())
        )
        po_id = line.po_id if line else None
    if po_id is not None:
        recalc_delivery(session, po_id)
    session.flush()
    return row


# --------------------------------------------------------------------------
# dict
# --------------------------------------------------------------------------


def survey_dict(r: SiteSurvey) -> dict:
    return {
        "id": r.id,
        "project_no": r.project_no,
        "surveyed_at": r.surveyed_at,
        "contact": r.contact,
        "floor_load": r.floor_load,
        "passage": r.passage,
        "power": r.power,
        "air": r.air,
        "network": r.network,
        "enter_date": r.enter_date,
        "photos": r.photos or [],
        "remark": r.remark,
    }


def daily_dict(r: SiteDaily) -> dict:
    return {
        "id": r.id,
        "project_no": r.project_no,
        "equip_no": r.equip_no,
        "report_date": r.report_date,
        "stage": r.stage,
        "done_items": r.done_items or [],
        "people": int(r.people) if r.people is not None else None,
        "photos": r.photos or [],
        "videos": r.videos or [],
        "problem": r.problem,
        "reporter_id": r.reporter_id,
        "remark": r.remark,
    }


def issue_dict(r: SiteIssue) -> dict:
    return {
        "id": r.id,
        "project_no": r.project_no,
        "equip_no": r.equip_no,
        "drawing_no": r.drawing_no,
        "item_no": r.item_no,
        "part_name": r.part_name,
        "title": r.title,
        "desc": r.desc,
        "photos": r.photos or [],
        "status": r.status,
        "related_change_id": r.related_change_id,
        "created_by": r.created_by,
        "closed_at": r.closed_at,
    }


def commission_dict(r: SiteCommission) -> dict:
    return {
        "id": r.id,
        "project_no": r.project_no,
        "request_by": r.request_by,
        "request_at": r.request_at,
        "dispatch_to": r.dispatch_to,
        "plan_date": r.plan_date,
        "arrived_at": r.arrived_at,
        "status": r.status,
        "remark": r.remark,
    }


def incoming_dict(r: SiteIncoming) -> dict:
    return {
        "id": r.id,
        "project_no": r.project_no,
        "receipt_id": r.receipt_id,
        "result": r.result,
        "shortage_detail": r.shortage_detail or [],
        "photos": r.photos or [],
        "received_at": r.received_at,
        "remark": r.remark,
    }
