"""仓库接口：库位 / 库存 / 出入库 / 领料单（S5 仓库三件事）。"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user, require_permission
from app.core.db import get_session
from app.models.engineering import BOM_ROW_FROZEN, Drawing
from app.models.initiation import GoodsReceipt, PurchaseRequest
from app.models.library import Item
from app.models.platform import User
from app.models.project import Equipment, Project
from app.models.warehouse import (
    ISSUE_STATUS,
    MOVE_IN,
    MOVE_OUT,
    MaterialIssue,
    MaterialIssueLine,
    StockItem,
    StockMove,
    WarehouseLocation,
)
from app.services import audit
from app.services.bom_math import bom_line_demand, cumulative_qty
from app.services.numbering import next_number, year_scope_key

router = APIRouter(prefix="/warehouse", tags=["仓库"])


def _qty(v) -> float:
    return float(v) if v is not None else 0.0


def _loc_name(loc: WarehouseLocation | None) -> str | None:
    return f"{loc.warehouse} {loc.code}" if loc else None


# ============================================================================
# ① 库位
# ============================================================================


@router.get("/locations")
def list_locations(session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    rows = session.scalars(select(WarehouseLocation).order_by(WarehouseLocation.warehouse, WarehouseLocation.code)).all()
    counts = dict(
        session.execute(
            select(StockItem.location_id, func.count()).where(StockItem.qty_on_hand > 0).group_by(StockItem.location_id)
        ).all()
    )
    return [
        {
            "id": l.id,
            "warehouse": l.warehouse,
            "code": l.code,
            "name": l.name,
            "item_count": counts.get(l.id, 0),
            "is_active": l.is_active,
        }
        for l in rows
    ]


class LocationIn(BaseModel):
    warehouse: str
    code: str
    name: str | None = None
    remark: str | None = None


@router.post("/locations", status_code=status.HTTP_201_CREATED)
def create_location(
    body: LocationIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("warehouse:edit")),
):
    dup = session.scalar(
        select(WarehouseLocation).where(
            WarehouseLocation.warehouse == body.warehouse, WarehouseLocation.code == body.code
        )
    )
    if dup:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{body.warehouse} {body.code} 已存在")
    row = WarehouseLocation(**body.model_dump())
    session.add(row)
    session.flush()
    audit.log(
        session,
        user=current,
        action="create",
        object_type="location",
        object_ref=f"{body.warehouse}/{body.code}",
        summary=f"新增库位 {body.warehouse} {body.code}",
        ip=client_ip(request),
    )
    session.commit()
    return {"id": row.id}


# ============================================================================
# ② 库存与流水
# ============================================================================


def _stock_dict(s: StockItem, item: Item | None, loc: WarehouseLocation | None) -> dict:
    return {
        "id": s.id,
        "item_no": s.item_no,
        "display_name": item.display_name if item else s.item_no,
        "spec_text": item.spec_text if item else None,
        "unit": item.unit if item else None,
        "location_id": s.location_id,
        "location_name": _loc_name(loc),
        "qty_on_hand": _qty(s.qty_on_hand),
        "qty_locked": _qty(s.qty_locked),
        "qty_available": _qty(s.qty_on_hand) - _qty(s.qty_locked),
        "batch_no": s.batch_no,
    }


@router.get("/stock")
def list_stock(
    q: str | None = None,
    location_id: int | None = None,
    only_available: bool = False,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    stmt = select(StockItem).order_by(StockItem.item_no)
    if location_id:
        stmt = stmt.where(StockItem.location_id == location_id)
    if only_available:
        stmt = stmt.where(StockItem.qty_on_hand > StockItem.qty_locked)
    rows = session.scalars(stmt.limit(500)).all()
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    locs = {l.id: l for l in session.scalars(select(WarehouseLocation)).all()}
    out = [_stock_dict(s, items.get(s.item_no), locs.get(s.location_id)) for s in rows]
    if q:
        like = q.lower()
        out = [
            x
            for x in out
            if like in (x["item_no"] or "").lower()
            or like in (x["display_name"] or "").lower()
            or like in (x["spec_text"] or "").lower()
        ]
    return out


@router.get("/moves")
def list_moves(
    limit: int = 100, session: Session = Depends(get_session), _: User = Depends(get_current_user)
):
    rows = session.scalars(select(StockMove).order_by(StockMove.id.desc()).limit(min(limit, 500))).all()
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    locs = {l.id: l for l in session.scalars(select(WarehouseLocation)).all()}
    names = {u.id: u.name for u in session.scalars(select(User)).all()}
    return [
        {
            "id": m.id,
            "item_no": m.item_no,
            "display_name": items[m.item_no].display_name if m.item_no in items else m.item_no,
            "move_type": m.move_type,
            "qty": _qty(m.qty),
            "from_location": _loc_name(locs.get(m.from_location_id)) if m.from_location_id else None,
            "to_location": _loc_name(locs.get(m.to_location_id)) if m.to_location_id else None,
            "project_no": m.project_no,
            "ref_no": m.ref_no,
            "operator": names.get(m.operator_id) if m.operator_id else None,
            "moved_at": m.moved_at,
            "remark": m.remark,
        }
        for m in rows
    ]


def _apply_stock(
    session: Session,
    *,
    item_no: str,
    qty: float,
    move_type: str,
    to_location_id: int | None = None,
    from_location_id: int | None = None,
    project_no: str | None = None,
    equip_no: str | None = None,
    ref_type: str | None = None,
    ref_no: str | None = None,
    operator_id: int | None = None,
    remark: str | None = None,
) -> None:
    """库存变动统一走这里：改库存 + 落流水。"""
    if move_type in (MOVE_OUT,) and from_location_id:
        s = session.scalar(
            select(StockItem).where(
                StockItem.item_no == item_no, StockItem.location_id == from_location_id
            )
        )
        if s:
            s.qty_on_hand = _qty(s.qty_on_hand) - qty
    elif move_type in (MOVE_IN,) and to_location_id:
        s = session.scalar(
            select(StockItem).where(
                StockItem.item_no == item_no, StockItem.location_id == to_location_id
            )
        )
        if s is None:
            s = StockItem(item_no=item_no, location_id=to_location_id, qty_on_hand=0, qty_locked=0)
            session.add(s)
            session.flush()
        s.qty_on_hand = _qty(s.qty_on_hand) + qty

    session.add(
        StockMove(
            item_no=item_no,
            move_type=move_type,
            qty=qty,
            from_location_id=from_location_id,
            to_location_id=to_location_id,
            project_no=project_no,
            equip_no=equip_no,
            ref_type=ref_type,
            ref_no=ref_no,
            operator_id=operator_id,
            moved_at=datetime.now(UTC),
            remark=remark,
        )
    )
    session.flush()


class InboundIn(BaseModel):
    item_no: str
    qty: float = Field(..., gt=0)
    location_id: int
    project_no: str | None = None
    equip_no: str | None = None
    ref_no: str | None = None
    remark: str | None = None


@router.post("/inbound", status_code=status.HTTP_201_CREATED)
def inbound(
    body: InboundIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("warehouse:edit")),
):
    """手工入库（没走采购流程的东西，比如退料回库、盘盈）。"""
    if session.get(Item, body.item_no) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"物料不存在：{body.item_no}")
    loc = session.get(WarehouseLocation, body.location_id)
    if loc is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "库位不存在")
    _apply_stock(
        session,
        item_no=body.item_no,
        qty=body.qty,
        move_type=MOVE_IN,
        to_location_id=body.location_id,
        project_no=body.project_no,
        equip_no=body.equip_no,
        ref_type="manual",
        ref_no=body.ref_no,
        operator_id=current.id,
        remark=body.remark,
    )
    item = session.get(Item, body.item_no)
    audit.log(
        session,
        user=current,
        action="create",
        object_type="stock_move",
        object_ref=body.item_no,
        summary=f"入库 {item.display_name if item else body.item_no} × {body.qty} → {_loc_name(loc)}",
        ip=client_ip(request),
    )
    session.commit()
    return {"ok": True}


# ============================================================================
# ③ 领料单
# ============================================================================


def _issue_dict(i: MaterialIssue, lines: list[MaterialIssueLine], items: dict[str, Item], locs: dict[int, WarehouseLocation]) -> dict:
    return {
        "id": i.id,
        "issue_no": i.issue_no,
        "project_no": i.project_no,
        "equip_no": i.equip_no,
        "status": i.status,
        "requested_at": i.requested_at,
        "picked_at": i.picked_at,
        "issued_to": i.issued_to,
        "issued_at": i.issued_at,
        "remark": i.remark,
        "line_count": len(lines),
        "shortage_count": len([x for x in lines if x.shortage]),
        "lines": [
            {
                "id": x.id,
                "item_no": x.item_no,
                "display_name": items[x.item_no].display_name if x.item_no in items else x.item_no,
                "spec_text": items[x.item_no].spec_text if x.item_no in items else None,
                "unit": items[x.item_no].unit if x.item_no in items else None,
                "qty_required": _qty(x.qty_required),
                "qty_issued": _qty(x.qty_issued),
                "location_id": x.location_id,
                "location_name": _loc_name(locs.get(x.location_id)) if x.location_id else None,
                "shortage": x.shortage,
                "for_part": x.for_part,
            }
            for x in lines
        ],
    }


@router.get("/issues")
def list_issues(
    status_filter: str | None = Query(default=None, alias="status"),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    stmt = select(MaterialIssue).order_by(MaterialIssue.id.desc())
    if status_filter:
        stmt = stmt.where(MaterialIssue.status == status_filter)
    rows = session.scalars(stmt.limit(200)).all()
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    locs = {l.id: l for l in session.scalars(select(WarehouseLocation)).all()}
    all_lines = session.scalars(select(MaterialIssueLine)).all()
    return [
        _issue_dict(i, [x for x in all_lines if x.issue_id == i.id], items, locs) for i in rows
    ]


@router.post("/projects/{project_no}/equipment/{equip_no}/generate-issue", status_code=status.HTTP_201_CREATED)
def generate_issue(
    project_no: str,
    equip_no: str,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("warehouse:edit")),
):
    """★ 按设备的 BOM 展开领料需求 → 查库存 → 生成领料单（缺的标出来）。

    要领什么：
      · 自制件 → 它的**原材料**（材料 BOM）
      · 整个设备下的**标准件**
    """
    drawings = session.scalars(
        select(Drawing).where(Drawing.project_no == project_no, Drawing.equip_no == equip_no)
    ).all()
    if not drawings:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "这台设备还没出图，没有可领的料")

    from app.models.engineering import BomItem  # noqa: PLC0415

    bom_rows = session.scalars(
        select(BomItem).where(
            BomItem.project_no == project_no,
            # ★ 只领「已冻结」的行，且排除改版后被替代的旧行 —— 否则按草稿 BOM 领料 / ECN 白走
            BomItem.status == BOM_ROW_FROZEN,
            BomItem.superseded_by_id.is_(None),
        )
    ).all()
    tree_nos = {d.drawing_no for d in drawings}
    cum = cumulative_qty(drawings)

    need: dict[str, float] = {}
    for_part: dict[str, str] = {}
    # 标准件 + 自制件的原材料：都在 BOM 行上，统一用「行数量 × 父件累计倍数」
    # （旧算法标准件不乘父级、原材料只乘直接父件一层 → qty>1 的多级树必少领）
    for b in bom_rows:
        if b.parent_ref not in tree_nos:
            continue
        need[b.child_item_no] = need.get(b.child_item_no, 0) + bom_line_demand(b, cum)
        for_part[b.child_item_no] = b.parent_ref

    if not need:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "这台设备还没有可领的料（标准件或材料 BOM 都是空的）",
        )

    issue_no = next_number(session, "ISSUE", scope_key=year_scope_key())
    issue = MaterialIssue(
        issue_no=issue_no,
        project_no=project_no,
        equip_no=equip_no,
        status="待备料",
        requested_by=current.id,
        requested_at=datetime.now(UTC),
    )
    session.add(issue)
    session.flush()

    shortage_items = []
    for item_no, qty in need.items():
        stocks = session.scalars(select(StockItem).where(StockItem.item_no == item_no)).all()
        available = sum(_qty(s.qty_on_hand) - _qty(s.qty_locked) for s in stocks)
        loc = None
        for s in sorted(stocks, key=lambda x: -(_qty(x.qty_on_hand) - _qty(x.qty_locked))):
            if _qty(s.qty_on_hand) - _qty(s.qty_locked) > 0:
                loc = s.location_id
                break
        short = available < qty
        session.add(
            MaterialIssueLine(
                issue_id=issue.id,
                item_no=item_no,
                qty_required=qty,
                location_id=loc,
                shortage=short,
                for_part=for_part.get(item_no),
            )
        )
        if short:
            item = session.get(Item, item_no)
            shortage_items.append(f"{item.display_name if item else item_no}（需 {qty:g}，有 {available:g}）")

    audit.log(
        session,
        user=current,
        action="create",
        object_type="material_issue",
        object_ref=issue_no,
        summary=f"生成领料单 {issue_no}（{project_no} / {equip_no}）：{len(need)} 种物料"
        + (f"，其中 {len(shortage_items)} 种库存不足：{'、'.join(shortage_items[:3])}" if shortage_items else "，库存都够"),
        ip=client_ip(request),
    )
    session.commit()
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    locs = {l.id: l for l in session.scalars(select(WarehouseLocation)).all()}
    lines = session.scalars(select(MaterialIssueLine).where(MaterialIssueLine.issue_id == issue.id)).all()
    return _issue_dict(issue, lines, items, locs)


class IssueActionIn(BaseModel):
    location_id: int | None = None  # 备料时指定从哪个库位出
    issued_to: str | None = None  # 领料人（车间）
    remark: str | None = None


@router.post("/issues/{issue_id}/pick")
def pick_issue(
    issue_id: int,
    body: IssueActionIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("warehouse:edit")),
):
    """仓库备料完成：锁定库存（qty_locked += 需求）。"""
    issue = session.get(MaterialIssue, issue_id)
    if issue is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "领料单不存在")
    if issue.status != "待备料":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"当前状态是「{issue.status}」，不能备料")
    lines = session.scalars(select(MaterialIssueLine).where(MaterialIssueLine.issue_id == issue.id)).all()
    for ln in lines:
        s = session.scalar(
            select(StockItem).where(StockItem.item_no == ln.item_no, StockItem.location_id == ln.location_id)
        ) if ln.location_id else None
        if s:
            s.qty_locked = _qty(s.qty_locked) + _qty(ln.qty_required)
    issue.status = "已备料"
    issue.picked_by = current.id
    issue.picked_at = datetime.now(UTC)
    audit.log(
        session,
        user=current,
        action="pick",
        object_type="material_issue",
        object_ref=issue.issue_no,
        summary=f"备料完成 {issue.issue_no}",
        ip=client_ip(request),
    )
    session.commit()
    return {"ok": True, "status": issue.status}


@router.post("/issues/{issue_id}/hand-over")
def hand_over_issue(
    issue_id: int,
    body: IssueActionIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("warehouse:edit")),
):
    """车间领走：扣库存、解锁占用、写出库流水。"""
    if not (body.issued_to or "").strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "必须填领料人（谁领走的）")
    issue = session.get(MaterialIssue, issue_id)
    if issue is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "领料单不存在")
    if issue.status != "已备料":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "要先备料才能领走")
    lines = session.scalars(select(MaterialIssueLine).where(MaterialIssueLine.issue_id == issue.id)).all()
    for ln in lines:
        if not ln.location_id:
            continue
        s = session.scalar(
            select(StockItem).where(StockItem.item_no == ln.item_no, StockItem.location_id == ln.location_id)
        )
        if s:
            s.qty_locked = max(0.0, _qty(s.qty_locked) - _qty(ln.qty_required))
        _apply_stock(
            session,
            item_no=ln.item_no,
            qty=_qty(ln.qty_required),
            move_type=MOVE_OUT,
            from_location_id=ln.location_id,
            project_no=issue.project_no,
            equip_no=issue.equip_no,
            ref_type="material_issue",
            ref_no=issue.issue_no,
            operator_id=current.id,
            remark=f"领料给车间（{body.issued_to or '—'}）",
        )
        ln.qty_issued = ln.qty_required
    issue.status = "已领走"
    issue.issued_to = body.issued_to
    issue.issued_at = datetime.now(UTC)
    audit.log(
        session,
        user=current,
        action="issue",
        object_type="material_issue",
        object_ref=issue.issue_no,
        summary=f"领料出库 {issue.issue_no}：{len(lines)} 种物料，领料人 {body.issued_to or '—'}",
        ip=client_ip(request),
    )
    session.commit()
    return {"ok": True, "status": issue.status}


# ============================================================================
# ④ 仓库工作台
# ============================================================================


@router.get("/workbench")
def workbench(session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    """仓库两个动作的待办：验收（在途的货到了就验）/ 入库（验收合格待入库）/ 领料。"""
    # ★ 待入库：验收合格、还没选库位入库的货
    receipts = session.scalars(
        select(GoodsReceipt).where(GoodsReceipt.status == "待入库", GoodsReceipt.deliver_to == "公司仓库")
    ).all()
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    projects = {p.project_no: p.project_name for p in session.scalars(select(Project)).all()}
    equips = {
        (e.project_no, e.equip_no): e.equip_name for e in session.scalars(select(Equipment)).all()
    }
    reqs = {r.id: r for r in session.scalars(select(PurchaseRequest)).all()}

    # ★ 待验收：还没到完的货（在途 / 部分到货，货到了就在这行上验收）
    incoming = session.scalars(
        select(PurchaseRequest)
        .where(
            PurchaseRequest.status.in_(("在途", "已下单", "部分到货")),
            or_(PurchaseRequest.deliver_to == "公司仓库", PurchaseRequest.deliver_to.is_(None)),
        )
        .order_by(PurchaseRequest.expected_date)
    ).all()

    issues = session.scalars(
        select(MaterialIssue).where(MaterialIssue.status.in_(("待备料", "已备料")))
    ).all()
    lines = session.scalars(select(MaterialIssueLine)).all()

    stock_total = session.scalar(select(func.count()).select_from(StockItem).where(StockItem.qty_on_hand > 0))
    low = session.scalars(
        select(StockItem).where(StockItem.qty_on_hand <= StockItem.qty_locked)
    ).all()

    return {
        # ☆ 待验收：货到了就验；合格 → 待入库，不合格 → 采购协商
        "incoming": [
            {
                "id": r.id,
                "project_no": r.project_no,
                "attribution": r.attribution,
                "project_name": projects.get(r.project_no),
                "equip_no": r.equip_no,
                "equip_name": equips.get((r.project_no, r.equip_no)),
                "item_no": r.item_no,
                "display_name": items[r.item_no].display_name if r.item_no in items else r.item_no,
                "spec_text": items[r.item_no].spec_text if r.item_no in items else None,
                "qty": _qty(r.qty),
                "qty_received": _qty(r.qty_received),
                "unit": r.unit,
                "po_no": r.po_no,
                "supplier_name": r.supplier_name,
                "need_date": r.need_date,
                "expected_date": r.expected_date,
                "overdue": bool(
                    r.expected_date and r.need_date and r.expected_date > r.need_date
                ),
            }
            for r in incoming
        ],
        # ☆ 待入库：验收合格，选库位入库
        "pending_storage": [
            {
                "id": g.id,
                "receipt_no": g.receipt_no,
                "project_no": g.project_no,
                "attribution": reqs[g.request_id].attribution if g.request_id in reqs else None,
                "project_name": projects.get(g.project_no),
                "request_id": g.request_id,
                "po_no": reqs[g.request_id].po_no if g.request_id in reqs else None,
                "equip_no": reqs[g.request_id].equip_no if g.request_id in reqs else None,
                "equip_name": (
                    equips.get((g.project_no, reqs[g.request_id].equip_no))
                    if g.request_id in reqs and reqs[g.request_id].equip_no
                    else None
                ),
                "supplier_name": reqs[g.request_id].supplier_name if g.request_id in reqs else None,
                "item_no": g.item_no,
                "display_name": items[g.item_no].display_name if g.item_no in items else g.item_no,
                "spec_text": items[g.item_no].spec_text if g.item_no in items else None,
                "qty": _qty(g.qty),
                "unit": g.unit,
                "receipt_date": g.receipt_date,
                "inspected_at": g.inspected_at,
            }
            for g in receipts
        ],
        "pending_issues": [
            {
                "id": i.id,
                "issue_no": i.issue_no,
                "project_no": i.project_no,
                "equip_no": i.equip_no,
                "status": i.status,
                "line_count": len([x for x in lines if x.issue_id == i.id]),
                "shortage_count": len([x for x in lines if x.issue_id == i.id and x.shortage]),
            }
            for i in issues
        ],
        "stock": {"item_kinds": stock_total or 0, "out_of_stock": len(low)},
    }
