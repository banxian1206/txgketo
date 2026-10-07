"""标准库接口（T06）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user, require_permission
from app.core.db import get_session
from app.models.library import (
    SELECT_ANY,
    SELECT_DESIGN,
    SELECT_PROCESS,
    SELECT_PURCHASE,
    SOURCE_STANDARD,
    Item,
    StdCategory,
    StdClass,
    render_spec_text,
    validate_spec,
)
from app.models.platform import User
from app.services import audit, pricing
from app.services.numbering import next_number
from app.models.purchasing import SupplierQuote

router = APIRouter(prefix="/library", tags=["标准库"])


def _item_dict(i: Item, class_name: str | None = None, category_code: str | None = None) -> dict:
    return {
        "item_no": i.item_no,
        "display_name": i.display_name,
        "source_type": i.source_type,
        "std_class_code": i.std_class_code,
        "std_class_name": class_name,
        "category_code": category_code,
        "spec": i.spec,
        "spec_text": i.spec_text,
        "unit": i.unit,
        "brand": i.brand,
        "mfr_model": i.mfr_model,
        "is_active": i.is_active,
    }


# ---------------------------------------------------------------- 类别与品类


@router.get("/categories")
def list_categories(session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    cats = session.scalars(select(StdCategory).order_by(StdCategory.seq)).all()
    classes = session.scalars(select(StdClass).order_by(StdClass.seq)).all()
    counts = dict(
        session.execute(
            select(Item.std_class_code, func.count())
            .where(Item.source_type == SOURCE_STANDARD)
            .group_by(Item.std_class_code)
        ).all()
    )
    # ★ 每个品类还要知道「有几条有历史价」—— 「看得到才能选得对」（2026-10-07）。
    #   与价格库同一口径：都数 supplier_quote 里出现过的物料。
    priced = dict(
        session.execute(
            select(Item.std_class_code, func.count(func.distinct(Item.item_no)))
            .where(Item.source_type == SOURCE_STANDARD, Item.item_no.in_(select(SupplierQuote.item_no)))
            .group_by(Item.std_class_code)
        ).all()
    )
    return [
        {
            "code": c.code,
            "name": c.name,
            # ★ 这个类别归谁选（design/process/purchase/any 的中文值，2026-10-07）
            "select_by": c.select_by,
            "classes": [
                {
                    "code": k.code,
                    "name": k.name,
                    # ★ 带上父类别码（P2-3）：标准库「新建物料」弹窗要显示
                    #   “编码由系统自动发（YL-LC-0001 形式）”，少了这个字段就会渲染成
                    #   「undefined-LC-0001」——用户可见的 undefined。
                    "category_code": k.category_code,
                    "spec_template": k.spec_template,
                    "item_count": counts.get(k.code, 0),
                    "priced_count": priced.get(k.code, 0),
                }
                for k in classes
                if k.category_code == c.code
            ],
        }
        for c in cats
    ]


@router.get("/classes/{class_code}")
def get_class(class_code: str, session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    k = session.get(StdClass, class_code)
    if k is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "品类不存在")
    cat = session.get(StdCategory, k.category_code)
    return {
        "code": k.code,
        "name": k.name,
        "category_code": k.category_code,
        "category_name": cat.name if cat else None,
        "spec_template": k.spec_template,
    }


# ---------------------------------------------------------------- 物料（型号）


# ★ 挂料选择器按职责收口（2026-10-07 客户口径，见 models/library.py::CATEGORY_SELECT_BY）
#
#   design   → 只看「设计 + 皆可」  （机械/电气/程序：商选件）
#   process  → 只看「工艺 + 皆可」  （工艺员：原材料）
#   purchase → **不过滤**（采购什么都能买，包括原材料与耗材 —— 客户：
#              「我在这个标准里面去买的时候，照样能买」）
#
# ⚠ `采购` 这个取值的语义是「**对设计/工艺隐藏**」，不是「只有采购才看得到」——
#   所以 purchase 与不传一样是全量，别把它也写成 in_([采购, 皆可])。
_PICK_ALLOWED: dict[str, tuple[str, ...]] = {
    "design": (SELECT_DESIGN, SELECT_ANY),
    "process": (SELECT_PROCESS, SELECT_ANY),
}


def _apply_pick_for(stmt, pick_for: str | None):
    """按职责过滤挂料候选。未知/未传 → 不过滤（宁可多给，不可静默少给）。"""
    allowed = _PICK_ALLOWED.get((pick_for or "").strip().lower())
    if not allowed:
        return stmt
    cats = select(StdCategory.code).where(StdCategory.select_by.in_(allowed))
    return stmt.where(Item.std_class_code.in_(select(StdClass.code).where(StdClass.category_code.in_(cats))))


@router.get("/items")
def list_items(
    class_code: str | None = None,
    category_code: str | None = None,
    q: str | None = Query(default=None, description="按编码/品名/规格/品牌/型号模糊搜索"),
    pick_for: str | None = Query(default=None, description="按职责收口：design/process（purchase 与不传=全量）"),
    limit: int = 50,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    stmt = select(Item).where(Item.source_type == SOURCE_STANDARD, Item.is_active.is_(True))
    stmt = _apply_pick_for(stmt, pick_for)
    if class_code:
        stmt = stmt.where(Item.std_class_code == class_code)
    if category_code:
        sub = select(StdClass.code).where(StdClass.category_code == category_code)
        stmt = stmt.where(Item.std_class_code.in_(sub))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Item.item_no.ilike(like),
                Item.display_name.ilike(like),
                Item.spec_text.ilike(like),
                Item.brand.ilike(like),
                Item.mfr_model.ilike(like),
            )
        )
    rows = session.scalars(stmt.order_by(Item.item_no).limit(min(limit, 200))).all()
    classes = {k.code: k for k in session.scalars(select(StdClass)).all()}
    return [
        _item_dict(
            i,
            classes[i.std_class_code].name if i.std_class_code in classes else None,
            classes[i.std_class_code].category_code if i.std_class_code in classes else None,
        )
        for i in rows
    ]


@router.get("/items/page")
def list_items_paged(
    class_code: str | None = None,
    category_code: str | None = None,
    q: str | None = Query(default=None, description="按编码/品名/规格/品牌/型号模糊搜索"),
    all_classes: bool = Query(default=False, description="true=跨全库搜（否则在当前品类内）"),
    only_priced: bool = Query(default=False, description="只看有历史价的"),
    pick_for: str | None = Query(default=None, description="按职责收口：design/process（purchase 与不传=全量）"),
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """标准库物料 · **真服务端分页**（2026-10-07 客户要求「两页统一标准」）。

    为什么要新开一个而不是改 `/items`：那个接口是**选料候选搜索**（多个弹窗在用，
    只取前 30~50 条），动它的返回形状（`list` → `{total, items}`）会让所有调用方
    静默失败。所以老接口原样保留，分页台账走这里（docs/17「避免直接改变其他调用方
    的响应协议」）。

    ★ 每行带**价格可用性**（最近价 / 有没有历史价 / 能不能比价）——
      数据来自 `services/pricing.price_index()`，**与价格库同一口径**。
      客户原话：「看得到才能选得对」。（实测钢材 2517 条里 1192 条有价。）
    """
    base = select(Item).where(Item.source_type == SOURCE_STANDARD, Item.is_active.is_(True))
    base = _apply_pick_for(base, pick_for)
    if not all_classes:
        if class_code:
            base = base.where(Item.std_class_code == class_code)
        elif category_code:
            base = base.where(Item.std_class_code.in_(select(StdClass.code).where(StdClass.category_code == category_code)))
    if q:
        like = f"%{q}%"
        base = base.where(
            or_(
                Item.item_no.ilike(like),
                Item.display_name.ilike(like),
                Item.spec_text.ilike(like),
                Item.brand.ilike(like),
                Item.mfr_model.ilike(like),
            )
        )
    if only_priced:
        base = base.where(Item.item_no.in_(select(SupplierQuote.item_no)))

    total = int(session.execute(select(func.count()).select_from(base.subquery())).scalar_one())
    rows = session.scalars(base.order_by(Item.item_no).limit(limit).offset(offset)).all()
    classes = {k.code: k for k in session.scalars(select(StdClass)).all()}
    idx = pricing.price_index(session, [i.item_no for i in rows])
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [
            {
                **_item_dict(
                    i,
                    classes[i.std_class_code].name if i.std_class_code in classes else None,
                    classes[i.std_class_code].category_code if i.std_class_code in classes else None,
                ),
                **idx.get(i.item_no, {}),
            }
            for i in rows
        ],
    }


@router.get("/items/{item_no}")
def get_item(item_no: str, session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    i = session.get(Item, item_no)
    if i is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "物料不存在")
    k = session.get(StdClass, i.std_class_code) if i.std_class_code else None
    return _item_dict(i, k.name if k else None, k.category_code if k else None)


class ItemIn(BaseModel):
    std_class_code: str
    spec: dict = Field(default_factory=dict, description="按品类规格模板填的结构化规格")
    unit: str = "件"
    brand: str | None = None
    mfr_model: str | None = None


@router.post("/items", status_code=status.HTTP_201_CREATED)
def create_item(
    body: ItemIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("std:edit")),
):
    """新建标准库物料：规格必须完整 → 自动发码 → 品名与规格串自动生成 → 防重复建码。"""
    k = session.get(StdClass, body.std_class_code)
    if k is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "品类不存在")
    cat = session.get(StdCategory, k.category_code)
    if cat is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "类别不存在")

    try:
        validate_spec(k.spec_template, body.spec)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    spec_text = render_spec_text(k.spec_template, body.spec)
    brand = body.brand or body.spec.get("brand")

    # 防重复建码：同品类 + 同规格 + 同品牌 已存在就直接返回它
    dup_stmt = select(Item).where(
        Item.std_class_code == body.std_class_code,
        Item.spec_text == spec_text,
    )
    dup_stmt = dup_stmt.where(Item.brand == brand) if brand else dup_stmt.where(Item.brand.is_(None))
    dup = session.scalar(dup_stmt)
    if dup is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"标准库里已经有同规格的物料了：{dup.item_no}（{dup.display_name}）",
        )

    item_no = next_number(
        session,
        "STD_ITEM",
        scope_key=k.code,
        cat=cat.code,
        cls=k.code,
    )
    display_name = f"{k.name} {spec_text}".strip()
    row = Item(
        item_no=item_no,
        display_name=display_name,
        source_type=SOURCE_STANDARD,
        project_no=None,  # ★ 标准件不属于任何项目
        std_class_code=k.code,
        spec=body.spec,
        spec_text=spec_text,
        unit=body.unit or "件",
        brand=brand,
        mfr_model=body.mfr_model or body.spec.get("model"),
    )
    session.add(row)
    session.flush()
    audit.log(
        session,
        user=current,
        action="create",
        object_type="std_item",
        object_ref=item_no,
        summary=f"标准库新建物料 {item_no}（{display_name}）",
        detail={"spec": body.spec, "class": k.code},
        ip=client_ip(request),
    )
    session.commit()
    return _item_dict(row, k.name, cat.code)


class ItemPatch(BaseModel):
    unit: str | None = None
    brand: str | None = None
    mfr_model: str | None = None
    is_active: bool | None = None
    spec: dict | None = None


@router.patch("/items/{item_no}")
def update_item(
    item_no: str,
    body: ItemPatch,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("std:edit")),
):
    """★ 一码不变：规格要改就新建物料；这里只允许改单位/品牌/厂家型号/停用。"""
    row = session.get(Item, item_no)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "物料不存在")
    if body.spec is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "规格改了要新建物料号（一码不变）—— 不能直接改已分配的编码对应的规格",
        )
    labels = {"unit": "单位", "brand": "品牌", "mfr_model": "厂家型号", "is_active": "是否启用"}
    changes = []
    for field, new_value in body.model_dump(exclude_unset=True).items():
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
            object_type="std_item",
            object_ref=item_no,
            summary=f"标准库物料 {item_no}：" + "；".join(f"{c['label']} {c['old']} → {c['new']}" for c in changes),
            detail={"changes": changes},
            ip=client_ip(request),
        )
    session.commit()
    k = session.get(StdClass, row.std_class_code) if row.std_class_code else None
    return _item_dict(row, k.name if k else None, k.category_code if k else None)
