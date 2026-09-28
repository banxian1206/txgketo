"""09 卷 §2.1：装配结果决定发运清单结构 —— `assembly_record.unassembled`。

背景（客户口径 2026-09-28）：
  “一个设备有 100 个零件，但我只装配了 80 个，那么发货时怎么发？那肯定是发这个装了 80 件的
   **组装体**，勾选这个就可以了。装配完之后，清单其实就变成了**一个组装体 + 20 个零件**。
   发货的时候，就可以选择这个组装体和 20 个零件，勾选拍照进行发货。”
  “组装体只是清单里面的一项，你**不需要去纠结**它是由 80 个零件组成的”；
  “他收货的时候肯定也是「组装体 + 20 个零件」，**干嘛要去拆？**”

所以：装配完成时登记**未装清单**（形如 `[{"ref","name","qty","unit"}]`，空 = 全部装完），
发运清单生成时把已装部分折成**一项** `kind=组装体`，未装零件保持单列。
`shipment_item.kind` 新增取值「组装体」（`SHIP_ITEM_ASSEMBLY`）。

Revision ID: y1e3a5c79d80
Revises: x0d2f4b68c79
Create Date: 2026-09-28

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "y1e3a5c79d80"
down_revision: str | None = "x0d2f4b68c79"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assembly_record",
        sa.Column("unassembled", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("assembly_record", "unassembled")
