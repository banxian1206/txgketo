"""采购域：供应商、报价、价格参考（依据《00 方案》§3 S3 采购）。

采购员最需要的不是"填个供应商名字"，而是：
    ★ 这个东西**上次买多少钱、哪家买的**
    ★ 各家供应商**现在报多少**
    ★ 本次报价比上次**涨了还是降了**
有了这些才好跟供应商砍价。
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# 供应商类型
SUPPLIER_KINDS = ("原材料", "标准件", "机加工", "外协", "电气", "气动", "其他")

# 报价来源
QUOTE_TYPES = ("报价", "成交")


class Supplier(Base, TimestampMixin):
    """供应商主数据。"""

    __tablename__ = "supplier"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    short_name: Mapped[str | None] = mapped_column(String(64))
    kind: Mapped[str | None] = mapped_column(String(16))  # 主营类别
    contact_name: Mapped[str | None] = mapped_column(String(64))
    phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(128))
    address: Mapped[str | None] = mapped_column(String(255))
    payment_terms: Mapped[str | None] = mapped_column(String(128))  # 账期，如 月结 30 天
    tax_rate: Mapped[float | None] = mapped_column(Numeric(5, 2))  # 税率 %
    rating: Mapped[int | None] = mapped_column(Integer)  # 1~5 星评价
    remark: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")


class SupplierQuote(Base, TimestampMixin):
    """供应商报价 / 成交价记录。

    - price_type='报价'：供应商报的价（用于比价、砍价）
    - price_type='成交'：实际买到的价（下单时自动回写，形成历史价格）
    """

    __tablename__ = "supplier_quote"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_no: Mapped[str] = mapped_column(ForeignKey("item.item_no", ondelete="CASCADE"))
    supplier_id: Mapped[int] = mapped_column(ForeignKey("supplier.id", ondelete="CASCADE"))
    project_no: Mapped[str | None] = mapped_column(ForeignKey("project.project_no"))
    price: Mapped[float] = mapped_column(Numeric(14, 2))
    tax_incl: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")  # 含税/不含税（★ 必选）
    qty: Mapped[float | None] = mapped_column(Numeric(14, 3))  # 本笔成交数量（审批比价要用）
    currency: Mapped[str] = mapped_column(String(8), default="CNY", server_default="CNY")
    unit: Mapped[str | None] = mapped_column(String(16))
    min_qty: Mapped[float | None] = mapped_column(Numeric(14, 3))  # 起订量
    lead_days: Mapped[int | None] = mapped_column(Integer)  # 交期（天）
    price_type: Mapped[str] = mapped_column(String(8), default="报价", server_default="报价")
    quote_date: Mapped[date] = mapped_column(Date)
    valid_until: Mapped[date | None] = mapped_column(Date)
    source: Mapped[str | None] = mapped_column(String(64))  # 采购单号 / 手工
    remark: Mapped[str | None] = mapped_column(String(255))
    recorded_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))


class SupplierCatalog(Base, TimestampMixin):
    """★ 供应商「能供什么」—— 采购推荐匹配的依据。

    只填“主营大类=原材料”是**匹配不到方通的**：原材料下面有方通、扁通、槽钢、板材…
    所以供应商必须声明到**品类**（方通），愿意的话还能精确到**型号**（YL-FT-0001）。

    匹配优先级：型号 > 品类 > 大类（大类只是兜底，且会被标注“未声明品类”）
    """

    __tablename__ = "supplier_catalog"

    id: Mapped[int] = mapped_column(primary_key=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("supplier.id", ondelete="CASCADE"))
    std_class_code: Mapped[str | None] = mapped_column(ForeignKey("std_class.code"))
    item_no: Mapped[str | None] = mapped_column(ForeignKey("item.item_no"))
    price: Mapped[float | None] = mapped_column(Numeric(14, 2))  # 常规价（可空，以实际报价为准）
    lead_days: Mapped[int | None] = mapped_column(Integer)  # 常规交期（天）
    min_qty: Mapped[float | None] = mapped_column(Numeric(14, 3))  # 起订量
    is_preferred: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    remark: Mapped[str | None] = mapped_column(String(255))


class PurchaseRequestRef(Base):  # 占位，避免循环导入
    __abstract__ = True


__all__ = ["QUOTE_TYPES", "SUPPLIER_KINDS", "Supplier", "SupplierQuote", "date", "datetime"]
