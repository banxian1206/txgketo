"""二期：采购单审批留档 purchase_approval + 比价口径 supplier_quote.tax_incl/qty。

Revision ID: r4d6f8a02c13
Revises: q3c5e7f91b02
Create Date: 2026-09-28

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "r4d6f8a02c13"
down_revision: str | None = "q3c5e7f91b02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "purchase_approval",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "po_id",
            sa.Integer(),
            sa.ForeignKey("purchase_order.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("round_no", sa.Integer(), server_default="1", nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("reviewer_id", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("action", sa.String(8), nullable=False),
        sa.Column("note", sa.String(255)),
        sa.Column("price_flags", postgresql.JSONB()),
        sa.Column("acted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_purchase_approval_po_id", "purchase_approval", ["po_id"])

    # ★ 比价口径（08 §3.6）：量存报价单绝大多数含税，存量一律标「含税」
    op.add_column(
        "supplier_quote",
        sa.Column("tax_incl", sa.Boolean(), server_default="true", nullable=False),
    )
    op.add_column("supplier_quote", sa.Column("qty", sa.Numeric(14, 3)))
    # 存量成交价的数量：从需求/采购单行兜底回填
    op.execute(
        """
        UPDATE supplier_quote q
        SET qty = l.qty
        FROM purchase_order_line l
        JOIN purchase_order o ON o.id = l.po_id
        WHERE q.price_type = '成交'
          AND q.item_no = l.item_no
          AND q.supplier_id = o.supplier_id
          AND q.source = o.po_no
          AND q.qty IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("supplier_quote", "qty")
    op.drop_column("supplier_quote", "tax_incl")
    op.drop_index("ix_purchase_approval_po_id", table_name="purchase_approval")
    op.drop_table("purchase_approval")
