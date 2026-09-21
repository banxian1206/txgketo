"""P7 移动端：到货验收照片 goods_receipt.photos（05 卷 §8.2 / 03 卷手机端）

Revision ID: c9e3b5d72a14
Revises: b8d2f4a6913c
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c9e3b5d72a14"
down_revision: str | None = "b8d2f4a6913c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("goods_receipt", sa.Column("photos", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("goods_receipt", "photos")
