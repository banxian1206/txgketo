"""S8 现场域：site_survey / site_daily / site_issue / site_commission / site_incoming（02 卷 §9）

Revision ID: j4f6b8d03e59
Revises: i3e5a7c92d48
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "j4f6b8d03e59"
down_revision: str | None = "i3e5a7c92d48"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "site_survey",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_no", sa.String(16), sa.ForeignKey("project.project_no", ondelete="CASCADE"), nullable=False),
        sa.Column("surveyed_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("surveyed_at", sa.DateTime(timezone=True)),
        sa.Column("contact", sa.String(64)),
        sa.Column("floor_load", sa.String(128)),
        sa.Column("passage", sa.String(128)),
        sa.Column("power", sa.String(128)),
        sa.Column("air", sa.String(128)),
        sa.Column("network", sa.String(128)),
        sa.Column("enter_date", sa.Date()),
        sa.Column("photos", postgresql.JSONB()),
        sa.Column("remark", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_site_survey_project", "site_survey", ["project_no"])

    op.create_table(
        "site_daily",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_no", sa.String(16), sa.ForeignKey("project.project_no", ondelete="CASCADE"), nullable=False),
        sa.Column("equip_no", sa.String(16)),
        sa.Column("report_date", sa.Date()),
        sa.Column("stage", sa.String(16), server_default="安装", nullable=False),
        sa.Column("done_items", postgresql.JSONB()),
        sa.Column("people", sa.Numeric(6, 0)),
        sa.Column("photos", postgresql.JSONB()),
        sa.Column("videos", postgresql.JSONB()),
        sa.Column("problem", sa.Text()),
        sa.Column("reporter_id", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("remark", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_site_daily_project", "site_daily", ["project_no", "report_date"])

    op.create_table(
        "site_issue",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_no", sa.String(16), sa.ForeignKey("project.project_no", ondelete="CASCADE"), nullable=False),
        sa.Column("equip_no", sa.String(16)),
        sa.Column("title", sa.String(128), nullable=False),
        sa.Column("desc", sa.Text()),
        sa.Column("photos", postgresql.JSONB()),
        sa.Column("status", sa.String(16), server_default="待处理", nullable=False),
        sa.Column("related_change_id", sa.Integer(), sa.ForeignKey("change_request.id")),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_site_issue_project", "site_issue", ["project_no"])

    op.create_table(
        "site_commission",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_no", sa.String(16), sa.ForeignKey("project.project_no", ondelete="CASCADE"), nullable=False),
        sa.Column("request_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("request_at", sa.DateTime(timezone=True)),
        sa.Column("dispatch_to", sa.String(128)),
        sa.Column("plan_date", sa.Date()),
        sa.Column("arrived_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(16), server_default="已申请", nullable=False),
        sa.Column("photos", postgresql.JSONB()),
        sa.Column("remark", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_site_commission_project", "site_commission", ["project_no"])

    op.create_table(
        "site_incoming",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_no", sa.String(16), sa.ForeignKey("project.project_no", ondelete="CASCADE"), nullable=False),
        sa.Column("receipt_id", sa.Integer(), sa.ForeignKey("goods_receipt.id", ondelete="CASCADE")),
        sa.Column("result", sa.String(16), nullable=False),
        sa.Column("shortage_detail", postgresql.JSONB()),
        sa.Column("photos", postgresql.JSONB()),
        sa.Column("received_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("received_at", sa.DateTime(timezone=True)),
        sa.Column("remark", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_site_incoming_project", "site_incoming", ["project_no"])


def downgrade() -> None:
    for t in ("site_incoming", "site_commission", "site_issue", "site_daily", "site_survey"):
        op.drop_table(t)
