"""长周期件改为「进采购池、由采购下单」（客户口径 2026-10-07）。

背景：旧实现里登记长周期件会**直接发号 + 置「在途」**（所谓“立项即下单”），
但并没有真正的 `purchase_order` / `purchase_order_line` / 供应商 / 审批 —— 于是它
① 绕过「所有采购都要两级审批」，② 直接出现在仓库「待验收」队列（仓库按状态「在途」列出待验收）。
客户实测 TX26005 长周期件时明确要求：长周期件也要走「采购池 → 采购下单 → 审批 → 在途 → 到货验收」。

本迁移把**历史遗留下来的幽灵单**（有 `po_no` 但没有任何采购单行、也没有任何到货单的
长周期需求）退回到采购池：状态置「待采购」，清掉 `po_no` / `ordered_at` / `expected_date` /
`qty_ordered`。真正下过单（有 `purchase_order_line`）或已收货的**不动**。

Revision ID: b2c3d4e5f6a7
Revises: d4f7b2a91c35
Create Date: 2026-10-07

"""

from collections.abc import Sequence

from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: str | None = "d4f7b2a91c35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ① 幽灵单退回采购池
    op.execute(
        """
        UPDATE purchase_request pr
           SET status = '待采购',
               po_no = NULL,
               ordered_at = NULL,
               expected_date = NULL,
               qty_ordered = NULL
         WHERE pr.is_long_lead = true
           AND pr.po_no IS NOT NULL
           AND NOT EXISTS (
                 SELECT 1 FROM purchase_order_line l WHERE l.request_id = pr.id
               )
           AND NOT EXISTS (
                 SELECT 1 FROM goods_receipt g WHERE g.request_id = pr.id
               )
        """
    )
    # ② 立项时按「已下单」生成的采购任务同步退回去（否则任务还写「进行中」、
    #    计划开始日停在旧的幽灵下单日，与需求状态对不上）
    op.execute(
        """
        UPDATE task t
           SET status = '待开始', plan_start = NULL
          FROM purchase_request pr
         WHERE t.ref_type = 'purchase_request'
           AND t.ref_id = pr.id
           AND t.status = '进行中'
           AND pr.is_long_lead = true
           AND pr.status = '待采购'
           AND pr.ordered_at IS NULL
           AND NOT EXISTS (
                 SELECT 1 FROM purchase_order_line l WHERE l.request_id = pr.id
               )
        """
    )


def downgrade() -> None:
    # 数据修正不可逆（已被重新下单的需求不再需要回退成幽灵单）
    pass
