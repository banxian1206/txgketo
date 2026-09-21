"""任务（立项后的并行分发，依据《00 方案》§3.2 任务体系）。

立项 = 项目的【大任务】，往下细分：
  ① 设备 × 专业（机械/电气/程序/工艺）→ 设计任务 → 分给项目团队里对应专业的负责人
     机械 / 电气 / 程序 三专业并行；工艺挂在机械之后（05 卷 §0）
  ② 长周期件 → 采购任务 → 分给项目的采购负责人
  ③ 后续：制造 / 装配 / 调试 / 现场任务（随对应模块生成）

★ 任务是指派到**人**的，不是挂在项目上就算完 —— 每个人在「我的任务」里看到自己要干什么。
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin
from app.models.platform import PROFESSIONS  # 专业口径统一在 platform（05 卷 §2.1）

TASK_TYPES = ("设计", "采购", "制造", "装配", "调试", "现场")

__all__ = ["PROFESSIONS", "ROLE_BY_TASK", "TASK_STATUS", "TASK_TYPES", "Task"]

# 任务类型 → 项目团队里对应的负责人角色
ROLE_BY_TASK: dict[tuple[str, str], str] = {
    ("设计", "机械"): "机械负责人",
    ("设计", "电气"): "电气负责人",
    ("设计", "程序"): "程序负责人",
    ("设计", "工艺"): "工艺负责人",
    ("采购", "采购"): "采购负责人",
}

TASK_STATUS = ("待开始", "进行中", "已完成", "已取消")


class Task(Base, TimestampMixin):
    """任务：指派到人的一件事。"""

    __tablename__ = "task"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_no: Mapped[str] = mapped_column(String(24))
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str | None] = mapped_column(String(16))

    task_type: Mapped[str] = mapped_column(String(16))  # 设计 / 采购 / 制造 / 装配 / 调试 / 现场
    profession: Mapped[str | None] = mapped_column(String(16))  # 机械 / 电气 / 程序 / 工艺 / 采购
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str | None] = mapped_column(Text)

    owner_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    plan_start: Mapped[date | None] = mapped_column(Date)
    plan_end: Mapped[date | None] = mapped_column(Date)

    status: Mapped[str] = mapped_column(String(16), default="待开始", server_default="待开始")
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # 关联对象（设备 / 采购需求 / 零件…），方便一键跳过去干活
    ref_type: Mapped[str | None] = mapped_column(String(24))
    ref_id: Mapped[int | None] = mapped_column(Integer)
    ref_no: Mapped[str | None] = mapped_column(String(64))

    remark: Mapped[str | None] = mapped_column(Text)
