"""S11 售后域：service_order / spare_part / spare_part_move（02 卷 §10）

Revision ID: l6b8d0f25a71
Revises: k5a7c9e14f60
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "l6b8d0f25a71"
down_revision: str | None = "k5a7c9e14f60"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "service_order",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("so_no", sa.String(32), nullable=False, unique=True),
        sa.Column("project_no", sa.String(16), sa.ForeignKey("project.project_no", ondelete="CASCADE"), nullable=False),
        sa.Column("equip_no", sa.String(16)),
        sa.Column("reported_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("reported_at", sa.DateTime(timezone=True)),
        sa.Column("fault", sa.Text()),
        sa.Column("status", sa.String(16), server_default="待受理", nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True)),
        sa.Column("dispatched_to", sa.String(64)),
        sa.Column("arrived_at", sa.DateTime(timezone=True)),
        sa.Column("solution", sa.Text()),
        sa.Column("labor_hours", sa.Numeric(6, 1)),
        sa.Column("fixed_at", sa.DateTime(timezone=True)),
        sa.Column("photos", postgresql.JSONB()),
        sa.Column("customer_sign", sa.String(64)),
        sa.Column("signed_at", sa.DateTime(timezone=True)),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("in_warranty", sa.Boolean()),
        sa.Column("remark", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_service_order_project", "service_order", ["project_no"])

    op.create_table(
        "spare_part",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_no", sa.String(16), sa.ForeignKey("project.project_no", ondelete="CASCADE")),
        sa.Column("equip_no", sa.String(16)),
        sa.Column("item_no", sa.String(48), nullable=False),
        sa.Column("item_name", sa.String(128)),
        sa.Column("qty_stock", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("qty_installed", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("min_qty", sa.Numeric(12, 2)),
        sa.Column("remark", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_spare_part_project", "spare_part", ["project_no"])

    op.create_table(
        "spare_part_move",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("part_id", sa.Integer(), sa.ForeignKey("spare_part.id", ondelete="CASCADE"), nullable=False),
        sa.Column("move_type", sa.String(16), nullable=False),
        sa.Column("qty", sa.Numeric(12, 2), nullable=False),
        sa.Column("service_order_id", sa.Integer(), sa.ForeignKey("service_order.id", ondelete="SET NULL")),
        sa.Column("issued_to", sa.String(64)),
        sa.Column("operator_id", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("moved_at", sa.DateTime(timezone=True)),
        sa.Column("remark", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_spare_part_move_part", "spare_part_move", ["part_id"])


def downgrade() -> None:
    op.drop_table("spare_part_move")
    op.drop_table("spare_part")
    op.drop_table("service_order")
