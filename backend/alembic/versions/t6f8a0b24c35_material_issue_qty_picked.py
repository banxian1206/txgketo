"""N24：领料单行新增 qty_picked（已备料量）—— 支持「部分备料」。

背景（全局测试报告 N24）：
  领料单原来只有 `qty_required`（需求）与 `qty_issued`（已领走），**没有「已备料量」**。
  于是 `pick` 只能「要么全锁、要么整单 400」：库存 5 / 需求 10 时整张单卡在「待备料」，
  同一张单里可满足的行也被连坐；补货后又没有「已备过多少」的记录，会重复锁。
  三量分离后：pick 按可用量备（有多少备多少）→ hand-over 只领已备到的量
  → 补货后可再 pick 补差额 → 直到领完。

Revision ID: t6f8a0b24c35
Revises: s5e7a9b13d24
Create Date: 2026-09-28

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "t6f8a0b24c35"
down_revision: str | None = "s5e7a9b13d24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "material_issue_line",
        sa.Column("qty_picked", sa.Numeric(14, 3), nullable=False, server_default="0"),
    )
    # 回填：历史行「已备料量」=「已领走量」（老流程里备多少就领多少）
    op.execute("UPDATE material_issue_line SET qty_picked = qty_issued")


def downgrade() -> None:
    op.drop_column("material_issue_line", "qty_picked")
