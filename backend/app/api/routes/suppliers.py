"""供应商与价格参考接口。"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user, has_permission, require_permission, scrub_money
from app.core.db import get_session
from app.models.initiation import PurchaseRequest
from app.models.library import SOURCE_STANDARD, Item, StdCategory, StdClass
from app.models.platform import User
from app.models.purchasing import (
    QUOTE_TYPES,
    SUPPLIER_KINDS,
    Supplier,
    SupplierCatalog,
    SupplierQuote,
)
from app.services import audit
from app.services.numbering import next_number

router = APIRouter(tags=["供应商"])


def _supplier_dict(s: Supplier, stats: dict | None = None) -> dict:
    d = {
        "id": s.id,
        "code": s.code,
        "name": s.name,
        "short_name": s.short_name,
        "kind": s.kind,
        "contact_name": s.contact_name,
        "phone": s.phone,
        "email": s.email,
        "address": s.address,
        "payment_terms": s.payment_terms,
        "tax_rate": float(s.tax_rate) if s.tax_rate is not None else None,
        "rating": s.rating,
        "remark": s.remark,
        "is_active": s.is_active,
    }
    if stats:
        d.update(stats)
    return d


# ============================================================================
# 供应商主数据
# ============================================================================


@router.get("/suppliers")
def list_suppliers(
    q: str | None = None,
    kind: str | None = None,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    stmt = select(Supplier).order_by(Supplier.id)
    if kind:
        stmt = stmt.where(Supplier.kind == kind)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(Supplier.name.ilike(like), Supplier.code.ilike(like), Supplier.contact_name.ilike(like))
        )
    rows = session.scalars(stmt).all()

    # 每家供应商：报价条数 + 成交条数 + 最近成交时间
    catalogs: dict[int, list[dict]] = {}
    for c in session.scalars(select(SupplierCatalog)).all():
        catalogs.setdefault(c.supplier_id, []).append(
            {
                "id": c.id,
                "std_class_code": c.std_class_code,
                "item_no": c.item_no,
                "price": float(c.price) if c.price is not None else None,
                "lead_days": c.lead_days,
                "is_preferred": c.is_preferred,
            }
        )
    classes = {k.code: k.name for k in session.scalars(select(StdClass)).all()}
    quote_counts = dict(
        session.execute(
            select(SupplierQuote.supplier_id, func.count()).group_by(SupplierQuote.supplier_id)
        ).all()
    )
    deal_counts = dict(
        session.execute(
            select(SupplierQuote.supplier_id, func.count())
            .where(SupplierQuote.price_type == "成交")
            .group_by(SupplierQuote.supplier_id)
        ).all()
    )
    return [
        _supplier_dict(
            s,
            {
                "quote_count": quote_counts.get(s.id, 0),
                "deal_count": deal_counts.get(s.id, 0),
                "catalog": [
                    {**c, "std_class_name": classes.get(c["std_class_code"] or "", None)}
                    for c in catalogs.get(s.id, [])
                ],
            },
        )
        for s in rows
    ]


class SupplierIn(BaseModel):
    name: str
    short_name: str | None = None
    kind: str | None = None
    contact_name: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    payment_terms: str | None = None
    tax_rate: float | None = None
    rating: int | None = Field(default=None, ge=1, le=5)
    remark: str | None = None


@router.post("/suppliers", status_code=status.HTTP_201_CREATED)
def create_supplier(
    body: SupplierIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    if session.scalar(select(Supplier).where(Supplier.name == body.name)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"供应商「{body.name}」已存在")
    if body.kind and body.kind not in SUPPLIER_KINDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"主营类别只能是：{'/'.join(SUPPLIER_KINDS)}")
    code = next_number(session, "SUPPLIER", scope_key="")
    row = Supplier(code=code, **body.model_dump())
    session.add(row)
    session.flush()
    audit.log(
        session,
        user=current,
        action="create",
        object_type="supplier",
        object_ref=code,
        summary=f"新增供应商 {body.name}（{code}）"
        + (f"· {body.kind}" if body.kind else "")
        + (f"· 联系人 {body.contact_name}" if body.contact_name else ""),
        ip=client_ip(request),
    )
    session.commit()
    return _supplier_dict(row)


@router.patch("/suppliers/{supplier_id}")
def update_supplier(
    supplier_id: int,
    body: SupplierIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    row = session.get(Supplier, supplier_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "供应商不存在")
    labels = {
        "name": "名称",
        "short_name": "简称",
        "kind": "主营类别",
        "contact_name": "联系人",
        "phone": "电话",
        "email": "邮箱",
        "address": "地址",
        "payment_terms": "账期",
        "tax_rate": "税率",
        "rating": "评价",
        "remark": "备注",
    }
    changes = []
    for field, new_value in body.model_dump().items():
        old = getattr(row, field)
        if old == new_value:
            continue
        changes.append(
            {"field": field, "label": labels.get(field, field), "old": str(old or "—"), "new": str(new_value or "—")}
        )
        setattr(row, field, new_value)
    if changes:
        audit.log(
            session,
            user=current,
            action="update",
            object_type="supplier",
            object_ref=row.code,
            summary=f"编辑供应商 {row.name}：" + "；".join(f"{c['label']} {c['old']} → {c['new']}" for c in changes),
            detail={"changes": changes},
            ip=client_ip(request),
        )
    session.commit()
    return _supplier_dict(row)


# ============================================================================
# 报价 / 成交价
# ============================================================================


class QuoteIn(BaseModel):
    item_no: str
    price: float = Field(..., gt=0)
    unit: str | None = None
    min_qty: float | None = None
    lead_days: int | None = None
    price_type: str = Field(default="报价", description="报价 / 成交")
    quote_date: date
    valid_until: date | None = None
    source: str | None = None
    remark: str | None = None


def _quote_dict(q: SupplierQuote, supplier: Supplier | None, item: Item | None) -> dict:
    return {
        "id": q.id,
        "item_no": q.item_no,
        "item_name": item.display_name if item else q.item_no,
        "spec_text": item.spec_text if item else None,
        "supplier_id": q.supplier_id,
        "supplier_name": supplier.name if supplier else None,
        "price": float(q.price) if q.price is not None else None,
        "currency": q.currency,
        "unit": q.unit or (item.unit if item else None),
        "min_qty": float(q.min_qty) if q.min_qty is not None else None,
        "lead_days": q.lead_days,
        "price_type": q.price_type,
        "quote_date": q.quote_date,
        "valid_until": q.valid_until,
        "source": q.source,
        "remark": q.remark,
    }


@router.get("/suppliers/{supplier_id}/quotes")
def list_quotes(
    supplier_id: int, session: Session = Depends(get_session), current: User = Depends(get_current_user)
):
    rows = session.scalars(
        select(SupplierQuote).where(SupplierQuote.supplier_id == supplier_id).order_by(SupplierQuote.quote_date.desc())
    ).all()
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    sup = session.get(Supplier, supplier_id)
    out = [_quote_dict(q, sup, items.get(q.item_no)) for q in rows]
    return out if has_permission(current, "purchase:price") else scrub_money(out)


@router.post("/suppliers/{supplier_id}/quotes", status_code=status.HTTP_201_CREATED)
def add_quote(
    supplier_id: int,
    body: QuoteIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    sup = session.get(Supplier, supplier_id)
    if sup is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "供应商不存在")
    item = session.get(Item, body.item_no)
    if item is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"标准库里没有 {body.item_no} —— 请先去标准库把它建出来"
        )
    if body.price_type not in QUOTE_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"类型只能是：{'/'.join(QUOTE_TYPES)}")
    row = SupplierQuote(
        item_no=body.item_no,
        supplier_id=supplier_id,
        price=body.price,
        unit=body.unit or item.unit,
        min_qty=body.min_qty,
        lead_days=body.lead_days,
        price_type=body.price_type,
        quote_date=body.quote_date,
        valid_until=body.valid_until,
        source=body.source,
        remark=body.remark,
        recorded_by=current.id,
    )
    session.add(row)
    session.flush()
    audit.log(
        session,
        user=current,
        action="create",
        object_type="supplier_quote",
        object_ref=f"{sup.name}/{body.item_no}",
        summary=f"登记{body.price_type}价：{item.display_name} · {sup.name} · ¥{body.price:,.0f}"
        + (f" · 交期 {body.lead_days} 天" if body.lead_days else "")
        + (f" · 来源 {body.source}" if body.source else ""),
        ip=client_ip(request),
    )
    session.commit()
    return _quote_dict(row, sup, item)


# ============================================================================
# ★ 价格参考：下单前看清历史，才好砍价
# ============================================================================


@router.get("/purchase/price-reference/{item_no}")
def price_reference(
    item_no: str,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("purchase:price")),
):
    item = session.get(Item, item_no)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "物料不存在")

    quotes = session.scalars(
        select(SupplierQuote).where(SupplierQuote.item_no == item_no).order_by(SupplierQuote.quote_date.desc())
    ).all()
    sups = {s.id: s for s in session.scalars(select(Supplier)).all()}

    # 历史成交价（按时间倒序）
    deals = [q for q in quotes if q.price_type == "成交"]
    deal_prices = [float(q.price) for q in deals]
    last_price = deal_prices[0] if deal_prices else None

    # 当前报价（各家最新一条报价）
    latest_quote: dict[int, SupplierQuote] = {}
    for q in quotes:
        if q.price_type == "报价" and q.supplier_id not in latest_quote:
            latest_quote[q.supplier_id] = q

    # 采购单上记录过的价格（历史下单，兜底）
    pr_prices = session.scalars(
        select(PurchaseRequest)
        .where(PurchaseRequest.item_no == item_no, PurchaseRequest.unit_price.isnot(None))
        .order_by(PurchaseRequest.ordered_at.desc())
        .limit(5)
    ).all()

    result = {
        "item_no": item_no,
        "display_name": item.display_name,
        "spec_text": item.spec_text,
        "unit": item.unit,
        "stats": {
            "last_price": last_price,
            "last_supplier": sups[deals[0].supplier_id].name if deals else None,
            "last_date": deals[0].quote_date if deals else None,
            "min_price": min(deal_prices) if deal_prices else None,
            "max_price": max(deal_prices) if deal_prices else None,
            "avg_price": round(sum(deal_prices) / len(deal_prices), 2) if deal_prices else None,
            "deal_count": len(deals),
            "quote_count": len(latest_quote),
        },
        "deals": [_quote_dict(q, sups.get(q.supplier_id), item) for q in deals[:8]],
        "quotes": [
            _quote_dict(q, sups.get(q.supplier_id), item)
            for q in sorted(latest_quote.values(), key=lambda x: float(x.price))
        ],
        "ordered": [
            {
                "project_no": p.project_no,
                "unit_price": float(p.unit_price) if p.unit_price is not None else None,
                "supplier_name": p.supplier_name,
                "ordered_at": p.ordered_at,
                "qty": float(p.qty) if p.qty is not None else None,
            }
            for p in pr_prices
        ],
    }
    return result if has_permission(current, "purchase:price") else scrub_money(result)


# ============================================================================
# ★ 供应商能供什么（推荐匹配的依据）
# ============================================================================


class CatalogIn(BaseModel):
    std_class_code: str | None = Field(default=None, description="能供的品类，如 FT 方通")
    item_no: str | None = Field(default=None, description="精确到型号（可选）")
    price: float | None = Field(default=None, description="常规价（可空，以实际报价为准）")
    lead_days: int | None = Field(default=None, description="常规交期（天）")
    min_qty: float | None = None
    is_preferred: bool = False
    remark: str | None = None


@router.get("/suppliers/{supplier_id}/catalog")
def list_catalog(
    supplier_id: int, session: Session = Depends(get_session), _: User = Depends(get_current_user)
):
    rows = session.scalars(
        select(SupplierCatalog).where(SupplierCatalog.supplier_id == supplier_id)
    ).all()
    classes = {k.code: k.name for k in session.scalars(select(StdClass)).all()}
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}
    return [
        {
            "id": c.id,
            "std_class_code": c.std_class_code,
            "std_class_name": classes.get(c.std_class_code or ""),
            "item_no": c.item_no,
            "item_name": items[c.item_no].display_name if c.item_no in items else None,
            "price": float(c.price) if c.price is not None else None,
            "lead_days": c.lead_days,
            "min_qty": float(c.min_qty) if c.min_qty is not None else None,
            "is_preferred": c.is_preferred,
            "remark": c.remark,
        }
        for c in rows
    ]


@router.post("/suppliers/{supplier_id}/catalog", status_code=status.HTTP_201_CREATED)
def add_catalog(
    supplier_id: int,
    body: CatalogIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """声明这家供应商能供哪些品类 / 型号。"""
    sup = session.get(Supplier, supplier_id)
    if sup is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "供应商不存在")
    if not body.std_class_code and not body.item_no:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "至少填「品类」或「型号」之一")
    if body.std_class_code and session.get(StdClass, body.std_class_code) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"品类不存在：{body.std_class_code}")
    if body.item_no and session.get(Item, body.item_no) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"标准库里没有 {body.item_no}")
    dup = session.scalar(
        select(SupplierCatalog).where(
            SupplierCatalog.supplier_id == supplier_id,
            SupplierCatalog.std_class_code == body.std_class_code,
            SupplierCatalog.item_no == body.item_no,
        )
    )
    if dup:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "这条供货范围已经有了")
    row = SupplierCatalog(supplier_id=supplier_id, **body.model_dump())
    session.add(row)
    session.flush()
    k = session.get(StdClass, body.std_class_code) if body.std_class_code else None
    scope = f"型号 {body.item_no}" if body.item_no else f"品类 {k.name if k else ''}"
    audit.log(
        session,
        user=current,
        action="create",
        object_type="supplier_catalog",
        object_ref=f"{sup.name}/{scope}",
        summary=f"{sup.name} 声明可供应 {scope}"
        + (f"（常规价 ¥{body.price:,.0f}）" if body.price else "")
        + (f"（交期 {body.lead_days} 天）" if body.lead_days else ""),
        ip=client_ip(request),
    )
    session.commit()
    return {"id": row.id}


@router.delete("/suppliers/catalog/{catalog_id}")
def remove_catalog(
    catalog_id: int, session: Session = Depends(get_session), _: User = Depends(get_current_user)
):
    row = session.get(SupplierCatalog, catalog_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "记录不存在")
    session.delete(row)
    session.commit()
    return {"ok": True}


# ============================================================================
# ★★ 推荐供应商：多路证据综合打分（不是靠"大类"瞎猜）
# ============================================================================


@router.get("/purchase/recommend/{item_no}")
def recommend_suppliers(
    item_no: str,
    need_date: date | None = Query(default=None, description="需要到货日期，用来判断交期赶不赶得上"),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    item = session.get(Item, item_no)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "物料不存在")
    cls = session.get(StdClass, item.std_class_code) if item.std_class_code else None
    cat = session.get(StdCategory, cls.category_code) if cls else None

    suppliers = session.scalars(select(Supplier).where(Supplier.is_active.is_(True))).all()
    catalogs = session.scalars(select(SupplierCatalog)).all()
    quotes = session.scalars(select(SupplierQuote).where(SupplierQuote.item_no == item_no)).all()

    # ★ 第二个数据源：采购单上真正下过的价（purchase_request.unit_price）
    #   有些历史下单发生在本系统的“自动回写”功能上线之前 —— 这里兜住，不能漏
    pr_deals = session.scalars(
        select(PurchaseRequest).where(
            PurchaseRequest.item_no == item_no, PurchaseRequest.unit_price.isnot(None)
        )
    ).all()
    today = date.today()

    recos = []
    for sup in suppliers:
        score = 0
        reasons: list[str] = []
        level = ""

        # ── ① 历史成交（最强证据：真买过）—— 合并两个数据源
        deal_records = [
            {"price": float(q.price), "date": q.quote_date, "source": q.source, "from": "价格库"}
            for q in quotes
            if q.supplier_id == sup.id and q.price_type == "成交"
        ]
        deal_records += [
            {
                "price": float(p.unit_price),
                "date": p.ordered_at,
                "source": p.po_no,
                "from": f"采购单 {p.project_no}",
            }
            for p in pr_deals
            if (p.supplier_id == sup.id) or (not p.supplier_id and p.supplier_name == sup.name)
        ]
        deal_records = sorted(
            [d for d in deal_records if d["date"]],
            key=lambda d: d["date"],
            reverse=True,
        )
        deals = deal_records
        # ── ② 报价
        offers = sorted(
            [q for q in quotes if q.supplier_id == sup.id and q.price_type == "报价"],
            key=lambda q: q.quote_date,
            reverse=True,
        )
        # ── ③ 供货范围声明
        cat_rows = [c for c in catalogs if c.supplier_id == sup.id]
        by_item = [c for c in cat_rows if c.item_no == item_no]
        by_class = [c for c in cat_rows if c.std_class_code and c.std_class_code == item.std_class_code]

        if deals:
            score += 60
            reasons.append(
                f"买过 {len(deals)} 次，最近 ¥{deals[0]['price']:,.0f}"
                f"（{deals[0]['date']}"
                + (f"，{deals[0]['source']}" if deals[0]["source"] else "")
                + "）"
            )
            if len(deals) > 1:
                prices = [d["price"] for d in deals]
                reasons.append(
                    f"历史 {len(prices)} 次成交价 ¥{min(prices):,.0f} ~ ¥{max(prices):,.0f}"
                )
            level = "买过"
        elif offers:
            score += 35
            reasons.append(f"报过价 ¥{float(offers[0].price):,.0f}（{offers[0].quote_date}）")
            level = "报过价"

        if by_item:
            score += 50
            reasons.append("长期供应这个型号")
            level = level or "型号"
        elif by_class:
            score += 30
            reasons.append(f"供应「{cls.name if cls else item.std_class_code}」这类")
            level = level or "品类"
        elif sup.kind and cat and sup.kind == cat.name:
            # 只声明了大类 → 兜底，明确标注不可靠
            score += 8
            reasons.append(f"只声明了主营「{sup.kind}」，没到品类 —— 建议补上")
            level = "大类"
        elif deals or offers:
            pass  # 有价格记录就不算无关
        else:
            continue  # 完全无关，不推荐

        # ── ④ 价格提示（优先成交价，其次报价，再次常规价）
        price_hint = None
        if deals:
            price_hint = deals[0]["price"]
        elif offers:
            price_hint = float(offers[0].price)
        elif by_item and by_item[0].price:
            price_hint = float(by_item[0].price)
        elif by_class and by_class[0].price:
            price_hint = float(by_class[0].price)

        # ── ⑤ 交期
        lead = (
            (by_item[0].lead_days if by_item else None)
            or (by_class[0].lead_days if by_class else None)
            or (deals[0].lead_days if deals and hasattr(deals[0], "lead_days") else None)
            or (offers[0].lead_days if offers else None)
        )
        late = False
        if lead and need_date:
            eta = today + timedelta(days=lead)
            if eta > need_date:
                late = True
                score -= 25
                reasons.append(f"⚠️ 交期 {lead} 天，预计 {eta} 到货，赶不上需要到货 {need_date}")
            else:
                score += 10
                reasons.append(f"交期 {lead} 天，赶得上")

        # ── ⑥ 星级 & 首选
        score += (sup.rating or 3) * 3
        if by_item and by_item[0].is_preferred:
            score += 15
            reasons.append("首选供应商")
        elif by_class and by_class[0].is_preferred:
            score += 15
            reasons.append("首选供应商")

        recos.append(
            {
                "supplier_id": sup.id,
                "code": sup.code,
                "name": sup.name,
                "kind": sup.kind,
                "rating": sup.rating,
                "payment_terms": sup.payment_terms,
                "match_level": level,
                "score": score,
                "reasons": reasons,
                "price_hint": price_hint,
                "lead_days": lead,
                "late": late,
                "last_deal_date": deals[0]["date"] if deals else None,
                "deal_count": len(deals),
            }
        )

    recos.sort(key=lambda x: -x["score"])
    return {
        "item_no": item_no,
        "display_name": item.display_name,
        "spec_text": item.spec_text,
        "unit": item.unit,
        "std_class_code": item.std_class_code,
        "std_class_name": cls.name if cls else None,
        "category_code": cat.code if cat else None,
        "category_name": cat.name if cat else None,
        "need_date": need_date,
        "recommendations": recos,
        "note": "只声明了「大类」的供应商排在后面并标注 —— 建议补上能供的具体品类",
    }
