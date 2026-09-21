"""P1 组织与岗位：app_user 加 profession/position + 「软件」→「程序」归一

· app_user.profession / position：工程部岗位（05 卷 §2.1）
  专业 = 机械/电气/程序/工艺；岗位 = 设计师/设计组长/工程总监（审核链按此找人）
· 「软件」→「程序」：任务专业与项目团队角色里的旧值统一改名（05 卷 §0.1#12）

Revision ID: b7c4a1e93d20
Revises: e9c06543ffaa
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7c4a1e93d20"
down_revision: str | None = "e9c06543ffaa"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("app_user", sa.Column("profession", sa.String(length=16), nullable=True))
    op.add_column("app_user", sa.Column("position", sa.String(length=32), nullable=True))
    op.execute("UPDATE task SET profession = '程序' WHERE profession = '软件'")
    op.execute("UPDATE project_member SET project_role = '程序负责人' WHERE project_role = '软件负责人'")


def downgrade() -> None:
    op.execute("UPDATE project_member SET project_role = '软件负责人' WHERE project_role = '程序负责人'")
    op.execute("UPDATE task SET profession = '软件' WHERE profession = '程序'")
    op.drop_column("app_user", "position")
    op.drop_column("app_user", "profession")
