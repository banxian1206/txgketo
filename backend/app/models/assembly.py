"""装配与齐套域（《00 方案》§3.3 S6 · 《02 数据模型》§7）。

**齐套率只做展示**（用户确认）：装配随时能开工，56%、78% 都能装，视情况而定。
系统只把「这台设备到了多少个件、还差什么」摆出来，**不设 100% 门槛**。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# 装配形态
ASSY_WHOLE = "整机装配"
ASSY_PARTIAL = "组件预装"
ASSY_KINDS = (ASSY_WHOLE, ASSY_PARTIAL)

# 装配/调试状态
ASSY_ING = "装配中"
ASSY_DONE = "已装配"
ASSY_DEBUGGING = "调试中"
ASSY_DEBUG_DONE = "调试完成"
ASSY_STATUS = (ASSY_ING, ASSY_DONE, ASSY_DEBUGGING, ASSY_DEBUG_DONE)


class KittingSnapshot(Base, TimestampMixin):
    """齐套快照：装配开工时记录「当时到了多少」（历史留档，只读）。"""

    __tablename__ = "kitting_snapshot"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str] = mapped_column(String(16))
    snapshot_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    total_qty: Mapped[float] = mapped_column(Numeric(14, 3), default=0, server_default="0")
    arrived_qty: Mapped[float] = mapped_column(Numeric(14, 3), default=0, server_default="0")
    kitting_rate: Mapped[float] = mapped_column(Numeric(6, 4), default=0, server_default="0")
    detail: Mapped[dict | None] = mapped_column(JSONB)


class AssemblyRecord(Base, TimestampMixin):
    """装配记录 + 厂内调试：整机装配 或 组件预装。"""

    __tablename__ = "assembly_record"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str] = mapped_column(String(16))
    sub_assembly: Mapped[str] = mapped_column(String(32), default=ASSY_WHOLE, server_default=ASSY_WHOLE)
    # 开工时的齐套率快照（不是门槛，只是记录「当时到了多少」）
    kitting_rate: Mapped[float] = mapped_column(Numeric(6, 4), default=0, server_default="0")
    total_qty: Mapped[float] = mapped_column(Numeric(14, 3), default=0, server_default="0")
    arrived_qty: Mapped[float] = mapped_column(Numeric(14, 3), default=0, server_default="0")
    status: Mapped[str] = mapped_column(String(16), default=ASSY_ING, server_default=ASSY_ING)
    assembled_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    assembled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    photos: Mapped[list | None] = mapped_column(JSONB)
    # 厂内调试
    debug_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    debug_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    debug_result: Mapped[str | None] = mapped_column(String(16))
    debug_note: Mapped[str | None] = mapped_column(Text)
    debug_photos: Mapped[list | None] = mapped_column(JSONB)
    remark: Mapped[str | None] = mapped_column(Text)
