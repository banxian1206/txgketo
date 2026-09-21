"""P3 评审单：review_ticket / review_ticket_item / review_action / design_release + bom_item 冻结线

05 卷 §8.1/§8.2：
· 评审单按任务一张、多轮留档；发布（=冻结）写 design_release
· bom_item 加 status（草稿/审核中/已冻结）+ frozen_release_id + owner_id + superseded_by_id

Revision ID: d4e6b8c02f17
Revises: c8d2f4a1b9e3
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d4e6b8c02f17"
down_revision: str | None = "c8d2f4a1b9e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "review_ticket",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ticket_no", sa.String(length=24), nullable=False, unique=True),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("task.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "project_no",
            sa.String(length=16),
            sa.ForeignKey("project.project_no", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("equip_no", sa.String(length=16)),
        sa.Column("profession", sa.String(length=16)),
        sa.Column("submitter_id", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="已通过"),
        sa.Column("current_round", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("task_id", name="uq_review_ticket_task"),
    )

    op.create_table(
        "review_ticket_item",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "ticket_id",
            sa.Integer(),
            sa.ForeignKey("review_ticket.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("round_no", sa.Integer(), nullable=False),
        sa.Column("item_type", sa.String(length=16), nullable=False),
        sa.Column("item_ref", sa.String(length=64), nullable=False),
        sa.Column("version", sa.String(length=16)),
        sa.Column("snapshot", postgresql.JSONB()),
        sa.Column("submitted_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "review_action",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "ticket_id",
            sa.Integer(),
            sa.ForeignKey("review_ticket.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("round_no", sa.Integer(), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("reviewer_id", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("action", sa.String(length=8), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("acted_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "design_release",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("release_no", sa.String(length=24), nullable=False, unique=True),
        sa.Column(
            "ticket_id",
            sa.Integer(),
            sa.ForeignKey("review_ticket.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("round_no", sa.Integer(), nullable=False),
        sa.Column(
            "project_no",
            sa.String(length=16),
            sa.ForeignKey("project.project_no", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("equip_no", sa.String(length=16)),
        sa.Column("profession", sa.String(length=16)),
        sa.Column("released_by", sa.Integer(), sa.ForeignKey("app_user.id")),
        sa.Column("released_at", sa.DateTime(timezone=True)),
        sa.Column("summary", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    op.add_column(
        "bom_item", sa.Column("status", sa.String(length=8), nullable=False, server_default="草稿")
    )
    op.add_column("bom_item", sa.Column("frozen_release_id", sa.Integer(), nullable=True))
    op.add_column("bom_item", sa.Column("owner_id", sa.Integer(), nullable=True))
    op.add_column("bom_item", sa.Column("superseded_by_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_bom_item_frozen_release_id", "bom_item", "design_release", ["frozen_release_id"], ["id"]
    )
    op.create_foreign_key("fk_bom_item_owner_id", "bom_item", "app_user", ["owner_id"], ["id"])
    op.create_foreign_key(
        "fk_bom_item_superseded_by_id", "bom_item", "bom_item", ["superseded_by_id"], ["id"]
    )


def downgrade() -> None:
    op.drop_constraint("fk_bom_item_superseded_by_id", "bom_item", type_="foreignkey")
    op.drop_constraint("fk_bom_item_owner_id", "bom_item", type_="foreignkey")
    op.drop_constraint("fk_bom_item_frozen_release_id", "bom_item", type_="foreignkey")
    op.drop_column("bom_item", "superseded_by_id")
    op.drop_column("bom_item", "owner_id")
    op.drop_column("bom_item", "frozen_release_id")
    op.drop_column("bom_item", "status")
    op.drop_table("design_release")
    op.drop_table("review_action")
    op.drop_table("review_ticket_item")
    op.drop_table("review_ticket")
