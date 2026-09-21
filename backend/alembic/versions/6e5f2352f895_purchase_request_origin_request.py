"""purchase_request: origin_request_id（退货重采回池的根）

退货 = 这家供应商的货不行，退给他、换一家重买：原行数量减掉，
退货的那部分新建一条「待采购」需求回到采购池（source='退货重采'），
origin_request_id 指向原来那条需求，方便追溯。

Revision ID: 6e5f2352f895
Revises: 7603a7179b83
Create Date: 2026-09-21 07:58:48.352238

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '6e5f2352f895'
down_revision: str | None = '7603a7179b83'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('purchase_request', sa.Column('origin_request_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_purchase_request_origin_request_id_purchase_request',
        'purchase_request',
        'purchase_request',
        ['origin_request_id'],
        ['id'],
    )


def downgrade() -> None:
    op.drop_constraint(
        'fk_purchase_request_origin_request_id_purchase_request',
        'purchase_request',
        type_='foreignkey',
    )
    op.drop_column('purchase_request', 'origin_request_id')
