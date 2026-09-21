"""purchase: acceptance/store split + receipt resolution (换货/退货)

验收与入库拆开：验收合格 → 待入库；入库单独记谁/什么时候入的。
到货单新增 stored_by/stored_at/resolve_note；历史「已验收」按去向改造：
公司仓库 → 已入库，直发现场 → 现场已验收。

Revision ID: 69aeb88f2bd9
Revises: d2b3f01c7bd7
Create Date: 2026-09-20

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '69aeb88f2bd9'
down_revision: str | None = 'd2b3f01c7bd7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('goods_receipt', sa.Column('stored_by', sa.Integer(), nullable=True))
    op.add_column('goods_receipt', sa.Column('stored_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('goods_receipt', sa.Column('resolve_note', sa.Text(), nullable=True))
    op.create_foreign_key(
        'fk_goods_receipt_stored_by_app_user', 'goods_receipt', 'app_user', ['stored_by'], ['id']
    )

    # ---- 历史数据：已验收 = 旧流程里「验收+入库」一步完成 ----
    op.execute(
        """
        UPDATE goods_receipt
        SET stored_by = inspected_by,
            stored_at = inspected_at,
            location = COALESCE(location, '待定'),
            status = CASE WHEN deliver_to = '直发客户现场' THEN '现场已验收' ELSE '已入库' END
        WHERE status = '已验收'
        """
    )
    # 已入库的采购需求与到货单对齐（历史数据收尾）
    op.execute(
        """
        UPDATE purchase_request r
        SET status = CASE
                WHEN EXISTS (
                    SELECT 1 FROM goods_receipt g
                    WHERE g.request_id = r.id AND g.deliver_to = '直发客户现场'
                ) THEN '现场已验收'
                ELSE '已入库'
            END
        WHERE r.status IN ('在途', '到货待检', '待入库')
          AND EXISTS (SELECT 1 FROM goods_receipt g WHERE g.request_id = r.id)
          AND NOT EXISTS (
              SELECT 1 FROM goods_receipt g
              WHERE g.request_id = r.id AND g.status NOT IN ('已入库', '现场已验收')
          )
          AND (
              SELECT COALESCE(SUM(g.qty), 0) FROM goods_receipt g WHERE g.request_id = r.id
          ) >= COALESCE(r.qty, 0)
        """
    )


def downgrade() -> None:
    op.drop_constraint('fk_goods_receipt_stored_by_app_user', 'goods_receipt', type_='foreignkey')
    op.drop_column('goods_receipt', 'resolve_note')
    op.drop_column('goods_receipt', 'stored_at')
    op.drop_column('goods_receipt', 'stored_by')
