"""验收与质保服务（《00 方案》§3.3 S10 · 《02 数据模型》§10）。

★ 质保闭环（自动）：客户确认验收 → `warranty_start = 验收确认日`
→ `warranty_end = warranty_start + warranty_months` → 到期提醒（同时提醒质保金可退）。
"""

from __future__ import annotations

import calendar
from datetime import UTC, date, datetime, timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.acceptance import ACC_APPLIED, ACC_PASSED, ACC_REJECTED, Acceptance, AcceptanceDocument
from app.models.initiation import ProjectMember
from app.models.project import Project
from app.models.site import COMMISSION_DONE, SiteCommission
from app.services import notify
from app.services import payment as payment_svc
from app.services import project_stage


class AcceptanceError(Exception):
    """验收业务规则错误。"""


def _now() -> datetime:
    return datetime.now(UTC)


def _add_months(d: date, months: int) -> date:
    """加 N 个月（不引第三方库：跨年 + 月末夹紧）。"""
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def team_ids(session: Session, project_no: str) -> set[int]:
    return {
        uid
        for uid in session.scalars(
            select(ProjectMember.user_id).where(ProjectMember.project_no == project_no)
        ).all()
        if uid
    }


def apply_acceptance(
    session: Session, *, project_no: str, actor_id: int, remark: str | None = None
) -> Acceptance:
    """调试完成 → 申请客户验收。"""
    existing = session.scalar(
        select(Acceptance).where(Acceptance.project_no == project_no, Acceptance.status == ACC_APPLIED)
    )
    if existing is not None:
        raise AcceptanceError("这个项目已经在申请验收中")
    # ★ N25：已通过验收的项目禁止重复申请 —— 重复确认会**覆盖质保起算日**（无留痕）
    passed = session.scalar(
        select(Acceptance.id)
        .where(Acceptance.project_no == project_no, Acceptance.status == ACC_PASSED)
        .limit(1)
    )
    if passed is not None:
        raise AcceptanceError(
            "这个项目已经通过客户验收（质保期已开始）—— 要重新验收请走变更/重开流程；"
            "重复申请会覆盖质保起算日"
        )
    project = session.get(Project, project_no)
    if project is None:
        raise AcceptanceError(f"项目不存在：{project_no}")
    # ★ 前置门禁（S9→S10）：必须已有「调试完成」的现场调试记录（P-05）
    done = session.scalar(
        select(SiteCommission.id)
        .where(SiteCommission.project_no == project_no, SiteCommission.status == COMMISSION_DONE)
        .limit(1)
    )
    if done is None:
        raise AcceptanceError("现场调试还没完成（S9）—— 先在现场台「申请调试」走到「调试完成」，再申请客户验收")
    row = Acceptance(
        project_no=project_no,
        applied_by=actor_id,
        applied_at=_now(),
        status=ACC_APPLIED,
        warranty_months=project.warranty_months if project else None,
        remark=remark,
    )
    session.add(row)
    session.flush()
    notify.notify_role(
        session,
        "SALES",
        type_="acceptance",
        title=f"申请客户验收：{project_no}",
        body="请准备验收资料包并联系客户签字确认。",
        link="/acceptance",
        biz_type="acceptance",
        biz_id=row.id,
        actor_id=actor_id,
    )
    notify.notify(
        session,
        team_ids(session, project_no),
        type_="acceptance",
        title=f"申请客户验收：{project_no}",
        body="调试完成，进入客户验收阶段。",
        link="/acceptance",
        biz_type="acceptance",
        biz_id=row.id,
        actor_id=actor_id,
    )
    return row


def confirm(
    session: Session,
    acc: Acceptance,
    *,
    actor_id: int,
    result: str,
    signed_by: str | None,
    accepted_at: date | None = None,
    remark: str | None = None,
) -> Acceptance:
    """客户确认验收。通过 → 自动进入质保期 + 项目阶段推进到「质保」。"""
    # ★ N25：已确认过的单不再重复确认（幂等拒绝），避免重复改写质保起算日
    if acc.status in (ACC_PASSED, ACC_REJECTED):
        raise AcceptanceError(f"这张验收单已经确认过（{acc.status}），不能重复确认")
    if result == "通过" and not (signed_by or "").strip():
        raise AcceptanceError("验收通过必须记录客户签字人")
    project = session.get(Project, acc.project_no)
    when = accepted_at or date.today()
    acc.accepted_at = _now()
    acc.signed_by = signed_by
    acc.result = result
    acc.status = ACC_PASSED if result == "通过" else ACC_REJECTED
    if remark:
        acc.remark = remark
    if result == "通过" and project is not None:
        months = acc.warranty_months or project.warranty_months or 12
        acc.warranty_months = months
        acc.warranty_start = when
        acc.warranty_end = _add_months(when, months)
        project.warranty_start = acc.warranty_start
        project.warranty_end = acc.warranty_end
        # 项目阶段：交付中 → 质保（若还在更早的阶段则依次补齐）
        for target in (project_stage.DELIVERING, project_stage.WARRANTY):
            try:
                project_stage.assert_transition(project.stage, target, allow_same=True)
            except project_stage.StageError:
                continue
            if project.stage != target:
                project.stage = target
        # ★ G2：验收通过 → **催商务部收「验收款」+「质保金」**（只提醒，不卡流程）
        payment_svc.trigger_for_acceptance(session, project.project_no)
    return acc


def document_dict(d: AcceptanceDocument) -> dict:
    return {
        "id": d.id,
        "acceptance_id": d.acceptance_id,
        "doc_type": d.doc_type,
        "filename": d.filename,
        "is_signed": d.is_signed,
        "signed_at": d.signed_at,
        "remark": d.remark,
    }


def acceptance_dict(session: Session, a: Acceptance) -> dict:
    docs = session.scalars(
        select(AcceptanceDocument)
        .where(AcceptanceDocument.acceptance_id == a.id)
        .order_by(AcceptanceDocument.id)
    ).all()
    project = session.get(Project, a.project_no)
    return {
        "id": a.id,
        "project_no": a.project_no,
        "project_name": project.project_name if project else None,
        "applied_at": a.applied_at,
        "accepted_at": a.accepted_at,
        "signed_by": a.signed_by,
        "result": a.result,
        "status": a.status,
        "warranty_months": a.warranty_months,
        "warranty_start": a.warranty_start,
        "warranty_end": a.warranty_end,
        "photos": a.photos or [],
        "remark": a.remark,
        "documents": [document_dict(d) for d in docs],
        "doc_count": len(docs),
        "signed_count": len([d for d in docs if d.is_signed]),
    }


def warranty_watch(session: Session, within_days: int = 60) -> list[dict]:
    """质保到期提醒（同时提醒质保金可退）。"""
    today = date.today()
    horizon = today + timedelta(days=within_days)
    rows = session.scalars(
        select(Project).where(
            Project.warranty_end.isnot(None),
            Project.warranty_end >= today,
            Project.warranty_end <= horizon,
        ).order_by(Project.warranty_end)
    ).all()
    out = []
    for p in rows:
        out.append(
            {
                "project_no": p.project_no,
                "project_name": p.project_name,
                "warranty_start": p.warranty_start,
                "warranty_end": p.warranty_end,
                "days_left": (p.warranty_end - today).days if p.warranty_end else None,
                "warranty_amount": float(p.warranty_amount) if p.warranty_amount is not None else None,
            }
        )
    return out
