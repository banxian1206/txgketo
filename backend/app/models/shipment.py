"""发运域（《00 方案》§3.1⑤ · 《02 数据模型》§8）。

★ 发货指令：项目经理勾选**本次要发的设备** → 打包（拆不拆解看车的大小，由打包师傅定，
**不拆成两个流程**）→ 装车（拍照）→ 分批发往现场 → 现场到货验收（防"对不齐"）。
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# 发货指令 / 发运状态（02 卷 §8）
# ★ 命名约定（D4）：SHIP_SHIPPING「发货中」的真实语义是**清单确认中** ——
#   sync_items 生成发运清单时会把批次从「已指令」自动推到这一档（哪怕一项都还没勾），
#   所以它不代表“车在路上”。S7 真实顺序：勾「已发」→ 装车 → 发运（在途）→ 到货 → 清点签收。
#   不改存储值（改名要动存量数据/状态色表/断言，风险大于收益），靠本注释 + 发运页副标题消歧。
SHIP_INSTRUCTED = "已指令"
SHIP_SHIPPING = "发货中"
SHIP_LOADED = "已装车"
SHIP_TRANSIT = "在途"
SHIP_ARRIVED = "已到货"
SHIP_SIGNED = "已签收"
SHIP_STATUS = (SHIP_INSTRUCTED, SHIP_SHIPPING, SHIP_LOADED, SHIP_TRANSIT, SHIP_ARRIVED, SHIP_SIGNED)

# 现场到货验收结论
RECEIPT_OK = "齐"
RECEIPT_SHORT = "缺件"
RECEIPT_DAMAGED = "破损"
RECEIPT_RESULTS = (RECEIPT_OK, RECEIPT_SHORT, RECEIPT_DAMAGED)


class Shipment(Base, TimestampMixin):
    """发货指令：一次发运（一批设备）。"""

    __tablename__ = "shipment"

    id: Mapped[int] = mapped_column(primary_key=True)
    shipment_no: Mapped[str] = mapped_column(String(32), unique=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    instruct_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))  # 项目经理
    instruct_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    plan_ship_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default=SHIP_INSTRUCTED, server_default=SHIP_INSTRUCTED)
    vehicle: Mapped[str | None] = mapped_column(String(64))
    driver: Mapped[str | None] = mapped_column(String(64))
    plate_no: Mapped[str | None] = mapped_column(String(32))
    depart_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    arrive_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    photos: Mapped[list | None] = mapped_column(JSONB)  # 装车 / 发运照片
    remark: Mapped[str | None] = mapped_column(Text)


class ShipmentLine(Base, TimestampMixin):
    """本次发哪几台设备（PM 勾选的）。"""

    __tablename__ = "shipment_line"

    id: Mapped[int] = mapped_column(primary_key=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipment.id", ondelete="CASCADE"))
    equip_no: Mapped[str] = mapped_column(String(16))
    equip_name: Mapped[str | None] = mapped_column(String(64))
    qty: Mapped[float] = mapped_column(Numeric(12, 2), default=1, server_default="1")
    remark: Mapped[str | None] = mapped_column(String(255))


class ShipmentItem(Base, TimestampMixin):
    """发运清单行：按设备结构生成（组件/零件/标准件/原材料），散件发运、逐项勾选。

    ★ 没有装箱动作：散件发过去，逐项标「发了没发」+ 拍照；最后拍一张照片记录摆放位置。
      勾大组件 = 整棵子树都发了。结构外的东西（说明书/备件/工具）手动补充（source=补充）。
    """

    __tablename__ = "shipment_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipment.id", ondelete="CASCADE"))
    equip_no: Mapped[str] = mapped_column(String(16))
    # 树结构
    ref: Mapped[str] = mapped_column(String(48))  # 图号 / 物料号
    parent_ref: Mapped[str | None] = mapped_column(String(48))  # 父级图号（组件树）
    name: Mapped[str | None] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(16), default="零件", server_default="零件")
    # 组件 / 零件 / 标准件 / 原材料 / 补充
    qty: Mapped[float] = mapped_column(Numeric(12, 2), default=1, server_default="1")
    unit: Mapped[str | None] = mapped_column(String(16))
    source: Mapped[str] = mapped_column(String(16), default="结构", server_default="结构")
    # 发运勾选
    shipped: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    shipped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    shipped_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    photos: Mapped[list | None] = mapped_column(JSONB)  # 发这个件的拍照
    place_photos: Mapped[list | None] = mapped_column(JSONB)  # 摆放位置照片（可后补）
    # 现场清点结果
    check_result: Mapped[str | None] = mapped_column(String(8))  # 到 / 缺 / 损
    check_qty: Mapped[float | None] = mapped_column(Numeric(12, 2))  # 实到数量
    check_note: Mapped[str | None] = mapped_column(String(255))  # 缺/损原因
    check_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    remark: Mapped[str | None] = mapped_column(String(255))


class SiteReceipt(Base, TimestampMixin):
    """现场到货验收（★ 防止"对不齐"）：与发货指令 / 装箱清单对账。"""

    __tablename__ = "site_receipt"

    id: Mapped[int] = mapped_column(primary_key=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipment.id", ondelete="CASCADE"))
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    received_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result: Mapped[str] = mapped_column(String(16))  # 齐 / 缺件 / 破损
    shortage_detail: Mapped[list | None] = mapped_column(JSONB)  # [{equip_no, item, qty, reason}]
    photos: Mapped[list | None] = mapped_column(JSONB)
    remark: Mapped[str | None] = mapped_column(Text)
