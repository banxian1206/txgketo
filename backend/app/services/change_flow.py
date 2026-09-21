"""改版申请流转（05 卷 §7）。

冻结后要动，唯一入口：
  提申请（挂具体冻结版本）→ 总监裁决 →（批准）下发改版任务 → 设计师改 → 重走两级审核
  → 新版本发布、旧版留档；否决必须给替代方案。
影响面（已生成采购需求/已领料）只**提示**，人工处理，不自动改。
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.change import (
    CR_ACTIVE,
    CR_APPROVED,
    CR_DISPATCHED,
    CR_DONE,
    CR_PENDING,
    CR_REJECTED,
    TARGET_BOM_ITEM,
    TARGET_DRAWING,
    TARGET_PROGRAM,
    TARGET_TYPES,
    ChangeRequest,
)
from app.models.engineering import (
    BOM_MATERIAL,
    BOM_ROW_DRAFT,
    BOM_ROW_FROZEN,
    BomItem,
    Drawing,
)
from app.models.initiation import PurchaseRequest
from app.models.library import Item
from app.models.platform import POSITION_DIRECTOR, POSITION_LEAD, User
from app.models.program import EquipmentProgram
from app.models.review import DesignRelease
from app.models.task import Task
from app.models.warehouse import MaterialIssue, MaterialIssueLine
from app.services import audit, notify
from app.services.numbering import next_number, year_scope_key
from app.services.reviewers import director_for


class ChangeFlowError(ValueError):
    """改版流转的非法操作（路由转 400）。"""


# ---------------------------------------------------------------------------
# 目标解析 / 归属
# ---------------------------------------------------------------------------


def target_info(
    session: Session, target_type: str, target_ref: str, target_version: str | None = None
) -> dict:
    """解析改版目标：返回 project/equip/part/专业/冻结版本/标题。"""
    if target_type not in TARGET_TYPES:
        raise ChangeFlowError(f"改版对象只能是：{'/'.join(TARGET_TYPES)}")

    if target_type == TARGET_DRAWING:
        d = session.get(Drawing, target_ref)
        if d is None:
            raise ChangeFlowError(f"图纸不存在：{target_ref}")
        return {
            "project_no": d.project_no,
            "equip_no": d.equip_no,
            "part_no": d.drawing_no,
            "profession": d.kind,
            "version": target_version or d.current_version,
            "title": f"{d.drawing_no} {d.title}",
            "frozen": d.status == "已发布",
        }

    if target_type == TARGET_PROGRAM:
        try:
            pid = int(target_ref)
        except ValueError as exc:
            raise ChangeFlowError(f"程序号不对：{target_ref}") from exc
        p = session.get(EquipmentProgram, pid)
        if p is None:
            raise ChangeFlowError(f"程序不存在：{target_ref}")
        return {
            "project_no": p.project_no,
            "equip_no": p.equip_no,
            "part_no": None,
            "profession": "程序",
            "version": target_version or p.current_version,
            "title": f"程序 {p.name}",
            "frozen": p.status == "已发布",
        }

    # BOM 行
    try:
        bid = int(target_ref)
    except ValueError as exc:
        raise ChangeFlowError(f"BOM 行号不对：{target_ref}") from exc
    b = session.get(BomItem, bid)
    if b is None:
        raise ChangeFlowError("BOM 行不存在")
    parent = session.get(Drawing, b.parent_ref)
    item = session.get(Item, b.child_item_no)
    release = session.get(DesignRelease, b.frozen_release_id) if b.frozen_release_id else None
    return {
        "project_no": b.project_no,
        "equip_no": parent.equip_no if parent else None,
        "part_no": b.parent_ref,
        "profession": "工艺" if b.bom_source == BOM_MATERIAL else (parent.kind if parent else "机械"),
        "version": target_version or (release.release_no if release else None),
        "title": f"{b.parent_ref} ← {item.display_name if item else b.child_item_no} × {float(b.qty or 0):g}",
        "frozen": b.status == BOM_ROW_FROZEN and b.superseded_by_id is None,
    }


def active_map(session: Session, project_no: str, equip_no: str | None = None) -> dict[tuple[str, str], ChangeRequest]:
    """这台设备上还在进行中的改版申请（按 目标类型 + 目标 索引）。"""
    stmt = select(ChangeRequest).where(
        ChangeRequest.project_no == project_no, ChangeRequest.status.in_(CR_ACTIVE)
    )
    if equip_no is not None:
        stmt = stmt.where(ChangeRequest.equip_no == equip_no)
    return {(c.target_type, c.target_ref): c for c in session.scalars(stmt).all()}


def approved_for(session: Session, target_type: str, target_ref: str) -> ChangeRequest | None:
    """找一个已批准/已下发的改版申请（用来放行 new-version）。"""
    return session.scalar(
        select(ChangeRequest)
        .where(
            ChangeRequest.target_type == target_type,
            ChangeRequest.target_ref == target_ref,
            ChangeRequest.status.in_((CR_APPROVED, CR_DISPATCHED)),
        )
        .order_by(ChangeRequest.id.desc())
    )


def _ensure_task_owner(session: Session, cr: ChangeRequest, user: User) -> Task | None:
    task = session.get(Task, cr.change_task_id) if cr.change_task_id else None
    if not user.is_superuser and (task is None or task.owner_id != user.id):
        raise ChangeFlowError("只有这条改版任务的负责人能改")
    return task


# ---------------------------------------------------------------------------
# 申请 / 裁决 / 下发
# ---------------------------------------------------------------------------


def create_request(
    session: Session,
    user: User,
    target_type: str,
    target_ref: str,
    reason: str,
    proposal: str | None,
    ip: str | None = None,
) -> ChangeRequest:
    """任何部门/个人都能提（05 卷 §0.1#7）；同一冻结版本同时只能有一个在办。"""
    if not (reason or "").strip():
        raise ChangeFlowError("请把问题写清楚")
    info = target_info(session, target_type, target_ref)
    if not info["frozen"]:
        raise ChangeFlowError("只有已冻结（发布过）的版本才能提改版申请")
    dup = session.scalar(
        select(ChangeRequest).where(
            ChangeRequest.target_type == target_type,
            ChangeRequest.target_ref == target_ref,
            ChangeRequest.status.in_(CR_ACTIVE),
        )
    )
    if dup is not None:
        raise ChangeFlowError(f"这个版本已经有改版申请在处理中（{dup.cr_no} {dup.status}）")

    row = ChangeRequest(
        cr_no=next_number(session, "CHANGE_REQUEST", scope_key=year_scope_key()),
        project_no=info["project_no"],
        equip_no=info["equip_no"],
        target_type=target_type,
        target_ref=target_ref,
        target_version=info["version"],
        part_no=info["part_no"],
        reason=reason.strip(),
        proposal=(proposal or "").strip() or None,
        applicant_id=user.id,
        status=CR_PENDING,
    )
    session.add(row)
    session.flush()
    audit.log(
        session,
        user=user,
        action="create",
        object_type="change_request",
        object_ref=row.cr_no,
        summary=f"改版申请 {row.cr_no}：{info['title']}（{info['version']}）—— {row.reason}",
        ip=ip,
    )
    # ★ 站内消息：提醒**申请人所在部门**的部门负责人裁决（06 卷 §9）
    boss = director_for(session, user)
    if boss is not None:
        notify.notify(
            session,
            [boss.id],
            type_=notify.TYPE_CHANGE,
            title=f"有改版申请等你裁决：{row.cr_no}",
            body=f"{info['title']} —— {row.reason}",
            link="/changes",
            biz_type="change_request",
            biz_id=row.id,
            actor_id=user.id,
        )
    else:
        notify.notify_directors(
            session,
            type_=notify.TYPE_CHANGE,
            title=f"有改版申请等你裁决：{row.cr_no}",
            body=f"{info['title']} —— {row.reason}",
            link="/changes",
            biz_type="change_request",
            biz_id=row.id,
            actor_id=user.id,
        )
    return row


def decide(
    session: Session,
    cr: ChangeRequest,
    user: User,
    decision: str,
    note: str,
    solution: str,
    ip: str | None = None,
) -> None:
    """工程总监裁决（05 卷 §7②）：批准 / 否决（否决必须给替代方案）。"""
    if cr.status != CR_PENDING:
        raise ChangeFlowError(f"这张申请当前是「{cr.status}」，不在待裁决")
    if user.position != POSITION_DIRECTOR and not user.is_superuser:
        raise ChangeFlowError("只有工程部总监能裁决")
    now = datetime.now(UTC)
    if decision == "批准":
        cr.status = CR_APPROVED
    elif decision == "否决":
        if not (solution or "").strip():
            raise ChangeFlowError("否决必须填写替代方案 / 处理办法，不能空关")
        cr.status = CR_REJECTED
        cr.solution = solution.strip()
        cr.archived_at = now
    else:
        raise ChangeFlowError("裁决只能是 批准 / 否决")
    cr.decided_by = user.id
    cr.decided_at = now
    cr.decision_note = (note or "").strip() or None
    if cr.applicant_id:
        notify.notify(
            session,
            [cr.applicant_id],
            type_=notify.TYPE_CHANGE,
            title=f"改版申请 {cr.cr_no} {decision}",
            body=(note or cr.solution) or None,
            link="/changes",
            biz_type="change_request",
            biz_id=cr.id,
            actor_id=user.id,
        )
    audit.log(
        session,
        user=user,
        action="decide",
        object_type="change_request",
        object_ref=cr.cr_no,
        summary=f"改版申请 {cr.cr_no} {decision}"
        + (f"：{note}" if note else "")
        + (f"；替代方案：{cr.solution}" if cr.solution else ""),
        ip=ip,
    )


def dispatch(
    session: Session,
    cr: ChangeRequest,
    user: User,
    assignee_id: int,
    ip: str | None = None,
) -> Task:
    """批准后下发改版任务给对应设计师（05 卷 §7③）。"""
    if cr.status != CR_APPROVED:
        raise ChangeFlowError(f"只有「已批准」的申请能下发（当前：{cr.status}）")
    if user.position != POSITION_DIRECTOR and not user.is_superuser:
        raise ChangeFlowError("只有工程部总监能下发")
    assignee = session.get(User, assignee_id)
    if assignee is None:
        raise ChangeFlowError(f"用户不存在：{assignee_id}")
    info = target_info(session, cr.target_type, cr.target_ref)
    if (
        not assignee.is_superuser
        and assignee.profession != info["profession"]
        and assignee.position not in (POSITION_LEAD, POSITION_DIRECTOR)
    ):
        raise ChangeFlowError(f"改版任务要派给「{info['profession']}」专业的人")
    task = Task(
        task_no=next_number(session, "TASK", scope_key=year_scope_key()),
        project_no=cr.project_no,
        equip_no=cr.equip_no,
        task_type="设计",
        profession=info["profession"],
        title=f"改版：{info['title']}（{cr.cr_no}）",
        content=f"问题：{cr.reason}" + (f"\n建议：{cr.proposal}" if cr.proposal else ""),
        owner_id=assignee.id,
        status="待开始",
        ref_type="change_request",
        ref_id=cr.id,
        ref_no=cr.cr_no,
        remark=f"{info['version']} 冻结版本改版",
    )
    session.add(task)
    session.flush()
    cr.change_task_id = task.id
    cr.status = CR_DISPATCHED
    notify.notify(
        session,
        [assignee.id],
        type_=notify.TYPE_CHANGE,
        title=f"改版任务派给你：{cr.cr_no}（{task.title}）",
        body=f"问题：{cr.reason}",
        link="/my-tasks",
        biz_type="change_request",
        biz_id=cr.id,
        actor_id=user.id,
    )
    audit.log(
        session,
        user=user,
        action="dispatch",
        object_type="change_request",
        object_ref=cr.cr_no,
        summary=f"改版申请 {cr.cr_no} 下发改版任务 {task.task_no} → {assignee.name}",
        ip=ip,
    )
    return task


def complete_for_release(session: Session, task_id: int, release: DesignRelease, now: datetime) -> list[ChangeRequest]:
    """改版任务发布 → 改版申请完成（05 卷 §7⑥）。"""
    rows = session.scalars(
        select(ChangeRequest).where(
            ChangeRequest.change_task_id == task_id, ChangeRequest.status == CR_DISPATCHED
        )
    ).all()
    for cr in rows:
        cr.status = CR_DONE
        cr.new_release_id = release.id
        cr.archived_at = now
        if cr.applicant_id:
            notify.notify(
                session,
                [cr.applicant_id],
                type_=notify.TYPE_CHANGE,
                title=f"改版已完成并发布：{cr.cr_no}（{release.release_no}）",
                link="/changes",
                biz_type="change_request",
                biz_id=cr.id,
                actor_id=None,
            )
    return list(rows)


# ---------------------------------------------------------------------------
# BOM 行修订 / 影响面
# ---------------------------------------------------------------------------


def revise_bom(
    session: Session,
    cr: ChangeRequest,
    user: User,
    qty: float | None,
    child_item_no: str | None,
    pos_no: str | None,
    remark: str | None,
    ip: str | None = None,
) -> BomItem:
    """BOM 行改版：生成一条草稿替代行（旧行标记被替代，发布后生效）。"""
    if cr.target_type != TARGET_BOM_ITEM:
        raise ChangeFlowError("这不是 BOM 行的改版申请")
    if cr.status != CR_DISPATCHED:
        raise ChangeFlowError(f"只有已下发的申请能修订（当前：{cr.status}）")
    _ensure_task_owner(session, cr, user)
    old = session.get(BomItem, int(cr.target_ref))
    if old is None:
        raise ChangeFlowError("原 BOM 行不存在")
    if old.superseded_by_id:
        raise ChangeFlowError("这条 BOM 行已经修订过了")

    new_item_no = child_item_no or old.child_item_no
    if session.get(Item, new_item_no) is None:
        raise ChangeFlowError(f"标准库里没有 {new_item_no} —— 先去标准库建")
    new = BomItem(
        project_no=old.project_no,
        parent_ref=old.parent_ref,
        child_item_no=new_item_no,
        bom_source=old.bom_source,
        qty=qty if qty is not None else old.qty,
        unit=old.unit,
        pos_no=pos_no if pos_no is not None else old.pos_no,
        remark=remark if remark is not None else old.remark,
        status=BOM_ROW_DRAFT,
        owner_id=user.id,
    )
    session.add(new)
    session.flush()
    old.superseded_by_id = new.id
    audit.log(
        session,
        user=user,
        action="revise_bom",
        object_type="change_request",
        object_ref=cr.cr_no,
        summary=f"改版申请 {cr.cr_no} 生成替代 BOM 行（{old.parent_ref}，旧行 → 新行 {new.id}）",
        ip=ip,
    )
    return new


def impact(session: Session, cr: ChangeRequest) -> dict:
    """影响面：已生成的采购需求 + 已领料（先列出来，人工处理，不自动改）。"""
    item_no: str | None = None
    part_no: str | None = cr.part_no
    if cr.target_type == TARGET_BOM_ITEM:
        b = session.get(BomItem, int(cr.target_ref))
        if b is not None:
            item_no = b.child_item_no
            part_no = b.parent_ref
    elif cr.target_type == TARGET_DRAWING:
        item_no = cr.target_ref  # 定制件/外协件的物料号就是图号

    requests: list[dict] = []
    if item_no:
        stmt = select(PurchaseRequest).where(PurchaseRequest.item_no == item_no)
        if part_no:
            stmt = stmt.where(
                or_(PurchaseRequest.part_no == part_no, PurchaseRequest.part_no.is_(None))
            )
        for r in session.scalars(stmt.order_by(PurchaseRequest.id)).all():
            requests.append(
                {
                    "id": r.id,
                    "item_no": r.item_no,
                    "qty": float(r.qty or 0),
                    "unit": r.unit,
                    "status": r.status,
                    "po_no": r.po_no,
                    "qty_received": float(r.qty_received or 0),
                    "part_no": r.part_no,
                    "source": r.source,
                    "need_date": r.need_date,
                }
            )

    issues: list[dict] = []
    if item_no:
        rows = session.execute(
            select(MaterialIssueLine, MaterialIssue)
            .join(MaterialIssue, MaterialIssue.id == MaterialIssueLine.issue_id)
            .where(MaterialIssueLine.item_no == item_no)
            .order_by(MaterialIssue.id)
        ).all()
        for line, issue in rows:
            issues.append(
                {
                    "issue_no": issue.issue_no,
                    "status": issue.status,
                    "qty_required": float(line.qty_required or 0),
                    "qty_issued": float(line.qty_issued or 0),
                    "project_no": issue.project_no,
                }
            )

    open_statuses = ("待采购", "在途", "待入库", "部分到货", "不合格")
    return {
        "purchase_requests": requests,
        "material_issues": issues,
        "has_open_purchase": any(r["status"] in open_statuses for r in requests),
        "note": "改版不会自动改已下的采购需求/已领料 —— 请人工判断退货、补买或继续用。",
    }
