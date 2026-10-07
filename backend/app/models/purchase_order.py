"""采购单实体化（《08 采购域重构方案》V2.0 §3 · 一期）。

**为什么要实体化**：此前「采购单」是用 `purchase_request.po_no` 字符串 GROUP BY 凑出来的视图，
带三个洞（08 §2）：① 拆单会**丢需求**（`merge_order` 直接把 `row.qty` 覆盖成已下量，
剩下 40 个蒸发）；② 部分合格表达不了；③ 一处数据靠代码兜底。

一期落地：`purchase_order`（单头）+ `purchase_order_line`（单行）。
★ **一条需求可以拆到多张单的多行**（客户口径 #1：很有可能会拆给多个供应商），
所以 `purchase_request.qty` **不再被下单动作改写**，改为记 `qty_ordered`（已下单量）。

审批（`purchase_approval`）：两级（采购经理 → 采购总监），通过后单头/单行都转「在途」。
★ 单头与单行**共用同一套状态词表**，单头是唯一口径（2026-10-07 客户口径）。
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

# ── ★ 采购状态机：单头与单行共用**同一套词表**（客户口径 2026-10-07）──────
#   原则：**单头是唯一口径**；审批阶段单行状态必须跟单头一致（不能审批前就显示「在途」）；
#   审批通过 → 在途；验收入库 → 已入库。不再有「已批准 / 执行中」这两个只在内部用的影子状态。
PO_DRAFT = "草稿"
PO_PENDING_LEAD = "待经理审"
PO_PENDING_DIRECTOR = "待总监审"
PO_RETURNED = "已退回"
PO_IN_TRANSIT = "在途"  # ★ 审批通过后（单头/单行共用；旧「已批准」「在途」归并到这里）
PO_PARTIAL = "部分到货"
PO_PENDING_STORE = "待入库"  # 单行：验收合格、还没入库
PO_STORED = "已入库"  # 单行：真的入库了（仓库）
PO_SITE_ACCEPTED = "现场已验收"  # 单行：直发客户现场、现场清点完成（不进仓库）
PO_FAILED = "不合格"
PO_RETURNED_GOODS = "已退货"
PO_CANCELLED = "已取消"
PO_DONE = "已完成"  # 单头聚合：所有行都已入库/已退货/已取消
PO_VOIDED = "已作废"
PO_CLOSED = "已关闭"

# 单头状态（单头是唯一口径；不再有「已批准/执行中」）
PO_STATUS = (
    PO_DRAFT,
    PO_PENDING_LEAD,
    PO_PENDING_DIRECTOR,
    PO_RETURNED,
    PO_IN_TRANSIT,
    PO_PARTIAL,
    PO_DONE,
    PO_VOIDED,
    PO_CLOSED,
)
# 在途之后：供应商/收货地/交期不可改（要改走「更改供应商」或作废重下）—— 08 §4.1 清单锁死线
PO_LOCKED_STATUS = (PO_IN_TRANSIT, PO_PARTIAL, PO_DONE)

# 单行状态（与单头同词表；多出到货/入库/协商的终态）
PO_LINE_STATUS = (
    PO_DRAFT,
    PO_PENDING_LEAD,
    PO_PENDING_DIRECTOR,
    PO_RETURNED,
    PO_IN_TRANSIT,
    PO_PARTIAL,
    PO_PENDING_STORE,
    PO_STORED,
    PO_SITE_ACCEPTED,
    PO_FAILED,
    PO_RETURNED_GOODS,
    PO_CANCELLED,
)
# 审批阶段的状态：这期间单行状态必须跟单头一致
PO_APPROVAL_STATUS = (PO_DRAFT, PO_PENDING_LEAD, PO_PENDING_DIRECTOR, PO_RETURNED)

# ── 兼容旧名（值已归并到新口径；新代码不要再引用）────────────────────
PO_APPROVED = PO_IN_TRANSIT
PO_EXECUTING = PO_PARTIAL
PO_LINE_OPEN = PO_IN_TRANSIT
PO_LINE_PARTIAL = PO_PARTIAL
PO_LINE_STORED = PO_STORED
PO_LINE_SITE_ACCEPTED = PO_SITE_ACCEPTED
PO_LINE_FAILED = PO_FAILED
PO_LINE_RETURNED = PO_RETURNED_GOODS
PO_LINE_CANCELLED = PO_CANCELLED

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


class PurchaseApproval(Base, TimestampMixin):
    """采购单审批留档（08 §3.3，二期）：多轮多级，**退回重提全部留档**。

    与工程评审 `review_action` 同构，但不复用同一张表（评审单是任务级按专业链；
    采购审批是单据级按部门链，硬塞会两边都脏）。
    """

    __tablename__ = "purchase_approval"

    id: Mapped[int] = mapped_column(primary_key=True)
    po_id: Mapped[int] = mapped_column(
        ForeignKey("purchase_order.id", ondelete="CASCADE"), index=True
    )
    round_no: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    level: Mapped[int] = mapped_column(Integer)  # 1=采购经理 / 2=采购总监 / 0=撤回
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    action: Mapped[str] = mapped_column(String(8))  # 通过 / 退回 / 跳过 / 撤回
    note: Mapped[str | None] = mapped_column(String(255))  # ★ 退回必填说明
    price_flags: Mapped[dict | None] = mapped_column(JSONB)  # 本轮审核时看到的价格参考快照
    acted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# 审批级别/动作
APPR_LEVEL_WITHDRAW = 0
APPR_LEVEL_LEAD = 1
APPR_LEVEL_DIRECTOR = 2
APPR_ACTIONS = ("通过", "退回", "跳过", "撤回")


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
