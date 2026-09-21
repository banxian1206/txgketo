"""S7 发运域：shipment / shipment_line / packing_list / site_receipt（02 卷 §8）

Revision ID: i3e5a7c92d48
Revises: h2c4e6a81d35
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "i3e5a7c92d48"
down_revision: str | None = "h2c4e6a81d35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shipment",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("shipment_no", sa.String(32), nullable=False, unique=True),
        sa.Column("project_no", sa.String(16), sa.ForeignKey("project.project_no", ondelete="CASCADE"), nullable=False),
        sa.Column("instruct_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("instruct_at", sa.DateTime(timezone=True)),
        sa.Column("plan_ship_date", sa.Date()),
        sa.Column("status", sa.String(16), server_default="已指令", nullable=False),
        sa.Column("vehicle", sa.String(64)),
        sa.Column("driver", sa.String(64)),
        sa.Column("plate_no", sa.String(32)),
        sa.Column("depart_at", sa.DateTime(timezone=True)),
        sa.Column("arrive_at", sa.DateTime(timezone=True)),
        sa.Column("signed_at", sa.DateTime(timezone=True)),
        sa.Column("photos", postgresql.JSONB()),
        sa.Column("remark", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_shipment_project", "shipment", ["project_no"])

    op.create_table(
        "shipment_line",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("shipment_id", sa.Integer(), sa.ForeignKey("shipment.id", ondelete="CASCADE"), nullable=False),
        sa.Column("equip_no", sa.String(16), nullable=False),
        sa.Column("equip_name", sa.String(64)),
        sa.Column("qty", sa.Numeric(12, 2), server_default="1", nullable=False),
        sa.Column("remark", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_shipment_line_ship", "shipment_line", ["shipment_id"])

    op.create_table(
        "packing_list",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("shipment_id", sa.Integer(), sa.ForeignKey("shipment.id", ondelete="CASCADE"), nullable=False),
        sa.Column("equip_no", sa.String(16)),
        sa.Column("part_item_no", sa.String(48), nullable=False),
        sa.Column("part_name", sa.String(128)),
        sa.Column("qty", sa.Numeric(12, 2), server_default="1", nullable=False),
        sa.Column("package_no", sa.String(32)),
        sa.Column("weight", sa.Numeric(12, 2)),
        sa.Column("size", sa.String(48)),
        sa.Column("disassembled", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("photos", postgresql.JSONB()),
        sa.Column("remark", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_packing_ship", "packing_list", ["shipment_id"])

    op.create_table(
        "site_receipt",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("shipment_id", sa.Integer(), sa.ForeignKey("shipment.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_no", sa.String(16), sa.ForeignKey("project.project_no", ondelete="CASCADE"), nullable=False),
        sa.Column("received_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("received_at", sa.DateTime(timezone=True)),
        sa.Column("result", sa.String(16), nullable=False),
        sa.Column("shortage_detail", postgresql.JSONB()),
        sa.Column("photos", postgresql.JSONB()),
        sa.Column("remark", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_site_receipt_ship", "site_receipt", ["shipment_id"])

    op.execute(
        sa.text(
            "INSERT INTO number_rule (object_type, name, template, scope, start_value, step, remark,"
            " created_at, updated_at)"
            " SELECT 'SHIPMENT', '发货指令（发运批次）', 'FH{YY}{seq:03}', 'global_year', 1, 1,"
            " '项目经理勾选本次要发的设备', now(), now()"
            " WHERE NOT EXISTS (SELECT 1 FROM number_rule WHERE object_type = 'SHIPMENT')"
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM number_rule WHERE object_type = 'SHIPMENT'"))
    op.drop_table("site_receipt")
    op.drop_table("packing_list")
    op.drop_table("shipment_line")
    op.drop_table("shipment")
