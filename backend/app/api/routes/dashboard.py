"""经营驾驶舱（00 卷 §2.1 对总经理的承诺：「在手订单、交付风险、项目毛利、售后质量，**一屏看完**」）。

为什么单独开接口：
  总经理今天登录后只有「我的工作台」——两张 0 数字卡 + 一张没有项目的表。
  而这个承诺写在方案第一页（§2.1「对总经理」），属于**承诺过、但一直没有**的视图。

只做**读侧聚合**（不改任何业务表）：四块内容各自复用已有的服务/口径 ——
  ① 在手订单：按阶段分布（数量 + 金额，金额走 scrub）
  ② 交付风险：交期临期/超期 × 齐套率 <70% × 长长期件在途
  ③ 卡点榜：每个在执行/交付的项目"现在卡在哪、卡几天、谁手上"
  ④ 售后与质保：60 天内到期质保 + 未关闭工单 + 备件低库存

★ 金额：无 `project:amount` / `cost:view` 的账号拿到的金额字段是 `None`（不是 403）。
  成本毛利在三期（`cost_entry` 未建表），这里**不假装有**：`cost` 块返回 `available: false` 并说明原因。
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, has_permission, scrub_money
from app.core.db import get_session
from app.models.acceptance import Acceptance
from app.models.assembly import AssemblyRecord
from app.models.initiation import PurchaseRequest
from app.models.platform import User
from app.models.project import Equipment, Project
from app.models.service import ServiceOrder, SparePart
from app.models.site import SiteIssue
from app.services import kitting as kitting_svc

router = APIRouter(prefix="/dashboard", tags=["驾驶舱"])

# 还在跑的阶段（驾驶舱只看这些；已关闭/已归档不算在手）
ACTIVE_STAGES = ("线索", "成交待立项", "执行中", "交付中", "质保")
# 采购需求里"还没到"的状态（与 services 的口径一致：这些算未完成）
OPEN_REQ = ("待采购", "在途", "部分到货", "待入库", "现场待验收", "不合格")


def _maybe_scrub(payload, user: User):
    """金额按权限裁剪（与全站一致：不是 403，而是字段为 None）。"""
    if has_permission(user, "project:amount") or has_permission(user, "cost:view"):
        return payload
    return scrub_money(payload)


@router.get("/gm")
def gm_dashboard(session: Session = Depends(get_session), current: User = Depends(get_current_user)):
    """一屏看完：在手订单 / 交付风险 / 卡点榜 / 售后与质保（+ 成本毛利占位说明）。"""
    today = date.today()
    projects = session.scalars(select(Project)).all()
    by_no = {p.project_no: p for p in projects}

    # ── ① 在手订单：阶段分布（数量 + 金额）──────────────────────────────
    stages: dict[str, dict] = {s: {"stage": s, "count": 0, "amount": 0.0} for s in ACTIVE_STAGES}
    for p in projects:
        if p.stage not in stages:
            continue
        stages[p.stage]["count"] += 1
        stages[p.stage]["amount"] += float(p.amount or 0)
    orders = {
        "total_count": sum(x["count"] for x in stages.values()),
        "total_amount": sum(x["amount"] for x in stages.values()),
        "by_stage": [stages[s] for s in ACTIVE_STAGES],
    }

    # ── ② 交付风险：交期临期/超期 + 齐套 <70% + 长周期件在途 ────────────────
    equipments = session.scalars(select(Equipment)).all()
    kitting_low: dict[str, list[dict]] = {}
    for eq in equipments:
        k = kitting_svc.compute(session, eq.project_no, eq.equip_no)
        rate = float(k.get("kitting_rate") or 0)
        if k.get("total") and rate < 0.7:
            kitting_low.setdefault(eq.project_no, []).append(
                {"equip_no": eq.equip_no, "equip_name": eq.equip_name, "rate": rate,
                 "missing": k.get("total", 0) - k.get("arrived", 0)}
            )
    longlead_map = {
        r[0]: int(r[1])
        for r in session.execute(
            select(PurchaseRequest.project_no, func.count())
            .where(PurchaseRequest.is_long_lead.is_(True), PurchaseRequest.status.in_(OPEN_REQ))
            .group_by(PurchaseRequest.project_no)
        ).all()
    }

    risks: list[dict] = []
    for p in projects:
        if p.stage not in ACTIVE_STAGES:
            continue
        items: list[str] = []
        days_left = (p.period_end - today).days if p.period_end else None
        if days_left is not None and days_left < 0:
            items.append(f"交期已过 {-days_left} 天")
        elif days_left is not None and days_left <= 7:
            items.append(f"交期还有 {days_left} 天")
        if kitting_low.get(p.project_no):
            lowest = min(kitting_low[p.project_no], key=lambda x: x["rate"])
            items.append(f"{lowest['equip_no']} 齐套 {round(lowest['rate'] * 100)}%")
        if longlead_map.get(p.project_no):
            items.append(f"长周期件在途 {longlead_map[p.project_no]} 项")
        if items:
            risks.append({
                "project_no": p.project_no,
                "project_name": p.project_name,
                "stage": p.stage,
                "days_left": days_left,
                "items": items,
                "level": "err" if (days_left is not None and days_left < 0) else "warn",
            })
    risks.sort(key=lambda r: (r["days_left"] is None, r["days_left"] if r["days_left"] is not None else 0))

    # ── ③ 卡点榜：卡在哪个部门、谁手上（用"未完成单据归谁"表达）──────────────
    #   口径说明：不发明"卡点判定算法"，就数**没做完的单据**，并指出它归哪个部门/角色：
    #   采购需求未完成 → 采购；现场问题待处理 → 现场；售后未关闭 → 售后；
    #   未齐套设备 → 采购+制造；交期过 → 项目经理。谁都能顺着点进去。
    req_by_proj = dict(session.execute(
        select(PurchaseRequest.project_no, func.count())
        .where(PurchaseRequest.status.in_(OPEN_REQ), PurchaseRequest.project_no.is_not(None))
        .group_by(PurchaseRequest.project_no)
    ).all())
    issue_by_proj = dict(session.execute(
        select(SiteIssue.project_no, func.count())
        .where(SiteIssue.status == "待处理")
        .group_by(SiteIssue.project_no)
    ).all())
    svc_by_proj = dict(session.execute(
        select(ServiceOrder.project_no, func.count())
        .where(ServiceOrder.status != "已关闭")
        .group_by(ServiceOrder.project_no)
    ).all())
    blocked: list[dict] = []
    for p in projects:
        if p.stage not in ACTIVE_STAGES:
            continue
        rows: list[dict] = []
        if req_by_proj.get(p.project_no):
            rows.append({"who": "采购", "what": f"{req_by_proj[p.project_no]} 条采购需求未完成",
                         "to": "/purchase?tab=pool", "level": "warn"})
        if kitting_low.get(p.project_no):
            rows.append({"who": "采购 / 车间", "what": f"{len(kitting_low[p.project_no])} 台设备齐套 <70%",
                         "to": f"/equipment/{p.project_no}/{kitting_low[p.project_no][0]['equip_no']}",
                         "level": "warn"})
        if issue_by_proj.get(p.project_no):
            rows.append({"who": "现场", "what": f"{issue_by_proj[p.project_no]} 个现场问题待处理",
                         "to": "/delivery/site", "level": "err"})
        if svc_by_proj.get(p.project_no):
            rows.append({"who": "售后", "what": f"{svc_by_proj[p.project_no]} 张工单未关闭",
                         "to": "/delivery/service", "level": "err"})
        if p.period_end and p.period_end < today and p.stage in ("执行中", "交付中"):
            rows.append({"who": "项目经理", "what": f"交期已过 {(today - p.period_end).days} 天，项目还没进终态",
                         "to": f"/projects/{p.project_no}", "level": "err"})
        if rows:
            blocked.append({"project_no": p.project_no, "project_name": p.project_name,
                            "stage": p.stage, "rows": rows})
    blocked.sort(key=lambda x: -sum(1 for r in x["rows"] if r["level"] == "err"))

    # ── ④ 售后与质保：60 天内到期 + 在保工单 + 备件低库存 ────────────────────
    soon = today + timedelta(days=60)
    warranty_soon = [
        {"project_no": p.project_no, "project_name": p.project_name,
         "warranty_end": p.warranty_end.isoformat() if p.warranty_end else None,
         "days_left": (p.warranty_end - today).days if p.warranty_end else None,
         "warranty_amount": float(p.warranty_amount or 0)}
        for p in projects
        if p.warranty_end and today <= p.warranty_end <= soon
    ]
    warranty_soon.sort(key=lambda x: x["days_left"] or 0)
    svc_open = session.scalars(select(ServiceOrder).where(ServiceOrder.status != "已关闭")).all()
    parts_low = [
        {"item_no": sp.item_no, "item_name": sp.item_name, "project_no": sp.project_no,
         "equip_no": sp.equip_no, "qty_stock": float(sp.qty_stock or 0), "min_qty": float(sp.min_qty or 0)}
        for sp in session.scalars(select(SparePart)).all()
        if (sp.min_qty or 0) > 0 and float(sp.qty_stock or 0) < float(sp.min_qty or 0)
    ]
    accepted_recent = session.execute(
        select(Acceptance.project_no, func.max(Acceptance.accepted_at))
        .where(Acceptance.status == "已通过")
        .group_by(Acceptance.project_no)
    ).all()

    after_sales = {
        "warranty_soon": warranty_soon[:10],
        "warranty_soon_count": len(warranty_soon),
        "open_orders": [
            {"so_no": o.so_no, "project_no": o.project_no, "equip_no": o.equip_no,
             "status": o.status, "fault": o.fault, "in_warranty": bool(o.in_warranty)}
            for o in sorted(svc_open, key=lambda x: x.id, reverse=True)[:10]
        ],
        "open_orders_count": len(svc_open),
        "in_warranty_count": sum(1 for o in svc_open if o.in_warranty),
        "parts_low": parts_low[:10],
        "parts_low_count": len(parts_low),
        "accepted_projects": [{"project_no": r[0], "accepted_at": r[1].isoformat() if r[1] else None}
                              for r in accepted_recent if r[0]],
    }

    return _maybe_scrub({
        "as_of": today.isoformat(),
        "orders": orders,
        "risks": risks[:12],
        "risks_count": len(risks),
        "blocked": blocked[:12],
        "blocked_count": len(blocked),
        "after_sales": after_sales,
        # ★ 成本毛利在三期（`cost_entry` 未建表）—— 这里**不假装有**，如实说明
        "cost": {"available": False, "reason": "成本与毛利属三期（成本归集未建表）；本期只做交付与质量视图"},
    }, current)
