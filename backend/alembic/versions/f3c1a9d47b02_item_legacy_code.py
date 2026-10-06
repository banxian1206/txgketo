"""标准库物料增加「内部来源编号」`item.legacy_code`。

背景（`docs/16-ERP历史数据导入方案.md`）：
客户要把 ERP 的标准库搬进来，但**不要 ERP 的编码规则** —— 全部用本系统发号引擎重编码
（`{类别码}-{品类码}-{0001}`）。可是：

  · 按（品类+名称+型号+品牌）去重会撞掉 **1,952 条**（924 组同名同型号，实测）；
  · 重复导入（增量/重跑）需要一把稳定主键。

所以加一个**只内部用**的来源编号，存 ERP 原物料编码：
只用于重复导入幂等与交叉核对，**不出现在任何接口 / 页面 / 搜索**里。

Revision ID: f3c1a9d47b02
Revises: c5d7e9f13a24
Create Date: 2026-10-06

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3c1a9d47b02"
down_revision: str | None = "c5d7e9f13a24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("item", sa.Column("legacy_code", sa.String(64), nullable=True))
    op.create_unique_constraint("uq_item_legacy_code", "item", ["legacy_code"])


def downgrade() -> None:
    op.drop_constraint("uq_item_legacy_code", "item", type_="unique")
    op.drop_column("item", "legacy_code")
