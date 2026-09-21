"""工作台框架（06 卷 §8）：按角色算「我能进哪些工作台」+ 待办数字 + 我的项目。

一个节点一个工作台；登录默认落在「我的工作台」。
本模块只做**汇总**（我的工作台用），各工作台页面的详细内容随后续步骤补齐。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_session
from app.models.change import CR_ACTIVE, CR_PENDING, ChangeRequest
from app.models.initiation import GoodsReceipt, ProjectMember, PurchaseRequest
from app.models.platform import POSITION_DIRECTOR, POSITION_LEAD, Org, User
from app.models.project import Project
from app.models.review import TICKET_PENDING_DIRECTOR, TICKET_PENDING_LEAD, ReviewTicket
from app.models.task import Task
from app.models.warehouse import MaterialIssue
from app.services import notify

router = APIRouter(prefix="/workbench", tags=["工作台"])

TO_INSPECT = ("在途", "已下单", "部分到货")
LEAD_STAGES = ("线索", "成交待立项")

# 工作台定义（06 卷 §5）：key / 名称 / 路由 / 由哪些角色看得见
WORKBENCHES: list[dict] = [
    {"key": "mine", "name": "我的工作台", "route": "/workbench", "roles": None},
    {"key": "sales", "name": "商务部工作台", "route": "/workbench/sales", "roles": ("SALES", "SCHEME")},
    {"key": "pm", "name": "项目经理台", "route": "/workbench/pm", "roles": ("PM",)},
    {"key": "eng", "name": "工程部工作台", "route": "/workbench/eng", "roles": ("DESIGN", "DESIGN_AUDIT", "CRAFT")},
    {"key": "purchase", "name": "采购工作台", "route": "/purchase", "roles": ("PURCHASE", "PURCHASE_LEAD")},
    {"key": "warehouse", "name": "仓库工作台", "route": "/warehouse", "roles": ("WAREHOUSE",)},
    {"key": "shop", "name": "车间工作台", "route": "/workbench/shop", "roles": ("MFG", "ASSY", "QC")},
]


def _count(session: Session, stmt) -> int:
    return int(session.scalar(stmt) or 0)


def _my_project_nos(session: Session, user: User) -> list[str]:
    """我参与的项目：项目经理 / 销售负责人 / 项目团队成员。"""
    rows = session.execute(
        select(Project.project_no)
        .outerjoin(ProjectMember, ProjectMember.project_no == Project.project_no)
        .where(or_(Project.pm_id == user.id, Project.sales_id == user.id, ProjectMember.user_id == user.id))
        .distinct()
        .order_by(Project.project_no.desc())
    ).all()
    return [r[0] for r in rows]


def _visible(session: Session, user: User) -> set[str]:
    if user.is_superuser:
        return {w["key"] for w in WORKBENCHES}
    codes = {r.code for r in user.roles}
    out = {"mine"}
    for w in WORKBENCHES:
        if w["roles"] and codes & set(w["roles"]):
            out.add(w["key"])
    return out


@router.get("/me")
def workbench_me(session: Session = Depends(get_session), current: User = Depends(get_current_user)):
    codes = {r.code for r in current.roles}
    is_top = current.is_superuser or current.position == POSITION_DIRECTOR

    my_tasks = _count(
        session,
        select(func.count())
        .select_from(Task)
        .where(Task.owner_id == current.id, Task.status.not_in(("已完成", "已取消"))),
    )
    if current.is_superuser or current.position == POSITION_DIRECTOR:
        to_review = _count(
            session,
            select(func.count())
            .select_from(ReviewTicket)
            .where(ReviewTicket.status == TICKET_PENDING_DIRECTOR),
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
    else:
        to_review = 0

    to_decide = _count(
        session,
        select(func.count()).select_from(ChangeRequest).where(ChangeRequest.status == CR_PENDING),
    ) if is_top else 0
    my_changes = _count(
        session,
        select(func.count())
        .select_from(ChangeRequest)
        .where(ChangeRequest.applicant_id == current.id, ChangeRequest.status.in_(CR_ACTIVE)),
    )
    to_change = _count(
        session,
        select(func.count())
        .select_from(Task)
        .where(
            Task.ref_type == "change_request",
            Task.owner_id == current.id,
            Task.status.not_in(("已完成", "已取消")),
        ),
    )
    # 仓库/采购的待办只给相关角色看（避免设计看到“待入库”）
    is_warehouse = current.is_superuser or bool(codes & {"WAREHOUSE"})
    is_purchase = current.is_superuser or bool(codes & {"PURCHASE", "PURCHASE_LEAD"})
    to_inspect = _count(
        session,
        select(func.count())
        .select_from(PurchaseRequest)
        .where(
            PurchaseRequest.status.in_(TO_INSPECT),
            PurchaseRequest.deliver_to.in_(("公司仓库", None)),
        ),
    ) if is_warehouse else 0
    to_store = _count(
        session,
        select(func.count())
        .select_from(GoodsReceipt)
        .where(GoodsReceipt.status == "待入库", GoodsReceipt.deliver_to == "公司仓库"),
    ) if is_warehouse else 0
    issues = _count(
        session,
        select(func.count())
        .select_from(MaterialIssue)
        .where(MaterialIssue.status.in_(("待备料", "已备料"))),
    ) if is_warehouse else 0
    to_purchase = _count(
        session,
        select(func.count()).select_from(PurchaseRequest).where(PurchaseRequest.status == "待采购"),
    ) if is_purchase else 0
    my_leads = _count(
        session,
        select(func.count())
        .select_from(Project)
        .where(Project.sales_id == current.id, Project.stage.in_(LEAD_STAGES)),
    )
    project_nos = _my_project_nos(session, current)
    projects = (
        session.scalars(
            select(Project).where(Project.project_no.in_(project_nos[:10])).order_by(Project.project_no.desc())
        ).all()
        if project_nos
        else []
    )

    visible = _visible(session, current)
    workbenches = [
        {
            "key": w["key"],
            "name": w["name"],
            "route": w["route"],
            "visible": w["key"] in visible,
        }
        for w in WORKBENCHES
    ]

    dept = None
    if current.org_id:
        org = session.get(Org, current.org_id)
        seen: set[int] = set()
        while org is not None and org.parent_id and org.id not in seen:
            seen.add(org.id)
            parent = session.get(Org, org.parent_id)
            if parent is None:
                break
            org = parent
        dept = {"id": org.id, "name": org.name} if org else None

    return {
        "user": {
            "id": current.id,
            "name": current.name,
            "position": current.position,
            "title": current.title,
            "profession": current.profession,
            "roles": sorted(codes),
            "department": dept,
        },
        "workbenches": workbenches,
        "counts": {
            "my_tasks": my_tasks,
            "to_review": to_review,
            "to_decide": to_decide,
            "my_changes": my_changes,
            "to_change": to_change,
            "to_inspect": to_inspect,
            "to_store": to_store,
            "issues": issues,
            "to_purchase": to_purchase,
            "my_leads": my_leads,
            "my_projects": len(project_nos),
            "unread": notify.unread_count(session, current.id),
        },
        "my_projects": [
            {"project_no": p.project_no, "project_name": p.project_name, "stage": p.stage}
            for p in projects
        ],
    }
