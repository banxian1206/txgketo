"""G1：项目自动归档 —— 加 `project.archived_at`。

背景（`docs/09-从商机到归档-口径确认与缺口计划.md` §3-G1，客户口径 2026-09-28）：
  “归档是**自动**的。我们不是有一个质保期嘛，**质保期过了就自动归档**。”
  阶段值「已归档」本身是 varchar（无 CHECK），不需要 DDL；这里只为可追溯加一个时间戳。
  归档由 `services/project_stage.py::archive_due_projects()` **惰性扫描**写入
  （本系统不用 Redis/MQ/调度器 —— 技术栈铁律），与现有“超期”同一套路。

Revision ID: v8b0d2f46a57
Revises: u7a9c1e35f46
Create Date: 2026-09-28

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "v8b0d2f46a57"
down_revision: str | None = "u7a9c1e35f46"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("project", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("project", "archived_at")
