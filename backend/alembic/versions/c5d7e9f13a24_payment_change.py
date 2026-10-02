"""付款计划变更单：`payment_change` + `payment_change_line`（2026-09-30 客户拍板）。

成交登记只在「线索」阶段能提交，成交后付款节点**没有任何修改口** ——
录错（比例 170%）或客户改分期都只能一直错着。客户确认：做成变更单 + 商务总监审批，
**只改未来节点、历史收款留痕**。

Revision ID: c5d7e9f13a24
Revises: b4c6d8e02f13
Create Date: 2026-09-30

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c5d7e9f13a24"
down_revision: str | None = "b4c6d8e02f13"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "payment_change",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("change_no", sa.String(32), nullable=False, unique=True),
        sa.Column(
            "project_no",
            sa.String(16),
            sa.ForeignKey("project.project_no", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="待商务总监审"),
        sa.Column("before_terms", sa.JSON(), nullable=True),
        sa.Column("requested_by", sa.Integer(), sa.ForeignKey("app_user.id"), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by", sa.Integer(), sa.ForeignKey("app_user.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_payment_change_project", "payment_change", ["project_no"])
    op.create_index("ix_payment_change_status", "payment_change", ["status"])

    op.create_table(
        "payment_change_line",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "change_id",
            sa.Integer(),
            sa.ForeignKey("payment_change.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("node_name", sa.String(64), nullable=False),
        sa.Column("trigger_node", sa.String(16), nullable=True),
        sa.Column("percent", sa.Numeric(6, 2), nullable=True),
        sa.Column("amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("expect_date", sa.Date(), nullable=True),
        sa.Column("condition", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_payment_change_line_change", "payment_change_line", ["change_id"])

    # 新单据类型的编号规则（编号只能由发号引擎出 —— 铁律 1）
    op.execute(
        sa.text(
            "INSERT INTO number_rule (object_type, name, template, scope, start_value, step, remark,"
            " created_at, updated_at)"
            " SELECT 'PAY_CHANGE', '付款计划变更单', 'PC{YY}{seq:03}', 'global_year', 1, 1,"
            " '成交后改付款计划的唯一入口，走商务总监审批；全局按年取号', now(), now()"
            " WHERE NOT EXISTS (SELECT 1 FROM number_rule WHERE object_type = 'PAY_CHANGE')"
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM number_rule WHERE object_type = 'PAY_CHANGE'"))
    op.drop_index("ix_payment_change_line_change", table_name="payment_change_line")
    op.drop_table("payment_change_line")
    op.drop_index("ix_payment_change_status", table_name="payment_change")
    op.drop_index("ix_payment_change_project", table_name="payment_change")
    op.drop_table("payment_change")
