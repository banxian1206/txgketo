"""C 步（06 卷）：站内消息 notification + 未读红点

Revision ID: e2c4f6a8b013
Revises: d0f4a6c83b25
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e2c4f6a8b013"
down_revision: str | None = "d0f4a6c83b25"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notification",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text()),
        sa.Column("link", sa.String(length=255)),
        sa.Column("biz_type", sa.String(length=24)),
        sa.Column("biz_id", sa.Integer()),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("read_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_notification_user_read", "notification", ["user_id", "is_read"])


def downgrade() -> None:
    op.drop_index("ix_notification_user_read", table_name="notification")
    op.drop_table("notification")
