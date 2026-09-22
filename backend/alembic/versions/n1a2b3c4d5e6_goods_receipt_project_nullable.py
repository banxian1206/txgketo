"""P-02: goods_receipt.project_no 允许为空（辅料/办公用品采购没有项目）

Revision ID: n1a2b3c4d5e6
Revises: m8d0f2b47a93
Create Date: 2026-09-22

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "n1a2b3c4d5e6"
down_revision: str | None = "m8d0f2b47a93"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "goods_receipt", "project_no", existing_type=sa.String(16), nullable=True
    )


def downgrade() -> None:
    op.alter_column(
        "goods_receipt", "project_no", existing_type=sa.String(16), nullable=False
    )
