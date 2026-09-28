"""09 卷 §2.2：发货指令跨部门 —— 加「叫车」环节（采购做的事）。

背景（客户口径 2026-09-28）：
  “PM 发出指令需要**叫车服务**，**采购**就去采购车辆回来，**发运**就开始装车并进行交付。
   这相当于是一条指令，但是**指挥了两个部门**的人在干事情。
   同时，这个指令也是需要有**时间**的：PM 根据项目进度/装配进度/客户沟通定一个发货时间（如定在十几号）
   → 采购按这个时间，**当天**把车采购回来 → **装货的人就知道当天需要装几车**。”
  （「计划发货日」`plan_ship_date` 本来就有了，这里只补叫车相关字段。）
  车辆服务**不进价格库**（地方/车型/时间不同价格必不同），只填**本次**价格。

Revision ID: w9c1e3a57b68
Revises: v8b0d2f46a57
Create Date: 2026-09-28

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "w9c1e3a57b68"
down_revision: str | None = "v8b0d2f46a57"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "shipment",
        sa.Column("vehicle_status", sa.String(16), nullable=False, server_default="待叫车"),
    )
    op.add_column("shipment", sa.Column("vehicle_count", sa.Integer(), nullable=True))
    op.add_column("shipment", sa.Column("vehicle_fee", sa.Numeric(14, 2), nullable=True))
    op.add_column("shipment", sa.Column("vehicle_note", sa.String(255), nullable=True))
    op.add_column("shipment", sa.Column("vehicle_by", sa.Integer(), nullable=True))
    op.add_column("shipment", sa.Column("vehicle_at", sa.DateTime(timezone=True), nullable=True))
    # 存量批次：已经装过车的（有 vehicle/driver/plate_no）视为已叫车，避免卡住在老数据上
    op.execute(
        "UPDATE shipment SET vehicle_status = '已叫车' "
        "WHERE vehicle IS NOT NULL OR driver IS NOT NULL OR plate_no IS NOT NULL"
    )
    op.create_foreign_key(
        "fk_shipment_vehicle_by", "shipment", "app_user", ["vehicle_by"], ["id"]
    )


def downgrade() -> None:
    op.drop_constraint("fk_shipment_vehicle_by", "shipment", type_="foreignkey")
    op.drop_column("shipment", "vehicle_at")
    op.drop_column("shipment", "vehicle_by")
    op.drop_column("shipment", "vehicle_note")
    op.drop_column("shipment", "vehicle_fee")
    op.drop_column("shipment", "vehicle_count")
    op.drop_column("shipment", "vehicle_status")
