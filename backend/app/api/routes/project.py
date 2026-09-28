"""项目域：商机登记 → 成交登记 → 资料包（见《00 方案·业务与建设》§3）。"""

import time
from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user, has_permission, require_permission, scrub_money
from app.api.schemas import (
    CloseIn,
    ContactIn,
    DealIn,
    ProjectCreateIn,
    ProjectOut,
    ProjectUpdateIn,
)
from app.core.config import settings
from app.core.db import get_session
from app.models.initiation import ProjectMember
from app.models.platform import User
from app.models.project import Attachment, Contact, Customer, PaymentTerm, Project
from app.services import audit, payment as payment_svc, project_stage
from app.services.reviewers import dept_code_of
from app.services.numbering import ObjectType, next_number, peek_number, year_scope_key

router = APIRouter(tags=["商机/项目"])


def _out(
    p: Project,
    customer_name: str | None = None,
    attachment_count: int = 0,
    attachments_brief: list[dict] | None = None,
    user_names: dict[int, str] | None = None,
) -> ProjectOut:
    data = ProjectOut.model_validate(p)
    data.customer_name = customer_name
    data.attachment_count = attachment_count
    data.attachments_brief = attachments_brief or []
    if user_names is not None:
        data.sales_name = user_names.get(p.sales_id) if p.sales_id else None
    today = date.today()

    # ① 商机剩余：商机列表看的就是这个 —— 客户要求何时把这件事定下来
    if p.deadline:
        data.opportunity_days_left = (p.deadline - today).days

    # ② 项目交期：签了合同才有起算日；没签约日就算不出应交日与剩余
    data.delivery_start = p.period_start
    due = p.delivery_end_date  # ★ 单一口径（与到期扫描共用），见 Project.delivery_end_date
    if due:
        data.delivery_end = due
        data.delivery_days_left = (due - today).days
    return data


@router.get("/projects/next-number")
def preview_project_no(
    session: Session = Depends(get_session), _: User = Depends(get_current_user)
) -> dict:
    """试算下一个项目编号（不消耗序列）。"""
    return {
        "project_no": peek_number(session, ObjectType.PROJECT, scope_key=year_scope_key())
    }


@router.post("/projects", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(
    body: ProjectCreateIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """新建商机：发号（TX{YY}{NNN}）→ 建客户（如不存在）→ 建项目档案 → 建联系人。"""
    customer = session.scalar(select(Customer).where(Customer.name == body.customer_name))
    if customer is None:
        customer = Customer(name=body.customer_name)
        session.add(customer)
        session.flush()

    project_no = next_number(
        session, ObjectType.PROJECT, scope_key=year_scope_key()
    )

    project = Project(
        project_no=project_no,
        project_name=body.project_name,
        customer_id=customer.id,
        received_docs=body.received_docs or None,
        project_desc=body.project_desc,
        deadline=body.deadline,
        delivery_days=body.delivery_days,
        deal_mode=body.deal_mode,
        source=body.source,
        site_address=body.site_address,
        is_retrofit=body.is_retrofit,
        product_type=body.product_type,
        required_cycle=body.required_cycle,
        required_capacity=body.required_capacity,
        est_amount=body.est_amount,
        expect_sign_date=body.expect_sign_date,
        competitor=body.competitor,
        related_project_no=body.related_project_no,
        performance_deposit=body.performance_deposit,
        performance_deposit_return_date=body.performance_deposit_return_date,
        performance_deposit_returned=body.performance_deposit_returned,
        risk_note=body.risk_note,
        sales_id=body.sales_id,  # ★ 商机归属（创建时必选销售负责人，商务全程可见该订单）
        stage="线索",
        created_by=current.id,
    )
    session.add(project)

    for c in body.contacts:
        session.add(
            Contact(
                customer_id=customer.id,
                name=c.name,
                title=c.title,
                phone=c.phone,
                wechat=c.wechat,
                email=c.email,
                role_tag=c.role_tag,
            )
        )

    audit.log(
        session,
        user=current,
        action="create",
        object_type="project",
        object_ref=project_no,
        summary=f"新建商机 {project_no}（{body.project_name}）",
        detail={"customer": body.customer_name, "deal_mode": body.deal_mode},
        ip=client_ip(request),
    )
    session.commit()
    return _out(project, customer.name)


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(
    stage: str | None = None,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    # ★ G1：惰性扫描 —— 质保期过的项目顺手自动归档（客户口径：“质保期过了就自动归档”）
    project_stage.archive_due_projects(session)
    stmt = select(Project).order_by(Project.created_at.desc())
    if stage:
        stmt = stmt.where(Project.stage == stage)
    rows = session.scalars(stmt).all()
    names = {c.id: c.name for c in session.scalars(select(Customer)).all()}
    user_names = {u.id: u.name for u in session.scalars(select(User)).all()}

    # 每个项目的资料：数量 + 前几份（列表里直接展示文件名，一眼看得出有什么）
    att_rows = session.execute(
        select(Attachment.project_no, Attachment.id, Attachment.filename, Attachment.category)
        .order_by(Attachment.project_no, Attachment.id.desc())
    ).all()
    grouped: dict[str, list[dict]] = {}
    for project_no, aid, filename, category in att_rows:
        grouped.setdefault(project_no, []).append(
            {"id": aid, "filename": filename, "category": category}
        )

    out = [
        _out(
            r,
            names.get(r.customer_id),
            len(grouped.get(r.project_no, [])),
            grouped.get(r.project_no, [])[:4],
            user_names,
        )
        for r in rows
    ]
    if not has_permission(current, "project:amount"):
        for o in out:
            o.amount = None
            o.est_amount = None
            o.performance_deposit = None
            o.warranty_amount = None
    return out


@router.get("/projects/{project_no}", response_model=ProjectOut)
def get_project(
    project_no: str,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    # ★ G1：惰性扫描（看详情时也顺手归档一次，保证任何入口看到的阶段都是最新）
    project_stage.archive_due_projects(session)
    row = session.get(Project, project_no)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")
    customer = session.get(Customer, row.customer_id)
    count = session.scalar(
        select(func.count()).select_from(Attachment).where(Attachment.project_no == project_no)
    )
    user_names = {u.id: u.name for u in session.scalars(select(User)).all()}
    out = _out(row, customer.name if customer else None, count or 0, None, user_names)
    # ★ 金额分档（06 卷 F 步）：无 project:amount 的角色不得看到合同/预估/质保金（与列表接口一致）
    if not has_permission(current, "project:amount"):
        out.amount = None
        out.est_amount = None
        out.performance_deposit = None
        out.warranty_amount = None
    return out


# ---------------------------------------------------------------------------
# 成交登记 / 关闭订单（阶段状态机，见 00 卷 §3）
# ---------------------------------------------------------------------------

DEAL_FIELD_LABELS: dict[str, str] = {
    "period_start": "合同签订日",
    "period_end": "合同交期",
    "amount": "合同金额",
    "amount_tax_incl": "合同金额含税",
    "contract_no_customer": "客户合同号",
    "warranty_months": "质保期（月）",
    "warranty_amount": "质保金",
    "penalty_note": "交期与违约条款",
    "acceptance_standard": "验收标准",
    "designated_brand": "甲方指定品牌/供应商",
    "delivery_mode": "交货方式与地点",
    "site_condition": "客户现场接收条件",
    "is_batch_delivery": "是否分批交付",
    "tech_agreement_frozen": "技术协议冻结",
}


@router.post("/projects/{project_no}/deal")
def register_deal(
    project_no: str,
    body: DealIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
) -> dict:
    """成交登记：登记周期 / 金额 / 付款方式 / 质保，阶段 线索 → 成交待立项。"""
    project = session.get(Project, project_no)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")
    # 只有「线索」阶段的商机可以做成交登记 —— 否则重复提交会把已登记的数据覆盖成空
    if project.stage != project_stage.LEAD:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"只有「线索」阶段的商机可以做成交登记（当前阶段：{project.stage}）",
        )

    changes: list[dict] = []
    for field, new_value in body.model_dump(exclude={"payment_terms"}).items():
        old_value = getattr(project, field, None)
        if old_value == new_value:
            continue
        changes.append(
            {
                "field": field,
                "label": DEAL_FIELD_LABELS.get(field, field),
                "old": _fmt(old_value),
                "new": _fmt(new_value),
            }
        )
        setattr(project, field, new_value)

    # 付款节点整体替换；有比例没金额的，按合同金额自动折算
    session.execute(delete(PaymentTerm).where(PaymentTerm.project_no == project_no))
    total = 0.0
    warranty_from_terms = 0.0
    for i, t in enumerate(body.payment_terms, start=1):
        amount = float(t.amount or 0)
        if not amount and t.percent and body.amount:
            amount = float(body.amount) * float(t.percent) / 100
        total += amount
        # 质保金 = 付款节点里名字含「质保」的那一条（客户扣留、质保期满才付）
        if "质保" in t.node_name and amount:
            warranty_from_terms += amount
        session.add(
            PaymentTerm(
                project_no=project_no,
                seq=i,
                node_name=t.node_name,
                # ★ G2：把付款节点绑到业务节点（显式优先，否则按名字推断）
                trigger_node=payment_svc.normalize_trigger(t.trigger_node, t.node_name),
                percent=t.percent,
                amount=amount or None,
                expect_date=t.expect_date,
                condition=t.condition,
            )
        )

    # 质保金自动取自付款节点 —— 不需要人重复填
    if warranty_from_terms:
        old_wa = project.warranty_amount
        project.warranty_amount = warranty_from_terms
        changes.append(
            {
                "field": "warranty_amount",
                "label": "质保金（客户扣留，质保期满退）",
                "old": _fmt(old_wa),
                "new": _fmt(warranty_from_terms),
            }
        )

    if project.stage != project_stage.WON_PENDING:
        changes.append(
            {"field": "stage", "label": "阶段", "old": project.stage, "new": project_stage.WON_PENDING}
        )
        project.stage = project_stage.WON_PENDING

    summary = f"成交登记 {project_no}：" + "；".join(
        f"{c['label']} {c['old']} → {c['new']}" for c in changes
    )
    if body.payment_terms:
        summary += f"；付款节点 {len(body.payment_terms)} 条（合计 ¥{total:,.0f}）"
    audit.log(
        session,
        user=current,
        action="deal",
        object_type="project",
        object_ref=project_no,
        summary=summary,
        detail={"changes": changes},
        ip=client_ip(request),
    )
    session.commit()
    customer = session.get(Customer, project.customer_id)
    return {
        "project": _out(project, customer.name if customer else None).model_dump(),
        "payment_terms": len(body.payment_terms),
        "total": total,
    }


@router.post("/projects/{project_no}/close")
def close_project(
    project_no: str,
    body: CloseIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("project:close")),
) -> dict:
    """关闭订单（需填关闭原因），阶段 → 已关闭。**仅商务部**（客户口径 2026-09-28）。"""
    project = session.get(Project, project_no)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")
    assert_sales_owned(session, current, {"stage", "close_reason", "close_note"})
    if body.close_reason not in project_stage.CLOSE_REASONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"关闭原因必须是：{'/'.join(project_stage.CLOSE_REASONS)}",
        )
    try:
        project_stage.assert_transition(project.stage, project_stage.CLOSED)
    except project_stage.StageError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    old_stage = project.stage
    project.stage = project_stage.CLOSED
    project.close_reason = body.close_reason
    project.close_note = body.close_note
    audit.log(
        session,
        user=current,
        action="close",
        object_type="project",
        object_ref=project_no,
        summary=f"关闭订单 {project_no}（{body.close_reason}）：阶段 {old_stage} → 已关闭",
        detail={
            "changes": [
                {"field": "stage", "label": "阶段", "old": old_stage, "new": "已关闭"},
                {
                    "field": "close_reason",
                    "label": "关闭原因",
                    "old": "—",
                    "new": body.close_reason,
                },
            ]
        },
        ip=client_ip(request),
    )
    session.commit()
    customer = session.get(Customer, project.customer_id)
    return _out(project, customer.name if customer else None).model_dump()


# ---------------------------------------------------------------------------
# 资料包（方案 / 报价 / 合同 / 技术协议 / 客户资料）—— 只存文件，不建审批流
# ---------------------------------------------------------------------------


def _attachment_dict(row: Attachment) -> dict:
    return {
        "id": row.id,
        "category": row.category,
        "filename": row.filename,
        "size": row.size,
        "version": row.version,
        "is_frozen": row.is_frozen,
        "uploaded_at": row.uploaded_at,
    }


# 浏览器可直接渲染的类型（其余只能下载）
MEDIA_TYPES = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "bmp": "image/bmp",
    "svg": "image/svg+xml",
    "txt": "text/plain; charset=utf-8",
    "md": "text/plain; charset=utf-8",
    "csv": "text/plain; charset=utf-8",
    "json": "application/json",
    "log": "text/plain; charset=utf-8",
    "xml": "text/plain; charset=utf-8",
}


def _guess_media_type(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return MEDIA_TYPES.get(ext, "application/octet-stream")


@router.get("/projects/{project_no}/detail")
def get_project_detail(
    project_no: str, session: Session = Depends(get_session), current: User = Depends(get_current_user)
) -> dict:
    """详情抽屉一次拉齐：基本信息 + 联系人 + 资料包 + 付款节点 + 操作记录。"""
    project = session.get(Project, project_no)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")
    customer = session.get(Customer, project.customer_id)
    contacts = session.scalars(
        select(Contact).where(Contact.customer_id == project.customer_id).order_by(Contact.id)
    ).all()
    atts = session.scalars(
        select(Attachment).where(Attachment.project_no == project_no).order_by(Attachment.id.desc())
    ).all()
    terms = session.scalars(
        select(PaymentTerm).where(PaymentTerm.project_no == project_no).order_by(PaymentTerm.seq)
    ).all()

    def _user_name(uid: int | None) -> str | None:
        if not uid:
            return None
        u = session.get(User, uid)
        return u.name if u else None

    result = {
        "project": _out(project, customer.name if customer else None).model_dump(),
        "contacts": [
            {
                "id": c.id,
                "name": c.name,
                "title": c.title,
                "phone": c.phone,
                "wechat": c.wechat,
                "email": c.email,
                "role_tag": c.role_tag,
            }
            for c in contacts
        ],
        "attachments": [_attachment_dict(a) for a in atts],
        "payment_terms": [
            {
                "seq": t.seq,
                "node_name": t.node_name,
                "trigger_node": t.trigger_node,  # ★ G2：这个款由哪个业务节点提醒
                "percent": float(t.percent) if t.percent is not None else None,
                "amount": float(t.amount) if t.amount is not None else None,
                "expect_date": t.expect_date,
                "condition": t.condition,
                "received_amount": float(t.received_amount) if t.received_amount is not None else None,
                "received_date": t.received_date,
            }
            for t in terms
        ],
        "sales_name": _user_name(project.sales_id),
        "pm_name": _user_name(project.pm_id),
    }
    return result if has_permission(current, "project:amount") else scrub_money(result)


# ---------------------------------------------------------------------------
# 编辑项目 + 字段级变更留痕（谁、何时、从什么改成什么）
# ---------------------------------------------------------------------------

PROJECT_FIELD_LABELS: dict[str, str] = {
    "project_name": "项目名称",
    "project_desc": "项目描述",
    "deadline": "商机截止时间",
    "delivery_days": "项目交期（天）",
    "deal_mode": "项目方式",
    "source": "线索来源",
    "site_address": "项目地点",
    "is_retrofit": "是否旧线改造",
    "product_type": "客户产品类型",
    "required_cycle": "要求节拍",
    "required_capacity": "要求产能",
    "est_amount": "预计金额",
    "expect_sign_date": "预计签单时间",
    "competitor": "竞争对手",
    "related_project_no": "关联历史项目",
    "risk_note": "风险标记",
    "sales_id": "销售负责人",
    "performance_deposit": "履约保证金",
    "performance_deposit_return_date": "履约保证金预计退还日期",
    "performance_deposit_returned": "履约保证金已退还",
    "received_docs": "接收到的资料",
    "amount": "合同金额",
    "amount_tax_incl": "合同金额含税",
    "contract_no_customer": "客户合同号",
    "tech_agreement_frozen": "技术协议冻结",
    "warranty_amount": "质保金（客户扣留）",
    "period_start": "合同签订日",
    "period_end": "合同交期",
    "warranty_months": "质保期（月）",
    "pm_id": "项目经理",
    "stage": "阶段",
    "close_reason": "关闭原因",
    "close_note": "关闭备注",
}


CONTACT_FIELD_LABELS: dict[str, str] = {
    "name": "姓名",
    "title": "职务",
    "phone": "电话",
    "wechat": "微信",
    "email": "邮箱",
    "role_tag": "角色",
}


def _fmt(v: object) -> str:
    """变更留痕用的人类可读格式。"""
    if v is None or v == "":
        return "—"
    if isinstance(v, bool):
        return "是" if v else "否"
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, list):
        return "、".join(str(x) for x in v) if v else "—"
    if isinstance(v, float):
        return f"{v:,.2f}".rstrip("0").rstrip(".")
    return str(v)


def _contact_dict(c: Contact) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "title": c.title,
        "phone": c.phone,
        "wechat": c.wechat,
        "email": c.email,
        "role_tag": c.role_tag,
    }


def _diff(changes: list[dict], source: object, payload: dict, labels: dict[str, str]) -> None:
    """比较新旧值，把变化追加到 changes，并写回对象。"""
    for field, new_value in payload.items():
        old_value = getattr(source, field, None)
        if old_value == new_value:
            continue
        changes.append(
            {
                "field": field,
                "label": labels.get(field, field),
                "old": _fmt(old_value),
                "new": _fmt(new_value),
            }
        )
        setattr(source, field, new_value)


def _sync_pm_member(session: Session, project: Project, pm_id: int | None) -> str | None:
    """★ M-02（第八轮 §3）：`project.pm_id` 必须与项目角色「项目经理」同步（AGENTS §8.1）。

    任命/解绑走团队成员接口时会同步，但通用 `PATCH /projects {pm_id}` 以前漏了
    → 一个项目两个真相：通知发给新 `pm_id`，团队里挂的还是旧人。
    返回一句审计说明（没变化返回 None）。
    """
    row = session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_no == project.project_no,
            ProjectMember.project_role == "项目经理",
        )
    )
    if pm_id is None:
        if row is not None:
            session.delete(row)
            return "解除「项目经理」项目角色"
        return None
    if row is not None and row.user_id == pm_id:
        return None
    if row is None:
        session.add(
            ProjectMember(project_no=project.project_no, user_id=pm_id, project_role="项目经理")
        )
        return f"任命 {pm_id} 为「项目经理」"
    old = row.user_id
    row.user_id = pm_id
    return f"「项目经理」{old} → {pm_id}"


# ★ 商务部专属字段（商机 + 成交/合同 + 阶段/关闭）—— 其他部门不得修改
#   客户口径 2026-09-28：“商务部写的商机内容，其他部门的人就不可以去修改”；关闭项目权限也在商务部。
#   注：执行类（pm_id、等）不在内 —— 项目管理仍可改。
SALES_OWNED_FIELDS = frozenset({
    # 商机
    "customer_name", "project_name", "project_desc", "deadline", "delivery_days", "deal_mode",
    "source", "site_address", "is_retrofit", "product_type", "required_cycle",
    "required_capacity", "est_amount", "expect_sign_date", "competitor",
    "related_project_no", "risk_note", "sales_id", "received_docs",
    "performance_deposit", "performance_deposit_return_date", "performance_deposit_returned",
    # 成交 / 合同
    "amount", "amount_tax_incl", "period_start", "period_end", "contract_no_customer",
    "warranty_months", "warranty_amount", "penalty_note", "acceptance_standard",
    "designated_brand", "delivery_mode", "site_condition", "is_batch_delivery",
    "tech_agreement_frozen",
    # 阶段 / 关闭
    "stage", "close_reason", "close_note",
})


def assert_sales_owned(session: Session, user: User, touched: set[str]) -> None:
    """跟部门硬拦：商机/合同类字段只能**商务部**改（客户口径 2026-09-28）。

    `contract:edit` 只有 SALES 拥有，作为等价的放行条件（避免把部门树写死）。
    """
    bad = sorted(touched & SALES_OWNED_FIELDS)
    if not bad:
        return
    if has_permission(user, "contract:edit") or dept_code_of(session, user) == "SALES":
        return
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        f"这些内容属商务部：{'、'.join(bad)} —— 其他部门不能改（找商务/销售负责人）",
    )


@router.patch("/projects/{project_no}", response_model=ProjectOut)
def update_project(
    project_no: str,
    body: ProjectUpdateIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("project:edit")),
):
    """编辑项目（部分更新）。每次修改都落操作记录，含 旧值 → 新值。"""
    project = session.get(Project, project_no)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")

    payload = body.model_dump(exclude_unset=True)
    project_stage.assert_writable(project)  # ★ G1：已归档项目只读
    assert_sales_owned(session, current, set(payload))   # ★ N22：商机/合同类字段只能商务部改
    customer = session.get(Customer, project.customer_id)
    changes: list[dict] = []

    # 客户名称改了 → 换客户（没有就新建）
    new_customer_name = payload.pop("customer_name", None)
    if new_customer_name and new_customer_name != (customer.name if customer else None):
        target = session.scalar(select(Customer).where(Customer.name == new_customer_name))
        if target is None:
            target = Customer(name=new_customer_name)
            session.add(target)
            session.flush()
        changes.append(
            {
                "field": "customer_name",
                "label": "客户",
                "old": _fmt(customer.name if customer else None),
                "new": _fmt(new_customer_name),
            }
        )
        project.customer_id = target.id
        customer = target

    _diff(changes, project, payload, PROJECT_FIELD_LABELS)

    # ★ M-02：pm_id 变了要把项目角色「项目经理」一起换（否则两个真相）
    if "pm_id" in payload:
        sync = _sync_pm_member(session, project, project.pm_id)
        if sync:
            changes.append(
                {"field": "project_role_pm", "label": "项目角色·项目经理", "old": "—", "new": sync}
            )

    if not changes:
        return _out(project, customer.name if customer else None)

    summary = f"编辑 {project_no}：" + "；".join(
        f"{c['label']} {c['old']} → {c['new']}" for c in changes
    )
    audit.log(
        session,
        user=current,
        action="update",
        object_type="project",
        object_ref=project_no,
        summary=summary,
        detail={"changes": changes},
        ip=client_ip(request),
    )
    session.commit()
    return _out(project, customer.name if customer else None)


@router.post("/projects/{project_no}/contacts", status_code=status.HTTP_201_CREATED)
def create_contact(
    project_no: str,
    body: ContactIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("project:edit")),
) -> dict:
    """新增联系人（挂在项目的客户下）。"""
    project = session.get(Project, project_no)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")
    row = Contact(
        customer_id=project.customer_id,
        name=body.name,
        title=body.title,
        phone=body.phone,
        wechat=body.wechat,
        email=body.email,
        role_tag=body.role_tag,
    )
    session.add(row)
    session.flush()
    audit.log(
        session,
        user=current,
        action="create",
        object_type="contact",
        object_ref=project_no,
        summary=f"新增联系人 {body.name}（{body.role_tag or '—'}）",
        ip=client_ip(request),
    )
    session.commit()
    return _contact_dict(row)


@router.patch("/projects/{project_no}/contacts/{contact_id}")
def update_contact(
    project_no: str,
    contact_id: int,
    body: ContactIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
) -> dict:
    """编辑联系人（字段级留痕）。"""
    project = session.get(Project, project_no)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")
    row = session.get(Contact, contact_id)
    if row is None or row.customer_id != project.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "联系人不存在")

    changes: list[dict] = []
    _diff(changes, row, body.model_dump(), CONTACT_FIELD_LABELS)
    if changes:
        summary = f"编辑联系人 {row.name}：" + "；".join(
            f"{c['label']} {c['old']} → {c['new']}" for c in changes
        )
        audit.log(
            session,
            user=current,
            action="update",
            object_type="contact",
            object_ref=project_no,
            summary=summary,
            detail={"changes": changes},
            ip=client_ip(request),
        )
    session.commit()
    return _contact_dict(row)


@router.get("/projects/{project_no}/attachments")
def list_attachments(
    project_no: str, session: Session = Depends(get_session), _: User = Depends(get_current_user)
) -> list[dict]:
    rows = session.scalars(
        select(Attachment).where(Attachment.project_no == project_no).order_by(Attachment.id.desc())
    ).all()
    return [_attachment_dict(r) for r in rows]


@router.post("/projects/{project_no}/attachments", status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    project_no: str,
    request: Request,
    category: str = Form("客户资料"),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
) -> dict:
    """上传资料（图纸 / 合同 / 技术协议 / 客户资料）。"""
    if session.get(Project, project_no) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")

    safe_name = Path(file.filename or "file").name
    target_dir = Path(settings.upload_dir) / project_no
    target_dir.mkdir(parents=True, exist_ok=True)
    stored = target_dir / f"{int(time.time())}_{safe_name}"
    content = await file.read()
    stored.write_bytes(content)

    row = Attachment(
        project_no=project_no,
        category=category,
        filename=safe_name,
        stored_path=str(stored),
        size=len(content),
        uploaded_by=current.id,
    )
    session.add(row)
    session.flush()
    audit.log(
        session,
        user=current,
        action="create",
        object_type="attachment",
        object_ref=project_no,
        summary=f"上传资料《{safe_name}》（{category}）",
        detail={"size": len(content), "category": category},
        ip=client_ip(request),
    )
    session.commit()
    return _attachment_dict(row)


@router.get("/projects/{project_no}/attachments/{attachment_id}/download")
def download_attachment(
    project_no: str,
    attachment_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """下载资料（资料挂在这个商机下，随时能取）。"""
    row = session.get(Attachment, attachment_id)
    if row is None or row.project_no != project_no:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "资料不存在")
    path = Path(row.stored_path)
    if not path.exists():
        raise HTTPException(status.HTTP_410_GONE, "文件已不存在")
    return FileResponse(path, filename=row.filename)


@router.get("/projects/{project_no}/attachments/{attachment_id}/preview")
def preview_attachment(
    project_no: str,
    attachment_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """在线预览（inline）：图片 / PDF / 文本浏览器直接渲染，其他格式提示下载。"""
    row = session.get(Attachment, attachment_id)
    if row is None or row.project_no != project_no:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "资料不存在")
    path = Path(row.stored_path)
    if not path.exists():
        raise HTTPException(status.HTTP_410_GONE, "文件已不存在")
    return FileResponse(path, media_type=_guess_media_type(row.filename))


@router.post("/projects/{project_no}/payment-terms/{seq}/receive")
def receive_payment(
    project_no: str,
    seq: int,
    request: Request,
    received_amount: float | None = Form(default=None, description="本次实收金额；不填=按节点剩余全额"),
    received_date: date | None = Form(default=None),
    remark: str | None = Form(default=None),
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("payment:edit")),
):
    """登记回款（可多次累加）：某个付款节点收到一笔款。

    权限：`payment:edit`（销售/商务、财务）。
    """
    row = session.scalar(
        select(PaymentTerm).where(PaymentTerm.project_no == project_no, PaymentTerm.seq == seq)
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "付款节点不存在")
    remaining = max(0.0, float(row.amount or 0) - float(row.received_amount or 0))
    amount = float(received_amount) if received_amount is not None else remaining
    if amount <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "这个节点没有待收金额了")
    if amount > remaining + 1e-6:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"本次回款 {amount:g} 超过该节点未收金额 {remaining:g}",
        )
    row.received_amount = float(row.received_amount or 0) + amount
    row.received_date = received_date or date.today()
    if remark:
        row.remark = (f"{row.remark} {remark}" if row.remark else remark)[:255]
    audit.log(
        session,
        user=current,
        action="receive_payment",
        object_type="project",
        object_ref=project_no,
        summary=f"登记回款：{project_no} 节点{seq} {row.node_name} +¥{amount:,.2f}"
        + (f"（累计 {float(row.received_amount):,.2f}/{float(row.amount or 0):,.2f}）" if row.amount else ""),
        detail={"seq": seq, "amount": amount, "received_date": str(row.received_date)},
        ip=client_ip(request),
    )
    session.commit()
    return {
        "ok": True,
        "seq": seq,
        "node_name": row.node_name,
        "received_amount": float(row.received_amount or 0),
        "received_date": row.received_date,
        "unpaid": max(0.0, float(row.amount or 0) - float(row.received_amount or 0)),
    }
