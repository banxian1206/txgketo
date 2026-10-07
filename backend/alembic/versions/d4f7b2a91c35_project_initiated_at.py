"""项目增加「立项时点」`project.initiated_at`。

背景（2026-10-07 · 项目详情顶部全生命周期时间线）：
客户要一条「商机记录 → 立项 → 里程碑 → 交付截止 → 质保 → 回款」的全局时间线。
其中**成交**有 `period_start`（合同签订日），但**立项**一直只在 `audit_log`
（`action='initiate'`）里 —— 拿审计日志做业务展示不稳（受清理策略影响、查询也慢）。

所以落成一个字段：`initiate_project()` 里写一次。
存量数据用审计日志回填（有就填，没有就留 NULL，不回填假日期）。

Revision ID: d4f7b2a91c35
Revises: f3c1a9d47b02
Create Date: 2026-10-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4f7b2a91c35"
down_revision: str | None = "f3c1a9d47b02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("project", sa.Column("initiated_at", sa.Date(), nullable=True))

    # 存量回填：从审计日志取最早一次 initiate 的日期；取不到就留 NULL（不编日期）
    op.execute(
        """
        UPDATE project p
           SET initiated_at = sub.d
          FROM (
                SELECT object_ref, MIN(created_at)::date AS d
                  FROM audit_log
                 WHERE action = 'initiate'
                   AND object_type = 'project'
                 GROUP BY object_ref
               ) AS sub
         WHERE p.project_no = sub.object_ref
        """
    )


def downgrade() -> None:
    op.drop_column("project", "initiated_at")
