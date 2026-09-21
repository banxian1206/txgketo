"""S5 制造域：prod_order / prod_task / prod_acceptance / outsource_task（02 卷 §6）

Revision ID: g1b3d5f70c29
Revises: f3a5c7e9b104
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "g1b3d5f70c29"
down_revision: str | None = "f3a5c7e9b104"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PROD_TABLES = ("prod_order", "prod_task", "prod_acceptance", "outsource_task")

NEW_RULES = (
    ("PROD_ORDER", "排产订单", "PR{YY}{seq:03}", "global_year", "车间自制件排产；图号即物料号"),
    ("OUTSOURCE", "外协任务单", "WX{YY}{seq:03}", "global_year", "自制件发出去加工"),
)


def upgrade() -> None:
    op.create_table(
        "prod_order",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_no", sa.String(32), nullable=False, unique=True),
        sa.Column("project_no", sa.String(16), sa.ForeignKey("project.project_no", ondelete="CASCADE"), nullable=False),
        sa.Column("equip_no", sa.String(16)),
        sa.Column("item_no", sa.String(48), nullable=False),
        sa.Column("item_name", sa.String(128)),
        sa.Column("spec_text", sa.String(255)),
        sa.Column("qty", sa.Numeric(12, 2), server_default="1", nullable=False),
        sa.Column("unit", sa.String(16), server_default="件", nullable=False),
        sa.Column("plan_start", sa.Date()),
        sa.Column("plan_end", sa.Date()),
        sa.Column("status", sa.String(16), server_default="待领料", nullable=False),
        sa.Column("team", sa.String(32)),
        sa.Column("worker_id", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("remark", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_prod_order_project", "prod_order", ["project_no", "equip_no"])

    op.create_table(
        "prod_task",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("prod_order_id", sa.Integer(), sa.ForeignKey("prod_order.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_name", sa.String(32), nullable=False),
        sa.Column("material_item_no", sa.String(48)),
        sa.Column("material_qty", sa.Numeric(14, 3)),
        sa.Column("drawing_no", sa.String(48)),
        sa.Column("drawing_version", sa.String(8)),
        sa.Column("issued_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("issued_at", sa.DateTime(timezone=True)),
        sa.Column("issued_to", sa.String(64)),
        sa.Column("photos", postgresql.JSONB()),
        sa.Column("remark", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_prod_task_order", "prod_task", ["prod_order_id"])

    op.create_table(
        "prod_acceptance",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("prod_order_id", sa.Integer(), sa.ForeignKey("prod_order.id", ondelete="CASCADE"), nullable=False),
        sa.Column("accepted_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("accepted_at", sa.DateTime(timezone=True)),
        sa.Column("result", sa.String(16), nullable=False),
        sa.Column("reason", sa.Text()),
        sa.Column("photos", postgresql.JSONB()),
        sa.Column("transfer_at", sa.DateTime(timezone=True)),
        sa.Column("transfer_to", sa.String(32)),
        sa.Column("transfer_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("transfer_photos", postgresql.JSONB()),
        sa.Column("remark", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_prod_acceptance_order", "prod_acceptance", ["prod_order_id"])

    op.create_table(
        "outsource_task",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("outsource_no", sa.String(32), nullable=False, unique=True),
        sa.Column("project_no", sa.String(16), sa.ForeignKey("project.project_no", ondelete="CASCADE"), nullable=False),
        sa.Column("equip_no", sa.String(16)),
        sa.Column("item_no", sa.String(48), nullable=False),
        sa.Column("item_name", sa.String(128)),
        sa.Column("qty", sa.Numeric(12, 2), server_default="1", nullable=False),
        sa.Column("supplier_id", sa.Integer(), sa.ForeignKey("supplier.id")),
        sa.Column("supplier_name", sa.String(128)),
        sa.Column("material_supplied", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("sent_at", sa.Date()),
        sa.Column("due_date", sa.Date()),
        sa.Column("returned_at", sa.Date()),
        sa.Column("status", sa.String(16), server_default="待发出", nullable=False),
        sa.Column("photos", postgresql.JSONB()),
        sa.Column("remark", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_outsource_project", "outsource_task", ["project_no", "equip_no"])

    # 新编号规则：排产单 PR{YY}{NNN} / 外协单 WX{YY}{NNN}
    for obj_type, name, template, scope, remark in NEW_RULES:
        op.execute(
            sa.text(
                "INSERT INTO number_rule (object_type, name, template, scope, start_value, step, remark,"
                " created_at, updated_at)"
                " SELECT :ot, :name, :tpl, :scope, 1, 1, :remark, now(), now()"
                " WHERE NOT EXISTS (SELECT 1 FROM number_rule WHERE object_type = :ot)"
            ).bindparams(ot=obj_type, name=name, tpl=template, scope=scope, remark=remark)
        )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM number_rule WHERE object_type IN ('PROD_ORDER', 'OUTSOURCE')")
    )
    for table in reversed(PROD_TABLES):
        op.drop_table(table)
