"""goods_receipt: resolve_by / resolve_at（采购退换货处理留痕）

验收不合格的到货单，采购协商换货/退货时记下处理人和处理时间。

Revision ID: 7603a7179b83
Revises: 69aeb88f2bd9
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '7603a7179b83'
down_revision: str | None = '69aeb88f2bd9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('goods_receipt', sa.Column('resolved_by', sa.Integer(), nullable=True))
    op.add_column('goods_receipt', sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        'fk_goods_receipt_resolved_by_app_user', 'goods_receipt', 'app_user', ['resolved_by'], ['id']
    )


def downgrade() -> None:
    op.drop_constraint('fk_goods_receipt_resolved_by_app_user', 'goods_receipt', type_='foreignkey')
    op.drop_column('goods_receipt', 'resolved_at')
    op.drop_column('goods_receipt', 'resolved_by')
