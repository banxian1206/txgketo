"""P5 采购触发：purchase_request 加归属/申请人/发布批次；project_no 改可空；外协/定制进池

05 卷 §5/§6/§8.2：
· BOM 一发布就进池（设计发布→标准件/定制件；工艺发布→原材料/外协件）
· 手工申请：任何部门/个人可提，免审核直入池，归属分 项目/辅料/办公用品/其他
· 每条需求带 source_release_id（依据哪次发布冻结）

Revision ID: f6a8c0d24e19
Revises: e5f7a9b13c28
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f6a8c0d24e19"
down_revision: str | None = "e5f7a9b13c28"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("purchase_request", sa.Column("attribution", sa.String(length=16), nullable=True))
    op.add_column("purchase_request", sa.Column("requester_id", sa.Integer(), nullable=True))
    op.add_column("purchase_request", sa.Column("source_release_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_purchase_request_requester_id", "purchase_request", "app_user", ["requester_id"], ["id"]
    )
    op.create_foreign_key(
        "fk_purchase_request_source_release_id",
        "purchase_request",
        "design_release",
        ["source_release_id"],
        ["id"],
    )
    op.alter_column("purchase_request", "project_no", existing_type=sa.String(length=16), nullable=True)
    # 存量数据：挂项目的都算「项目」归属
    op.execute("UPDATE purchase_request SET attribution = '项目' WHERE project_no IS NOT NULL")


def downgrade() -> None:
    op.drop_constraint("fk_purchase_request_source_release_id", "purchase_request", type_="foreignkey")
    op.drop_constraint("fk_purchase_request_requester_id", "purchase_request", type_="foreignkey")
    op.drop_column("purchase_request", "source_release_id")
    op.drop_column("purchase_request", "requester_id")
    op.drop_column("purchase_request", "attribution")
    op.alter_column("purchase_request", "project_no", existing_type=sa.String(length=16), nullable=False)
