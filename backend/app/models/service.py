"""售后域（《00 方案》§3.3 S11 · 《02 数据模型》§10）。

服务工单：报修受理 → 派工 → 到场 → 处理（含**备件更换**）→ 客户签字 → 关闭。
备件：易损件清单 + 收发记录（领出/退回/补货，可关联工单）。
质保判定：项目在保/过保一目了然（质保期来自客户验收自动生成）。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# 工单状态
SO_WAIT = "待受理"
SO_DISPATCHED = "已派工"
SO_ONSITE = "已到场"
SO_FIXED = "待客户签字"
SO_CLOSED = "已关闭"
SO_STATUS = (SO_WAIT, SO_DISPATCHED, SO_ONSITE, SO_FIXED, SO_CLOSED)

# 备件收发类型
SP_ISSUE = "领出"
SP_RETURN = "退回"
SP_RESTOCK = "补货"
SP_MOVE_TYPES = (SP_ISSUE, SP_RETURN, SP_RESTOCK)


class ServiceOrder(Base, TimestampMixin):
    """服务工单（SV{YY}{NNN}）。"""

    __tablename__ = "service_order"

    id: Mapped[int] = mapped_column(primary_key=True)
    so_no: Mapped[str] = mapped_column(String(32), unique=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str | None] = mapped_column(String(16))
    reported_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    reported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fault: Mapped[str | None] = mapped_column(Text)  # 故障描述
    status: Mapped[str] = mapped_column(String(16), default=SO_WAIT, server_default=SO_WAIT)
    # 受理 / 派工
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dispatched_to: Mapped[str | None] = mapped_column(String(64))  # 派谁去修
    # 到场
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 处理
    solution: Mapped[str | None] = mapped_column(Text)
    labor_hours: Mapped[float | None] = mapped_column(Numeric(6, 1))
    fixed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    photos: Mapped[list | None] = mapped_column(JSONB)
    # 客户签字
    customer_sign: Mapped[str | None] = mapped_column(String(64))
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    in_warranty: Mapped[bool | None] = mapped_column(Boolean)  # 报修时是否在保
    remark: Mapped[str | None] = mapped_column(Text)


class SparePart(Base, TimestampMixin):
    """备件（易损件清单）：存备件库的数量 + 装机数。"""

    __tablename__ = "spare_part"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str | None] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str | None] = mapped_column(String(16))
    item_no: Mapped[str] = mapped_column(String(48))  # 物料号（标准库 / 图号）
    item_name: Mapped[str | None] = mapped_column(String(128))
    qty_stock: Mapped[float] = mapped_column(Numeric(12, 2), default=0, server_default="0")  # 备件库现存
    qty_installed: Mapped[float] = mapped_column(Numeric(12, 2), default=0, server_default="0")  # 装机数
    min_qty: Mapped[float | None] = mapped_column(Numeric(12, 2))  # 低于提醒
    remark: Mapped[str | None] = mapped_column(Text)


class SparePartMove(Base, TimestampMixin):
    """备件收发记录：领出 / 退回 / 补货（可关联工单）。"""

    __tablename__ = "spare_part_move"

    id: Mapped[int] = mapped_column(primary_key=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("spare_part.id", ondelete="CASCADE"))
    move_type: Mapped[str] = mapped_column(String(16))
    qty: Mapped[float] = mapped_column(Numeric(12, 2))
    service_order_id: Mapped[int | None] = mapped_column(ForeignKey("service_order.id", ondelete="SET NULL"))
    issued_to: Mapped[str | None] = mapped_column(String(64))
    operator_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    moved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    remark: Mapped[str | None] = mapped_column(String(255))
