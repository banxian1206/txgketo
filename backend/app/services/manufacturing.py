"""制造域服务（《00 方案》§3.3 S5 · 《02 数据模型》§6）。

**★ 只管两头**：下发（原材料 + 图纸，拍照）→ 到期验收（拍照）→ 转运装配区（拍照）。
不做工序级报工、不做工时统计。
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.engineering import BOM_MATERIAL, BomItem, Drawing
from app.models.initiation import ProjectMember
from app.models.production import (
    ACCEPT_OK,
    OS_BACK,
    OS_OK,
    OS_SENT,
    OS_WAIT,
    PROD_DISPATCHED,
    PROD_DONE,
    PROD_REWORK,
    PROD_RUNNING,
    PROD_TRANSFERRED,
    PROD_WAIT,
    OutsourceTask,
    ProdAcceptance,
    ProdOrder,
    ProdTask,
)
from app.models.project import Equipment
from app.models.project import Equipment
from app.models.project import Equipment
from app.models.project import Equipment
from app.services import notify
from app.services.bom_demand import _cumulative_qty
from app.services.numbering import ObjectType, next_number, year_scope_key

SOURCE_SELF_MADE = "自制件"
SOURCE_OUTSOURCE = "外协件"
DRAWING_PUBLISHED = "已发布"


class ManufacturingError(Exception):
    """制造域业务规则错误。"""


def _now() -> datetime:
    return datetime.now(UTC)


def project_team_ids(session: Session, project_no: str) -> set[int]:
    """项目团队成员（用于通知）。"""
    return {
        uid
        for uid in session.scalars(
            select(ProjectMember.user_id).where(ProjectMember.project_no == project_no)
        ).all()
        if uid
    }


def _drawing_owner(session: Session, drawing_no: str) -> int | None:
    d = session.get(Drawing, drawing_no)
    return d.owner_id if d else None


def _material_of(session: Session, drawing_no: str) -> str | None:
    """自制件的原材料（材料 BOM 行：parent_ref = 图号）。"""
    row = session.scalar(
        select(BomItem)
        .where(BomItem.parent_ref == drawing_no, BomItem.bom_source == BOM_MATERIAL)
        .order_by(BomItem.id)
    )
    return row.child_item_no if row else None


# --------------------------------------------------------------------------
# ① 生成排产单（自制件）+ 外协任务（外协件）
# --------------------------------------------------------------------------


def generate_orders(
    session: Session,
    *,
    project_no: str,
    equip_no: str,
    actor_id: int | None,
    plan_start: date | None = None,
    plan_days: int = 2,
) -> dict:
    """按设备的**已发布图纸**展开：自制件 → 排产单，外协件 → 外协任务（幂等）。"""
    drawings = session.scalars(
        select(Drawing).where(Drawing.project_no == project_no, Drawing.equip_no == equip_no)
    ).all()
    published = [d for d in drawings if d.status == DRAWING_PUBLISHED]
    if not published:
        raise ManufacturingError("这台设备还没有已发布的图纸，不能排产（先走工程设计审核发布）")

    mult = _cumulative_qty(drawings)
    start = plan_start or date.today()
    end = start + timedelta(days=max(plan_days, 1))

    orders: list[ProdOrder] = []
    outsource: list[OutsourceTask] = []
    for d in published:
        if d.source_type not in (SOURCE_SELF_MADE, SOURCE_OUTSOURCE):
            continue
        qty = float(mult.get(d.drawing_no, 1) or 1)
        if d.source_type == SOURCE_SELF_MADE:
            exists = session.scalar(
                select(ProdOrder).where(
                    ProdOrder.project_no == project_no,
                    ProdOrder.equip_no == equip_no,
                    ProdOrder.item_no == d.drawing_no,
                )
            )
            if exists is not None:
                continue
            row = ProdOrder(
                order_no=next_number(session, ObjectType.PROD_ORDER, scope_key=year_scope_key()),
                project_no=project_no,
                equip_no=equip_no,
                item_no=d.drawing_no,
                item_name=d.title,
                qty=qty,
                unit=d.unit or "件",
                plan_start=start,
                plan_end=end,
                status=PROD_WAIT,
            )
            session.add(row)
            orders.append(row)
        else:
            exists = session.scalar(
                select(OutsourceTask).where(
                    OutsourceTask.project_no == project_no,
                    OutsourceTask.equip_no == equip_no,
                    OutsourceTask.item_no == d.drawing_no,
                )
            )
            if exists is not None:
                continue
            row = OutsourceTask(
                outsource_no=next_number(session, ObjectType.OUTSOURCE, scope_key=year_scope_key()),
                project_no=project_no,
                equip_no=equip_no,
                item_no=d.drawing_no,
                item_name=d.title,
                qty=qty,
                status=OS_WAIT,
            )
            session.add(row)
            outsource.append(row)

    if orders or outsource:
        notify.notify_role(
            session,
            "MFG",
            type_="mfg",
            title=f"新的排产任务：{project_no} / {equip_no}（{len(orders)} 个自制件、{len(outsource)} 个外协件）",
            body="请下发原材料与图纸（拍照确认），到期验收后转运装配区。",
            link="/manufacturing",
            biz_type="project",
            biz_id=None,
            actor_id=actor_id,
        )
    return {"orders": orders, "outsource": outsource}


# --------------------------------------------------------------------------
# ② 下发（原材料 + 图纸，拍照）
# --------------------------------------------------------------------------


def dispatch(
    session: Session,
    order: ProdOrder,
    *,
    actor_id: int,
    step_name: str,
    material_item_no: str | None = None,
    material_qty: float | None = None,
    issued_to: str | None = None,
    photos: list | None = None,
    remark: str | None = None,
) -> ProdTask:
    if order.status not in (PROD_WAIT, PROD_DISPATCHED, PROD_REWORK):
        raise ManufacturingError(f"当前状态「{order.status}」，不能下发")
    if not photos:
        raise ManufacturingError("下发要拍照确认（原材料 + 图纸）")
    drawing = session.get(Drawing, order.item_no)
    if drawing is not None and drawing.status != DRAWING_PUBLISHED:
        raise ManufacturingError("图纸还没发布，不能下发（先走审核发布）")
    mat = material_item_no or _material_of(session, order.item_no)
    task = ProdTask(
        prod_order_id=order.id,
        step_name=step_name or "下料",
        material_item_no=mat,
        material_qty=material_qty,
        drawing_no=order.item_no,
        drawing_version=drawing.current_version if drawing else None,
        issued_by=actor_id,
        issued_at=_now(),
        issued_to=issued_to,
        photos=list(photos or []),
        remark=remark,
    )
    session.add(task)
    order.team = step_name or order.team
    order.status = PROD_DISPATCHED
    return task


def start(session: Session, order: ProdOrder) -> ProdOrder:
    if order.status not in (PROD_DISPATCHED, PROD_REWORK):
        raise ManufacturingError(f"当前状态「{order.status}」，不能开工")
    order.status = PROD_RUNNING
    order.plan_start = order.plan_start or date.today()
    return order


# --------------------------------------------------------------------------
# ③ 到期验收（合格 / 不合格 / 返工）→ 转运
# --------------------------------------------------------------------------


def accept(
    session: Session,
    order: ProdOrder,
    *,
    actor_id: int,
    result: str,
    reason: str | None = None,
    photos: list | None = None,
) -> ProdAcceptance:
    if order.status not in (PROD_DISPATCHED, PROD_RUNNING, PROD_DONE, PROD_REWORK):
        raise ManufacturingError(f"当前状态「{order.status}」，不能验收")
    row = ProdAcceptance(
        prod_order_id=order.id,
        accepted_by=actor_id,
        accepted_at=_now(),
        result=result,
        reason=reason,
        photos=list(photos or []),
    )
    session.add(row)
    if result == ACCEPT_OK:
        order.status = PROD_DONE
    else:
        order.status = PROD_REWORK
        targets = project_team_ids(session, order.project_no)
        owner = _drawing_owner(session, order.item_no)
        if owner:
            targets.add(owner)
        notify.notify(
            session,
            targets,
            type_="mfg",
            title=f"制造不合格/返工：{order.item_no}（{order.project_no} / {order.equip_no}）",
            body=f"验收结论：{result}。原因：{reason or '—'}。请设计/工艺确认后重新下发。",
            link="/manufacturing",
            biz_type="prod_order",
            biz_id=order.id,
            actor_id=actor_id,
        )
    return row


def transfer(
    session: Session,
    order: ProdOrder,
    *,
    actor_id: int,
    transfer_to: str = "装配区",
    photos: list | None = None,
) -> ProdOrder:
    if order.status != PROD_DONE:
        raise ManufacturingError("只能验收合格后再转运")
    if not photos:
        raise ManufacturingError("转运要拍照（证明确实到位）")
    acc = session.scalars(
        select(ProdAcceptance)
        .where(ProdAcceptance.prod_order_id == order.id)
        .order_by(ProdAcceptance.id.desc())
    ).first()
    if acc is not None:
        acc.transfer_at = _now()
        acc.transfer_to = transfer_to
        acc.transfer_by = actor_id
        acc.transfer_photos = list(photos or [])
    order.status = PROD_TRANSFERRED
    return order


# --------------------------------------------------------------------------
# 外协
# --------------------------------------------------------------------------


def outsource_send(
    session: Session,
    row: OutsourceTask,
    *,
    actor_id: int,
    supplier_id: int | None = None,
    supplier_name: str | None = None,
    sent_at: date | None = None,
    due_date: date | None = None,
    material_supplied: bool | None = None,
    photos: list | None = None,
    remark: str | None = None,
) -> OutsourceTask:
    if row.status not in (OS_WAIT,):
        raise ManufacturingError(f"当前状态「{row.status}」，不能发出")
    row.supplier_id = supplier_id or row.supplier_id
    row.supplier_name = supplier_name or row.supplier_name
    row.sent_at = sent_at or date.today()
    row.due_date = due_date or row.due_date
    if material_supplied is not None:
        row.material_supplied = material_supplied
    row.status = OS_SENT
    if photos:
        row.photos = list(photos)
    if remark:
        row.remark = remark
    return row


def outsource_return(
    session: Session,
    row: OutsourceTask,
    *,
    actor_id: int,
    returned_at: date | None = None,
    photos: list | None = None,
    remark: str | None = None,
) -> OutsourceTask:
    if row.status != OS_SENT:
        raise ManufacturingError(f"当前状态「{row.status}」，不能登记回厂")
    row.returned_at = returned_at or date.today()
    row.status = OS_BACK
    if photos:
        row.photos = list(photos)
    if remark:
        row.remark = remark
    notify.notify_role(
        session,
        "MFG",
        type_="mfg",
        title=f"外协件回厂待检：{row.item_no}（{row.project_no} / {row.equip_no}）",
        body="请验收（合格后转运装配区）。",
        link="/manufacturing",
        biz_type="outsource",
        biz_id=row.id,
        actor_id=actor_id,
    )
    return row


def outsource_accept(
    session: Session,
    row: OutsourceTask,
    *,
    actor_id: int,
    result: str,
    reason: str | None = None,
    photos: list | None = None,
) -> OutsourceTask:
    if row.status != OS_BACK:
        raise ManufacturingError(f"当前状态「{row.status}」，不能验收")
    row.status = OS_OK if result == ACCEPT_OK else OS_SENT
    if photos:
        row.photos = list(photos)
    if reason:
        row.remark = reason
    if result != ACCEPT_OK:
        targets = project_team_ids(session, row.project_no)
        notify.notify(
            session,
            targets,
            type_="mfg",
            title=f"外协件不合格：{row.item_no}（{row.project_no} / {row.equip_no}）",
            body=f"原因：{reason or '—'}。需重新发外协或改自制。",
            link="/manufacturing",
            biz_type="outsource",
            biz_id=row.id,
            actor_id=actor_id,
        )
    return row


# --------------------------------------------------------------------------
# 查询 / 视图
# --------------------------------------------------------------------------


def workbench_view(session: Session) -> dict:
    """车间台数据：待下发 / 在制 / 待验收 / 待转运 / 返工 / 超期 / 外协。"""
    today = date.today()
    orders = session.scalars(select(ProdOrder)).all()
    os_rows = session.scalars(select(OutsourceTask)).all()

    def _pick(*sts: str) -> list[dict]:
        picked = [o for o in orders if o.status in sts]
        picked.sort(key=lambda o: (o.plan_end or date.max, o.id))
        return [_order_brief(session, o) for o in picked]

    waiting = _pick(PROD_WAIT)
    running = _pick(PROD_DISPATCHED, PROD_RUNNING)
    overdue = [
        o
        for o in orders
        if o.plan_end and o.plan_end < today and o.status in (PROD_WAIT, PROD_DISPATCHED, PROD_RUNNING)
    ]
    return {
        "counts": {
            "wait": len(waiting),
            "running": len(running),
            "to_accept": len(running),
            "to_transfer": len([o for o in orders if o.status == PROD_DONE]),
            "rework": len([o for o in orders if o.status == PROD_REWORK]),
            "transferred": len([o for o in orders if o.status == PROD_TRANSFERRED]),
            "overdue": len(overdue),
            "outsource": len([o for o in os_rows if o.status in (OS_WAIT, OS_SENT, OS_BACK)]),
        },
        "wait": waiting,
        "running": running,
        "to_accept": running,
        "to_transfer": _pick(PROD_DONE),
        "rework": _pick(PROD_REWORK),
        "outsource": [_os_brief(o) for o in os_rows if o.status in (OS_WAIT, OS_SENT, OS_BACK)],
    }


def _order_brief(session: Session, o: ProdOrder) -> dict:
    return {
        "id": o.id,
        "order_no": o.order_no,
        "project_no": o.project_no,
        "equip_no": o.equip_no,
        "item_no": o.item_no,
        "item_name": o.item_name,
        "qty": float(o.qty or 0),
        "unit": o.unit,
        "plan_start": o.plan_start,
        "plan_end": o.plan_end,
        "status": o.status,
        "team": o.team,
        "material_item_no": _material_of(session, o.item_no),
    }


def _os_brief(o: OutsourceTask) -> dict:
    return {
        "id": o.id,
        "outsource_no": o.outsource_no,
        "project_no": o.project_no,
        "equip_no": o.equip_no,
        "item_no": o.item_no,
        "item_name": o.item_name,
        "qty": float(o.qty or 0),
        "supplier_name": o.supplier_name,
        "material_supplied": o.material_supplied,
        "sent_at": o.sent_at,
        "due_date": o.due_date,
        "returned_at": o.returned_at,
        "status": o.status,
    }


def order_dict(session: Session, o: ProdOrder) -> dict:
    tasks = session.scalars(
        select(ProdTask).where(ProdTask.prod_order_id == o.id).order_by(ProdTask.id)
    ).all()
    accs = session.scalars(
        select(ProdAcceptance).where(ProdAcceptance.prod_order_id == o.id).order_by(ProdAcceptance.id)
    ).all()
    return {
        "id": o.id,
        "order_no": o.order_no,
        "project_no": o.project_no,
        "equip_no": o.equip_no,
        "item_no": o.item_no,
        "item_name": o.item_name,
        "spec_text": o.spec_text,
        "qty": float(o.qty or 0),
        "unit": o.unit,
        "plan_start": o.plan_start,
        "plan_end": o.plan_end,
        "status": o.status,
        "team": o.team,
        "worker_id": o.worker_id,
        "remark": o.remark,
        "material_item_no": _material_of(session, o.item_no),
        "tasks": [
            {
                "id": t.id,
                "step_name": t.step_name,
                "material_item_no": t.material_item_no,
                "material_qty": float(t.material_qty) if t.material_qty is not None else None,
                "drawing_no": t.drawing_no,
                "drawing_version": t.drawing_version,
                "issued_to": t.issued_to,
                "issued_at": t.issued_at,
                "photos": t.photos or [],
                "remark": t.remark,
            }
            for t in tasks
        ],
        "acceptances": [
            {
                "id": a.id,
                "result": a.result,
                "reason": a.reason,
                "accepted_at": a.accepted_at,
                "photos": a.photos or [],
                "transfer_at": a.transfer_at,
                "transfer_to": a.transfer_to,
                "transfer_photos": a.transfer_photos or [],
            }
            for a in accs
        ],
    }
