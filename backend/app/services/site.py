"""现场域服务（《00 方案》§3.3 S8 · 《02 数据模型》§9）。

现场（客户工厂）以**手机为唯一终端**：勘测 → 验收来货（含直发）→ 每日汇报 → 申请调试。
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.initiation import GoodsReceipt, ProjectMember
from app.models.site import (
    COMMISSION_DONE,
    COMMISSION_ONSITE,
    COMMISSION_STARTED,
    ISSUE_CLOSED,
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
) -> SiteSurvey:
    row = SiteSurvey(
        project_no=project_no,
        surveyed_by=actor_id,
        surveyed_at=_now(),
        contact=body.get("contact"),
        floor_load=body.get("floor_load"),
        passage=body.get("passage"),
        power=body.get("power"),
        air=body.get("air"),
        network=body.get("network"),
        enter_date=body.get("enter_date"),
        photos=body.get("photos") or [],
        remark=body.get("remark"),
    )
    session.add(row)
    if body.get("enter_date"):
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
    return row


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


def add_issue(session: Session, *, project_no: str, actor_id: int, body: dict) -> SiteIssue:
    row = SiteIssue(
        project_no=project_no,
        equip_no=body.get("equip_no"),
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
) -> SiteCommission:
    row = SiteCommission(
        project_no=project_no,
        request_by=actor_id,
        request_at=_now(),
        dispatch_to=dispatch_to,
        plan_date=plan_date,
        status="已申请",
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
    return row


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
    if result == SITE_RECEIPT_OK:
        receipt.status = SITE_RECEIPT_DONE
        receipt.inspect_note = remark or (receipt.inspect_note or "")
    else:
        notify.notify(
            session,
            team_ids(session, receipt.project_no),
            type_="site",
            title=f"现场来货{result}：{receipt.project_no} {receipt.receipt_no}",
            body=f"物料 {receipt.item_no}：{remark or '请核对补发'}",
            link="/site",
            biz_type="goods_receipt",
            biz_id=receipt.id,
            actor_id=actor_id,
        )
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
