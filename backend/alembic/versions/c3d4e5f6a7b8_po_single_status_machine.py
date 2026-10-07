"""采购状态机收口：单头唯一口径、单行跟单头（客户口径 2026-10-07）。

背景：实测发现同一张单三个状态打架 —— 单头「待经理审」、**单行却在途**、需求「审批中」。
根因：行状态在建单那一刻就写死 `在途`（审批前也是），且单头有「已批准 / 执行中」两个
只在内部用的影子状态，靠 `_po_display_status` 折叠展示，导致单头真值与展示两套。

收口后：一套词表 ——
  草稿 / 待经理审 / 待总监审 / 已退回 / 在途 / 部分到货 / 待入库 / 已入库 / 现场已验收 /
  不合格 / 已退货 / 已取消 / 已完成 / 已作废 / 已关闭。

本迁移修存量：
  ① 单头 `已批准` → `在途`；
  ② 单头 `执行中` → 按行重算（全到位 → 已完成，否则 → 部分到货）；
  ③ 审批中的单，其行状态跟单头（修掉「审批前就显示在途」）。

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-10-07

"""

from collections.abc import Sequence

from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: str | None = "b2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ① 影子状态「已批准」归并到「在途」
    op.execute("UPDATE purchase_order SET status = '在途' WHERE status = '已批准'")
    # ② 「执行中」按行重算
    op.execute(
        """
        UPDATE purchase_order po
           SET status = CASE
                 WHEN NOT EXISTS (
                        SELECT 1 FROM purchase_order_line l WHERE l.po_id = po.id
                      ) THEN '在途'
                 WHEN NOT EXISTS (
                        SELECT 1 FROM purchase_order_line l
                         WHERE l.po_id = po.id
                           AND l.status NOT IN ('已入库', '现场已验收', '已退货', '已取消')
                      ) THEN '已完成'
                 ELSE '部分到货'
               END
         WHERE po.status = '执行中'
        """
    )
    # ③ 审批中的单：单行状态跟单头
    op.execute(
        """
        UPDATE purchase_order_line l
           SET status = po.status
          FROM purchase_order po
         WHERE l.po_id = po.id
           AND po.status IN ('草稿', '待经理审', '待总监审', '已退回')
           AND l.status = '在途'
        """
    )


def downgrade() -> None:
    # 状态收口不可逆（不再还原「已批准 / 执行中」两个影子状态）
    pass
