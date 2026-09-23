"""回填 project.pm_id：此前任命「项目经理」只写 project_member，从未同步 pm_id，
导致所有「通知项目经理」（直发到货/入库/报修…）静默发不出去。

Revision ID: p2b3c4d5e6f7
Revises: n1a2b3c4d5e6
Create Date: 2026-09-23

"""
from collections.abc import Sequence

from alembic import op

revision: str = "p2b3c4d5e6f7"
down_revision: str | None = "n1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE project p
        SET pm_id = m.user_id
        FROM project_member m
        WHERE m.project_no = p.project_no
          AND m.project_role = '项目经理'
          AND p.pm_id IS NULL
        """
    )


def downgrade() -> None:
    pass
