"""验收域（《00 方案》§3.3 S10 · 《02 数据模型》§10）。

调试完成 → 申请客户验收 → 上传**验收资料包**（要传、要签的东西很多）→ 客户签字确认
→ ★ **自动进入质保期**（`warranty_start = 验收确认日`，`warranty_end = +质保期`）。
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# 验收状态
ACC_APPLIED = "待验收"
ACC_PASSED = "已通过"
ACC_REJECTED = "未通过"
ACC_STATUS = (ACC_APPLIED, ACC_PASSED, ACC_REJECTED)

# 资料包类型
DOC_TYPES = ("技术协议", "图纸清单", "检验报告", "调试记录", "操作手册", "备件清单", "培训记录", "验收单", "其他")


class Acceptance(Base, TimestampMixin):
    """客户验收：调试完成 → 申请验收 → 客户签字确认。"""

    __tablename__ = "acceptance"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    applied_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    signed_by: Mapped[str | None] = mapped_column(String(64))  # 客户签字人
    result: Mapped[str | None] = mapped_column(String(16))  # 通过 / 不通过
    status: Mapped[str] = mapped_column(String(16), default=ACC_APPLIED, server_default=ACC_APPLIED)
    warranty_months: Mapped[int | None] = mapped_column(Integer)
    warranty_start: Mapped[date | None] = mapped_column(Date)
    warranty_end: Mapped[date | None] = mapped_column(Date)
    photos: Mapped[list | None] = mapped_column(JSONB)
    remark: Mapped[str | None] = mapped_column(Text)


class AcceptanceDocument(Base, TimestampMixin):
    """验收资料包文件（要上传、要签的东西很多）。"""

    __tablename__ = "acceptance_document"

    id: Mapped[int] = mapped_column(primary_key=True)
    acceptance_id: Mapped[int] = mapped_column(ForeignKey("acceptance.id", ondelete="CASCADE"))
    doc_type: Mapped[str] = mapped_column(String(32), default="其他", server_default="其他")
    filename: Mapped[str] = mapped_column(String(255))
    stored_path: Mapped[str] = mapped_column(String(512))
    is_signed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    remark: Mapped[str | None] = mapped_column(String(255))
