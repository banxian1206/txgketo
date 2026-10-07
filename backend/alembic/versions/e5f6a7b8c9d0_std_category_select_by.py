"""标准库品类增加「谁能选」`std_category.select_by`。

背景（2026-10-07 客户口径）：
> 「作为机械设计师，他不会去选择原材料，只会选择那些商选件（比如马达、电机）。
>   原材料是属于工艺去选择的……我们是不是可以分个类，把哪些东西可以让他选、
>   哪些东西不可以让他选？」
> 「车间仓库耗材这里只给采购。」「其他外购先不管，隐藏吧。」

所以品类要带一个**职责归属**，设计面 / 材料 BOM 的选择器各按自己的身份过滤。

取值（4 个，`SELECT_BY` 契约）：

| 值 | 谁能在**挂料选择器**里看到 |
|---|---|
| `设计` | 机械 / 电气 / 程序（设计 BOM 的商选件） |
| `工艺` | 工艺员（材料 BOM 的原材料） |
| `采购` | **只有采购**（手工申请 / 下单选料；设计/工艺看不到） |
| `皆可` | 谁都能看到（定不了的先放这里） |

★ 默认值给 `皆可`（**不是** `设计`）：将来 ERP 再导入新品类时，宁可"谁都能看到"，
  也不能因为没配归属就**静默地把料藏起来**（那会让人以为"这个件不存在"）。

★ 实测的 19 个类别归属（本次落值）：
  · 原材料 YL(4702) → 工艺
  · 车间仓库耗材 HC(1589)、其他外购 QT(2260) → 采购
  · 组件 ZJ(75)、半成品类 BCP(15)、管路附件 GLF(285) → 皆可（客户：「定不了的都能看得到」）
  · 其余 13 个（传动/动力/电气/气动/导轨/轴承/紧固/五金/仪表/通用/模具/标准化/TCL）→ 设计

Revision ID: e5f6a7b8c9d0
Revises: c3d4e5f6a7b8
Create Date: 2026-10-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: str | None = "c3d4e5f6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 归属表（与 `app/models/library.py::CATEGORY_SELECT_BY` 保持一致；改这里也要改那里）
BY_DESIGN = ["DQ", "QD", "JJ", "ZC", "CD", "DGL", "DL", "MJ", "TCL", "TYLJ", "WJ", "YQYB", "BZH"]
BY_PROCESS = ["YL"]
BY_PURCHASE = ["HC", "QT"]
BY_ANY = ["BCP", "ZJ", "GLF"]


def upgrade() -> None:
    op.add_column(
        "std_category",
        sa.Column("select_by", sa.String(8), nullable=False, server_default="皆可"),
    )
    # 存量按上面的归属表落值（分类写成显式语句，便于审计「哪个类别归了谁」）
    for code, who in [
        *[(c, "设计") for c in BY_DESIGN],
        *[(c, "工艺") for c in BY_PROCESS],
        *[(c, "采购") for c in BY_PURCHASE],
        *[(c, "皆可") for c in BY_ANY],
    ]:
        op.execute(sa.text("UPDATE std_category SET select_by = :w WHERE code = :c").bindparams(w=who, c=code))


def downgrade() -> None:
    op.drop_column("std_category", "select_by")
