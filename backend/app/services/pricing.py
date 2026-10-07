"""价格库（历史采购价）的**唯一算口径**（2026-10-07）。

背景：客户把「导入历史价」和「看我导入了什么」从采购台搬到了基础数据（`docs/25`）。
搬完之后最要防的是**同一个数在两处各算一套**（AGENTS §8.5 教训）：

  · 「有多少物料真的能比价」——推荐供应商（`recommend/{item_no}`）与台账首屏
    必须用**同一个阈值、同一个 SQL**，否则页面说 664 个、下单时却挑不出来。
  · 「均价 / 最近价」——台账列表与「价格参考」必须一致。

所以本模块只提供**纯读**的聚合函数，路由层不自己写聚合。
⚠ 过滤 / 排序 / 分页**全在 SQL 里**做（库里有 2.8 万个标准库物料，
  拉进 Python 再排会卡死）。
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import Select, and_, func, select
from sqlalchemy.orm import Session

from app.models.library import Item, StdClass
from app.models.purchasing import Supplier, SupplierQuote

# ★ 比价阈值：**唯一口径**。≥2 家就能比；≥3 家才算"可放心推荐"。
#   页面与推荐服务都用这两个常量，别各自写数字。
MIN_COMPARABLE = 2
MIN_RECOMMENDABLE = 3


class _Row:
    """台账一行的聚合结果（attrs 访问，和 SQLAlchemy Row 一样用 .item_no 等）。"""

    __slots__ = ("item_no", "quote_count", "supplier_count", "avg_price", "last_date", "last_price")

    def __init__(self, item_no: str, quote_count=0, supplier_count=0, avg_price=None, last_date=None, last_price=None):
        self.item_no = item_no
        self.quote_count = quote_count
        self.supplier_count = supplier_count
        self.avg_price = avg_price
        self.last_date = last_date
        self.last_price = last_price


def _base_items(
    *, q: str | None, class_code: str | None, category_code: str | None
) -> Select:
    """标准库物料（台账的基准集合）。"""
    stmt = select(Item.item_no.label("item_no"))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Item.item_no.ilike(like)
            | Item.display_name.ilike(like)
            | Item.spec_text.ilike(like)
            | Item.brand.ilike(like)
        )
    if class_code:
        stmt = stmt.where(Item.std_class_code == class_code)
    if category_code:
        stmt = stmt.where(
            Item.std_class_code.in_(select(StdClass.code).where(StdClass.category_code == category_code))
        )
    return stmt


def _deal_agg(base: Select, *, supplier_id: int | None, date_from, date_to, source) -> Select:
    """按物料聚合成交价条数 / 供应商家数 / 均价 / 最近日期。"""
    cond = [SupplierQuote.item_no == base.c.item_no]
    if supplier_id:
        cond.append(SupplierQuote.supplier_id == supplier_id)
    if date_from:
        cond.append(SupplierQuote.quote_date >= date_from)
    if date_to:
        cond.append(SupplierQuote.quote_date <= date_to)
    if source:
        cond.append(SupplierQuote.source == source)
    return (
        select(
            SupplierQuote.item_no.label("item_no"),
            func.count(SupplierQuote.id).label("quote_count"),
            func.count(func.distinct(SupplierQuote.supplier_id)).label("supplier_count"),
            func.avg(SupplierQuote.price).label("avg_price"),
            func.max(SupplierQuote.quote_date).label("last_date"),
        )
        .where(and_(*cond))
        .group_by(SupplierQuote.item_no)
        .subquery()
    )


def stats(
    session: Session,
    *,
    q: str | None = None,
    class_code: str | None = None,
    category_code: str | None = None,
) -> dict:
    """价格库健康度（台账首屏那排数）。**全是读时算的**，不落字段。

    「可比价物料数」与推荐服务用同一阈值（`MIN_RECOMMENDABLE`）。
    """
    item_nos = _base_items(q=q, class_code=class_code, category_code=category_code).subquery()
    deal = _deal_agg(item_nos, supplier_id=None, date_from=None, date_to=None, source=None)

    def _count(cond) -> int:
        return int(
            session.execute(select(func.count()).select_from(deal).where(cond)).scalar_one()
        )

    quote_count = int(
        session.execute(
            select(func.count()).select_from(SupplierQuote).where(SupplierQuote.item_no.in_(select(item_nos.c.item_no)))
        ).scalar_one()
    )
    item_count = int(
        session.execute(select(func.count()).select_from(item_nos)).scalar_one()
    )
    supplier_count = int(
        session.execute(
            select(func.count(func.distinct(SupplierQuote.supplier_id))).where(
                SupplierQuote.item_no.in_(select(item_nos.c.item_no))
            )
        ).scalar_one()
    )
    span = session.execute(
        select(func.min(SupplierQuote.quote_date), func.max(SupplierQuote.quote_date)).where(
            SupplierQuote.item_no.in_(select(item_nos.c.item_no))
        )
    ).one()
    no_spec = int(
        session.execute(
            select(func.count())
            .select_from(Item)
            .where(Item.item_no.in_(select(item_nos.c.item_no)), Item.spec_text.is_(None))
        ).scalar_one()
    )
    # 标准库里一个价都没有的料（台账默认不列，作为一条待办单独点出来）
    never_priced = int(
        session.execute(
            select(func.count())
            .select_from(item_nos)
            .where(item_nos.c.item_no.not_in(select(deal.c.item_no)))
        ).scalar_one()
    )

    return {
        "quote_count": quote_count,
        "item_count": item_count,
        "priced_item_count": _count(deal.c.quote_count > 0),
        "never_priced_items": never_priced,
        "supplier_count": supplier_count,
        "date_from": span[0],
        "date_to": span[1],
        # ★ 可比价物料（阈值与 recommend 同一套）
        "comparable_items": _count(deal.c.supplier_count >= MIN_COMPARABLE),
        "recommendable_items": _count(deal.c.supplier_count >= MIN_RECOMMENDABLE),
        "single_supplier_items": _count(deal.c.supplier_count == 1),
        "no_spec_item_count": no_spec,
        "thresholds": {"comparable": MIN_COMPARABLE, "recommendable": MIN_RECOMMENDABLE},
    }


def items_ledger(
    session: Session,
    *,
    q: str | None = None,
    class_code: str | None = None,
    category_code: str | None = None,
    supplier_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    source: str | None = None,
    only_single: bool = False,
    only_never: bool = False,
    limit: int = 20,
    offset: int = 0,
) -> dict:
    """台账：**一行一个物料**（不是一条报价）—— 12,431 个物料逐条报价翻不动。

    默认只列**有价**的料；`only_single` / `only_never` 对应首屏那两条待办。
    过滤与分页在 SQL 里做（库里 2.8 万个物料，不能拉回 Python 再排）。
    """
    base = _base_items(q=q, class_code=class_code, category_code=category_code).subquery()
    deal = _deal_agg(base, supplier_id=supplier_id, date_from=date_from, date_to=date_to, source=source)

    # ── 「从未有价」是另一个集合（标准库里有、价格库一条没有）——
    #   不能写成 `deal.item_no IS NULL`：那是子查询**没有该行**，
    #   从 deal 里选永远选不到（实测 total 恒为 0，而 stats 说有 16,149 个）。
    if only_never:
        never_stmt = select(base.c.item_no).where(
            base.c.item_no.not_in(select(deal.c.item_no))
        )
        total = int(session.execute(select(func.count()).select_from(never_stmt.subquery())).scalar_one())
        page_no = session.execute(
            never_stmt.order_by(base.c.item_no).limit(limit).offset(offset)
        ).scalars().all()
        page = [_Row(n) for n in page_no]
    else:
        # 相关子查询：每个物料的「最近一条价」（按日期倒序取第一条）
        last_price_sq = (
            select(SupplierQuote.price)
            .where(
                SupplierQuote.item_no == deal.c.item_no,
                *([SupplierQuote.supplier_id == supplier_id] if supplier_id else []),
                *([SupplierQuote.quote_date >= date_from] if date_from else []),
                *([SupplierQuote.quote_date <= date_to] if date_to else []),
                *([SupplierQuote.source == source] if source else []),
            )
            .order_by(SupplierQuote.quote_date.desc(), SupplierQuote.id.desc())
            .limit(1)
            .correlate(deal)
            .scalar_subquery()
        )

        rows_stmt = select(
            deal.c.item_no,
            deal.c.quote_count,
            deal.c.supplier_count,
            deal.c.avg_price,
            deal.c.last_date,
            last_price_sq.label("last_price"),
        )
        if only_single:
            rows_stmt = rows_stmt.where(deal.c.supplier_count == 1)
        else:
            rows_stmt = rows_stmt.where(deal.c.item_no.is_not(None))

        total = int(
            session.execute(select(func.count()).select_from(rows_stmt.subquery())).scalar_one()
        )
        page = session.execute(
            rows_stmt.order_by(deal.c.quote_count.desc(), deal.c.item_no)
            .limit(limit)
            .offset(offset)
        ).all()

    # 只给这一页补物料资料（≤limit 条）
    keys = [r.item_no for r in page]
    metas: dict[str, Item] = {}
    if keys:
        for m in session.scalars(select(Item).where(Item.item_no.in_(keys))):
            metas[m.item_no] = m

    items = []
    for r in page:
        meta = metas.get(r.item_no)
        sup_n = int(r.supplier_count or 0)
        items.append(
            {
                "item_no": r.item_no,
                "quote_count": int(r.quote_count or 0),
                "supplier_count": sup_n,
                "avg_price": float(r.avg_price) if r.avg_price is not None else None,
                "last_price": float(r.last_price) if r.last_price is not None else None,
                "last_date": r.last_date,
                "display_name": (meta.display_name if meta else "") or r.item_no,
                "spec_text": (meta.spec_text if meta else None),
                "unit": (meta.unit if meta else None),
                "std_class_code": (meta.std_class_code if meta else None),
                "comparable": sup_n >= MIN_COMPARABLE,
                "recommendable": sup_n >= MIN_RECOMMENDABLE,
            }
        )
    return {"total": total, "items": items, "offset": offset, "limit": limit}


def quotes_by_item(session: Session, item_no: str) -> dict:
    """单个物料的全部报价（台账里点开看）。"""
    quotes = session.scalars(
        select(SupplierQuote)
        .where(SupplierQuote.item_no == item_no)
        .order_by(SupplierQuote.quote_date.desc(), SupplierQuote.id.desc())
    ).all()
    sups = {s.id: s.name for s in session.scalars(select(Supplier)).all()}
    meta = session.get(Item, item_no)
    return {
        "item_no": item_no,
        "display_name": (meta.display_name if meta else "") or item_no,
        "spec_text": (meta.spec_text if meta else None),
        "unit": (meta.unit if meta else None),
        "quotes": [
            {
                "id": x.id,
                "supplier_id": x.supplier_id,
                "supplier_name": sups.get(x.supplier_id, "—"),
                "price": float(x.price),
                "tax_incl": x.tax_incl,
                "qty": float(x.qty) if x.qty is not None else None,
                "unit": x.unit,
                "price_type": x.price_type,
                "quote_date": x.quote_date,
                "source": x.source,
                "remark": x.remark,
            }
            for x in quotes
        ],
    }
