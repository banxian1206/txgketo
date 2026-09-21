"""P6 改版申请（ECN）：change_request（05 卷 §7/§8.1）

Revision ID: b8d2f4a6913c
Revises: a7c1e3f50b26
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8d2f4a6913c"
down_revision: str | None = "a7c1e3f50b26"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "change_request",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cr_no", sa.String(length=24), nullable=False, unique=True),
        sa.Column(
            "project_no",
            sa.String(length=16),
            sa.ForeignKey("project.project_no", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("equip_no", sa.String(length=16)),
        sa.Column("target_type", sa.String(length=16), nullable=False),
        sa.Column("target_ref", sa.String(length=64), nullable=False),
        sa.Column("target_version", sa.String(length=24)),
        sa.Column("part_no", sa.String(length=48)),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("proposal", sa.Text()),
        sa.Column("applicant_id", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="待裁决"),
        sa.Column("decided_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.Column("decision_note", sa.Text()),
        sa.Column("solution", sa.Text()),
        sa.Column("change_task_id", sa.Integer(), sa.ForeignKey("task.id")),
        sa.Column("new_release_id", sa.Integer(), sa.ForeignKey("design_release.id")),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("change_request")
