"""付款计划变更单（2026-09-30 客户拍板：成交后改付款计划走这张单）。

## 为什么需要它

成交登记只在「线索」阶段能提交（`routes/project.deal`），成交后付款节点只有「登记回款」——
录错了（比如比例合计 170%、或客户后来改了分期）**没有任何口改**，只能一直错下去。

客户 2026-09-30 确认：**做成付款计划变更单、走商务总监审批**
（口诀延续铁律 4「一切改动都是变更，必须走审批」与铁律 9「不自己发明规则」）。

## 口径（本轮定死）

1. **只改未来节点**：`received_amount > 0` 的节点是既成事实，**不许改、不许删**；
   变更单里只填「还没收的节点」的新计划。
2. **合计要对得上**：`Σ(已收节点比例) + Σ(新计划比例) = 100%`；
   金额合计不得超过合同额（与 `deal()` 同一套校验口径）。
3. **审批链按单据归属部门找人**（铁律 13）：付款是**商务部**的活 → 商务总监（`SALES`）。
   提交人不能自己审自己。
4. **全程留痕**：`before_terms`（改前快照 JSONB）+ 变更单明细（改后计划）+ 审批记录字段 + `audit_log`。
5. 存量“已收齐”的历史收款**不动**：批准后把未收节点整体替换成新计划（seq 接在已收节点之后）。

⚠️ 与铁律 12「审评口只有两处（工程 + 采购）」的关系：那条讲的是**设计评审**与**采购价格审批**；
付款计划属合同/商务域，按 §8.1 既有口径（收款提醒发给项目销售负责人 + 商务部总监）归**商务总监**批。
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.models.base import Base, TimestampMixin

# ---- 状态（★ 词表 = 契约：新增状态值必须同步进这里，tests/test_status_contract 会看） ----
PAY_CHANGE_PENDING = "待商务总监审"
PAY_CHANGE_APPROVED = "已批准"
PAY_CHANGE_REJECTED = "已否决"
PAY_CHANGE_WITHDRAWN = "已撤销"
PAY_CHANGE_STATUS = (
    PAY_CHANGE_PENDING,
    PAY_CHANGE_APPROVED,
    PAY_CHANGE_REJECTED,
    PAY_CHANGE_WITHDRAWN,
)
PAY_CHANGE_OPEN = (PAY_CHANGE_PENDING,)  # 还没定论的（列表/待办用）


class PaymentChange(Base, TimestampMixin):
    """付款计划变更单（单头）。"""

    __tablename__ = "payment_change"

    id: Mapped[int] = mapped_column(primary_key=True)
    change_no: Mapped[str] = mapped_column(String(32), unique=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    reason: Mapped[str] = mapped_column(Text)  # 为什么改（客户改分期/录错纠正…）
    status: Mapped[str] = mapped_column(String(16), default=PAY_CHANGE_PENDING)
    # 改前的付款节点快照（留痕：批准后旧行会被替换/删除，快照是唯一证据）
    before_terms: Mapped[list | None] = mapped_column(JSON)
    requested_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)


class PaymentChangeLine(Base, TimestampMixin):
    """变更单里填的**未来节点**新计划（不含已收款节点）。"""

    __tablename__ = "payment_change_line"

    id: Mapped[int] = mapped_column(primary_key=True)
    change_id: Mapped[int] = mapped_column(ForeignKey("payment_change.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    node_name: Mapped[str] = mapped_column(String(64))
    trigger_node: Mapped[str | None] = mapped_column(String(16))
    percent: Mapped[float | None] = mapped_column(Numeric(6, 2))
    amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    expect_date: Mapped[date | None] = mapped_column(Date)
    condition: Mapped[str | None] = mapped_column(String(255))
