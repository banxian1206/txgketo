"""付款节点新增触发节点「**立项**」：预收款在**立项之后就开始提醒**。

来源（客户口径 2026-09-29）：*"预收款的提醒是**立项**，立项之后就开始提醒。"*

- 新增 `PAY_TRIGGER_INITIATE = "立项"`（进 `PAYMENT_TRIGGERS`，排在最前 —— 它是流程里最早的节点）
- `infer_trigger()` 增加 `预收 / 预付 → 立项`（原来这两类推不出节点，只能留 `NULL`）
- **存量回填**：把历史 `预收款 / 预付款` 的 `NULL` 补成 `立项`（原来以为"预收款没有物流节点"，
  现在客户给了口径 —— 它由**立项**触发，不是"不触发"）

Revision ID: a3b5c7d91e02
Revises: z2f4b6d80e91
Create Date: 2026-09-29

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a3b5c7d91e02"
down_revision: str | None = "z2f4b6d80e91"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 存量回填：预收款/预付款 → 立项（只动 NULL 的，不动已经绑好的）
    op.execute(
        "UPDATE payment_term SET trigger_node = '立项' WHERE trigger_node IS NULL AND node_name LIKE '%预收%'"
    )
    op.execute(
        "UPDATE payment_term SET trigger_node = '立项' WHERE trigger_node IS NULL AND node_name LIKE '%预付%'"
    )


def downgrade() -> None:
    op.execute("UPDATE payment_term SET trigger_node = NULL WHERE trigger_node = '立项'")
