"""岗位统一三级：组员 / 经理 / 总监（06 卷 §3）

把散着的「成员·设计师 · 组长·设计组长·主管 · 部门负责人·工程总监」统一成：
  一级 组员 / 二级 经理 / 三级 总监

同时把评审单状态「待组长审」→「待经理审」，角色名「采购主管」→「采购经理」。

Revision ID: f3a5c7e9b104
Revises: e2c4f6a8b013
Create Date: 2026-09-21

"""
from collections.abc import Sequence

from alembic import op

revision: str = "f3a5c7e9b104"
down_revision: str | None = "e2c4f6a8b013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE app_user SET position = '组员' WHERE position IN ('成员', '设计师')"
    )
    op.execute(
        "UPDATE app_user SET position = '经理' WHERE position IN ('组长', '设计组长', '主管')"
    )
    op.execute(
        "UPDATE app_user SET position = '总监' WHERE position IN ('部门负责人', '工程总监')"
    )
    op.execute("UPDATE review_ticket SET status = '待经理审' WHERE status = '待组长审'")
    op.execute("UPDATE role SET name = '采购经理' WHERE code = 'PURCHASE_LEAD'")


def downgrade() -> None:
    op.execute("UPDATE role SET name = '采购主管' WHERE code = 'PURCHASE_LEAD'")
    op.execute("UPDATE review_ticket SET status = '待组长审' WHERE status = '待经理审'")
    op.execute("UPDATE app_user SET position = '部门负责人' WHERE position = '总监'")
    op.execute("UPDATE app_user SET position = '组长' WHERE position = '经理'")
    op.execute("UPDATE app_user SET position = '成员' WHERE position = '组员'")
