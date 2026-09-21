"""S6 装配与齐套域：kitting_snapshot / assembly_record（02 卷 §7）

Revision ID: h2c4e6a81d35
Revises: g1b3d5f70c29
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "h2c4e6a81d35"
down_revision: str | None = "g1b3d5f70c29"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "kitting_snapshot",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_no", sa.String(16), sa.ForeignKey("project.project_no", ondelete="CASCADE"), nullable=False),
        sa.Column("equip_no", sa.String(16), nullable=False),
        sa.Column("snapshot_at", sa.DateTime(timezone=True)),
        sa.Column("total_qty", sa.Numeric(14, 3), server_default="0", nullable=False),
        sa.Column("arrived_qty", sa.Numeric(14, 3), server_default="0", nullable=False),
        sa.Column("kitting_rate", sa.Numeric(6, 4), server_default="0", nullable=False),
        sa.Column("detail", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_kitting_project_equip", "kitting_snapshot", ["project_no", "equip_no"])

    op.create_table(
        "assembly_record",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_no", sa.String(16), sa.ForeignKey("project.project_no", ondelete="CASCADE"), nullable=False),
        sa.Column("equip_no", sa.String(16), nullable=False),
        sa.Column("sub_assembly", sa.String(32), server_default="整机装配", nullable=False),
        sa.Column("kitting_rate", sa.Numeric(6, 4), server_default="0", nullable=False),
        sa.Column("total_qty", sa.Numeric(14, 3), server_default="0", nullable=False),
        sa.Column("arrived_qty", sa.Numeric(14, 3), server_default="0", nullable=False),
        sa.Column("status", sa.String(16), server_default="装配中", nullable=False),
        sa.Column("assembled_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("assembled_at", sa.DateTime(timezone=True)),
        sa.Column("photos", postgresql.JSONB()),
        sa.Column("debug_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("debug_at", sa.DateTime(timezone=True)),
        sa.Column("debug_result", sa.String(16)),
        sa.Column("debug_note", sa.Text()),
        sa.Column("debug_photos", postgresql.JSONB()),
        sa.Column("remark", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_assembly_project_equip", "assembly_record", ["project_no", "equip_no"])


def downgrade() -> None:
    op.drop_table("assembly_record")
    op.drop_table("kitting_snapshot")
