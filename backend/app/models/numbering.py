"""发号引擎的表：规则 + 序列（T02）。

规则由贵司维护（不是写死在代码里）—— 改编号规则只改数据，不改代码。
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class NumberRule(Base, TimestampMixin):
    """编号规则。

    template 支持的占位符：
      {YY}      两位年份（2026 → 26）
      {seq}     序列号，可带补零位数（{seq:02} → 01、{seq:03} → 001）
      {project} 项目编号
      {equip}   设备号（01A）
      {line}    线体号（100）
      {l1}..{l4} 机械图纸 4 组层次码
    """

    __tablename__ = "number_rule"

    id: Mapped[int] = mapped_column(primary_key=True)
    object_type: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(64))
    template: Mapped[str] = mapped_column(String(128))
    scope: Mapped[str] = mapped_column(String(32), default="global", server_default="global")
    start_value: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    step: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    remark: Mapped[str | None] = mapped_column(String(255))


class NumberSeq(Base):
    """取号序列。主键 (rule_id, scope_key) —— 行锁取号，保证不重号、不跳号。"""

    __tablename__ = "number_seq"

    rule_id: Mapped[int] = mapped_column(ForeignKey("number_rule.id", ondelete="CASCADE"), primary_key=True)
    scope_key: Mapped[str] = mapped_column(String(64), primary_key=True, default="")
    next_value: Mapped[int] = mapped_column(Integer)
