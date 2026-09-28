"""到期扫描去重键：`notification.dedup_key`。

背景（AGENTS §8.3 第 6 条“超期扫描 / 到期提醒”本期落地）：
  提醒必须是**幂等**的 —— 同一件事每天最多提醒一次，否则工作台一刷新就刷屏。
  `services/deadline.py::scan_due()` 用 `dedup_key`（形如 `task-overdue:12:2026-09-28`）去重。

Revision ID: z2f4b6d80e91
Revises: y1e3a5c79d80
Create Date: 2026-09-28

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "z2f4b6d80e91"
down_revision: str | None = "y1e3a5c79d80"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("notification", sa.Column("dedup_key", sa.String(96), nullable=True))
    op.create_index("ix_notification_dedup_key", "notification", ["dedup_key"])


def downgrade() -> None:
    op.drop_index("ix_notification_dedup_key", table_name="notification")
    op.drop_column("notification", "dedup_key")
