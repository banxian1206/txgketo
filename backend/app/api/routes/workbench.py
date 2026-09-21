"""工作台框架（06 卷 §8）：按角色算「我能进哪些工作台」+ 待办数字 + 我的项目。

一个节点一个工作台；登录默认落在「我的工作台」。
本模块只做**汇总**（我的工作台用），各工作台页面的详细内容随后续步骤补齐。
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_session
from app.models.change import CR_ACTIVE, CR_PENDING, ChangeRequest
from app.models.initiation import GoodsReceipt, Milestone, ProjectMember, PurchaseRequest
from app.models.platform import POSITION_DIRECTOR, POSITION_LEAD, Org, User
from app.models.production import PROD_DISPATCHED, PROD_DONE, PROD_RUNNING, PROD_WAIT, ProdOrder
from app.models.project import Equipment, PaymentTerm, Project
from app.models.review import (
    TICKET_PENDING_DIRECTOR,
    TICKET_PENDING_LEAD,
    TICKET_REJECTED,
    DesignRelease,
    ReviewTicket,
)
from app.models.task import Task
from app.models.warehouse import MaterialIssue
from app.services import manufacturing as mfg
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


@router.get("/eng/board")
def eng_board(session: Session = Depends(get_session), current: User = Depends(get_current_user)):
    """工程部看板（06 卷 §3）：设备设计进度 + 待终审 + 改版裁决 + 卡住/超期。

    设计属于工程部，这里给全量；页面上再按岗位（组员/经理/总监）分三视角。
    """
    profs = ("机械", "电气", "程序", "工艺")
    today = datetime.now(UTC).date()

    equipments = session.scalars(select(Equipment)).all()
    tasks = session.scalars(select(Task).where(Task.task_type == "设计")).all()
    tickets = session.scalars(select(ReviewTicket)).all()
    releases = session.scalars(select(DesignRelease).order_by(DesignRelease.id)).all()
    projects = {p.project_no: p.project_name for p in session.scalars(select(Project)).all()}
    names = {u.id: u.name for u in session.scalars(select(User)).all()}

    task_map = {
        (t.project_no, t.equip_no, t.profession): t for t in tasks if t.parent_task_id is None
    }
    ticket_by_task = {t.task_id: t for t in tickets}
    rel_map: dict[tuple, DesignRelease] = {}
    for r in releases:
        rel_map[(r.project_no, r.equip_no, r.profession)] = r  # 后来的覆盖（已按 id 排序）

    items: list[dict] = []
    blocked_equip = 0
    all_released = 0
    for eq in equipments:
        cells: dict[str, dict] = {}
        blocked_parts: list[str] = []
        for prof in profs:
            task = task_map.get((eq.project_no, eq.equip_no, prof))
            rel = rel_map.get((eq.project_no, eq.equip_no, prof))
            ticket = ticket_by_task.get(task.id) if task else None
            if rel is not None:
                state = "已发布"
            elif ticket is not None and ticket.status in (
                TICKET_PENDING_LEAD,
                TICKET_PENDING_DIRECTOR,
            ):
                state = "审核中"
            elif ticket is not None and ticket.status == TICKET_REJECTED:
                state = "已退回"
                blocked_parts.append(f"{prof}（评审被退回）")
            elif task is not None:
                state = "进行中" if task.status != "待开始" else "待开始"
            else:
                state = "未派"
            overdue = bool(
                task is not None
                and task.plan_end is not None
                and task.plan_end < today
                and task.status not in ("已完成", "已取消")
            )
            if overdue:
                blocked_parts.append(f"{prof}（超期 {task.plan_end}）")
            cells[prof] = {
                "state": state,
                "task_no": task.task_no if task else None,
                "owner": names.get(task.owner_id) if task and task.owner_id else None,
                "release_no": rel.release_no if rel else None,
                "ticket_status": ticket.status if ticket else None,
                "overdue": overdue,
                "plan_end": task.plan_end if task else None,
            }
        done = sum(1 for p in profs if cells[p]["state"] == "已发布")
        if done == len(profs):
            all_released += 1
        if blocked_parts:
            blocked_equip += 1
        items.append(
            {
                "project_no": eq.project_no,
                "project_name": projects.get(eq.project_no),
                "equip_no": eq.equip_no,
                "equip_name": eq.equip_name,
                "professions": cells,
                "released_count": done,
                "blocked": blocked_parts,
            }
        )

    pending_reviews = session.scalars(
        select(ReviewTicket).where(ReviewTicket.status == TICKET_PENDING_DIRECTOR)
    ).all()
    pending_changes = session.scalars(
        select(ChangeRequest).where(ChangeRequest.status == CR_PENDING)
    ).all()
    overdue_tasks = [
        t
        for t in tasks
        if t.plan_end is not None
        and t.plan_end < today
        and t.status not in ("已完成", "已取消")
    ]

    return {
        "summary": {
            "equipments": len(equipments),
            "all_released": all_released,
            "blocked": blocked_equip,
            "pending_reviews": len(pending_reviews),
            "pending_changes": len(pending_changes),
            "overdue_tasks": len(overdue_tasks),
            "released": sum(1 for r in releases if r.profession in profs),
        },
        "equipments": items,
        "pending_reviews": [
            {
                "id": t.id,
                "ticket_no": t.ticket_no,
                "project_no": t.project_no,
                "equip_no": t.equip_no,
                "profession": t.profession,
                "submitter": names.get(t.submitter_id) if t.submitter_id else None,
                "round": t.current_round,
            }
            for t in pending_reviews
        ],
        "pending_changes": [
            {
                "id": c.id,
                "cr_no": c.cr_no,
                "target_type": c.target_type,
                "target_ref": c.target_ref,
                "project_no": c.project_no,
                "equip_no": c.equip_no,
                "reason": c.reason,
            }
            for c in pending_changes
        ],
        "overdue_tasks": [
            {
                "id": t.id,
                "task_no": t.task_no,
                "title": t.title,
                "profession": t.profession,
                "owner": names.get(t.owner_id) if t.owner_id else None,
                "plan_end": t.plan_end,
                "status": t.status,
            }
            for t in overdue_tasks
        ],
    }


@router.get("/sales/board")
def sales_board(session: Session = Depends(get_session), current: User = Depends(get_current_user)):
    """商务部工作台（06 卷 §3）：我的商机 / 待成交 / 待立项 / 回款。"""
    today = datetime.now(UTC).date()
    projects = session.scalars(
        select(Project).where(Project.sales_id == current.id).order_by(Project.project_no.desc())
    ).all()
    nos = [p.project_no for p in projects]
    terms = (
        session.scalars(select(PaymentTerm).where(PaymentTerm.project_no.in_(nos))).all() if nos else []
    )
    by_proj: dict[str, float] = {}
    payments: list[dict] = []
    for t in terms:
        unpaid = max(0.0, float(t.amount or 0) - float(t.received_amount or 0))
        by_proj[t.project_no] = by_proj.get(t.project_no, 0.0) + unpaid
        if unpaid > 0:
            payments.append(
                {
                    "project_no": t.project_no,
                    "node_name": t.node_name,
                    "amount": float(t.amount or 0),
                    "unpaid": round(unpaid, 2),
                    "expect_date": t.expect_date,
                    "overdue": bool(t.expect_date and t.expect_date < today),
                }
            )
    payments.sort(key=lambda x: (x["expect_date"] is None, x["expect_date"] or today))
    stage_count: dict[str, int] = {}
    rows = []
    for p in projects:
        stage_count[p.stage] = stage_count.get(p.stage, 0) + 1
        overdue_follow = bool(p.stage == "线索" and p.deadline and p.deadline < today)
        rows.append(
            {
                "project_no": p.project_no,
                "project_name": p.project_name,
                "stage": p.stage,
                "deadline": p.deadline,
                "amount": float(p.amount or 0),
                "unpaid": round(by_proj.get(p.project_no, 0.0), 2),
                "overdue_follow": overdue_follow,
            }
        )
    return {
        "summary": {
            "my_leads": stage_count.get("线索", 0),
            "to_initiate": stage_count.get("成交待立项", 0),
            "executing": sum(v for k, v in stage_count.items() if k in ("执行中", "交付中")),
            "overdue_followup": sum(1 for r in rows if r["overdue_follow"]),
            "payments_due": len(payments),
            "payments_overdue": sum(1 for x in payments if x["overdue"]),
        },
        "projects": rows,
        "payments": payments[:50],
    }


@router.get("/pm/board")
def pm_board(session: Session = Depends(get_session), current: User = Depends(get_current_user)):
    """项目经理台（06 卷 §3）：我项目的全链进度 + 风险 + 待办。"""
    today = datetime.now(UTC).date()
    pm_nos = set(session.scalars(select(Project.project_no).where(Project.pm_id == current.id)).all())
    member_nos = set(
        session.scalars(select(ProjectMember.project_no).where(ProjectMember.user_id == current.id)).all()
    )
    nos = sorted(pm_nos | member_nos)
    projects = session.scalars(select(Project).where(Project.project_no.in_(nos))).all() if nos else []

    equipments: dict[str, list[str]] = {}
    for e in session.scalars(select(Equipment).where(Equipment.project_no.in_(nos))).all() if nos else []:
        equipments.setdefault(e.project_no, []).append(e.equip_no)
    released: dict[str, set[tuple[str, str]]] = {}
    for r in session.scalars(select(DesignRelease).where(DesignRelease.project_no.in_(nos))).all() if nos else []:
        if r.profession in ("机械", "电气", "程序", "工艺") and r.equip_no:
            released.setdefault(r.project_no, set()).add((r.equip_no, r.profession))
    tasks = session.scalars(select(Task).where(Task.project_no.in_(nos))).all() if nos else []
    reqs = (
        session.scalars(select(PurchaseRequest).where(PurchaseRequest.project_no.in_(nos))).all()
        if nos
        else []
    )
    milestones = (
        session.scalars(select(Milestone).where(Milestone.project_no.in_(nos))).all() if nos else []
    )

    rows = []
    for p in projects:
        my_eq = equipments.get(p.project_no, [])
        design_total = len(my_eq) * 4
        design_done = len(released.get(p.project_no, set()))
        my_tasks = [t for t in tasks if t.project_no == p.project_no]
        overdue_tasks = [
            t
            for t in my_tasks
            if t.plan_end and t.plan_end < today and t.status not in ("已完成", "已取消")
        ]
        my_reqs = [r for r in reqs if r.project_no == p.project_no]
        to_purchase = [r for r in my_reqs if r.status == "待采购"]
        in_transit = [r for r in my_reqs if r.status in ("在途", "部分到货")]
        stored = [r for r in my_reqs if r.status == "已入库"]
        late_milestones = [
            m
            for m in milestones
            if m.project_no == p.project_no
            and m.plan_end
            and m.plan_end < today
            and m.status not in ("已完成",)
        ]
        overdue_delivery = [
            r for r in to_purchase if r.need_date and r.need_date < today
        ]
        risks: list[str] = []
        if overdue_tasks:
            risks.append(f"任务超期 {len(overdue_tasks)}")
        if overdue_delivery:
            risks.append(f"缺料超期 {len(overdue_delivery)}")
        if late_milestones:
            risks.append(f"节点延期 {len(late_milestones)}")
        rows.append(
            {
                "project_no": p.project_no,
                "project_name": p.project_name,
                "stage": p.stage,
                "deadline": p.deadline,
                "delivery_days": p.delivery_days,
                "design_done": design_done,
                "design_total": design_total,
                "purchase": {
                    "to_purchase": len(to_purchase),
                    "in_transit": len(in_transit),
                    "stored": len(stored),
                },
                "overdue_tasks": len(overdue_tasks),
                "shortage": len(to_purchase),
                "risks": risks,
            }
        )
    rows.sort(key=lambda r: (-len(r["risks"]), r["project_no"]))
    return {
        "summary": {
            "projects": len(rows),
            "at_risk": sum(1 for r in rows if r["risks"]),
            "shortage": sum(r["shortage"] for r in rows),
            "overdue_tasks": sum(r["overdue_tasks"] for r in rows),
            "in_transit": sum(r["purchase"]["in_transit"] for r in rows),
        },
        "projects": rows,
    }


@router.get("/shop")
def shop_board(session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    """车间台（S5 制造）：只管两头 —— 下发（拍照）→ 验收（拍照）→ 转运（拍照）。"""
    return mfg.workbench_view(session)


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
    is_shop = current.is_superuser or bool(codes & {"MFG", "ASSY", "QC"})
    shop_wait = _count(
        session,
        select(func.count()).select_from(ProdOrder).where(ProdOrder.status == PROD_WAIT),
    ) if is_shop else 0
    shop_accept = _count(
        session,
        select(func.count())
        .select_from(ProdOrder)
        .where(ProdOrder.status.in_((PROD_DISPATCHED, PROD_RUNNING))),
    ) if is_shop else 0
    shop_transfer = _count(
        session,
        select(func.count()).select_from(ProdOrder).where(ProdOrder.status == PROD_DONE),
    ) if is_shop else 0
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
            "shop_wait": shop_wait,
            "shop_accept": shop_accept,
            "shop_transfer": shop_transfer,
            "my_leads": my_leads,
            "my_projects": len(project_nos),
            "unread": notify.unread_count(session, current.id),
        },
        "my_projects": [
            {"project_no": p.project_no, "project_name": p.project_name, "stage": p.stage}
            for p in projects
        ],
    }
