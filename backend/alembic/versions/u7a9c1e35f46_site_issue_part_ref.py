"""G3：现场问题支持挂到**具体零件**（图号 / 物料号）。

背景（`docs/09-从商机到归档-口径确认与缺口计划.md` §3-G3，客户口径 2026-09-28）：
  "他在装这个设备的时候，发现零件有问题，那他肯定是反映**这个零件**，或者反映
   **这个设备的某个零件**，它是有归属的嘛。"
  原来 `site_issue` 只到 `project_no + equip_no`（设备级），挂不到具体零件，
  而现有「问题 → 改版(ECN)」链路（`related_change_id`）又需要知道是**哪个零件**。

Revision ID: u7a9c1e35f46
Revises: t6f8a0b24c35
Create Date: 2026-09-28

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "u7a9c1e35f46"
down_revision: str | None = "t6f8a0b24c35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("site_issue", sa.Column("drawing_no", sa.String(64), nullable=True))
    op.add_column("site_issue", sa.Column("item_no", sa.String(64), nullable=True))
    op.add_column("site_issue", sa.Column("part_name", sa.String(128), nullable=True))


def downgrade() -> None:
    op.drop_column("site_issue", "part_name")
    op.drop_column("site_issue", "item_no")
    op.drop_column("site_issue", "drawing_no")
