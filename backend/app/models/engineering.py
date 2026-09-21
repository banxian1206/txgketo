"""工程设计域：图纸、版本、BOM（依据《01 编码规则》与《02 数据模型》§3）。

★ 核心机制：**图号自带 BOM 结构**
    TX26003-01A-02-01-00-00  二级组件
        └─ 父级自动推导 → TX26003-01A-02-00-00-00  一级组件
             └─ 父级自动推导 → TX26003-01A-00-00-00-00  设备总装

所以「设计 BOM 的骨架 = 图纸树」，父子关系不用另存；
只有**标准件**（没有图号）才需要 bom_item 行挂到父级下。

两个 BOM 来源（00 卷 §3.2）：
    设计 BOM（设计部）—— 零件：自制件 / 外协件 / 定制件 / 标准件
    材料 BOM（工艺部）—— 原材料：型材 / 板材 / 棒料…
    两者合起来才是设备的【完整 BOM】
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# 图纸类型
DRAWING_KINDS = ("机械", "电气")

# 图纸状态（流程：草稿 → 审核中 → 已发布；改版则回到草稿并发新版本）
DRAWING_STATUS = ("草稿", "审核中", "已发布", "已作废")

# BOM 来源（两个工作节点）
BOM_DESIGN = "DESIGN"  # 设计 BOM（设计部提交）
BOM_MATERIAL = "MATERIAL"  # 材料 BOM（工艺部生成）


class Drawing(Base, TimestampMixin):
    """图纸。图号 = 自制件/外协件/定制件的物料号（01 卷「图号即物料号」）。"""

    __tablename__ = "drawing"

    drawing_no: Mapped[str] = mapped_column(String(48), primary_key=True)
    scheme: Mapped[str] = mapped_column(String(24), default="MECH_LEVEL", server_default="MECH_LEVEL")
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str] = mapped_column(String(16))

    # 4 组层次码（两位一组，从 01 起，未用补 00）
    l1: Mapped[str] = mapped_column(String(2), default="00", server_default="00")
    l2: Mapped[str] = mapped_column(String(2), default="00", server_default="00")
    l3: Mapped[str] = mapped_column(String(2), default="00", server_default="00")
    l4: Mapped[str] = mapped_column(String(2), default="00", server_default="00")

    parent_drawing_no: Mapped[str | None] = mapped_column(String(48))
    title: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(8), default="机械", server_default="机械")
    qty: Mapped[float] = mapped_column(Numeric(12, 2), default=1, server_default="1")
    unit: Mapped[str] = mapped_column(String(16), default="件", server_default="件")
    source_type: Mapped[str] = mapped_column(String(16), default="自制件", server_default="自制件")

    current_version: Mapped[str] = mapped_column(String(8), default="V1", server_default="V1")
    status: Mapped[str] = mapped_column(String(16), default="草稿", server_default="草稿")
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    is_part: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    remark: Mapped[str | None] = mapped_column(Text)


class DrawingVersion(Base, TimestampMixin):
    """图纸版本：V1 → V2 …；改版必须走审核发布，历史版本只读留档。"""

    __tablename__ = "drawing_version"

    id: Mapped[int] = mapped_column(primary_key=True)
    drawing_no: Mapped[str] = mapped_column(ForeignKey("drawing.drawing_no", ondelete="CASCADE"))
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
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


# BOM 行状态（05 卷 §8.2）：草稿 → 提交后审核中 → 发布后已冻结
BOM_ROW_DRAFT = "草稿"
BOM_ROW_REVIEWING = "审核中"
BOM_ROW_FROZEN = "已冻结"
BOM_ROW_STATUS = (BOM_ROW_DRAFT, BOM_ROW_REVIEWING, BOM_ROW_FROZEN)


class BomItem(Base, TimestampMixin):
    """BOM 行：只用于**没有图号**的项（标准件 / 原材料）。

    自制件、外协件、定制件有图号，父子关系由图号层次码推导，不用这张表。
    """

    __tablename__ = "bom_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    parent_ref: Mapped[str] = mapped_column(String(48))  # 父级图号（或设备号）
    child_item_no: Mapped[str] = mapped_column(ForeignKey("item.item_no"))
    bom_source: Mapped[str] = mapped_column(String(16), default=BOM_DESIGN, server_default=BOM_DESIGN)
    qty: Mapped[float] = mapped_column(Numeric(12, 3), default=1, server_default="1")
    unit: Mapped[str | None] = mapped_column(String(16))
    pos_no: Mapped[str | None] = mapped_column(String(32))
    remark: Mapped[str | None] = mapped_column(String(255))
    # ---- 冻结线（05 卷 §4、§8.2）----
    status: Mapped[str] = mapped_column(String(8), default=BOM_ROW_DRAFT, server_default=BOM_ROW_DRAFT)
    # 被哪次发布冻结（指向 design_release.id）
    frozen_release_id: Mapped[int | None] = mapped_column(ForeignKey("design_release.id"))
    # 谁挂的（提交归属；老数据可能为空）
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    # 改版流程用：被哪条新行替代（P6）
    superseded_by_id: Mapped[int | None] = mapped_column(ForeignKey("bom_item.id"))


# ---------------------------------------------------------------------------
# 设备 BOM 完整度
# ---------------------------------------------------------------------------

BOM_STATE_EMPTY = "未开始"
BOM_STATE_DESIGNING = "设计中"
BOM_STATE_DESIGN_DONE = "设计BOM已提交"
BOM_STATE_COMPLETE = "BOM完整"


class EquipmentBom(Base):  # 用 equipment 表来存状态，这里只放常量
    __abstract__ = True


BOM_STATES = (BOM_STATE_EMPTY, BOM_STATE_DESIGNING, BOM_STATE_DESIGN_DONE, BOM_STATE_COMPLETE)

__all__ = [
    "BOM_DESIGN",
    "BOM_MATERIAL",
    "BOM_STATES",
    "BOM_STATE_COMPLETE",
    "BOM_STATE_DESIGNING",
    "BOM_STATE_DESIGN_DONE",
    "BOM_STATE_EMPTY",
    "BOM_ROW_DRAFT",
    "BOM_ROW_FROZEN",
    "BOM_ROW_REVIEWING",
    "BOM_ROW_STATUS",
    "BomItem",
    "DRAWING_KINDS",
    "DRAWING_STATUS",
    "Drawing",
    "DrawingVersion",
    "date",
]
