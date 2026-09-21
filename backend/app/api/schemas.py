"""请求/响应模型。"""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    name: str
    phone: str | None = None
    org_id: int | None = None
    profession: str | None = None
    position: str | None = None
    is_active: bool = True
    is_superuser: bool = False


class UserAdminOut(UserOut):
    """用户管理页用：带角色编码。"""

    roles: list[str] = []


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ContactIn(BaseModel):
    name: str
    title: str | None = None
    phone: str | None = None
    wechat: str | None = None
    email: str | None = None
    role_tag: str | None = Field(default=None, description="技术对接人 / 采购 / 决策人")


class ProjectCreateIn(BaseModel):
    """新建商机（线索）—— 必填 7 项 + 建议字段。"""

    # 必填
    customer_name: str = Field(..., description="客户名称")
    project_name: str = Field(..., description="项目名称")
    contacts: list[ContactIn] = Field(default_factory=list, description="客户方联系人（可多个）")
    received_docs: list[str] = Field(default_factory=list, description="接收到的资料（清单勾选）")
    project_desc: str | None = Field(default=None, description="项目描述")
    deadline: date | None = Field(default=None, description="商机截止时间：客户要求何时把这件事定下来")
    delivery_days: int | None = Field(default=None, description="项目交期天数（签约后起算，如 90）")
    deal_mode: str | None = Field(default=None, description="项目方式：投标 / 直签")

    # 建议字段
    source: str | None = None
    site_address: str | None = None
    is_retrofit: bool = False
    product_type: str | None = None
    required_cycle: str | None = None
    required_capacity: str | None = None
    est_amount: float | None = None
    expect_sign_date: date | None = None
    competitor: str | None = None
    related_project_no: str | None = None
    risk_note: str | None = None
    sales_id: int | None = None
    # 履约保证金（我们交出去的，选填）
    performance_deposit: float | None = None
    performance_deposit_return_date: date | None = None
    performance_deposit_returned: bool = False


class ProjectUpdateIn(BaseModel):
    """编辑项目（部分更新）：只传需要改的字段。每一次修改都会落操作记录，含 旧值 → 新值。"""

    project_name: str | None = None
    customer_name: str | None = None
    project_desc: str | None = None
    # 商机阶段
    deadline: date | None = None
    delivery_days: int | None = None
    deal_mode: str | None = None
    source: str | None = None
    site_address: str | None = None
    is_retrofit: bool | None = None
    product_type: str | None = None
    required_cycle: str | None = None
    required_capacity: str | None = None
    est_amount: float | None = None
    expect_sign_date: date | None = None
    competitor: str | None = None
    related_project_no: str | None = None
    risk_note: str | None = None
    sales_id: int | None = None
    received_docs: list[str] | None = None
    performance_deposit: float | None = None
    performance_deposit_return_date: date | None = None
    performance_deposit_returned: bool | None = None
    # 成交登记
    amount: float | None = None
    amount_tax_incl: bool = True
    period_start: date | None = None
    period_end: date | None = None
    contract_no_customer: str | None = None
    warranty_months: int | None = None
    warranty_amount: float | None = None
    penalty_note: str | None = None
    acceptance_standard: str | None = None
    designated_brand: str | None = None
    delivery_mode: str | None = None
    site_condition: str | None = None
    is_batch_delivery: bool = True
    tech_agreement_frozen: bool = False
    close_reason: str | None = None
    close_note: str | None = None
    pm_id: int | None = None
    # 结果
    stage: str | None = None
    close_reason: str | None = None
    close_note: str | None = None


class PaymentTermIn(BaseModel):
    """付款节点（预付款 / 发货款 / 验收款 / 质保金 …）"""

    node_name: str
    percent: float | None = None
    amount: float | None = None
    expect_date: date | None = None
    condition: str | None = None


class DealIn(BaseModel):
    """成交登记：把商机定下来（周期 / 金额 / 付款方式 / 质保）。"""

    period_start: date | None = Field(default=None, description="合同签订日 / 项目开始")
    period_end: date | None = Field(default=None, description="合同交期")
    amount: float | None = Field(default=None, description="合同金额")
    amount_tax_incl: bool = True
    contract_no_customer: str | None = Field(default=None, description="客户方合同号")
    warranty_months: int | None = Field(default=None, description="质保期（月）")
    warranty_amount: float | None = Field(default=None, description="质保金")
    penalty_note: str | None = Field(default=None, description="交期与违约条款")
    acceptance_standard: str | None = Field(default=None, description="验收标准")
    designated_brand: str | None = Field(default=None, description="甲方指定品牌/供应商")
    delivery_mode: str | None = Field(default=None, description="交货方式与地点")
    site_condition: str | None = Field(default=None, description="客户现场接收条件")
    is_batch_delivery: bool = True
    tech_agreement_frozen: bool = Field(default=False, description="技术协议已冻结 = 设计基线")
    payment_terms: list[PaymentTermIn] = Field(default_factory=list)


class CloseIn(BaseModel):
    """关闭订单。"""

    close_reason: str = Field(..., description="价格 / 交期 / 技术不满足 / 客户取消 / 对手中标 / 其他")
    close_note: str | None = None


class AttachmentBrief(BaseModel):
    id: int
    filename: str
    category: str


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    project_no: str
    project_name: str
    customer_id: int
    customer_name: str | None = None
    sales_name: str | None = None
    attachment_count: int = 0
    attachments_brief: list[AttachmentBrief] = Field(default_factory=list)
    stage: str
    project_desc: str | None = None
    deadline: date | None = None  # 商机截止：客户要求何时把这件事定下来
    opportunity_days_left: int | None = None  # 商机剩余天数（列表用；负数=已过期）
    delivery_days: int | None = None  # 项目交期天数（签约后起算，如 90）
    delivery_start: date | None = None  # 起算日 = 合同签订日（没有就是还没起）
    delivery_end: date | None = None  # 应交日 = 签订日 + 交期天数（没签约日就没有）
    delivery_days_left: int | None = None  # 项目剩余天数（未签约时为 null）
    deal_mode: str | None = None
    received_docs: list[str] | None = None
    # 建议字段
    source: str | None = None
    site_address: str | None = None
    is_retrofit: bool = False
    product_type: str | None = None
    required_cycle: str | None = None
    required_capacity: str | None = None
    est_amount: float | None = None
    expect_sign_date: date | None = None
    competitor: str | None = None
    related_project_no: str | None = None
    risk_note: str | None = None
    sales_id: int | None = None
    performance_deposit: float | None = None
    performance_deposit_return_date: date | None = None
    performance_deposit_returned: bool = False
    # 成交登记
    amount: float | None = None
    amount_tax_incl: bool = True
    period_start: date | None = None
    period_end: date | None = None
    contract_no_customer: str | None = None
    warranty_months: int | None = None
    warranty_amount: float | None = None
    penalty_note: str | None = None
    acceptance_standard: str | None = None
    designated_brand: str | None = None
    delivery_mode: str | None = None
    site_condition: str | None = None
    is_batch_delivery: bool = True
    tech_agreement_frozen: bool = False
    close_reason: str | None = None
    close_note: str | None = None
    pm_id: int | None = None
    created_at: object | None = None
