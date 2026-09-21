"""P2 任务改造：前置依赖（工艺挂机械）+ 组长拆分给组员的子任务

· task.depends_on_id：前置任务（05 卷 §0.1#17 工艺等机械首次发布）
· task.parent_task_id：组长拆分的子任务（05 卷 §0.1#14）

Revision ID: c8d2f4a1b9e3
Revises: b7c4a1e93d20
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c8d2f4a1b9e3"
down_revision: str | None = "b7c4a1e93d20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("task", sa.Column("depends_on_id", sa.Integer(), nullable=True))
    op.add_column("task", sa.Column("parent_task_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_task_depends_on_id", "task", "task", ["depends_on_id"], ["id"])
    op.create_foreign_key("fk_task_parent_task_id", "task", "task", ["parent_task_id"], ["id"])


def downgrade() -> None:
    op.drop_constraint("fk_task_parent_task_id", "task", type_="foreignkey")
    op.drop_constraint("fk_task_depends_on_id", "task", type_="foreignkey")
    op.drop_column("task", "parent_task_id")
    op.drop_column("task", "depends_on_id")
