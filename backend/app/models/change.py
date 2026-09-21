"""改版申请（ECN）（05 卷 §7、§8.1）。

★ 冻结后要动，必须先提改版申请并**挂到具体冻结版本**：
    图号 + 版本 / 程序版本 / BOM 行（frozen_release）
  总监裁决：
    批准 → 下发改版任务（指派设计师）→ 改完重走两级审核 → 新版本发布、旧版留档
    否决 → 必须填替代方案，不能空关
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# 改版对象
TARGET_DRAWING = "DRAWING"
TARGET_PROGRAM = "PROGRAM"
TARGET_BOM_ITEM = "BOM_ITEM"
TARGET_TYPES = (TARGET_DRAWING, TARGET_PROGRAM, TARGET_BOM_ITEM)
TARGET_LABELS = {TARGET_DRAWING: "图纸", TARGET_PROGRAM: "程序版本", TARGET_BOM_ITEM: "BOM 行"}

# 状态机
CR_PENDING = "待裁决"
CR_APPROVED = "已批准"
CR_REJECTED = "已否决"
CR_DISPATCHED = "已下发"
CR_DONE = "已完成"
CR_ARCHIVED = "已归档"
CR_STATUS = (CR_PENDING, CR_APPROVED, CR_REJECTED, CR_DISPATCHED, CR_DONE, CR_ARCHIVED)
# 还在进行中的（可以再改版的目标）
CR_ACTIVE = (CR_PENDING, CR_APPROVED, CR_DISPATCHED)


class ChangeRequest(Base, TimestampMixin):
    """改版申请：冻结版本变更的唯一入口。"""

    __tablename__ = "change_request"

    id: Mapped[int] = mapped_column(primary_key=True)
    cr_no: Mapped[str] = mapped_column(String(24), unique=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str | None] = mapped_column(String(16))
    target_type: Mapped[str] = mapped_column(String(16))
    # 图号 / program_id / bom_item.id
    target_ref: Mapped[str] = mapped_column(String(64))
    # 具体冻结版本：图纸/程序的 V1、BOM 行的 frozen release_no
    target_version: Mapped[str | None] = mapped_column(String(24))
    part_no: Mapped[str | None] = mapped_column(String(48))
    reason: Mapped[str] = mapped_column(Text)  # 问题是什么
    proposal: Mapped[str | None] = mapped_column(Text)  # 建议怎么改
    applicant_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    status: Mapped[str] = mapped_column(String(16), default=CR_PENDING, server_default=CR_PENDING)
    # 裁决
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)
    solution: Mapped[str | None] = mapped_column(Text)  # 否决时的替代方案（必填）
    # 批准后下发的改版任务 / 改完发布到哪一版
    change_task_id: Mapped[int | None] = mapped_column(ForeignKey("task.id"))
    new_release_id: Mapped[int | None] = mapped_column(ForeignKey("design_release.id"))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
