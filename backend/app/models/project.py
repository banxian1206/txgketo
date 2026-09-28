"""项目域：客户、联系人、项目（唯一根）、付款节点、资料包、设备（T03 前置）。"""

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
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# 项目阶段（商机→订单→合同→项目，一号到底，只是阶段在推进）
PROJECT_STAGES = ("线索", "成交待立项", "执行中", "交付中", "质保", "已归档", "已关闭")
CLOSE_REASONS = ("价格", "交期", "技术不满足", "客户取消", "对手中标", "其他")
DEAL_MODES = ("投标", "直签")


class Customer(Base, TimestampMixin):
    __tablename__ = "customer"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str | None] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    short_name: Mapped[str | None] = mapped_column(String(64))
    address: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    remark: Mapped[str | None] = mapped_column(String(255))


class Contact(Base, TimestampMixin):
    """客户联系人（一对多：技术对接人 / 采购 / 决策人）。"""

    __tablename__ = "contact"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(64))
    title: Mapped[str | None] = mapped_column(String(64))
    phone: Mapped[str | None] = mapped_column(String(32))
    wechat: Mapped[str | None] = mapped_column(String(64))
    email: Mapped[str | None] = mapped_column(String(128))
    role_tag: Mapped[str | None] = mapped_column(String(32))


class Project(Base, TimestampMixin):
    """项目（系统的唯一根）。

    ★ 商机、订单、合同、项目是同一行记录的不同阶段：
      project_no 在建商机时发号（TX{YY}{NNN}），此后一生不变。
    """

    __tablename__ = "project"

    project_no: Mapped[str] = mapped_column(String(16), primary_key=True)

    # ---- ① 新建线索（必填）----
    project_name: Mapped[str] = mapped_column(String(128))
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"))
    project_desc: Mapped[str | None] = mapped_column(Text)
    deadline: Mapped[date | None] = mapped_column(Date)  # 商机截止：客户要求何时定下来
    delivery_days: Mapped[int | None] = mapped_column(Integer)  # 项目交期天数（签约后起算，如 90）
    deal_mode: Mapped[str | None] = mapped_column(String(16))

    # ---- ① 接收到的资料（资料清单勾选）----
    received_docs: Mapped[list | None] = mapped_column(JSONB)

    # ---- ① 附加（建议字段）----
    source: Mapped[str | None] = mapped_column(String(32))
    site_address: Mapped[str | None] = mapped_column(String(255))
    is_retrofit: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    product_type: Mapped[str | None] = mapped_column(String(64))
    required_cycle: Mapped[str | None] = mapped_column(String(64))
    required_capacity: Mapped[str | None] = mapped_column(String(64))
    est_amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    expect_sign_date: Mapped[date | None] = mapped_column(Date)
    competitor: Mapped[str | None] = mapped_column(String(128))
    # 履约保证金：我们交给对方、履约完成后收回（与质保金方向相反）
    performance_deposit: Mapped[float | None] = mapped_column(Numeric(14, 2))
    performance_deposit_return_date: Mapped[date | None] = mapped_column(Date)
    performance_deposit_returned: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    related_project_no: Mapped[str | None] = mapped_column(String(16))
    risk_note: Mapped[str | None] = mapped_column(String(255))
    sales_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))

    # ---- ② 成交登记（必填）----
    period_start: Mapped[date | None] = mapped_column(Date)
    period_end: Mapped[date | None] = mapped_column(Date)
    amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    amount_tax_incl: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    # ---- ② 附加（建议字段）----
    contract_no_customer: Mapped[str | None] = mapped_column(String(64))
    warranty_months: Mapped[int | None] = mapped_column(Integer)
    warranty_amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    penalty_note: Mapped[str | None] = mapped_column(String(255))
    acceptance_standard: Mapped[str | None] = mapped_column(Text)
    designated_brand: Mapped[str | None] = mapped_column(Text)
    delivery_mode: Mapped[str | None] = mapped_column(String(32))
    site_condition: Mapped[str | None] = mapped_column(Text)
    is_batch_delivery: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    tech_agreement_frozen: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    # ---- ③ 结果 ----
    stage: Mapped[str] = mapped_column(String(16), default="线索", server_default="线索")
    close_reason: Mapped[str | None] = mapped_column(String(32))
    close_note: Mapped[str | None] = mapped_column(String(255))
    warranty_start: Mapped[date | None] = mapped_column(Date)  # 验收确认日
    warranty_end: Mapped[date | None] = mapped_column(Date)  # 自动算出
    # ★ G1（09 卷 §3）：质保期过 → 自动归档（惰性扫描写入）
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    pm_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))


# ★ G2（09 卷 §3）：付款节点要**跟业务/物流节点对上** —— 客户：“我发了之后，就必须要催商务部的人去把这个款拿下来”
PAY_TRIGGER_SHIP = "发货"
PAY_TRIGGER_ARRIVE = "到货"
PAY_TRIGGER_ACCEPT = "验收"
PAY_TRIGGER_WARRANTY = "质保"
PAYMENT_TRIGGERS = (PAY_TRIGGER_SHIP, PAY_TRIGGER_ARRIVE, PAY_TRIGGER_ACCEPT, PAY_TRIGGER_WARRANTY)


class PaymentTerm(Base, TimestampMixin):
    """付款节点（成交时登记）+ 回款跟踪。"""

    __tablename__ = "payment_term"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    node_name: Mapped[str] = mapped_column(String(64))
    # ★ G2：这个款由哪个**业务节点**触发提醒（发货/到货/验收/质保）；预收款等无节点为 NULL
    trigger_node: Mapped[str | None] = mapped_column(String(16))
    percent: Mapped[float | None] = mapped_column(Numeric(6, 2))
    amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    expect_date: Mapped[date | None] = mapped_column(Date)
    condition: Mapped[str | None] = mapped_column(String(255))
    received_amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    received_date: Mapped[date | None] = mapped_column(Date)
    remark: Mapped[str | None] = mapped_column(String(255))

    __table_args__ = (UniqueConstraint("project_no", "seq", name="uq_payment_term_project_seq"),)


class Attachment(Base, TimestampMixin):
    """资料包：方案 / 报价 / 合同 / 技术协议 / 客户资料 —— 只存文件，不建审批流。"""

    __tablename__ = "attachment"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    category: Mapped[str] = mapped_column(String(32))
    filename: Mapped[str] = mapped_column(String(255))
    stored_path: Mapped[str] = mapped_column(String(512))
    size: Mapped[int | None] = mapped_column(Integer)
    version: Mapped[str | None] = mapped_column(String(16))
    is_frozen: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Equipment(Base, TimestampMixin):
    """设备：01A / 01B（同型第二台）。"""

    __tablename__ = "equipment"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str] = mapped_column(String(16))  # 01A / 01B / 100
    equip_name: Mapped[str] = mapped_column(String(64))  # 升降机 / 点胶机 / 皮带线
    model: Mapped[str | None] = mapped_column(String(64))
    kind: Mapped[str | None] = mapped_column(String(16))  # 单机 / 工位 / 线体
    line_no: Mapped[str | None] = mapped_column(String(16))
    seq_no: Mapped[int | None] = mapped_column(Integer)  # 01
    letter: Mapped[str | None] = mapped_column(String(4))  # A / B
    bom_complete: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    remark: Mapped[str | None] = mapped_column(String(255))

    __table_args__ = (UniqueConstraint("project_no", "equip_no", name="uq_equipment_project_no"),)
