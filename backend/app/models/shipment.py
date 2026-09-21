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
SHIP_INSTRUCTED = "已指令"
SHIP_PACKING = "打包中"
SHIP_LOADED = "已装车"
SHIP_TRANSIT = "在途"
SHIP_ARRIVED = "已到货"
SHIP_SIGNED = "已签收"
SHIP_STATUS = (SHIP_INSTRUCTED, SHIP_PACKING, SHIP_LOADED, SHIP_TRANSIT, SHIP_ARRIVED, SHIP_SIGNED)

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


class PackingItem(Base, TimestampMixin):
    """装箱清单：打包含拆解，不拆成两个流程。"""

    __tablename__ = "packing_list"

    id: Mapped[int] = mapped_column(primary_key=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipment.id", ondelete="CASCADE"))
    equip_no: Mapped[str | None] = mapped_column(String(16))
    part_item_no: Mapped[str] = mapped_column(String(48))  # 零件/物料号
    part_name: Mapped[str | None] = mapped_column(String(128))
    qty: Mapped[float] = mapped_column(Numeric(12, 2), default=1, server_default="1")
    package_no: Mapped[str | None] = mapped_column(String(32))  # 箱号
    weight: Mapped[float | None] = mapped_column(Numeric(12, 2))  # kg
    size: Mapped[str | None] = mapped_column(String(48))  # 长×宽×高 mm
    disassembled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    photos: Mapped[list | None] = mapped_column(JSONB)
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
