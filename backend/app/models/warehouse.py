"""仓库域（依据《00 方案》§3 S4 仓库三件事）。

    ① 来料检验验收：按到货清单勾选 + 拍照（直发现场的由现场验收）
    ② 入库：拍标签 / 选库位 → 库存增加 + 出入库流水
    ③ 领料：车间排产 → 自动生成领料单 → 仓库备料 → 车间领走

库存只认「型号级」：同一个物料放在哪个库位、有多少、被谁占用。
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# 出入库类型
MOVE_IN = "入库"
MOVE_OUT = "出库"
MOVE_TRANSFER = "移库"
MOVE_CHECK = "盘点"
MOVE_TYPES = (MOVE_IN, MOVE_OUT, MOVE_TRANSFER, MOVE_CHECK)

# 领料单状态
ISSUE_DRAFT = "待备料"
ISSUE_PICKED = "已备料"
ISSUE_DONE = "已领走"
ISSUE_STATUS = (ISSUE_DRAFT, ISSUE_PICKED, ISSUE_DONE, "已取消")


class WarehouseLocation(Base, TimestampMixin):
    """库位：深圳仓 / 惠州仓，库位码如 A-03-12。"""

    __tablename__ = "warehouse_location"

    id: Mapped[int] = mapped_column(primary_key=True)
    warehouse: Mapped[str] = mapped_column(String(32))  # 深圳仓 / 惠州仓
    code: Mapped[str] = mapped_column(String(32))  # A-03-12
    name: Mapped[str | None] = mapped_column(String(64))
    remark: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    __table_args__ = (UniqueConstraint("warehouse", "code", name="uq_location_warehouse_code"),)


class StockItem(Base, TimestampMixin):
    """库存：一个物料在一个库位上有多少、多少被占用。"""

    __tablename__ = "stock_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_no: Mapped[str] = mapped_column(ForeignKey("item.item_no", ondelete="CASCADE"))
    location_id: Mapped[int] = mapped_column(ForeignKey("warehouse_location.id"))
    qty_on_hand: Mapped[float] = mapped_column(Numeric(14, 3), default=0, server_default="0")
    qty_locked: Mapped[float] = mapped_column(Numeric(14, 3), default=0, server_default="0")  # 已备料占用
    batch_no: Mapped[str | None] = mapped_column(String(64))

    __table_args__ = (UniqueConstraint("item_no", "location_id", name="uq_stock_item_location"),)


class StockMove(Base, TimestampMixin):
    """出入库流水（每一次库存变动都留痕，可追溯）。"""

    __tablename__ = "stock_move"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_no: Mapped[str] = mapped_column(ForeignKey("item.item_no", ondelete="CASCADE"))
    move_type: Mapped[str] = mapped_column(String(8))
    qty: Mapped[float] = mapped_column(Numeric(14, 3))
    from_location_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse_location.id"))
    to_location_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse_location.id"))
    project_no: Mapped[str | None] = mapped_column(ForeignKey("project.project_no"))
    equip_no: Mapped[str | None] = mapped_column(String(16))
    ref_type: Mapped[str | None] = mapped_column(String(24))  # goods_receipt / material_issue / manual
    ref_no: Mapped[str | None] = mapped_column(String(32))
    operator_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    moved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    remark: Mapped[str | None] = mapped_column(String(255))


class MaterialIssue(Base, TimestampMixin):
    """领料单：车间要做的活，先来仓库领料。

    状态：待备料 → 已备料 → 已领走
    """

    __tablename__ = "material_issue"

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_no: Mapped[str] = mapped_column(String(32))
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str | None] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default=ISSUE_DRAFT, server_default=ISSUE_DRAFT)
    requested_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    picked_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    picked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    issued_to: Mapped[str | None] = mapped_column(String(64))  # 领料人（车间）
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    remark: Mapped[str | None] = mapped_column(Text)


class MaterialIssueLine(Base, TimestampMixin):
    """领料单行：要领哪个物料、多少、从哪个库位出、够不够。"""

    __tablename__ = "material_issue_line"

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("material_issue.id", ondelete="CASCADE"))
    item_no: Mapped[str] = mapped_column(ForeignKey("item.item_no"))
    qty_required: Mapped[float] = mapped_column(Numeric(14, 3))
    qty_issued: Mapped[float] = mapped_column(Numeric(14, 3), default=0, server_default="0")
    location_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse_location.id"))
    shortage: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    for_part: Mapped[str | None] = mapped_column(String(48))  # 给哪个零件用（图号）
    remark: Mapped[str | None] = mapped_column(String(255))
