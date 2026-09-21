"""评审单 / 两级审核 / 发布冻结（05 卷 §3、§4、§8.1）。

★ 审核单 = 任务级单据：**一个任务一张单**，反复使用。
  同一张单上可以多轮提交（第 1/2/3…次），每一次提交、每一次审核**全部留档**。
  审核链：组员 → 本部门经理（一级）→ 总监（二级）；
  经理本人提交跳过一级（总监直审）；总监不能自审（05 卷 §0.1#13）。

发布 = 冻结：二级通过的那一轮，这一轮勾选的内容整体冻结，写一条 `design_release`。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# ---- 可提交的内容类型 ----
ITEM_DRAWING = "DRAWING"  # 图纸（机械/电气）
ITEM_BOM_DESIGN = "BOM_DESIGN"  # 设计 BOM 行（标准件/定制件）
ITEM_BOM_MATERIAL = "BOM_MATERIAL"  # 材料 BOM 行（原材料）
ITEM_SOURCE_TAG = "SOURCE_TAG"  # 自制/外协判定（工艺）
ITEM_PROGRAM = "PROGRAM"  # PLC 程序版本（P4）
REVIEW_ITEM_TYPES = (
    ITEM_DRAWING,
    ITEM_BOM_DESIGN,
    ITEM_BOM_MATERIAL,
    ITEM_SOURCE_TAG,
    ITEM_PROGRAM,
)
REVIEW_ITEM_LABELS = {
    ITEM_DRAWING: "图纸",
    ITEM_BOM_DESIGN: "设计 BOM 行",
    ITEM_BOM_MATERIAL: "材料 BOM 行",
    ITEM_SOURCE_TAG: "自制/外协判定",
    ITEM_PROGRAM: "程序版本",
}

# ---- 评审单状态 ----
TICKET_PENDING_LEAD = "待经理审"
TICKET_PENDING_DIRECTOR = "待总监审"
TICKET_REJECTED = "已退回"
TICKET_WITHDRAWN = "已撤回"
TICKET_APPROVED = "已发布"
TICKET_STATUS = (
    TICKET_PENDING_LEAD,
    TICKET_PENDING_DIRECTOR,
    TICKET_REJECTED,
    TICKET_WITHDRAWN,
    TICKET_APPROVED,
)
TICKET_PENDING = (TICKET_PENDING_LEAD, TICKET_PENDING_DIRECTOR)

# ---- 审核动作 ----
ACTION_PASS = "通过"
ACTION_REJECT = "退回"
ACTION_SKIP = "跳过"  # 经理自提 / 经理空缺：系统自动留痕
ACTION_WITHDRAW = "撤回"
REVIEW_ACTIONS = (ACTION_PASS, ACTION_REJECT, ACTION_SKIP, ACTION_WITHDRAW)


class ReviewTicket(Base, TimestampMixin):
    """评审单（一个任务一张，反复使用）。"""

    __tablename__ = "review_ticket"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_no: Mapped[str] = mapped_column(String(24), unique=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("task.id", ondelete="CASCADE"))
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str | None] = mapped_column(String(16))
    profession: Mapped[str | None] = mapped_column(String(16))
    submitter_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    status: Mapped[str] = mapped_column(String(16), default=TICKET_APPROVED, server_default=TICKET_APPROVED)
    current_round: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    __table_args__ = (UniqueConstraint("task_id", name="uq_review_ticket_task"),)


class ReviewTicketItem(Base):
    """提交明细：哪一轮勾了哪些内容（snapshot = 提交那一刻的内容，不会被后续修改污染）。"""

    __tablename__ = "review_ticket_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("review_ticket.id", ondelete="CASCADE"))
    round_no: Mapped[int] = mapped_column(Integer)
    item_type: Mapped[str] = mapped_column(String(16))
    item_ref: Mapped[str] = mapped_column(String(64))  # 图号 / bom_item.id / 程序版本 id
    version: Mapped[str | None] = mapped_column(String(16))
    snapshot: Mapped[dict | None] = mapped_column(JSONB)
    submitted_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ReviewAction(Base):
    """审核记录（全部留档：每轮、每级各一条）。"""

    __tablename__ = "review_action"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("review_ticket.id", ondelete="CASCADE"))
    round_no: Mapped[int] = mapped_column(Integer)
    level: Mapped[int] = mapped_column(Integer, default=1, server_default="1")  # 1=经理 / 2=总监 / 0=撤回
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    action: Mapped[str] = mapped_column(String(8))
    note: Mapped[str | None] = mapped_column(Text)
    acted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DesignRelease(Base, TimestampMixin):
    """发布（= 冻结）批次；采购需求引用它（05 卷 §5、§8.1）。"""

    __tablename__ = "design_release"

    id: Mapped[int] = mapped_column(primary_key=True)
    release_no: Mapped[str] = mapped_column(String(24), unique=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("review_ticket.id", ondelete="CASCADE"))
    round_no: Mapped[int] = mapped_column(Integer)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str | None] = mapped_column(String(16))
    profession: Mapped[str | None] = mapped_column(String(16))
    released_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    summary: Mapped[dict | None] = mapped_column(JSONB)
