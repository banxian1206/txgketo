"""S9/S10 验收域：acceptance / acceptance_document（02 卷 §10）

Revision ID: k5a7c9e14f60
Revises: j4f6b8d03e59
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "k5a7c9e14f60"
down_revision: str | None = "j4f6b8d03e59"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "acceptance",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_no", sa.String(16), sa.ForeignKey("project.project_no", ondelete="CASCADE"), nullable=False),
        sa.Column("applied_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("applied_at", sa.DateTime(timezone=True)),
        sa.Column("accepted_at", sa.DateTime(timezone=True)),
        sa.Column("signed_by", sa.String(64)),
        sa.Column("result", sa.String(16)),
        sa.Column("status", sa.String(16), server_default="待验收", nullable=False),
        sa.Column("warranty_months", sa.Integer()),
        sa.Column("warranty_start", sa.Date()),
        sa.Column("warranty_end", sa.Date()),
        sa.Column("photos", postgresql.JSONB()),
        sa.Column("remark", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_acceptance_project", "acceptance", ["project_no"])

    op.create_table(
        "acceptance_document",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("acceptance_id", sa.Integer(), sa.ForeignKey("acceptance.id", ondelete="CASCADE"), nullable=False),
        sa.Column("doc_type", sa.String(32), server_default="其他", nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("stored_path", sa.String(512), nullable=False),
        sa.Column("is_signed", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("signed_at", sa.DateTime(timezone=True)),
        sa.Column("uploaded_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("remark", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_acceptance_doc_acc", "acceptance_document", ["acceptance_id"])


def downgrade() -> None:
    op.drop_table("acceptance_document")
    op.drop_table("acceptance")
