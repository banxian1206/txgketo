"""制造域（《00 方案》§3.3 S5 制造 · 《02 数据模型》§6）。

**★ 只管两头**（客户原则）：
  ① 下发任务：【原材料】+ 图纸交第一道工序 → 拍照确认
  ② 制造（有周期，如 2 天）
  ③ 到期验收：合格 → 转运装配区（拍照）｜ 不合格 → 返工 / 重做

**不做工序级报工、不做工时统计。** 一线不登录，由领料员/系统专员批量操作。
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# 排产单状态（02 卷 §6）
PROD_WAIT = "待领料"  # 已生成，还没下发
PROD_DISPATCHED = "已派工"  # 原材料 + 图纸已下发（拍照）
PROD_RUNNING = "制造中"
PROD_DONE = "完工待验收"
PROD_TRANSFERRED = "已转运"  # 验收合格 + 转运装配区（拍照）
PROD_REWORK = "返工"
PROD_STATUS = (
    PROD_WAIT,
    PROD_DISPATCHED,
    PROD_RUNNING,
    PROD_DONE,
    PROD_TRANSFERRED,
    PROD_REWORK,
)

# 验收结论
ACCEPT_OK = "合格"
ACCEPT_NG = "不合格"
ACCEPT_REWORK = "返工"
ACCEPT_RESULTS = (ACCEPT_OK, ACCEPT_NG, ACCEPT_REWORK)

# 转运目的地
TRANSFER_TO_ASSY = "装配区"
TRANSFER_DEFAULT = "装配区"

# 外协状态
OS_WAIT = "待发出"
OS_SENT = "外协中"
OS_BACK = "回厂待检"
OS_OK = "合格"
OS_STATUS = (OS_WAIT, OS_SENT, OS_BACK, OS_OK, "已取消")


class ProdOrder(Base, TimestampMixin):
    """排产订单：车间要做的**自制件**（图号即物料号）。"""

    __tablename__ = "prod_order"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_no: Mapped[str] = mapped_column(String(32), unique=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str | None] = mapped_column(String(16))
    item_no: Mapped[str] = mapped_column(String(48))  # 自制件图号
    item_name: Mapped[str | None] = mapped_column(String(128))
    spec_text: Mapped[str | None] = mapped_column(String(255))
    qty: Mapped[float] = mapped_column(Numeric(12, 2), default=1, server_default="1")
    unit: Mapped[str] = mapped_column(String(16), default="件", server_default="件")
    plan_start: Mapped[date | None] = mapped_column(Date)
    plan_end: Mapped[date | None] = mapped_column(Date)  # ★ 有周期，如 2 天
    status: Mapped[str] = mapped_column(String(16), default=PROD_WAIT, server_default=PROD_WAIT)
    team: Mapped[str | None] = mapped_column(String(32))  # 下料 / 机加 / 焊接 / 钣金 / 喷涂
    worker_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    remark: Mapped[str | None] = mapped_column(Text)


class ProdTask(Base, TimestampMixin):
    """派工到第一道工序：「原材料 + 图纸」下发的留痕（拍照）。"""

    __tablename__ = "prod_task"

    id: Mapped[int] = mapped_column(primary_key=True)
    prod_order_id: Mapped[int] = mapped_column(ForeignKey("prod_order.id", ondelete="CASCADE"))
    step_name: Mapped[str] = mapped_column(String(32))  # 第一道工序：下料 / 机加 / 焊接…
    material_item_no: Mapped[str | None] = mapped_column(String(48))  # 原材料（型号级）
    material_qty: Mapped[float | None] = mapped_column(Numeric(14, 3))
    drawing_no: Mapped[str | None] = mapped_column(String(48))
    drawing_version: Mapped[str | None] = mapped_column(String(8))
    issued_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    issued_to: Mapped[str | None] = mapped_column(String(64))  # 交到哪个工序/班组
    photos: Mapped[list | None] = mapped_column(JSONB)  # ★ 拍照确认已下发
    remark: Mapped[str | None] = mapped_column(String(255))


class ProdAcceptance(Base, TimestampMixin):
    """到期验收（合格 / 不合格 / 返工）+ 转运装配区（拍照）。"""

    __tablename__ = "prod_acceptance"

    id: Mapped[int] = mapped_column(primary_key=True)
    prod_order_id: Mapped[int] = mapped_column(ForeignKey("prod_order.id", ondelete="CASCADE"))
    accepted_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result: Mapped[str] = mapped_column(String(16))  # 合格 / 不合格 / 返工
    reason: Mapped[str | None] = mapped_column(Text)
    photos: Mapped[list | None] = mapped_column(JSONB)  # ★ 做完的照片
    transfer_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    transfer_to: Mapped[str | None] = mapped_column(String(32))  # 装配区 / 半成品区
    transfer_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    transfer_photos: Mapped[list | None] = mapped_column(JSONB)  # ★ 转运到位照片
    remark: Mapped[str | None] = mapped_column(String(255))


class OutsourceTask(Base, TimestampMixin):
    """外协：自己做不了的零件发出去加工（我方供料 / 外协供料）。"""

    __tablename__ = "outsource_task"

    id: Mapped[int] = mapped_column(primary_key=True)
    outsource_no: Mapped[str] = mapped_column(String(32), unique=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str | None] = mapped_column(String(16))
    item_no: Mapped[str] = mapped_column(String(48))  # 外协件图号
    item_name: Mapped[str | None] = mapped_column(String(128))
    qty: Mapped[float] = mapped_column(Numeric(12, 2), default=1, server_default="1")
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("supplier.id"))
    supplier_name: Mapped[str | None] = mapped_column(String(128))
    material_supplied: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    sent_at: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    returned_at: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default=OS_WAIT, server_default=OS_WAIT)
    photos: Mapped[list | None] = mapped_column(JSONB)
    remark: Mapped[str | None] = mapped_column(Text)


# 第一道工序（团队）候选，用于派工下拉
PROD_TEAMS = ("下料", "机加", "焊接", "钣金", "喷涂", "装配")
