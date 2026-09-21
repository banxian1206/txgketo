"""A 步（06 卷）：岗位统一三级 + 称谓 title

· app_user.position：设计师 → 成员；设计组长 → 组长；工程总监 → 部门负责人
· app_user.title：自由称谓（可选填，如“设计师”“销售员”），只影响显示

Revision ID: d0f4a6c83b25
Revises: c9e3b5d72a14
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d0f4a6c83b25"
down_revision: str | None = "c9e3b5d72a14"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("app_user", sa.Column("title", sa.String(length=32), nullable=True))
    op.execute("UPDATE app_user SET position = '成员' WHERE position = '设计师'")
    op.execute("UPDATE app_user SET position = '组长' WHERE position = '设计组长'")
    op.execute("UPDATE app_user SET position = '部门负责人' WHERE position = '工程总监'")
    # 老数据里的称谓补上（原来只有 position 表达岗位）
    op.execute("UPDATE app_user SET title = '设计师' WHERE title IS NULL AND position = '成员' AND profession IS NOT NULL")


def downgrade() -> None:
    op.execute("UPDATE app_user SET position = '设计师' WHERE position = '成员' AND profession IS NOT NULL")
    op.execute("UPDATE app_user SET position = '设计组长' WHERE position = '组长' AND profession IS NOT NULL")
    op.execute("UPDATE app_user SET position = '工程总监' WHERE position = '部门负责人'")
    op.drop_column("app_user", "title")
