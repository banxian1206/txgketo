"""采购单实体化（08 §3 · 一期）：purchase_order / purchase_order_line + 部分合格字段。

**为什么**：此前采购单是 `purchase_request.po_no` GROUP BY 凑出来的视图，拆单会丢需求
（`merge_order` 直接覆盖 `row.qty`）。本期建真表；一条需求可拆到多张单的多行。

回填（无真实生产数据，按现有 po_no 分组）：
  · 有 po_no 的需求 → 每组一张 purchase_order + 每条需求一行 purchase_order_line
  · purchase_request.qty_ordered = Σ 行 qty
  · goods_receipt.po_id / po_line_id / qty_ok / qty_rejected / batch_no
  · 历史单不补走审批，一律置「已批准」（有到货的置执行中/已完成）

Revision ID: q3c5e7f91b02
Revises: p2b3c4d5e6f7
Create Date: 2026-09-28

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "q3c5e7f91b02"
down_revision: str | None = "p2b3c4d5e6f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 单头 ──────────────────────────────────────────────────────────
    op.create_table(
        "purchase_order",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("po_no", sa.String(32), nullable=False),
        sa.Column("supplier_id", sa.Integer(), sa.ForeignKey("supplier.id")),
        sa.Column("supplier_name", sa.String(128)),
        sa.Column("order_date", sa.Date()),
        sa.Column("expect_date", sa.Date()),
        sa.Column("actual_arrive_date", sa.Date()),
        sa.Column("delay_days", sa.Integer()),
        sa.Column("deliver_to", sa.String(16)),
        sa.Column("deliver_address", sa.String(255)),
        sa.Column("currency", sa.String(8), server_default="CNY", nullable=False),
        sa.Column("tax_rate", sa.Numeric(5, 2)),
        sa.Column("freight", sa.Numeric(14, 2)),
        sa.Column("discount", sa.Numeric(14, 2)),
        sa.Column("total_tax_incl", sa.Numeric(14, 2)),
        sa.Column("total_tax_excl", sa.Numeric(14, 2)),
        sa.Column("status", sa.String(16), server_default="草稿", nullable=False),
        sa.Column("pay_status", sa.String(16), server_default="未付款", nullable=False),
        sa.Column("paid_amount", sa.Numeric(14, 2)),
        sa.Column("paid_at", sa.Date()),
        sa.Column("paid_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("paid_marked_at", sa.DateTime(timezone=True)),
        sa.Column("paid_vouchers", postgresql.JSONB()),
        sa.Column("paid_note", sa.String(255)),
        sa.Column("attachments", postgresql.JSONB()),
        sa.Column("round", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("remark", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("po_no", name="uq_purchase_order_po_no"),
    )
    # ── 单行 ──────────────────────────────────────────────────────────
    op.create_table(
        "purchase_order_line",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "po_id", sa.Integer(), sa.ForeignKey("purchase_order.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("request_id", sa.Integer(), sa.ForeignKey("purchase_request.id")),
        sa.Column("item_no", sa.String(32), sa.ForeignKey("item.item_no"), nullable=False),
        sa.Column("part_no", sa.String(48)),
        sa.Column("project_no", sa.String(32), sa.ForeignKey("project.project_no")),
        sa.Column("equip_no", sa.String(16)),
        sa.Column("qty", sa.Numeric(14, 3), nullable=False),
        sa.Column("unit", sa.String(16)),
        sa.Column("unit_price", sa.Numeric(14, 2)),
        sa.Column("tax_incl", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("tax_rate", sa.Numeric(5, 2)),
        sa.Column("amount_tax_incl", sa.Numeric(14, 2)),
        sa.Column("amount_tax_excl", sa.Numeric(14, 2)),
        sa.Column("expect_date", sa.Date()),
        sa.Column("received_qty", sa.Numeric(14, 3)),
        sa.Column("rejected_qty", sa.Numeric(14, 3)),
        sa.Column("status", sa.String(16), server_default="在途", nullable=False),
        sa.Column("remark", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_purchase_order_line_po_id", "purchase_order_line", ["po_id"])
    op.create_index("ix_purchase_order_line_request_id", "purchase_order_line", ["request_id"])

    # ── 需求加列 ───────────────────────────────────────────────────────
    op.add_column("purchase_request", sa.Column("qty_ordered", sa.Numeric(14, 3)))
    op.add_column("purchase_request", sa.Column("qty_rejected", sa.Numeric(14, 3)))

    # ── 到货单加列（部分合格）───────────────────────────────────────────
    op.add_column("goods_receipt", sa.Column("po_id", sa.Integer(), sa.ForeignKey("purchase_order.id")))
    op.add_column(
        "goods_receipt", sa.Column("po_line_id", sa.Integer(), sa.ForeignKey("purchase_order_line.id"))
    )
    op.add_column("goods_receipt", sa.Column("qty_ok", sa.Numeric(14, 3)))
    op.add_column("goods_receipt", sa.Column("qty_rejected", sa.Numeric(14, 3)))
    op.add_column("goods_receipt", sa.Column("batch_no", sa.String(32)))

    # ── 回填：按 po_no 分组建单头 ──────────────────────────────────────
    op.execute(
        """
        INSERT INTO purchase_order
            (po_no, supplier_id, supplier_name, order_date, expect_date,
             deliver_to, deliver_address, status, pay_status, round, created_at, updated_at)
        SELECT po_no,
               MAX(supplier_id), MAX(supplier_name),
               MIN(ordered_at), MIN(expected_date),
               MAX(deliver_to), MAX(deliver_address),
               '已批准', '未付款', 1, now(), now()
        FROM purchase_request
        WHERE po_no IS NOT NULL AND qty > 0
        GROUP BY po_no
        """
    )
    # ── 回填：每条需求一行 ─────────────────────────────────────────────
    op.execute(
        """
        INSERT INTO purchase_order_line
            (po_id, request_id, item_no, part_no, project_no, equip_no, qty, unit,
             unit_price, tax_incl, expect_date, received_qty, rejected_qty, status, created_at, updated_at)
        SELECT o.id, r.id, r.item_no, r.part_no, r.project_no, r.equip_no, r.qty, r.unit,
               r.unit_price, true, r.expected_date, r.qty_received, 0,
               CASE r.status
                   WHEN '待采购' THEN '在途'
                   WHEN '在途' THEN '在途'
                   WHEN '部分到货' THEN '部分到货'
                   WHEN '已入库' THEN '已入库'
                   WHEN '现场已验收' THEN '已入库'
                   WHEN '不合格' THEN '不合格'
                   WHEN '已退货' THEN '已退货'
                   WHEN '已取消' THEN '已取消'
                   ELSE '在途'
               END,
               now(), now()
        FROM purchase_request r
        JOIN purchase_order o ON o.po_no = r.po_no
        WHERE r.po_no IS NOT NULL AND r.qty > 0
        """
    )
    # 已下单量 = Σ 行 qty
    op.execute(
        """
        UPDATE purchase_request r
        SET qty_ordered = COALESCE(
            (SELECT SUM(l.qty) FROM purchase_order_line l WHERE l.request_id = r.id), 0)
        WHERE r.po_no IS NOT NULL
        """
    )
    # 单行金额（按含税口径换算）
    op.execute(
        """
        UPDATE purchase_order_line
        SET amount_tax_incl = round(COALESCE(qty, 0) * COALESCE(unit_price, 0), 2)
        WHERE unit_price IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE purchase_order_line
        SET amount_tax_excl = round(COALESCE(qty, 0) * COALESCE(unit_price, 0), 2)
        WHERE unit_price IS NOT NULL
        """
    )
    # 单头合计（含税 = 不含税，历史无税率）
    op.execute(
        """
        UPDATE purchase_order o
        SET total_tax_incl = t.s, total_tax_excl = t.s
        FROM (SELECT po_id, SUM(amount_tax_incl) AS s FROM purchase_order_line GROUP BY po_id) t
        WHERE t.po_id = o.id
        """
    )
    # 单头状态：全线完成 → 已完成；有到货 → 执行中；否则 已批准
    op.execute(
        """
        UPDATE purchase_order o SET status = '已完成'
        WHERE NOT EXISTS (
            SELECT 1 FROM purchase_order_line l
            WHERE l.po_id = o.id AND l.status NOT IN ('已入库', '已退货', '已取消')
        )
        """
    )
    op.execute(
        """
        UPDATE purchase_order o SET status = '执行中'
        WHERE status = '已批准' AND EXISTS (
            SELECT 1 FROM purchase_order_line l
            WHERE l.po_id = o.id AND l.status IN ('部分到货', '已入库', '不合格')
        )
        """
    )
    # ── 回填：到货单挂单/行 + 部分合格字段 ─────────────────────────────
    op.execute(
        """
        UPDATE goods_receipt g
        SET po_id = o.id, po_line_id = l.id
        FROM purchase_request r
        JOIN purchase_order o ON o.po_no = r.po_no
        JOIN purchase_order_line l ON l.request_id = r.id
        WHERE g.request_id = r.id
        """
    )
    op.execute("UPDATE goods_receipt SET qty_ok = qty WHERE status IN ('待入库','已入库','现场已验收','现场待验收')")
    op.execute("UPDATE goods_receipt SET qty_rejected = qty WHERE status IN ('不合格','已退货')")
    op.execute("UPDATE goods_receipt SET batch_no = receipt_no WHERE qty_ok IS NULL AND qty_rejected IS NULL")


def downgrade() -> None:
    op.drop_column("goods_receipt", "batch_no")
    op.drop_column("goods_receipt", "qty_rejected")
    op.drop_column("goods_receipt", "qty_ok")
    op.drop_column("goods_receipt", "po_line_id")
    op.drop_column("goods_receipt", "po_id")
    op.drop_column("purchase_request", "qty_rejected")
    op.drop_column("purchase_request", "qty_ordered")
    op.drop_index("ix_purchase_order_line_request_id", table_name="purchase_order_line")
    op.drop_index("ix_purchase_order_line_po_id", table_name="purchase_order_line")
    op.drop_table("purchase_order_line")
    op.drop_table("purchase_order")
