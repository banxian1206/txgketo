"""S7 发运重构：散件发运清单 shipment_item 取代 packing_list（不装箱，逐项勾选+拍照）

Revision ID: m8d0f2b47a93
Revises: l6b8d0f25a71
Create Date: 2026-09-22

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "m8d0f2b47a93"
down_revision: str | None = "l6b8d0f25a71"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("packing_list")
    op.create_table(
        "shipment_item",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("shipment_id", sa.Integer(), sa.ForeignKey("shipment.id", ondelete="CASCADE"), nullable=False),
        sa.Column("equip_no", sa.String(16), nullable=False),
        sa.Column("ref", sa.String(48), nullable=False),
        sa.Column("parent_ref", sa.String(48)),
        sa.Column("name", sa.String(128)),
        sa.Column("kind", sa.String(16), server_default="零件", nullable=False),
        sa.Column("source", sa.String(16), server_default="结构", nullable=False),
        sa.Column("qty", sa.Numeric(12, 2), server_default="1", nullable=False),
        sa.Column("unit", sa.String(16)),
        sa.Column("shipped", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("shipped_at", sa.DateTime(timezone=True)),
        sa.Column("shipped_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("photos", postgresql.JSONB()),
        sa.Column("place_photos", postgresql.JSONB()),
        sa.Column("check_result", sa.String(8)),
        sa.Column("check_qty", sa.Numeric(12, 2)),
        sa.Column("check_note", sa.String(255)),
        sa.Column("check_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("check_at", sa.DateTime(timezone=True)),
        sa.Column("remark", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_shipment_item_ship", "shipment_item", ["shipment_id"])


def downgrade() -> None:
    op.drop_table("shipment_item")
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
