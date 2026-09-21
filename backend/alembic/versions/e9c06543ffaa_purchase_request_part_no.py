"""purchase_request: part_no（零件归属）+ 遗留状态归一

· part_no：这条采购需求是给哪个零件的（图号），合并单里能看出「10 个方通分别给谁」
· 旧状态线遗留：把历史「已下单」归一成「在途」（下单即等货，AGENTS §8.1）

Revision ID: e9c06543ffaa
Revises: 6e5f2352f895
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = 'e9c06543ffaa'
down_revision: str | None = '6e5f2352f895'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('purchase_request', sa.Column('part_no', sa.String(length=48), nullable=True))
    op.execute("UPDATE purchase_request SET status = '在途' WHERE status = '已下单'")


def downgrade() -> None:
    op.drop_column('purchase_request', 'part_no')
