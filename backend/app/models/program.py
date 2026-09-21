"""PLC 程序：程序 + 程序版本（与 drawing_version 同构，05 卷 §8.1、§0）。

· 程序是程序专业的产出物，**不进 BOM、不触发采购**（PLC 硬件在电气 BOM 里）
· 程序版本和图纸一样走评审单两级审核，通过后发布（= 冻结）
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# 程序状态（与图纸同构）：草稿 → 审核中 → 已发布
PROGRAM_STATUS = ("草稿", "审核中", "已发布", "已作废")


class EquipmentProgram(Base, TimestampMixin):
    """PLC 程序（一台设备可有多套：主控 / HMI / 机器人 …）。"""

    __tablename__ = "equipment_program"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(128))  # 如：PLC 主控程序 / HMI 画面
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    current_version: Mapped[str] = mapped_column(String(8), default="V1", server_default="V1")
    status: Mapped[str] = mapped_column(String(16), default="草稿", server_default="草稿")
    remark: Mapped[str | None] = mapped_column(Text)


class EquipmentProgramVersion(Base, TimestampMixin):
    """程序版本：V1 → V2 …；发布后只读留档（与 drawing_version 同构）。"""

    __tablename__ = "equipment_program_version"

    id: Mapped[int] = mapped_column(primary_key=True)
    program_id: Mapped[int] = mapped_column(ForeignKey("equipment_program.id", ondelete="CASCADE"))
    version: Mapped[str] = mapped_column(String(8))
    file_path: Mapped[str | None] = mapped_column(String(512))
    filename: Mapped[str | None] = mapped_column(String(255))
    change_reason: Mapped[str | None] = mapped_column(Text)
    submitted_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(Text)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
