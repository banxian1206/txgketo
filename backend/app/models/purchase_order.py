"""采购单实体化（《08 采购域重构方案》V2.0 §3 · 一期）。

**为什么要实体化**：此前「采购单」是用 `purchase_request.po_no` 字符串 GROUP BY 凑出来的视图，
带三个洞（08 §2）：① 拆单会**丢需求**（`merge_order` 直接把 `row.qty` 覆盖成已下量，
剩下 40 个蒸发）；② 部分合格表达不了；③ 一处数据靠代码兜底。

一期落地：`purchase_order`（单头）+ `purchase_order_line`（单行）。
★ **一条需求可以拆到多张单的多行**（客户口径 #1：很有可能会拆给多个供应商），
所以 `purchase_request.qty` **不再被下单动作改写**，改为记 `qty_ordered`（已下单量）。

审批（`purchase_approval`）属**二期**，本期 PO 建出来直接 `已批准`。
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# ── 单头状态（08 §4.1）──────────────────────────────────────────────
# 二期会用到 待经理审/待总监审/已退回；一期直接 草稿 → 已批准。
PO_DRAFT = "草稿"
PO_PENDING_LEAD = "待经理审"
PO_PENDING_DIRECTOR = "待总监审"
PO_RETURNED = "已退回"
PO_APPROVED = "已批准"
PO_EXECUTING = "执行中"
PO_DONE = "已完成"
PO_VOIDED = "已作废"
PO_CLOSED = "已关闭"
PO_STATUS = (
    PO_DRAFT,
    PO_PENDING_LEAD,
    PO_PENDING_DIRECTOR,
    PO_RETURNED,
    PO_APPROVED,
    PO_EXECUTING,
    PO_DONE,
    PO_VOIDED,
    PO_CLOSED,
)
# 已批准之后：供应商/收货地/交期不可改（要改走「更改供应商」或作废重下）—— 08 §4.1 清单锁死线
PO_LOCKED_STATUS = (PO_APPROVED, PO_EXECUTING, PO_DONE)

# ── 单行状态（08 §3.2）──────────────────────────────────────────────
PO_LINE_OPEN = "在途"
PO_LINE_PARTIAL = "部分到货"
PO_LINE_STORED = "已入库"
PO_LINE_FAILED = "不合格"
PO_LINE_RETURNED = "已退货"
PO_LINE_CANCELLED = "已取消"
PO_LINE_STATUS = (
    PO_LINE_OPEN,
    PO_LINE_PARTIAL,
    PO_LINE_STORED,
    PO_LINE_FAILED,
    PO_LINE_RETURNED,
    PO_LINE_CANCELLED,
)

# ── 付款（08 §6；三期才会真正用）────────────────────────────────────
PAY_UNPAID = "未付款"
PAY_PAID = "已付款"
PAY_STATUS = (PAY_UNPAID, PAY_PAID)


class PurchaseOrder(Base, TimestampMixin):
    """采购单头：★ 一单一供应商（由表结构保证，不再靠代码判断 `len(suppliers)<=1`）。"""

    __tablename__ = "purchase_order"

    id: Mapped[int] = mapped_column(primary_key=True)
    po_no: Mapped[str] = mapped_column(String(32), unique=True)
    # ★ 一单一供应商：新单必填；历史回填可能只有 supplier_name
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("supplier.id"))
    supplier_name: Mapped[str | None] = mapped_column(String(128))  # 下单时快照
    order_date: Mapped[date | None] = mapped_column(Date)
    # 承诺交期（整单口径，采购填）—— 算 delay_days 用
    expect_date: Mapped[date | None] = mapped_column(Date)
    actual_arrive_date: Mapped[date | None] = mapped_column(Date)  # 派生：最后一批到货日
    delay_days: Mapped[int | None] = mapped_column(Integer)  # 派生：实际 − 承诺（>0 逾期）
    deliver_to: Mapped[str | None] = mapped_column(String(16))  # 公司仓库 / 直发客户现场
    deliver_address: Mapped[str | None] = mapped_column(String(255))
    currency: Mapped[str] = mapped_column(String(8), default="CNY", server_default="CNY")
    tax_rate: Mapped[float | None] = mapped_column(Numeric(5, 2))
    freight: Mapped[float | None] = mapped_column(Numeric(14, 2))  # 运费
    discount: Mapped[float | None] = mapped_column(Numeric(14, 2))  # 整单折扣
    total_tax_incl: Mapped[float | None] = mapped_column(Numeric(14, 2))  # 派生：含税合计
    total_tax_excl: Mapped[float | None] = mapped_column(Numeric(14, 2))  # 派生：不含税合计
    status: Mapped[str] = mapped_column(String(16), default=PO_DRAFT, server_default=PO_DRAFT)
    # 付款（客户口径 #12：一单付一次；三期用，字段先就位）
    pay_status: Mapped[str] = mapped_column(String(16), default=PAY_UNPAID, server_default=PAY_UNPAID)
    paid_amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    paid_at: Mapped[date | None] = mapped_column(Date)  # 财务实际付款日
    paid_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    paid_marked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_vouchers: Mapped[list | None] = mapped_column(JSONB)  # 付款截图
    paid_note: Mapped[str | None] = mapped_column(String(255))
    attachments: Mapped[list | None] = mapped_column(JSONB)  # 订单附件
    round: Mapped[int] = mapped_column(Integer, default=1, server_default="1")  # 审批轮次（二期）
    created_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    remark: Mapped[str | None] = mapped_column(Text)


class PurchaseOrderLine(Base, TimestampMixin):
    """采购单行：★ 一条需求可出现在多张单的多行上（拆单）。"""

    __tablename__ = "purchase_order_line"

    id: Mapped[int] = mapped_column(primary_key=True)
    po_id: Mapped[int] = mapped_column(
        ForeignKey("purchase_order.id", ondelete="CASCADE"), index=True
    )
    request_id: Mapped[int | None] = mapped_column(ForeignKey("purchase_request.id"), index=True)
    item_no: Mapped[str] = mapped_column(ForeignKey("item.item_no"))
    part_no: Mapped[str | None] = mapped_column(String(48))
    project_no: Mapped[str | None] = mapped_column(ForeignKey("project.project_no"))
    equip_no: Mapped[str | None] = mapped_column(String(16))
    qty: Mapped[float] = mapped_column(Numeric(14, 3))  # 本次向这家买多少
    unit: Mapped[str | None] = mapped_column(String(16))
    unit_price: Mapped[float | None] = mapped_column(Numeric(14, 2))
    tax_incl: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    tax_rate: Mapped[float | None] = mapped_column(Numeric(5, 2))
    amount_tax_incl: Mapped[float | None] = mapped_column(Numeric(14, 2))  # 派生
    amount_tax_excl: Mapped[float | None] = mapped_column(Numeric(14, 2))  # 派生
    # 本行预计到货（可被「换货」重算覆盖；与单头承诺交期分开）
    expect_date: Mapped[date | None] = mapped_column(Date)
    received_qty: Mapped[float | None] = mapped_column(Numeric(14, 3))  # 派生：已验收合格
    rejected_qty: Mapped[float | None] = mapped_column(Numeric(14, 3))  # 派生：累计不合格
    status: Mapped[str] = mapped_column(String(16), default=PO_LINE_OPEN, server_default=PO_LINE_OPEN)
    remark: Mapped[str | None] = mapped_column(String(255))


def compute_line_amounts(
    qty: float, unit_price: float | None, tax_incl: bool, tax_rate: float | None
) -> tuple[float | None, float | None]:
    """按 `tax_incl` 口径算含税/不含税金额（08 §3.2 换算规则）。"""
    if unit_price is None:
        return None, None
    rate = 1.0 + float(tax_rate or 0.0) / 100.0
    gross = float(qty or 0) * float(unit_price)
    if tax_incl:
        return round(gross, 2), round(gross / rate, 2)
    return round(gross * rate, 2), round(gross, 2)
