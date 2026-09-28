"""齐套率 + 装配与厂内调试（《00 方案》§3.3 S6 · 《02 数据模型》§7）。

**齐套率只做展示**（用户确认）：装配随时可以开工，56%、78% 都能装，视情况而定 ——
系统不设 100% 门槛，只把「这台设备到了多少个件、还差什么」摆出来。

齐套口径（按**零件种数**为主，同时给出数量）：
  · 自制件   → 排产单状态「已转运」（已转到装配区）
  · 外协件   → 外协状态「合格」
  · 定制件/标准件（图号）  → 已入库（库存可用 > 0）或有采购到货/入库记录
  · 标准件/原材料（BOM 行）→ 库存可用 ≥ 需求
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.assembly import ASSY_DEBUG_DONE, ASSY_DONE, AssemblyRecord, KittingSnapshot
from app.models.engineering import BOM_MATERIAL, BOM_ROW_FROZEN, BomItem, Drawing
from app.models.initiation import GoodsReceipt, PurchaseRequest
from app.models.library import Item
from app.models.production import OS_OK, PROD_TRANSFERRED, OutsourceTask, ProdOrder
from app.models.project import Equipment
from app.models.warehouse import MaterialIssue, MaterialIssueLine
from app.services.bom_demand import _stock_available
from app.services.bom_math import bom_line_demand, cumulative_qty, drawing_demand, is_ready

SOURCE_SELF_MADE = "自制件"
SOURCE_OUTSOURCE = "外协件"
DRAWING_PUBLISHED = "已发布"

# 采购已到（还没入库也算到货）的需求状态。
# ★ 去掉非法值「已完成」（那是采购单视图算出来的，非 REQUEST_STATUS）；补「已入库/现场已验收」
ARRIVED_STATUS = ("待入库", "部分到货", "已入库", "现场已验收")


def _qty(v) -> float:
    return float(v or 0)


def _issued_to_workshop(session: Session, project_no: str) -> dict[str, float]:
    """本项目已领走到车间的数量（领料单已领走 / 部分领料）。从装配视角，这些料也算到位。

    用 `qty_issued`（实发）而非 `qty_required`（需求）：缺料行实发 0，不能算领到（BM-10）。
    """
    rows = session.execute(
        select(MaterialIssueLine.item_no, func.sum(MaterialIssueLine.qty_issued))
        .join(MaterialIssue, MaterialIssue.id == MaterialIssueLine.issue_id)
        .where(
            MaterialIssue.project_no == project_no,
            MaterialIssue.status.in_(("已领走", "部分领料")),
        )
        .group_by(MaterialIssueLine.item_no)
    ).all()
    return {item_no: float(qty or 0) for item_no, qty in rows}


def _ready_purchased(
    session: Session, item_no: str, have: float, need: float, project_no: str
) -> tuple[bool, str]:
    """买来的件到位没有：手上（库存 + 已领到车间）够 → 到位；否则看到货/入库记录。

    ★ 三个查询都带 `project_no`：标准件 `item_no` 全公司共用，不能拿别项目的到货算本项目到位
      （BM-12）；直发件靠状态「现场已验收」判到位（BM-13 / 客户口径：齐套率含直发件）。
    """
    if is_ready(have, need):
        return True, "已入库"
    pr = session.scalars(
        select(PurchaseRequest).where(
            PurchaseRequest.item_no == item_no,
            PurchaseRequest.project_no == project_no,
            PurchaseRequest.status.in_(ARRIVED_STATUS),
        )
    ).first()
    if pr is not None:
        return True, f"已到货（{pr.status}）"
    gr = session.scalar(
        select(GoodsReceipt).where(
            GoodsReceipt.item_no == item_no,
            GoodsReceipt.project_no == project_no,
            GoodsReceipt.status.in_(("已入库", "现场已验收")),
        )
    )
    if gr is not None:
        return True, gr.status
    in_flight = session.scalar(
        select(PurchaseRequest).where(
            PurchaseRequest.item_no == item_no,
            PurchaseRequest.project_no == project_no,
            PurchaseRequest.status.in_(("待采购", "在途", "待入库", "现场待验收", "部分到货")),
        )
    )
    return False, "已下单在途" if in_flight is not None else "未采购"


def compute(session: Session, project_no: str, equip_no: str) -> dict:
    """算一台设备的齐套率 + 缺什么。**不设门槛**，只展示。"""
    drawings = session.scalars(
        select(Drawing).where(Drawing.project_no == project_no, Drawing.equip_no == equip_no)
    ).all()
    published = [d for d in drawings if d.status == DRAWING_PUBLISHED]
    tree_nos = {d.drawing_no for d in drawings}
    cum = cumulative_qty(drawings)
    stock = _stock_available(session)
    issued = _issued_to_workshop(session, project_no)

    prod = {
        o.item_no: o
        for o in session.scalars(
            select(ProdOrder).where(ProdOrder.project_no == project_no, ProdOrder.equip_no == equip_no)
        ).all()
    }
    outsource = {
        o.item_no: o
        for o in session.scalars(
            select(OutsourceTask).where(
                OutsourceTask.project_no == project_no, OutsourceTask.equip_no == equip_no
            )
        ).all()
    }

    lines: list[dict] = []

    # ① 有图号的件：自制 / 外协 / 定制 / 标准（总装图是装配对象，不计入齐套）
    for d in published:
        if d.parent_drawing_no is None:
            continue
        need = drawing_demand(d, cum)
        if d.source_type == SOURCE_SELF_MADE:
            o = prod.get(d.drawing_no)
            ready = bool(o and o.status == PROD_TRANSFERRED)
            state = o.status if o else "未排产"
            src = "自制"
        elif d.source_type == SOURCE_OUTSOURCE:
            o = outsource.get(d.drawing_no)
            ready = bool(o and o.status == OS_OK)
            state = o.status if o else "未发出"
            src = "外协"
        else:
            have = stock.get(d.drawing_no, 0.0) + issued.get(d.drawing_no, 0.0)
            ready, state = _ready_purchased(session, d.drawing_no, have, need, project_no)
            src = "采购"
        lines.append(
            {
                "ref": d.drawing_no,
                "name": d.title,
                "kind": d.source_type,
                "source": src,
                "qty": need,
                "unit": d.unit,
                "ready": ready,
                "state": state,
            }
        )

    # ② 无图号的 BOM 行（标准件 / 原材料）
    rows = session.scalars(
        select(BomItem).where(
            BomItem.project_no == project_no,
            BomItem.parent_ref.in_(tree_nos),
            # 只算已冻结、未被改版替代的 BOM 行（与采购/领料同口径）
            BomItem.status == BOM_ROW_FROZEN,
            BomItem.superseded_by_id.is_(None),
        )
    ).all()
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    for b in rows:
        need = bom_line_demand(b, cum)
        have = stock.get(b.child_item_no, 0.0)
        taken = issued.get(b.child_item_no, 0.0)  # 已领到车间（本项目）
        ready = is_ready(have + taken, need)
        it = items.get(b.child_item_no)
        lines.append(
            {
                "ref": b.child_item_no,
                "name": it.display_name if it else b.child_item_no,
                "kind": "原材料" if b.bom_source == BOM_MATERIAL else "标准件",
                "source": "库存",
                "qty": need,
                "unit": it.unit if it else None,
                "ready": ready,
                "state": "已入库" if ready else (f"有 {have:g}" if have > 0 else "未到"),
            }
        )

    total = len(lines)
    arrived = len([x for x in lines if x["ready"]])
    total_qty = sum(x["qty"] for x in lines)
    arrived_qty = sum(x["qty"] for x in lines if x["ready"])
    return {
        "project_no": project_no,
        "equip_no": equip_no,
        "total": total,
        "arrived": arrived,
        "total_qty": total_qty,
        "arrived_qty": arrived_qty,
        "kitting_rate": round(arrived / total, 4) if total else 0.0,
        "missing": [x for x in lines if not x["ready"]],
        "lines": lines,
    }


def overview(session: Session, project_no: str) -> list[dict]:
    """一个项目下每台设备的齐套率（装配人员一眼看能不能开工）。"""
    equips = session.scalars(
        select(Equipment).where(Equipment.project_no == project_no).order_by(Equipment.equip_no)
    ).all()
    out = []
    for e in equips:
        k = compute(session, project_no, e.equip_no)
        out.append(
            {
                "equip_no": e.equip_no,
                "equip_name": e.equip_name,
                "total": k["total"],
                "arrived": k["arrived"],
                "total_qty": k["total_qty"],
                "arrived_qty": k["arrived_qty"],
                "kitting_rate": k["kitting_rate"],
            }
        )
    return out


# --------------------------------------------------------------------------
# 装配 / 厂内调试
# --------------------------------------------------------------------------


def snapshot(session: Session, project_no: str, equip_no: str, actor_id: int | None = None) -> KittingSnapshot:
    """把当前齐套率存一份快照（装配开工时记录「当时到了多少」）。"""
    k = compute(session, project_no, equip_no)
    row = KittingSnapshot(
        project_no=project_no,
        equip_no=equip_no,
        snapshot_at=datetime.now(UTC),
        total_qty=k["total_qty"],
        arrived_qty=k["arrived_qty"],
        kitting_rate=k["kitting_rate"],
        detail={"total": k["total"], "arrived": k["arrived"], "missing": k["missing"][:50]},
    )
    session.add(row)
    session.flush()
    return row


def start_assembly(
    session: Session,
    *,
    project_no: str,
    equip_no: str,
    sub_assembly: str,
    actor_id: int,
    photos: list | None = None,
    remark: str | None = None,
) -> AssemblyRecord:
    """开始装配（整机 / 组件预装）。**不校验齐套率** —— 到了多少都行，快照留档。"""
    snap = snapshot(session, project_no, equip_no, actor_id)
    row = AssemblyRecord(
        project_no=project_no,
        equip_no=equip_no,
        sub_assembly=sub_assembly or "整机装配",
        kitting_rate=snap.kitting_rate,
        total_qty=snap.total_qty,
        arrived_qty=snap.arrived_qty,
        status="装配中",
        assembled_by=actor_id,
        assembled_at=datetime.now(UTC),
        photos=list(photos or []),
        remark=remark,
    )
    session.add(row)
    session.flush()
    return row


def finish_assembly(
    session: Session,
    rec: AssemblyRecord,
    *,
    photos: list | None = None,
    remark: str | None = None,
) -> AssemblyRecord:
    rec.status = ASSY_DONE
    if photos:
        rec.photos = list(rec.photos or []) + list(photos)
    if remark:
        rec.remark = remark
    return rec


def debug(
    session: Session,
    rec: AssemblyRecord,
    *,
    actor_id: int,
    result: str,
    note: str | None = None,
    photos: list | None = None,
) -> AssemblyRecord:
    """厂内调试记录（单机调试 / 联调）。result：合格 / 有问题。"""
    rec.status = ASSY_DEBUG_DONE if result == "合格" else "调试中"
    rec.debug_by = actor_id
    rec.debug_at = datetime.now(UTC)
    rec.debug_result = result
    rec.debug_note = note
    if photos:
        rec.debug_photos = list(rec.debug_photos or []) + list(photos)
    return rec


def record_dict(r: AssemblyRecord) -> dict:
    return {
        "id": r.id,
        "project_no": r.project_no,
        "equip_no": r.equip_no,
        "sub_assembly": r.sub_assembly,
        "kitting_rate": float(r.kitting_rate or 0),
        "total_qty": float(r.total_qty or 0),
        "arrived_qty": float(r.arrived_qty or 0),
        "status": r.status,
        "assembled_by": r.assembled_by,
        "assembled_at": r.assembled_at,
        "photos": r.photos or [],
        "debug_by": r.debug_by,
        "debug_at": r.debug_at,
        "debug_result": r.debug_result,
        "debug_note": r.debug_note,
        "debug_photos": r.debug_photos or [],
        "remark": r.remark,
    }
