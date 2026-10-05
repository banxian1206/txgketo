"""对象档案与全局检索（docs/13 §5 的 1/4/5/6 号接口）。

为什么单独开这个文件：00 卷 §2.1 承诺过两个视图 ——
「对售后：这台设备**全部历史**（图纸版本/装配人/检验/发运/现场改动/维修）都在」
「对采购/仓库：知道**哪台设备的哪个件**还没到」 —— 而系统里从来没有一个地方
按「件 / 设备」把它串起来（图纸在设计面、需求在采购台、领料在仓库台、排产在车间台…）。

这里只做**读侧聚合**（不改任何业务表、不复制业务逻辑）：
· `GET /search?q=`            粘一个编号/图号/物料号/名称 → 直达（18 类编号都能命中）
· `GET /items/{item_no}/dossier`            件档案：一个件的一生
· `GET /equipment/{p}/{e}/dossier`          设备档案：这台设备的设计/料/做/装/发/修
· `GET /timeline?ref=`        活动流：谁在什么时候干了什么（audit_log 为准）

★ 权限口径（不要在这里另起一套）：
  · 金额一律走 `deps.scrub_money`（无 `purchase:price` / `project:amount` → 字段返回 None）
  · 写操作一个都没有：全是 GET，不需要 `require_permission`，但**登录是必须的**
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, has_permission, scrub_money
from app.core.db import get_session
from app.models.assembly import AssemblyRecord
from app.models.change import ChangeRequest
from app.models.engineering import BomItem, Drawing, DrawingVersion
from app.models.initiation import GoodsReceipt, PurchaseRequest
from app.models.platform import User
from app.models.production import OutsourceTask, ProdOrder, ProdTask
from app.models.project import Equipment, Project
from app.models.purchase_order import PurchaseOrder
from app.models.service import ServiceOrder, SparePart
from app.models.shipment import Shipment, ShipmentItem
from app.models.site import SiteCommission, SiteDaily, SiteIssue, SiteSurvey
from app.models.task import Task
from app.models.warehouse import MaterialIssue, MaterialIssueLine, StockItem, StockMove

router = APIRouter(tags=["对象档案"])

# 单据号前缀 → (类型, 落点路由模板)。★ 只描述"粘这个号去哪"，不参与业务判断。
_CODE_ROUTES: list[tuple[str, str, str]] = [
    ("TX", "项目", "/projects/{v}"),
    ("PO", "采购单", "/purchase?tab=orders"),
    ("GR", "到货单", "/warehouse?tab=storage"),
    ("MI", "领料单", "/warehouse?tab=issues"),
    ("PR", "排产单", "/workbench/shop/mfg"),
    ("WX", "外协单", "/workbench/shop/mfg"),
    ("FH", "发运批次", "/delivery/shipping"),
    ("SV", "服务工单", "/delivery/service"),
    ("RV", "评审单", "/workbench/reviews"),
    ("RL", "发布批次", "/workbench/reviews"),
    ("CR", "改版申请", "/workbench/changes"),
    ("TK", "任务", "/workbench/tasks"),
    ("PC", "付款计划变更", "/projects"),
]


def _maybe_scrub(payload, user: User):
    """金额按权限裁剪（与全站同一口径）：有 `purchase:price` 或 `project:amount` 就原样，
    否则把 MONEY_KEYS 抹成 None —— **不是 403**（用户还能看档案，只是看不到钱）。"""
    if has_permission(user, "purchase:price") or has_permission(user, "project:amount"):
        return payload
    return scrub_money(payload)


def _user_name(session: Session, uid: int | None) -> str | None:
    if not uid:
        return None
    u = session.get(User, uid)
    return u.name if u else None


# ─────────────────────────────── 全局检索 ───────────────────────────────


@router.get("/search")
def global_search(
    q: str = Query(..., min_length=1, max_length=64),
    limit: int = Query(12, ge=1, le=30),
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """粘一个编号 / 图号 / 物料号 / 项目名 / 客户名 → 直达。

    为什么需要：铁律 2 是「图号 = 物料号」，铁律 1 是「编号只能由发号引擎生成」——
    也就是说**在这套系统里，编号就是入口**。而改造前全站只有 4 处列表内模糊搜，
    用户想查"PO26034 现在到哪了"得先猜它属于哪个台、哪个页签。
    """
    term = q.strip()
    like = f"%{term}%"
    out: list[dict] = []
    seen: set[str] = set()

    def add(kind: str, code: str | None, title: str, sub: str = "", route: str = "", money_key: bool = False):
        key = f"{kind}:{code}:{title}"
        if key in seen:
            return
        seen.add(key)
        out.append({"kind": kind, "code": code, "title": title, "sub": sub, "route": route, "money": money_key})

    # ① 项目 / 商机（号 + 名 + 客户名）
    for p in session.scalars(
        select(Project)
        .where(or_(Project.project_no.ilike(like), Project.project_name.ilike(like)))
        .limit(limit)
    ).all():
        add("项目", p.project_no, p.project_name, f"{p.stage}", f"/projects/{p.project_no}")
    if len(out) < limit:
        for p in session.scalars(
            select(Project).where(Project.project_no.ilike(f"{term}%")).limit(3)
        ).all():
            add("项目", p.project_no, p.project_name, p.stage, f"/projects/{p.project_no}")

    # ②b 设备（★ 2026-10-05：用户实测"设备档案没有入口" —— 命令栏也得能搜到设备）
    for e in session.scalars(
        select(Equipment)
        .where(or_(Equipment.equip_no.ilike(like), Equipment.equip_name.ilike(like), Equipment.model.ilike(like)))
        .limit(limit)
    ).all():
        add("设备", f"{e.project_no} {e.equip_no}", e.equip_name or e.equip_no,
            f"{e.project_no} · {e.kind or ''} {e.model or ''}".strip(),
            f"/equipment/{e.project_no}/{e.equip_no}")

    # ② 物料 / 图号（图号=物料号 → 同一个档案页）
    from app.models.library import Item

    for it in session.scalars(
        select(Item)
        .where(or_(Item.item_no.ilike(like), Item.display_name.ilike(like), Item.spec_text.ilike(like)))
        .limit(limit)
    ).all():
        add("物料", it.item_no, it.display_name or it.item_no,
            f"{it.source_type or ''} {it.spec_text or ''}".strip(), f"/items/{it.item_no}")

    # ③ 图纸（图号进件档案）
    for d in session.scalars(
        select(Drawing).where(or_(Drawing.drawing_no.ilike(like), Drawing.title.ilike(like))).limit(limit)
    ).all():
        add("图纸", d.drawing_no, d.title or d.drawing_no, f"{d.source_type} · {d.current_version}", f"/items/{d.drawing_no}")

    # ④ 单据类（前缀命中 + 精确命中）
    _doc_queries: list[tuple[str, str, object, str]] = [
        ("采购单", "po_no", PurchaseOrder, "/purchase?tab=orders"),
        ("到货单", "receipt_no", GoodsReceipt, "/warehouse?tab=storage"),
        ("领料单", "issue_no", MaterialIssue, "/warehouse?tab=issues"),
        ("排产单", "order_no", ProdOrder, "/workbench/shop/mfg"),
        ("外协单", "outsource_no", OutsourceTask, "/workbench/shop/mfg"),
        ("发运批次", "shipment_no", Shipment, "/delivery/shipping"),
        ("服务工单", "so_no", ServiceOrder, "/delivery/service"),
    ]
    for label, field, model, route in _doc_queries:
        col = getattr(model, field)
        for row in session.scalars(select(model).where(col.ilike(like)).limit(5)).all():
            code = getattr(row, field)
            sub = getattr(row, "status", "") or ""
            proj = getattr(row, "project_no", None)
            add(label, code, f"{label} {code}", f"{sub}{' · ' + proj if proj else ''}", route)

    # ⑤ 任务（按号或标题）
    for t in session.scalars(
        select(Task).where(or_(Task.task_no.ilike(like), Task.title.ilike(like))).limit(5)
    ).all():
        add("任务", t.task_no, t.title, f"{t.task_type} · {t.status}", "/workbench/tasks")

    # ⑥ 前缀直达兜底：粘 `PO26034` 这类但库里没命中 → 给出"去哪个台找"的提示（不假装有）
    if not out:
        for prefix, label, route in _CODE_ROUTES:
            if term.upper().startswith(prefix):
                add(label, term.upper(), f"没有找到「{term.upper()}」", f"可能不属于你可见的范围；去{label}列表里找", route)

    return {"q": term, "count": len(out), "items": _maybe_scrub(out, current)}


# ─────────────────────────────── 件档案 ───────────────────────────────


@router.get("/items/{item_no}/dossier")
def item_dossier(
    item_no: str,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """一个件的一生：设计 → 需求 → 采购 → 到货/入库 → 领料 → 排产/外协 → 装配 → 发运 → 现场 → 售后。

    `item_no` 既可以是标准库物料号（`YL-BC-0001`），也可以是图号（`TX26001-01A-01-01-00-00`）——
    铁律 2：图号 = 物料号，所以两者共用同一个档案页。
    """
    from app.models.library import Item

    item = session.get(Item, item_no)
    drawing = session.get(Drawing, item_no)
    if item is None and drawing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"没有这个物料 / 图号：{item_no}")

    project_no = (item.project_no if item else None) or (drawing.project_no if drawing else None)
    equip_no = drawing.equip_no if drawing else None
    project = session.get(Project, project_no) if project_no else None

    # ① 图纸（自制/定制件才有）
    drawings = []
    if drawing is not None:
        ver = session.scalar(
            select(DrawingVersion)
            .where(DrawingVersion.drawing_no == item_no, DrawingVersion.is_current.is_(True))
            .limit(1)
        )
        drawings.append({
            "drawing_no": drawing.drawing_no,
            "title": drawing.title,
            "qty": float(drawing.qty or 0),
            "unit": drawing.unit,
            "source_type": drawing.source_type,
            "status": drawing.status,
            "version": drawing.current_version,
            "file": bool(ver and ver.file_path),
            "owner": _user_name(session, drawing.owner_id),
            "parent": drawing.parent_drawing_no,
        })
        # 同项目的兄弟件（结构上下文）：父级 + 直接子件
        parents = []
        if drawing.parent_drawing_no:
            p = session.get(Drawing, drawing.parent_drawing_no)
            if p:
                parents.append({"drawing_no": p.drawing_no, "title": p.title})
        children = [
            {"drawing_no": d.drawing_no, "title": d.title, "qty": float(d.qty or 0), "status": d.status}
            for d in session.scalars(
                select(Drawing).where(Drawing.parent_drawing_no == item_no).limit(50)
            ).all()
        ]
    else:
        parents, children = [], []

    # ①b 材料/标准件 BOM（挂在哪个父件下、多少、冻结没）
    bom_rows = [
        {
            "parent_ref": b.parent_ref,
            "qty": float(b.qty or 0),
            "kind": b.bom_source,
            "status": b.status,
            "superseded": b.superseded_by_id is not None,
        }
        for b in session.scalars(
            select(BomItem).where(BomItem.child_item_no == item_no, BomItem.superseded_by_id.is_(None)).limit(50)
        ).all()
    ]

    # ② 采购：需求 → 采购单（同一个 po_no）
    reqs = session.scalars(
        select(PurchaseRequest).where(PurchaseRequest.item_no == item_no).order_by(PurchaseRequest.id.desc()).limit(30)
    ).all()
    requests = [
        {
            "id": r.id,
            "status": r.status,
            "qty": float(r.qty or 0),
            "unit": r.unit,
            "po_no": r.po_no,
            "supplier": r.supplier_name,
            "unit_price": float(r.unit_price) if r.unit_price is not None else None,
            "amount": float(r.amount) if r.amount is not None else None,
            "need_date": r.need_date.isoformat() if r.need_date else None,
            "expected_date": r.expected_date.isoformat() if r.expected_date else None,
            "ordered_at": r.ordered_at.isoformat() if r.ordered_at else None,
            "deliver_to": r.deliver_to,
            "source": r.source,
            "part_no": r.part_no,
            "project_no": r.project_no,
            "equip_no": r.equip_no,
        }
        for r in reqs
    ]

    # ③ 到货单
    receipts = [
        {
            "receipt_no": g.receipt_no,
            "qty": float(g.qty or 0),
            "unit": g.unit,
            "status": g.status,
            "receipt_date": g.receipt_date.isoformat() if g.receipt_date else None,
            "location": g.location,
            "inspect_note": g.inspect_note,
            "photos": len(g.photos or []),
            "project_no": g.project_no,
        }
        for g in session.scalars(
            select(GoodsReceipt).where(GoodsReceipt.item_no == item_no).order_by(GoodsReceipt.id.desc()).limit(30)
        ).all()
    ]

    # ④ 库存 / 流水
    stock = [
        {
            "location_id": s.location_id,
            "qty_on_hand": float(s.qty_on_hand or 0),
            "qty_locked": float(s.qty_locked or 0),
            "batch_no": s.batch_no,
        }
        for s in session.scalars(select(StockItem).where(StockItem.item_no == item_no).limit(30)).all()
    ]
    moves = [
        {
            "move_type": m.move_type,
            "qty": float(m.qty or 0),
            "ref_no": m.ref_no,
            "project_no": m.project_no,
            "equip_no": m.equip_no,
            "moved_at": m.moved_at.isoformat() if m.moved_at else None,
            "operator": _user_name(session, m.operator_id),
        }
        for m in session.scalars(
            select(StockMove).where(StockMove.item_no == item_no).order_by(StockMove.id.desc()).limit(20)
        ).all()
    ]

    # ⑤ 领料行
    issues = [
        {
            "issue_no": mi.issue_no,
            "status": mi.status,
            "project_no": mi.project_no,
            "equip_no": mi.equip_no,
            "qty_required": float(ln.qty_required or 0),
            "qty_picked": float(ln.qty_picked or 0),
            "qty_issued": float(ln.qty_issued or 0),
            "shortage": bool(ln.shortage),
            "for_part": ln.for_part,
            "issued_to": mi.issued_to,
        }
        for ln, mi in session.execute(
            select(MaterialIssueLine, MaterialIssue)
            .join(MaterialIssue, MaterialIssue.id == MaterialIssueLine.issue_id)
            .where(MaterialIssueLine.item_no == item_no)
            .order_by(MaterialIssueLine.id.desc())
            .limit(20)
        ).all()
    ]

    # ⑥ 排产 / 派工（按哪版图干）/ 外协
    prod = [
        {
            "order_no": o.order_no,
            "status": o.status,
            "qty": float(o.qty or 0),
            "plan_start": o.plan_start.isoformat() if o.plan_start else None,
            "plan_end": o.plan_end.isoformat() if o.plan_end else None,
            "team": o.team,
            "project_no": o.project_no,
            "equip_no": o.equip_no,
            "overdue": bool(o.plan_end and o.plan_end.isoformat() < __import__("datetime").date.today().isoformat()
                           and o.status not in ("已转运", "已取消")),
        }
        for o in session.scalars(
            select(ProdOrder).where(ProdOrder.item_no == item_no).order_by(ProdOrder.id.desc()).limit(20)
        ).all()
    ]
    prod_tasks = [
        {
            "step_name": t.step_name,
            "drawing_no": t.drawing_no,
            "drawing_version": t.drawing_version,
            "material_item_no": t.material_item_no,
            "material_qty": float(t.material_qty or 0) if t.material_qty is not None else None,
            "issued_to": t.issued_to,
            "photos": len(t.photos or []),
        }
        for t in session.scalars(
            select(ProdTask).where(ProdTask.drawing_no == item_no).order_by(ProdTask.id.desc()).limit(20)
        ).all()
    ]
    outsourced = [
        {
            "outsource_no": o.outsource_no,
            "status": o.status,
            "qty": float(o.qty or 0),
            "supplier": o.supplier_name,
            "sent_at": o.sent_at.isoformat() if o.sent_at else None,
            "due_date": o.due_date.isoformat() if o.due_date else None,
            "returned_at": o.returned_at.isoformat() if o.returned_at else None,
            "material_supplied": o.material_supplied,
            "project_no": o.project_no,
        }
        for o in session.scalars(
            select(OutsourceTask).where(OutsourceTask.item_no == item_no).order_by(OutsourceTask.id.desc()).limit(20)
        ).all()
    ]

    # ⑦ 装配（快照明细里出现过这个件）
    assembly = [
        {
            "project_no": a.project_no,
            "equip_no": a.equip_no,
            "sub_assembly": a.sub_assembly,
            "status": a.status,
            "kitting_rate": float(a.kitting_rate or 0),
            "assembled_at": a.assembled_at.isoformat() if a.assembled_at else None,
            "assembled_by": _user_name(session, a.assembled_by),
            "debug_result": a.debug_result,
        }
        for a in session.scalars(
            select(AssemblyRecord).where(AssemblyRecord.project_no == project_no).limit(20)
        ).all()
    ] if project_no else []

    # ⑧ 发运清单行 + 现场清点结果（"这个件发了没发、现场说到了没"）
    shipments = [
        {
            "shipment_no": sh.shipment_no,
            "status": sh.status,
            "equip_no": si.equip_no,
            "kind": si.kind,
            "qty": float(si.qty or 0),
            "shipped": bool(si.shipped),
            "shipped_at": si.shipped_at.isoformat() if si.shipped_at else None,
            "check_result": si.check_result,
            "check_qty": float(si.check_qty or 0) if si.check_qty is not None else None,
            "check_note": si.check_note,
            "photos": len(si.photos or []),
        }
        for si, sh in session.execute(
            select(ShipmentItem, Shipment)
            .join(Shipment, Shipment.id == ShipmentItem.shipment_id)
            .where(ShipmentItem.ref == item_no)
            .order_by(ShipmentItem.id.desc())
            .limit(20)
        ).all()
    ]

    # ⑨ 现场问题 / 售后备件
    site_issues = [
        {
            "title": s.title,
            "status": s.status,
            "project_no": s.project_no,
            "equip_no": s.equip_no,
            "desc": s.desc,
            "photos": len(s.photos or []),
        }
        for s in session.scalars(
            select(SiteIssue).where(or_(SiteIssue.item_no == item_no, SiteIssue.drawing_no == item_no)).limit(20)
        ).all()
    ]
    spare = [
        {
            "project_no": sp.project_no,
            "equip_no": sp.equip_no,
            "qty_stock": float(sp.qty_stock or 0),
            "qty_installed": float(sp.qty_installed or 0),
            "min_qty": float(sp.min_qty or 0),
        }
        for sp in session.scalars(select(SparePart).where(SparePart.item_no == item_no).limit(20)).all()
    ]

    # ⑩ 改版 / 评审（这个件被谁提过变更）
    changes = [
        {
            "cr_no": c.cr_no,
            "status": c.status,
            "target_type": c.target_type,
            "target_ref": c.target_ref,
            "target_version": c.target_version,
            "reason": c.reason,
            "applicant": _user_name(session, c.applicant_id),
            "decided_by": _user_name(session, c.decided_by),
        }
        for c in session.scalars(
            select(ChangeRequest)
            .where(or_(ChangeRequest.part_no == item_no, ChangeRequest.target_ref == item_no))
            .order_by(ChangeRequest.id.desc())
            .limit(20)
        ).all()
    ]

    # ⑪ 一句话结论：这个件现在**卡在哪**（采购/制造/发运/现场/售后 一览）
    open_reqs = [r for r in requests if r["status"] in ("待采购", "在途", "部分到货", "待入库", "不合格")]
    open_prod = [o for o in prod if o["status"] not in ("已转运", "已取消")]
    open_out = [o for o in outsourced if o["status"] not in ("合格", "已取消")]
    blocked = []
    if open_out:
        blocked.append(f"外协未回厂（{open_out[0]['outsource_no']}）")
    for o in open_prod[:2]:
        blocked.append(f"{o['order_no']} {o['status']}")
    for r in open_reqs[:2]:
        blocked.append(f"{r['status']}{'（' + str(r['po_no']) + '）' if r['po_no'] else ''}")
    if not shipments and project_no:
        blocked.append("还没进发运清单")

    payload = {
        "item_no": item_no,
        "kind": "自制/定制件" if drawing is not None else "标准件/原材料",
        "display_name": (item.display_name if item else None) or (drawing.title if drawing else item_no),
        "spec_text": item.spec_text if item else None,
        "brand": item.brand if item else None,
        "unit": item.unit if item else (drawing.unit if drawing else None),
        "source_type": (item.source_type if item else None) or (drawing.source_type if drawing else None),
        "project_no": project_no,
        "project_name": project.project_name if project else None,
        "equip_no": equip_no,
        "drawings": drawings,
        "parents": parents,
        "children": children,
        "bom_rows": bom_rows,
        "requests": requests,
        "receipts": receipts,
        "stock": stock,
        "moves": moves,
        "issues": issues,
        "prod_orders": prod,
        "prod_tasks": prod_tasks,
        "outsource": outsourced,
        "assembly": assembly,
        "shipments": shipments,
        "site_issues": site_issues,
        "spare_parts": spare,
        "changes": changes,
        "blocked": blocked,
        "counts": {
            "requests": len(requests),
            "receipts": len(receipts),
            "issues": len(issues),
            "prod": len(prod),
            "outsource": len(outsourced),
            "shipments": len(shipments),
            "changes": len(changes),
        },
    }
    return _maybe_scrub(payload, current)


# ─────────────────────────────── 设备档案 ───────────────────────────────


@router.get("/equipment/{project_no}/{equip_no}/dossier")
def equipment_dossier(
    project_no: str,
    equip_no: str,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """这台设备的全部历史（00 卷 §2.1 对售后的承诺）。

    设计面是"设计这一个环节的工位"，而这里回答的是"**这台设备**从设计到售后整个过程"：
    图纸与版本 → 关键件与齐套 → 排产/外协 → 装配与调试 → 发运批次与现场清点 → 现场问题 → 售后工单。
    """
    equip = session.scalar(
        select(Equipment).where(Equipment.project_no == project_no, Equipment.equip_no == equip_no)
    )
    if equip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"项目 {project_no} 下没有设备 {equip_no}")
    project = session.get(Project, project_no)

    # ① 图纸（树）：只列顶层 + 计数，完整树在设计面
    tops = session.scalars(
        select(Drawing)
        .where(
            Drawing.project_no == project_no,
            Drawing.equip_no == equip_no,
            Drawing.parent_drawing_no.is_(None),
        )
        .limit(1)
    ).all()
    all_drawings = session.scalars(
        select(Drawing).where(Drawing.project_no == project_no, Drawing.equip_no == equip_no).limit(500)
    ).all()
    by_status: dict[str, int] = {}
    for d in all_drawings:
        by_status[d.status] = by_status.get(d.status, 0) + 1
    versions = {
        v.drawing_no: v.version
        for v in session.scalars(
            select(DrawingVersion).where(DrawingVersion.drawing_no.in_([d.drawing_no for d in all_drawings] or [""]))
        ).all()
    }

    # ② 关键件（自制/外协/定制件 + 标准件/材料各取几条）——"还剩什么没到"
    drawings_rows = [
        {
            "drawing_no": d.drawing_no,
            "title": d.title,
            "qty": float(d.qty or 0),
            "unit": d.unit,
            "source_type": d.source_type,
            "status": d.status,
            "version": d.current_version,
            "owner": _user_name(session, d.owner_id),
            "has_current_file": bool(versions.get(d.drawing_no)),
        }
        for d in all_drawings
        if d.drawing_no != (tops[0].drawing_no if tops else None)
    ][:60]

    # ③ 排产 / 外协
    prod = [
        {
            "order_no": o.order_no,
            "item_no": o.item_no,
            "item_name": o.item_name,
            "status": o.status,
            "qty": float(o.qty or 0),
            "plan_end": o.plan_end.isoformat() if o.plan_end else None,
            "team": o.team,
        }
        for o in session.scalars(
            select(ProdOrder)
            .where(ProdOrder.project_no == project_no, ProdOrder.equip_no == equip_no)
            .order_by(ProdOrder.id.desc())
            .limit(50)
        ).all()
    ]
    outsourced = [
        {
            "outsource_no": o.outsource_no,
            "item_no": o.item_no,
            "item_name": o.item_name,
            "status": o.status,
            "supplier": o.supplier_name,
            "due_date": o.due_date.isoformat() if o.due_date else None,
        }
        for o in session.scalars(
            select(OutsourceTask)
            .where(OutsourceTask.project_no == project_no, OutsourceTask.equip_no == equip_no)
            .order_by(OutsourceTask.id.desc())
            .limit(50)
        ).all()
    ]

    # ④ 装配与厂内调试（★ 只认整机装配 —— 组件预装不得改写整机状态，N2/F8）
    asm = [
        {
            "id": a.id,
            "sub_assembly": a.sub_assembly,
            "status": a.status,
            "kitting_rate": float(a.kitting_rate or 0),
            "assembled_at": a.assembled_at.isoformat() if a.assembled_at else None,
            "assembled_by": _user_name(session, a.assembled_by),
            "debug_result": a.debug_result,
            "debug_note": a.debug_note,
            "debug_at": a.debug_at.isoformat() if a.debug_at else None,
            "unassembled": a.unassembled or [],
            "photos": len(a.photos or []) + len(a.debug_photos or []),
        }
        for a in session.scalars(
            select(AssemblyRecord)
            .where(AssemblyRecord.project_no == project_no, AssemblyRecord.equip_no == equip_no)
            .order_by(AssemblyRecord.id.desc())
            .limit(20)
        ).all()
    ]

    # ⑤ 发运（这个设备在哪些批次里、发了哪些件、现场清点结果）
    ship_rows = session.execute(
        select(ShipmentItem, Shipment)
        .join(Shipment, Shipment.id == ShipmentItem.shipment_id)
        .where(Shipment.project_no == project_no, ShipmentItem.equip_no == equip_no)
        .order_by(ShipmentItem.id.desc())
        .limit(200)
    ).all()
    shipments = []
    seen_ship: set[str] = set()
    for si, sh in ship_rows:
        if sh.shipment_no not in seen_ship:
            seen_ship.add(sh.shipment_no)
            shipments.append({
                "shipment_no": sh.shipment_no,
                "status": sh.status,
                "plan_ship_date": sh.plan_ship_date.isoformat() if sh.plan_ship_date else None,
                "depart_at": sh.depart_at.isoformat() if sh.depart_at else None,
                "arrive_at": sh.arrive_at.isoformat() if sh.arrive_at else None,
                "signed_at": sh.signed_at.isoformat() if sh.signed_at else None,
                "items": 0,
                "shipped": 0,
                "checked": 0,
                "short": 0,
            })
    idx = {x["shipment_no"]: x for x in shipments}
    for si, sh in ship_rows:
        row = idx.get(sh.shipment_no)
        if row:
            row["items"] += 1
            row["shipped"] += 1 if si.shipped else 0
            if si.check_result:
                row["checked"] += 1
                if si.check_result in ("缺", "损"):
                    row["short"] += 1

    # ⑥ 现场（勘测/日报/问题/调试申请）—— 表是按项目的，设备列有就过滤
    site_issues = [
        {
            "title": s.title,
            "status": s.status,
            "equip_no": s.equip_no,
            "drawing_no": s.drawing_no,
            "item_no": s.item_no,
            "desc": s.desc,
        }
        for s in session.scalars(
            select(SiteIssue)
            .where(SiteIssue.project_no == project_no, or_(SiteIssue.equip_no == equip_no, SiteIssue.equip_no.is_(None)))
            .limit(30)
        ).all()
    ]
    surveys = [
        {
            "enter_date": s.enter_date.isoformat() if s.enter_date else None,
            "contact": s.contact,
            "floor_load": s.floor_load,
            "passage": s.passage,
            "power": s.power,
        }
        for s in session.scalars(
            select(SiteSurvey).where(SiteSurvey.project_no == project_no).order_by(SiteSurvey.id.desc()).limit(3)
        ).all()
    ]
    dailies = [
        {
            "report_date": d.report_date.isoformat() if d.report_date else None,
            "stage": d.stage,
            "equip_no": d.equip_no,
            "people": d.people,
            "done": len(d.done_items or []),
            "problem": d.problem,
            "photos": len(d.photos or []),
            "videos": len(d.videos or []),
        }
        for d in session.scalars(
            select(SiteDaily)
            .where(SiteDaily.project_no == project_no, or_(SiteDaily.equip_no == equip_no, SiteDaily.equip_no.is_(None)))
            .order_by(SiteDaily.id.desc())
            .limit(20)
        ).all()
    ]
    commissions = [
        {
            "status": c.status,
            "dispatch_to": c.dispatch_to,
            "plan_date": c.plan_date.isoformat() if c.plan_date else None,
            "arrived_at": c.arrived_at.isoformat() if c.arrived_at else None,
        }
        for c in session.scalars(
            select(SiteCommission).where(SiteCommission.project_no == project_no).order_by(SiteCommission.id.desc()).limit(5)
        ).all()
    ]

    # ⑦ 售后工单（这台机器修过几次、在不在保）
    service = [
        {
            "so_no": o.so_no,
            "status": o.status,
            "fault": o.fault,
            "in_warranty": o.in_warranty,
            "dispatched_to": o.dispatched_to,
            "reported_at": o.reported_at.isoformat() if o.reported_at else None,
            "fixed_at": o.fixed_at.isoformat() if o.fixed_at else None,
            "solution": o.solution,
            "labor_hours": float(o.labor_hours or 0) if o.labor_hours is not None else None,
            "customer_sign": o.customer_sign,
        }
        for o in session.scalars(
            select(ServiceOrder)
            .where(ServiceOrder.project_no == project_no, ServiceOrder.equip_no == equip_no)
            .order_by(ServiceOrder.id.desc())
            .limit(30)
        ).all()
    ]

    # ⑧ 一句话结论 + 齐套（复用 services.kitting 的单一口径，不在这重算）
    kitting = None
    try:
        from app.services import kitting as kitting_svc

        # ★ `services.kitting.compute()` 返回的是 **dict**（`kitting_rate` / `arrived` / `total` …），
        #   不是对象 —— 我第一版用 `getattr` 取，结果齐套率**永远是 0**（口径漂移的典型：
        #   页面上显示一个假的 0%，比不显示更坏）。这里按 dict 取，并顺带给出缺料前几项。
        k = kitting_svc.compute(session, project_no, equip_no)
        kitting = {
            "rate": float(k.get("kitting_rate") or 0),
            "total": int(k.get("total") or 0),
            "arrived": int(k.get("arrived") or 0),
            "total_qty": float(k.get("total_qty") or 0),
            "arrived_qty": float(k.get("arrived_qty") or 0),
            "missing": [
                {"ref": m.get("ref"), "name": m.get("name"), "state": m.get("state"), "qty": m.get("qty")}
                for m in (k.get("missing") or [])[:20]
            ],
        }
    except Exception:  # 齐套算不出来不该让档案页打不开
        kitting = None

    blocked: list[str] = []
    for o in outsourced:
        if o["status"] not in ("合格", "已取消"):
            blocked.append(f"外协未回厂 {o['outsource_no']} {o['item_name'] or o['item_no']}")
    for o in prod:
        if o["status"] not in ("已转运", "已取消"):
            blocked.append(f"{o['order_no']} {o['status']}")
    for d in site_issues:
        if d["status"] == "待处理":
            blocked.append(f"现场问题：{d['title']}")
    for s in service:
        if s["status"] not in ("已关闭",):
            blocked.append(f"售后 {s['so_no']} {s['status']}")

    return _maybe_scrub({
        "project_no": project_no,
        "project_name": project.project_name if project else None,
        "equip_no": equip.equip_no,
        "equip_name": equip.equip_name,
        "kind": equip.kind,
        "model": equip.model,
        "line_no": equip.line_no,
        "bom_complete": bool(equip.bom_complete),
        "root_drawing_no": tops[0].drawing_no if tops else None,
        "drawing_summary": by_status,
        "drawings": drawings_rows,
        "prod_orders": prod,
        "outsource": outsourced,
        "assembly": asm,
        "shipments": shipments,
        "site_issues": site_issues,
        "site_surveys": surveys,
        "site_dailies": dailies,
        "site_commissions": commissions,
        "service_orders": service,
        "kitting": kitting,
        "blocked": blocked[:6],
    }, current)


# ─────────────────────────────── 活动流 ───────────────────────────────


@router.get("/timeline")
def timeline(
    ref: str = Query(..., min_length=1, max_length=64, description="对象引用：项目号 / 图号 / 单据号"),
    limit: int = Query(50, ge=1, le=200),
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """谁在什么时候干了什么 —— 以 `audit_log` 为准（铁律 5：所有写操作落审计）。

    为什么不用新的表：审计日志本来就全量落库、带 `object_ref` 与旧值→新值，
    只是过去只在"项目详情"里露了一小块。这里把它按对象聚合出来，供件/设备档案页用。
    """
    from app.models.platform import AuditLog

    rows = session.scalars(
        select(AuditLog)
        .where(or_(AuditLog.object_ref == ref, AuditLog.object_ref.ilike(f"{ref}%")))
        .order_by(AuditLog.id.desc())
        .limit(limit)
    ).all()
    return {
        "ref": ref,
        "count": len(rows),
        "items": [
            {
                "id": r.id,
                "at": r.created_at.isoformat() if r.created_at else None,
                "who": r.username or _user_name(session, r.user_id),
                "action": r.action,
                "object_type": r.object_type,
                "object_ref": r.object_ref,
                "summary": r.summary,
            }
            for r in rows
        ],
    }
