"""评审单流转：提交 → 组长 → 总监 → 发布（= 冻结）（05 卷 §3、§4）。

规则速查（全部来自 05 卷对齐结论）：
· 审核单按**人的任务**一张，多轮提交共用；每轮提交/审核全部留档
· 只能提交自己任务的内容；提交后内容锁定（图纸/ BOM 行 → 审核中）
· 两级必须都过；组长本人提交跳过一级（总监直审）；总监不能自审
· 二级通过的那一轮整体发布（=冻结），写 design_release；退回/撤回则解锁回草稿
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.engineering import (
    BOM_DESIGN,
    BOM_MATERIAL,
    BOM_ROW_DRAFT,
    BOM_ROW_FROZEN,
    BOM_ROW_REVIEWING,
    BomItem,
    Drawing,
    DrawingVersion,
)
from app.models.library import Item
from app.models.platform import User
from app.models.program import EquipmentProgram, EquipmentProgramVersion
from app.models.review import (
    ACTION_PASS,
    ACTION_REJECT,
    ACTION_SKIP,
    ACTION_WITHDRAW,
    ITEM_BOM_DESIGN,
    ITEM_BOM_MATERIAL,
    ITEM_DRAWING,
    ITEM_PROGRAM,
    ITEM_SOURCE_TAG,
    TICKET_APPROVED,
    TICKET_PENDING,
    TICKET_PENDING_DIRECTOR,
    TICKET_PENDING_LEAD,
    TICKET_REJECTED,
    TICKET_WITHDRAWN,
    DesignRelease,
    ReviewAction,
    ReviewTicket,
    ReviewTicketItem,
)
from app.models.task import Task
from app.services import audit, bom_demand, change_flow
from app.services.numbering import next_number, year_scope_key
from app.services.reviewers import chain_levels, director, director_for, team_lead_for

LEVEL_LABEL = {1: "组长", 2: "总监"}
KIND_BY_PROFESSION = {"机械": "机械", "电气": "电气"}
TAG_TYPES = ("自制件", "外协件", "定制件")


class ReviewFlowError(ValueError):
    """评审流转的非法操作（路由转 400）。"""


# ---------------------------------------------------------------------------
# 查询 / 序列化辅助
# ---------------------------------------------------------------------------


def ticket_for_task(session: Session, task_id: int) -> ReviewTicket | None:
    return session.scalar(select(ReviewTicket).where(ReviewTicket.task_id == task_id))


def current_version_row(session: Session, drawing_no: str) -> DrawingVersion | None:
    return session.scalar(
        select(DrawingVersion).where(
            DrawingVersion.drawing_no == drawing_no, DrawingVersion.is_current.is_(True)
        )
    )


def current_program_version_row(session: Session, program_id: int) -> EquipmentProgramVersion | None:
    return session.scalar(
        select(EquipmentProgramVersion).where(
            EquipmentProgramVersion.program_id == program_id,
            EquipmentProgramVersion.is_current.is_(True),
        )
    )


def candidates(session: Session, task: Task) -> dict:
    """这条任务下、还在草稿态的可提交内容（05 卷 §3.1 勾选清单）。

    ★ 归属判断在任务层（提交时校验 task.owner_id）—— 组长拆给组员的子任务，
      组员可以提交该设备该专业下任何草稿内容，不卡单条内容是谁建的。
    """
    out: dict = {
        "drawings": [],
        "std_bom": [],
        "material_bom": [],
        "source_tags": [],
        "programs": [],
    }
    if task.equip_no is None:
        return out
    project_no, equip_no, prof = task.project_no, task.equip_no, task.profession
    drawings = session.scalars(
        select(Drawing).where(
            Drawing.project_no == project_no, Drawing.equip_no == equip_no
        ).order_by(Drawing.drawing_no)
    ).all()
    tree_nos = {d.drawing_no for d in drawings} | {equip_no}
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}

    if prof in KIND_BY_PROFESSION:
        for d in drawings:
            if d.kind != KIND_BY_PROFESSION[prof] or d.status != "草稿":
                continue
            ver = current_version_row(session, d.drawing_no)
            out["drawings"].append(
                {
                    "drawing_no": d.drawing_no,
                    "title": d.title,
                    "version": d.current_version,
                    "status": d.status,
                    "source_type": d.source_type,
                    "owner_id": d.owner_id,
                    "filename": ver.filename if ver else None,
                }
            )

    bom_rows = session.scalars(
        select(BomItem).where(BomItem.project_no == project_no, BomItem.status == BOM_ROW_DRAFT)
    ).all()
    for b in bom_rows:
        if b.parent_ref not in tree_nos:
            continue
        item = items.get(b.child_item_no)
        entry = {
            "id": b.id,
            "parent_ref": b.parent_ref,
            "child_item_no": b.child_item_no,
            "display_name": item.display_name if item else b.child_item_no,
            "spec_text": item.spec_text if item else None,
            "qty": float(b.qty or 0),
            "unit": b.unit or (item.unit if item else None),
        }
        if b.bom_source == BOM_DESIGN and prof in ("机械", "电气"):
            out["std_bom"].append(entry)
        elif b.bom_source == BOM_MATERIAL and prof == "工艺":
            out["material_bom"].append(entry)

    if prof == "工艺":
        for d in drawings:
            if d.kind == "机械" and d.status != "已作废":
                out["source_tags"].append(
                    {
                        "drawing_no": d.drawing_no,
                        "title": d.title,
                        "source_type": d.source_type,
                        "status": d.status,
                    }
                )

    if prof == "程序":
        for p in session.scalars(
            select(EquipmentProgram).where(
                EquipmentProgram.project_no == project_no,
                EquipmentProgram.equip_no == equip_no,
                EquipmentProgram.status == "草稿",
            ).order_by(EquipmentProgram.id)
        ).all():
            ver = current_program_version_row(session, p.id)
            out["programs"].append(
                {
                    "program_id": p.id,
                    "name": p.name,
                    "version": p.current_version,
                    "status": p.status,
                    "filename": ver.filename if ver else None,
                }
            )
    return out


# ---------------------------------------------------------------------------
# 提交
# ---------------------------------------------------------------------------


def _lock_and_snapshot(
    session: Session, task: Task, item_type: str, item_ref: str, source_type: str | None, user: User, now: datetime
) -> dict:
    """校验 + 锁定 + 生成提交那一刻的快照（05 卷 §8.1 snapshot）。"""
    project_no, equip_no, prof = task.project_no, task.equip_no, task.profession
    if item_type == ITEM_DRAWING:
        d = session.get(Drawing, item_ref)
        expected_kind = KIND_BY_PROFESSION.get(prof)
        if d is None or d.project_no != project_no or d.equip_no != equip_no:
            raise ReviewFlowError(f"图纸不存在或不属于本设备：{item_ref}")
        if expected_kind and d.kind != expected_kind:
            raise ReviewFlowError(f"{item_ref} 是{d.kind}图，不能由{prof}任务提交")
        if d.status != "草稿":
            raise ReviewFlowError(f"{item_ref} 当前是「{d.status}」，只有草稿能提交")
        ver = current_version_row(session, d.drawing_no)
        if ver is None:
            ver = DrawingVersion(drawing_no=d.drawing_no, version=d.current_version, is_current=True)
            session.add(ver)
            session.flush()
        ver.submitted_by = user.id
        ver.submitted_at = now
        d.status = "审核中"
        return {
            "drawing_no": d.drawing_no,
            "title": d.title,
            "version": ver.version,
            "filename": ver.filename,
            "kind": d.kind,
            "qty": float(d.qty or 1),
            "source_type": d.source_type,
        }

    if item_type in (ITEM_BOM_DESIGN, ITEM_BOM_MATERIAL):
        try:
            bom_id = int(item_ref)
        except ValueError as exc:
            raise ReviewFlowError(f"BOM 行号不对：{item_ref}") from exc
        b = session.get(BomItem, bom_id)
        expected_source = BOM_DESIGN if item_type == ITEM_BOM_DESIGN else BOM_MATERIAL
        if b is None or b.project_no != project_no or b.bom_source != expected_source:
            raise ReviewFlowError("BOM 行不存在或类型不对")
        if b.parent_ref != equip_no:
            parent = session.get(Drawing, b.parent_ref)
            if parent is None or parent.equip_no != equip_no:
                raise ReviewFlowError(f"BOM 行不属于本设备：{b.parent_ref}")
        if b.status != BOM_ROW_DRAFT:
            raise ReviewFlowError(f"BOM 行当前是「{b.status}」，不能提交")
        b.status = BOM_ROW_REVIEWING
        if b.owner_id is None:
            b.owner_id = user.id
        item = session.get(Item, b.child_item_no)
        return {
            "bom_id": b.id,
            "parent_ref": b.parent_ref,
            "child_item_no": b.child_item_no,
            "display_name": item.display_name if item else b.child_item_no,
            "qty": float(b.qty or 0),
            "unit": b.unit or (item.unit if item else None),
        }

    if item_type == ITEM_SOURCE_TAG:
        if prof != "工艺":
            raise ReviewFlowError("只有工艺任务能提交自制/外协判定")
        d = session.get(Drawing, item_ref)
        if d is None or d.project_no != project_no or d.equip_no != equip_no:
            raise ReviewFlowError(f"图纸不存在或不属于本设备：{item_ref}")
        if d.status == "已作废":
            raise ReviewFlowError(f"{item_ref} 已作废，不能判定")
        new = source_type or d.source_type
        if new not in TAG_TYPES:
            raise ReviewFlowError(f"判定只能是：{'/'.join(TAG_TYPES)}")
        return {"drawing_no": d.drawing_no, "title": d.title, "old": d.source_type, "new": new}

    if item_type == ITEM_PROGRAM:
        if prof != "程序":
            raise ReviewFlowError("只有程序任务能提交程序版本")
        try:
            program_id = int(item_ref)
        except ValueError as exc:
            raise ReviewFlowError(f"程序号不对：{item_ref}") from exc
        p = session.get(EquipmentProgram, program_id)
        if p is None or p.project_no != project_no or p.equip_no != equip_no:
            raise ReviewFlowError(f"程序不存在或不属于本设备：{item_ref}")
        if p.status != "草稿":
            raise ReviewFlowError(f"程序「{p.name}」当前是「{p.status}」，只有草稿能提交")
        ver = current_program_version_row(session, p.id)
        if ver is None:
            ver = EquipmentProgramVersion(program_id=p.id, version=p.current_version, is_current=True)
            session.add(ver)
            session.flush()
        ver.submitted_by = user.id
        ver.submitted_at = now
        p.status = "审核中"
        return {
            "program_id": p.id,
            "name": p.name,
            "version": ver.version,
            "filename": ver.filename,
        }
    raise ReviewFlowError(f"未知提交类型：{item_type}")


def submit_round(
    session: Session,
    task: Task,
    user: User,
    selections: list[dict],
    note: str,
    ip: str | None = None,
) -> ReviewTicket:
    """提交新一轮（05 卷 §3.1/§3.2）。selections: [{item_type, item_ref, source_type?}]"""
    if task.task_type != "设计":
        raise ReviewFlowError("只有设计任务能提交评审")
    if task.owner_id != user.id and not user.is_superuser:
        raise ReviewFlowError("只能提交自己负责的任务")
    ticket = ticket_for_task(session, task.id)
    if ticket is not None and ticket.status in TICKET_PENDING:
        raise ReviewFlowError(f"上一轮还在「{ticket.status}」，不能重复提交")
    if not selections:
        raise ReviewFlowError("至少勾选一项内容再提交")

    now = datetime.now(UTC)
    if ticket is None:
        ticket = ReviewTicket(
            ticket_no=next_number(session, "REVIEW_TICKET", scope_key=year_scope_key()),
            task_id=task.id,
            project_no=task.project_no,
            equip_no=task.equip_no,
            profession=task.profession,
            submitter_id=user.id,
            status=TICKET_APPROVED,
            current_round=0,
        )
        session.add(ticket)
        session.flush()

    round_no = ticket.current_round + 1
    seen: set[tuple[str, str]] = set()
    for sel in selections:
        item_type = (sel.get("item_type") or "").upper()
        item_ref = str(sel.get("item_ref") or "")
        if (item_type, item_ref) in seen:
            continue
        seen.add((item_type, item_ref))
        snapshot = _lock_and_snapshot(session, task, item_type, item_ref, sel.get("source_type"), user, now)
        session.add(
            ReviewTicketItem(
                ticket_id=ticket.id,
                round_no=round_no,
                item_type=item_type,
                item_ref=item_ref,
                version=snapshot.get("version"),
                snapshot=snapshot,
                submitted_by=user.id,
                submitted_at=now,
            )
        )

    # 审核链：组长本人提交 → 跳过一级（05 卷 §0.1#13）
    need_lead, _ = chain_levels(user.position)
    if need_lead:
        ticket.status = TICKET_PENDING_LEAD
    else:
        ticket.status = TICKET_PENDING_DIRECTOR
        session.add(
            ReviewAction(
                ticket_id=ticket.id,
                round_no=round_no,
                level=1,
                reviewer_id=user.id,
                action=ACTION_SKIP,
                note="组长本人提交，跳过一级（05 卷 §0.1#13）",
                acted_at=now,
            )
        )
    ticket.current_round = round_no
    ticket.submitter_id = user.id

    audit.log(
        session,
        user=user,
        action="submit",
        object_type="review_ticket",
        object_ref=ticket.ticket_no,
        summary=f"提交评审第 {round_no} 轮（{len(seen)} 项）→ {ticket.status}"
        + (f"；说明：{note}" if note else ""),
        detail={"round": round_no, "items": [f"{t}:{r}" for t, r in seen]},
        ip=ip,
    )
    return ticket


# ---------------------------------------------------------------------------
# 审核 / 撤回
# ---------------------------------------------------------------------------


def review_ticket(
    session: Session,
    ticket: ReviewTicket,
    user: User,
    action: str,
    note: str,
    ip: str | None = None,
) -> DesignRelease | None:
    """组长/总监审核。二级通过时发布本轮（= 冻结），返回 design_release。"""
    if ticket.status not in TICKET_PENDING:
        raise ReviewFlowError(f"这张单当前是「{ticket.status}」，不在审核中")
    if action not in (ACTION_PASS, ACTION_REJECT):
        raise ReviewFlowError("审核动作只能是 通过/退回")
    if action == ACTION_REJECT and not (note or "").strip():
        raise ReviewFlowError("退回必须写说明")

    level = 1 if ticket.status == TICKET_PENDING_LEAD else 2
    if level == 1:
        lead = team_lead_for(session, ticket.profession)
        if lead is None or lead.id != user.id:
            raise ReviewFlowError("只有本专业组长能审这一级")
    else:
        submitter = session.get(User, ticket.submitter_id) if ticket.submitter_id else None
        boss = director_for(session, submitter) if submitter else director(session)
        if boss is None or boss.id != user.id:
            raise ReviewFlowError("只有本部门的部门负责人能审这一级")

    now = datetime.now(UTC)
    round_no = ticket.current_round
    session.add(
        ReviewAction(
            ticket_id=ticket.id,
            round_no=round_no,
            level=level,
            reviewer_id=user.id,
            action=action,
            note=note or None,
            acted_at=now,
        )
    )

    release: DesignRelease | None = None
    if action == ACTION_REJECT:
        ticket.status = TICKET_REJECTED
        _unlock_round(session, ticket, round_no)
    elif level == 1:
        ticket.status = TICKET_PENDING_DIRECTOR
    else:
        release = _publish_round(session, ticket, user, round_no, note, now)
        ticket.status = TICKET_APPROVED

    audit.log(
        session,
        user=user,
        action="review",
        object_type="review_ticket",
        object_ref=ticket.ticket_no,
        summary=f"{LEVEL_LABEL[level]}第 {round_no} 轮{action}"
        + (f"：{note}" if note else "")
        + (f" → 发布 {release.release_no}" if release else f" → {ticket.status}"),
        ip=ip,
    )
    return release


def withdraw_round(
    session: Session, ticket: ReviewTicket, user: User, ip: str | None = None
) -> None:
    """撤回（审核前，仅提交人；05 卷 §0.1#15）。"""
    if ticket.status not in TICKET_PENDING:
        raise ReviewFlowError(f"只有审核中的单能撤回（当前：{ticket.status}）")
    if ticket.submitter_id != user.id and not user.is_superuser:
        raise ReviewFlowError("只有提交人能撤回")
    now = datetime.now(UTC)
    session.add(
        ReviewAction(
            ticket_id=ticket.id,
            round_no=ticket.current_round,
            level=0,
            reviewer_id=user.id,
            action=ACTION_WITHDRAW,
            note="提交人撤回",
            acted_at=now,
        )
    )
    ticket.status = TICKET_WITHDRAWN
    _unlock_round(session, ticket, ticket.current_round)
    audit.log(
        session,
        user=user,
        action="withdraw",
        object_type="review_ticket",
        object_ref=ticket.ticket_no,
        summary=f"撤回第 {ticket.current_round} 轮提交",
        ip=ip,
    )


# ---------------------------------------------------------------------------
# 发布（= 冻结）/ 解锁 / 任务联动
# ---------------------------------------------------------------------------


def _round_items(session: Session, ticket_id: int, round_no: int) -> list[ReviewTicketItem]:
    return list(
        session.scalars(
            select(ReviewTicketItem).where(
                ReviewTicketItem.ticket_id == ticket_id, ReviewTicketItem.round_no == round_no
            )
        ).all()
    )


def _unlock_round(session: Session, ticket: ReviewTicket, round_no: int) -> None:
    for it in _round_items(session, ticket.id, round_no):
        if it.item_type == ITEM_DRAWING:
            d = session.get(Drawing, it.item_ref)
            if d is not None and d.status == "审核中":
                d.status = "草稿"
        elif it.item_type in (ITEM_BOM_DESIGN, ITEM_BOM_MATERIAL):
            try:
                b = session.get(BomItem, int(it.item_ref))
            except ValueError:
                continue
            if b is not None and b.status == BOM_ROW_REVIEWING:
                b.status = BOM_ROW_DRAFT
        elif it.item_type == ITEM_PROGRAM:
            try:
                p = session.get(EquipmentProgram, int(it.item_ref))
            except ValueError:
                continue
            if p is not None and p.status == "审核中":
                p.status = "草稿"


def _publish_round(
    session: Session,
    ticket: ReviewTicket,
    director_user: User,
    round_no: int,
    note: str,
    now: datetime,
) -> DesignRelease:
    """二级通过：这一轮勾选的内容整体冻结，写一条发布批次。"""
    release = DesignRelease(
        release_no=next_number(session, "DESIGN_RELEASE", scope_key=year_scope_key()),
        ticket_id=ticket.id,
        round_no=round_no,
        project_no=ticket.project_no,
        equip_no=ticket.equip_no,
        profession=ticket.profession,
        released_by=director_user.id,
        released_at=now,
        summary={},
    )
    session.add(release)
    session.flush()

    summary: dict = {"drawings": [], "bom_items": [], "source_tags": [], "programs": []}
    for it in _round_items(session, ticket.id, round_no):
        if it.item_type == ITEM_DRAWING:
            d = session.get(Drawing, it.item_ref)
            ver = current_version_row(session, it.item_ref)
            if ver is not None:
                ver.reviewed_by = director_user.id
                ver.reviewed_at = now
                ver.published_by = director_user.id
                ver.published_at = now
                ver.review_note = note or None
                ver.is_current = True
            if d is not None:
                d.status = "已发布"
            summary["drawings"].append(
                {
                    "drawing_no": it.item_ref,
                    "version": ver.version if ver else None,
                    "filename": ver.filename if ver else None,
                }
            )
        elif it.item_type in (ITEM_BOM_DESIGN, ITEM_BOM_MATERIAL):
            try:
                b = session.get(BomItem, int(it.item_ref))
            except ValueError:
                continue
            if b is not None:
                b.status = BOM_ROW_FROZEN
                b.frozen_release_id = release.id
                summary["bom_items"].append(
                    {
                        "bom_id": b.id,
                        "parent_ref": b.parent_ref,
                        "child_item_no": b.child_item_no,
                        "qty": float(b.qty or 0),
                    }
                )
        elif it.item_type == ITEM_SOURCE_TAG:
            d = session.get(Drawing, it.item_ref)
            if d is not None and it.snapshot:
                d.source_type = it.snapshot.get("new", d.source_type)
                item = session.get(Item, d.drawing_no)
                if item is not None and d.source_type != "自制件":
                    item.source_type = d.source_type
                summary["source_tags"].append(
                    {"drawing_no": d.drawing_no, "old": it.snapshot.get("old"), "new": d.source_type}
                )
        elif it.item_type == ITEM_PROGRAM:
            try:
                p = session.get(EquipmentProgram, int(it.item_ref))
            except ValueError:
                continue
            if p is not None:
                ver = current_program_version_row(session, p.id)
                if ver is not None:
                    ver.reviewed_by = director_user.id
                    ver.reviewed_at = now
                    ver.published_by = director_user.id
                    ver.published_at = now
                    ver.review_note = note or None
                    ver.is_current = True
                p.status = "已发布"
                summary["programs"].append(
                    {
                        "program_id": p.id,
                        "name": p.name,
                        "version": ver.version if ver else p.current_version,
                        "filename": ver.filename if ver else None,
                    }
                )

    release.summary = summary
    # ★ 发布 = 采购触发（05 卷 §5）：这一批冻结的内容净需求自动进采购池
    created = bom_demand.create_release_demands(session, release)
    summary["purchase_requests"] = [r.id for r in created]
    release.summary = summary
    # 改版任务发布 → 改版申请完成（05 卷 §7⑥）
    change_flow.complete_for_release(session, ticket.task_id, release, now)
    _maybe_complete_task(session, ticket.task_id)
    return release


def _maybe_complete_task(session: Session, task_id: int) -> None:
    """任务联动（05 卷 §3.3#6）：任务下所有内容都已冻结 → 任务自动已完成。

    有子任务的父任务不自动完成（等组长手动兜底）——避免把组员的活算空。
    """
    task = session.get(Task, task_id)
    if task is None or task.task_type != "设计" or task.equip_no is None:
        return
    has_children = session.scalar(select(Task.id).where(Task.parent_task_id == task.id).limit(1))
    if has_children:
        return

    project_no, equip_no, prof = task.project_no, task.equip_no, task.profession
    now = datetime.now(UTC)

    if prof in KIND_BY_PROFESSION:
        drawings = session.scalars(
            select(Drawing).where(
                Drawing.project_no == project_no,
                Drawing.equip_no == equip_no,
                Drawing.kind == KIND_BY_PROFESSION[prof],
            )
        ).all()
        if not drawings or any(d.status != "已发布" for d in drawings):
            return
        parents = {d.drawing_no for d in drawings} | {equip_no}
        bom_rows = session.scalars(
            select(BomItem).where(
                BomItem.project_no == project_no,
                BomItem.bom_source == BOM_DESIGN,
                BomItem.parent_ref.in_(parents),
            )
        ).all()
        if any(b.status != BOM_ROW_FROZEN for b in bom_rows):
            return
    elif prof == "工艺":
        drawings = session.scalars(
            select(Drawing).where(
                Drawing.project_no == project_no, Drawing.equip_no == equip_no, Drawing.kind == "机械"
            )
        ).all()
        if not drawings:
            return
        parents = {d.drawing_no for d in drawings} | {equip_no}
        bom_rows = session.scalars(
            select(BomItem).where(
                BomItem.project_no == project_no,
                BomItem.bom_source == BOM_MATERIAL,
                BomItem.parent_ref.in_(parents),
            )
        ).all()
        if any(b.status != BOM_ROW_FROZEN for b in bom_rows):
            return
        tagged: set[str] = set()
        for rel in session.scalars(
            select(DesignRelease).where(
                DesignRelease.project_no == project_no,
                DesignRelease.equip_no == equip_no,
                DesignRelease.profession == "工艺",
            )
        ).all():
            for tag in (rel.summary or {}).get("source_tags", []):
                tagged.add(tag.get("drawing_no"))
        if any(d.drawing_no not in tagged for d in drawings):
            return
    else:
        programs = session.scalars(
            select(EquipmentProgram).where(
                EquipmentProgram.project_no == project_no, EquipmentProgram.equip_no == equip_no
            )
        ).all()
        if not programs or any(p.status != "已发布" for p in programs):
            return

    task.status = "已完成"
    task.done_at = now
