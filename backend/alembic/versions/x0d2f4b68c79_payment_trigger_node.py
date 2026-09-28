"""G2：付款节点绑业务节点（`payment_term.trigger_node`）。

背景（`docs/09-从商机到归档-口径确认与缺口计划.md` §3-G2，客户口径 2026-09-28）：
  “这些节点要跟物流能够对上。因为我**发了之后**，就必须要**催商务部**的人去把这个款给拿下来。”
  取值为 **发货 / 到货 / 验收 / 质保**（预收款等无节点 = NULL）。
  存量数据按 `node_name` 关键词回填（与既有“名字含「质保」= 质保金”同一套路）。
  提醒**只提醒、不卡流程**（`services/payment.py`）。

Revision ID: x0d2f4b68c79
Revises: w9c1e3a57b68
Create Date: 2026-09-28

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "x0d2f4b68c79"
down_revision: str | None = "w9c1e3a57b68"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("payment_term", sa.Column("trigger_node", sa.String(16), nullable=True))
    # 存量回填：按名字推断（顺序敏感：先更具体的关键词）
    for kw, node in (("质保", "质保"), ("验收", "验收"), ("到货", "到货"), ("发货", "发货")):
        op.execute(
            sa.text(
                "UPDATE payment_term SET trigger_node = :n "
                "WHERE trigger_node IS NULL AND node_name LIKE :k"
            ).bindparams(n=node, k=f"%{kw}%")
        )


def downgrade() -> None:
    op.drop_column("payment_term", "trigger_node")
