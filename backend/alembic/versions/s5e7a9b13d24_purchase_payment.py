"""三期：新增权限码 purchase:payment（标记付款 / 上传付款凭证）。

Revision ID: s5e7a9b13d24
Revises: r4d6f8a02c13
Create Date: 2026-09-28

"""
from collections.abc import Sequence

from alembic import op

revision: str = "s5e7a9b13d24"
down_revision: str | None = "r4d6f8a02c13"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO permission (code, name, module)
        VALUES ('purchase:payment', '标记付款/上传付款凭证', '采购')
        ON CONFLICT (code) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO role_permission (role_id, permission_id)
        SELECT r.id, p.id FROM role r, permission p
        WHERE r.code IN ('PURCHASE', 'PURCHASE_LEAD', 'FIN')
          AND p.code = 'purchase:payment'
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM role_permission WHERE permission_id IN "
        "(SELECT id FROM permission WHERE code = 'purchase:payment')"
    )
    op.execute("DELETE FROM permission WHERE code = 'purchase:payment'")
