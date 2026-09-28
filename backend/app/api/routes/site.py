"""现场域 API（《00 方案》§3.3 S8 · 《02 数据模型》§9）。

勘测 → 验收来货（含直发）→ 每日汇报（拍照/录视频）→ 申请调试；现场问题 → 变更。
权限：写 `site:edit`（现场服务 / 项目/交付也可按需开），读登录即可。
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user, has_permission, require_permission
from app.core.db import get_session
from app.models.initiation import GoodsReceipt, PurchaseRequest
from app.models.platform import User
from app.models.site import SITE_RECEIPT_RESULTS, SITE_STAGES, SiteCommission, SiteDaily, SiteIssue, SiteSurvey
from app.services import audit
from app.services import site as site_svc

router = APIRouter(prefix="/site", tags=["现场"])


def _can_site(current: User = Depends(get_current_user)) -> User:
    """现场写操作：现场服务（site:edit）或项目经理（project:edit）皆可。"""
    if not (has_permission(current, "site:edit") or has_permission(current, "project:edit")):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "没有权限：site:edit")
    return current


# --------------------------------------------------------------------------
# 照片（含录视频）
# --------------------------------------------------------------------------


@router.post("/photos", status_code=status.HTTP_201_CREATED)
async def upload_photos(
    request: Request,
    project_no: str = Query(...),
    ref: str | None = Query(default=None),
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    current: User = Depends(_can_site),
):
    from app.services.photos import save_photos

    out = await save_photos(files, project_no=project_no, area="site", ref=ref)
    audit.log(
        session, user=current, action="photos", object_type="site", object_ref=ref,
        summary=f"现场拍照/录像 {project_no}/{ref or ''}：{len(out)} 个", ip=client_ip(request),
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
# ① 勘测
# --------------------------------------------------------------------------


class SurveyIn(BaseModel):
    project_no: str
    contact: str | None = None
    floor_load: str | None = None
    passage: str | None = None
    power: str | None = None
    air: str | None = None
    network: str | None = None
    enter_date: date
    photos: list = Field(default_factory=list)
    remark: str | None = None


@router.post("/survey", status_code=status.HTTP_201_CREATED)
def save_survey(
    body: SurveyIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(_can_site),
):
    row = site_svc.save_survey(session, project_no=body.project_no, actor_id=current.id, body=body.model_dump())
    audit.log(
        session, user=current, action="site_survey", object_type="project", object_ref=body.project_no,
        summary=f"现场勘测：{body.project_no} 约定入场 {body.enter_date or '待定'}", ip=client_ip(request),
    )
    session.commit()
    return site_svc.survey_dict(row)


@router.get("/survey")
def list_survey(
    project_no: str = Query(...),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    rows = session.scalars(
        select(SiteSurvey).where(SiteSurvey.project_no == project_no).order_by(SiteSurvey.id.desc())
    ).all()
    return [site_svc.survey_dict(r) for r in rows]


# --------------------------------------------------------------------------
# ② 每日汇报
# --------------------------------------------------------------------------


class DailyIn(BaseModel):
    project_no: str
    equip_no: str | None = None
    report_date: date | None = None
    stage: str = "安装"
    done_items: list = Field(default_factory=list)
    people: int | None = None
    photos: list = Field(default_factory=list, description="每日汇报必须拍照留痕")
    videos: list = Field(default_factory=list)
    problem: str | None = None
    remark: str | None = None


@router.post("/daily", status_code=status.HTTP_201_CREATED)
def add_daily(
    body: DailyIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(_can_site),
):
    if body.stage not in SITE_STAGES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "阶段只能是 安装 / 单机调试 / 联调")
    if not body.photos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "每日汇报必须拍照留痕")
    row = site_svc.add_daily(session, project_no=body.project_no, actor_id=current.id, body=body.model_dump())
    audit.log(
        session, user=current, action="site_daily", object_type="project", object_ref=body.project_no,
        summary=f"现场每日汇报：{body.project_no} {body.stage}（{len(body.done_items)} 项，{len(body.photos)} 图 {len(body.videos)} 视频）",
        ip=client_ip(request),
    )
    session.commit()
    return site_svc.daily_dict(row)


@router.get("/daily")
def list_daily(
    project_no: str = Query(...),
    limit: int = 200,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    rows = session.scalars(
        select(SiteDaily)
        .where(SiteDaily.project_no == project_no)
        .order_by(SiteDaily.report_date.desc(), SiteDaily.id.desc())
        .limit(min(limit, 500))
    ).all()
    return [site_svc.daily_dict(r) for r in rows]


# --------------------------------------------------------------------------
# ③ 现场问题
# --------------------------------------------------------------------------


class IssueIn(BaseModel):
    project_no: str
    equip_no: str | None = None
    # ★ G3：挂到具体零件（图号 / 物料号），服务层会校验**归属**
    drawing_no: str | None = None
    item_no: str | None = None
    part_name: str | None = None
    title: str
    desc: str | None = None
    photos: list = Field(default_factory=list)


@router.post("/issues", status_code=status.HTTP_201_CREATED)
def add_issue(
    body: IssueIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(_can_site),
):
    row = site_svc.add_issue(session, project_no=body.project_no, actor_id=current.id, body=body.model_dump())
    audit.log(
        session, user=current, action="site_issue", object_type="project", object_ref=body.project_no,
        summary=f"现场问题：{body.project_no} —— {body.title}"
        + (f"（零件 {row.drawing_no or row.item_no}）" if (row.drawing_no or row.item_no) else ""),
        ip=client_ip(request),
    )
    session.commit()
    return site_svc.issue_dict(row)


@router.get("/issues")
def list_issues(
    project_no: str = Query(...),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    rows = session.scalars(
        select(SiteIssue).where(SiteIssue.project_no == project_no).order_by(SiteIssue.id.desc())
    ).all()
    return [site_svc.issue_dict(r) for r in rows]


class IssueLinkIn(BaseModel):
    change_id: int | None = None
    close: bool = False


@router.post("/issues/{issue_id}/link-change")
def link_change(
    issue_id: int,
    body: IssueLinkIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("site:edit")),
):
    row = session.get(SiteIssue, issue_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "现场问题不存在")
    if body.close:
        site_svc.close_issue(session, row)
    else:
        site_svc.link_change(session, row, body.change_id)
    audit.log(
        session, user=current, action="site_issue_update", object_type="site_issue", object_ref=str(issue_id),
        summary=f"现场问题 {issue_id} → {'已闭环' if body.close else '已转变更'}", ip=client_ip(request),
    )
    session.commit()
    return site_svc.issue_dict(row)


# --------------------------------------------------------------------------
# ④ 申请调试
# --------------------------------------------------------------------------


class CommissionIn(BaseModel):
    project_no: str
    dispatch_to: str = Field(..., description="派谁去（调试工程师）——必须派人到现场")
    plan_date: date | None = None
    remark: str | None = None


@router.post("/commission", status_code=status.HTTP_201_CREATED)
def request_commission(
    body: CommissionIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(_can_site),
):
    row = site_svc.request_commission(
        session, project_no=body.project_no, actor_id=current.id,
        dispatch_to=body.dispatch_to, plan_date=body.plan_date, remark=body.remark,
    )
    audit.log(
        session, user=current, action="site_commission", object_type="project", object_ref=body.project_no,
        summary=f"申请调试：{body.project_no}（派 {body.dispatch_to or '待定'}）", ip=client_ip(request),
    )
    session.commit()
    return site_svc.commission_dict(row)


@router.get("/commission")
def list_commission(
    project_no: str | None = None,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    stmt = select(SiteCommission).order_by(SiteCommission.id.desc())
    if project_no:
        stmt = stmt.where(SiteCommission.project_no == project_no)
    return [site_svc.commission_dict(r) for r in session.scalars(stmt.limit(200)).all()]


@router.post("/commission/{cid}/arrive")
def commission_arrive(
    cid: int,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("site:edit")),
):
    row = session.get(SiteCommission, cid)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "申请不存在")
    site_svc.commission_arrive(session, row)
    audit.log(
        session, user=current, action="site_commission_arrive", object_type="site_commission",
        object_ref=str(cid), summary=f"调试人员已到现场：{row.project_no}", ip=client_ip(request),
    )
    session.commit()
    return site_svc.commission_dict(row)


@router.post("/commission/{cid}/finish")
def commission_finish(
    cid: int,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("site:edit")),
):
    row = session.get(SiteCommission, cid)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "申请不存在")
    site_svc.commission_finish(session, row)
    audit.log(
        session, user=current, action="site_commission_finish", object_type="site_commission",
        object_ref=str(cid), summary=f"现场调试完成：{row.project_no}（可申请客户验收）", ip=client_ip(request),
    )
    session.commit()
    return site_svc.commission_dict(row)


@router.post("/commission/{cid}/start")
def commission_start(
    cid: int,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("site:edit")),
):
    row = session.get(SiteCommission, cid)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "申请不存在")
    site_svc.commission_start(session, row)
    audit.log(
        session, user=current, action="site_commission_start", object_type="site_commission",
        object_ref=str(cid), summary=f"现场调试开始：{row.project_no}", ip=client_ip(request),
    )
    session.commit()
    return site_svc.commission_dict(row)


# --------------------------------------------------------------------------
# ⑤ 现场到货验收（直发件）
# --------------------------------------------------------------------------


@router.get("/incoming")
def list_incoming(
    project_no: str = Query(...),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """待现场验收的直发件（+ 已验收记录）。"""
    pending = session.scalars(
        select(GoodsReceipt).where(
            GoodsReceipt.project_no == project_no,
            GoodsReceipt.deliver_to == "直发客户现场",
            GoodsReceipt.status == site_svc.SITE_RECEIPT_PENDING,
        )
    ).all()
    done = session.scalars(
        select(GoodsReceipt).where(
            GoodsReceipt.project_no == project_no,
            GoodsReceipt.deliver_to == "直发客户现场",
            GoodsReceipt.status == site_svc.SITE_RECEIPT_DONE,
        )
    ).all()
    return {
        "pending": [
            {
                "receipt_id": r.id, "receipt_no": r.receipt_no, "item_no": r.item_no,
                "qty": float(r.qty or 0), "unit": r.unit, "receipt_date": r.receipt_date,
                "deliver_to": r.deliver_to, "status": r.status, "location": r.location,
            }
            for r in pending
        ],
        "done": [
            {
                "receipt_id": r.id, "receipt_no": r.receipt_no, "item_no": r.item_no,
                "qty": float(r.qty or 0), "unit": r.unit, "status": r.status,
            }
            for r in done
        ],
    }


class IncomingAcceptIn(BaseModel):
    result: str = Field(..., description="齐 / 缺件 / 破损")
    shortage_detail: list = Field(default_factory=list)
    photos: list = Field(default_factory=list)
    remark: str | None = None


@router.post("/incoming/{receipt_id}/accept")
def accept_incoming(
    receipt_id: int,
    body: IncomingAcceptIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(_can_site),
):
    gr = session.get(GoodsReceipt, receipt_id)
    if gr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "到货单不存在")
    if body.result not in SITE_RECEIPT_RESULTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "验收结论只能是 齐 / 缺件 / 破损")
    try:
        row = site_svc.accept_incoming(
            session, gr, actor_id=current.id, result=body.result,
            shortage_detail=body.shortage_detail, photos=body.photos, remark=body.remark,
        )
    except site_svc.SiteError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="site_incoming", object_type="goods_receipt",
        object_ref=gr.receipt_no, summary=f"现场到货验收 {gr.receipt_no}：{body.result}", ip=client_ip(request),
    )
    # 反推采购需求状态（现场验收完这一批，需求可能就齐了）
    if gr.request_id:
        from app.api.routes.initiation import _recalc_request_status

        req = session.get(PurchaseRequest, gr.request_id)
        if req is not None:
            _recalc_request_status(session, req)
    session.commit()
    return site_svc.incoming_dict(row)


# --------------------------------------------------------------------------
# 工作台
# --------------------------------------------------------------------------


@router.get("/workbench")
def workbench(
    project_no: str | None = None,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    surveys = session.scalars(select(SiteSurvey).order_by(SiteSurvey.id.desc()).limit(50)).all()
    dailies = session.scalars(select(SiteDaily).order_by(SiteDaily.id.desc()).limit(100)).all()
    issues = session.scalars(select(SiteIssue).order_by(SiteIssue.id.desc()).limit(100)).all()
    commissions = session.scalars(select(SiteCommission).order_by(SiteCommission.id.desc()).limit(100)).all()
    if project_no:
        surveys = [r for r in surveys if r.project_no == project_no]
        dailies = [r for r in dailies if r.project_no == project_no]
        issues = [r for r in issues if r.project_no == project_no]
        commissions = [r for r in commissions if r.project_no == project_no]
    return {
        "counts": {
            "surveyed": len(surveys),
            "daily_today": len([d for d in dailies if d.report_date == date.today()]),
            "open_issues": len([i for i in issues if i.status == "待处理"]),
            "to_dispatch": len([c for c in commissions if c.status == "已申请"]),
            "debugging": len([c for c in commissions if c.status in ("已到现场", "已开始调试")]),
        },
        "surveys": [site_svc.survey_dict(r) for r in surveys],
        "dailies": [site_svc.daily_dict(r) for r in dailies],
        "issues": [site_svc.issue_dict(r) for r in issues],
        "commissions": [site_svc.commission_dict(r) for r in commissions],
    }
