"""P4 PLC 程序：equipment_program + equipment_program_version（05 卷 §8.1）

Revision ID: e5f7a9b13c28
Revises: d4e6b8c02f17
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5f7a9b13c28"
down_revision: str | None = "d4e6b8c02f17"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "equipment_program",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_no",
            sa.String(length=16),
            sa.ForeignKey("project.project_no", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("equip_no", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("current_version", sa.String(length=8), nullable=False, server_default="V1"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="草稿"),
        sa.Column("remark", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    op.create_table(
        "equipment_program_version",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "program_id",
            sa.Integer(),
            sa.ForeignKey("equipment_program.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.String(length=8), nullable=False),
        sa.Column("file_path", sa.String(length=512)),
        sa.Column("filename", sa.String(length=255)),
        sa.Column("change_reason", sa.Text()),
        sa.Column("submitted_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("reviewed_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("published_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("review_note", sa.Text()),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("equipment_program_version")
    op.drop_table("equipment_program")
