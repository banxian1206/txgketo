"""标准库（依据《01 编码规则》§5 与《02 数据模型》§3/§6）。

三层结构：
    类别 Category（YL 原材料 / BZ 外购标准件 / DQ 电气件 …）—— 管理口径
      └─ 品类 Class（FT 方通 / DG 导轨 / PLC …）—— 汇总比价，带规格模板
          └─ 型号 Item（YL-FT-0001 = 方通 Q235 40×40×2.0）—— 采购/库存在这一层

★ 两条铁律：
  1. 标准件的 item_no 不带项目号（全公司共用、项目引用），非标件必带项目号
  2. 编码不含规格，但**规格必须完整**（按品类规格模板逐字段校验）——
     因为采购就是照规格买
"""

from __future__ import annotations

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# 物品来源
SOURCE_SELF_MADE = "自制件"
SOURCE_CUSTOM = "定制件"
SOURCE_OUTSOURCE = "外协件"
SOURCE_STANDARD = "标准件"
SOURCE_TYPES = (SOURCE_SELF_MADE, SOURCE_CUSTOM, SOURCE_OUTSOURCE, SOURCE_STANDARD)


# ★ 品类「谁能选」（2026-10-07 客户口径）：挂料选择器按职责过滤，不再"谁都能选到一切"。
#   机械只选商选件（马达/导轨…）、原材料归工艺、耗材只给采购 —— 详见迁移 e5f6a7b8c9d0。
SELECT_DESIGN = "设计"
SELECT_PROCESS = "工艺"
SELECT_PURCHASE = "采购"
SELECT_ANY = "皆可"
CATEGORY_SELECT_BY = (SELECT_DESIGN, SELECT_PROCESS, SELECT_PURCHASE, SELECT_ANY)

# 19 个类别的归属（**唯一来源**：迁移 e5f6a7b8c9d0 与 `scripts/seed.py` 都用它重应用，
# 所以 `e2e:clean` + `seed` 之后分类不会丢）。客户口径见 docs/26。
CATEGORY_SELECT_BY: dict[str, str] = {
    # 原材料 → 工艺（客户：「原材料是属于工艺去选择的」）
    "YL": SELECT_PROCESS,
    # 耗材 → 只给采购（客户：「第一个仓库耗材，这里只给采购」）
    # 其他外购 → 也只给采购（客户：「第二个先不管吧，隐藏吧」—— 从设计/工艺的选择器隐藏）
    "HC": SELECT_PURCHASE,
    "QT": SELECT_PURCHASE,
    # 定不了的 → 都能看到（客户：「这几个没办法定的，就都能看得到吧」）
    "ZJ": SELECT_ANY,
    "BCP": SELECT_ANY,
    "GLF": SELECT_ANY,
    # 其余 13 个 → 设计（机械/电气的商选件）
    "DQ": SELECT_DESIGN,
    "QD": SELECT_DESIGN,
    "JJ": SELECT_DESIGN,
    "ZC": SELECT_DESIGN,
    "CD": SELECT_DESIGN,
    "DGL": SELECT_DESIGN,
    "DL": SELECT_DESIGN,
    "MJ": SELECT_DESIGN,
    "TCL": SELECT_DESIGN,
    "TYLJ": SELECT_DESIGN,
    "WJ": SELECT_DESIGN,
    "YQYB": SELECT_DESIGN,
    "BZH": SELECT_DESIGN,
}


class StdCategory(Base, TimestampMixin):
    """类别：管理口径（原材料 / 外购标准件 / 电气件…）。"""

    __tablename__ = "std_category"

    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    name: Mapped[str] = mapped_column(String(32))
    seq: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # 谁能在这个品类的料上挂进 BOM / 下单：见上面的 CATEGORY_SELECT_BY。
    # ★ 默认「皆可」而不是「设计」：新导入的品类宁可谁都能看到，也不能静默藏起来。
    select_by: Mapped[str] = mapped_column(String(8), default=SELECT_ANY, server_default=SELECT_ANY)


class StdClass(Base, TimestampMixin):
    """品类：方通 / 导轨 / PLC…（汇总比价层，带规格模板）。"""

    __tablename__ = "std_class"

    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(32))
    category_code: Mapped[str] = mapped_column(ForeignKey("std_category.code"))
    # 规格模板：[{code,name,type,unit,required,options}]，按顺序拼 spec_text
    spec_template: Mapped[list | None] = mapped_column(JSONB)
    seq: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class Item(Base, TimestampMixin):
    """型号（物品）：标准件来自标准库；自制/定制/外协件用图号作 item_no。"""

    __tablename__ = "item"

    item_no: Mapped[str] = mapped_column(String(32), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(200))  # 自动生成，如「方通 Q235 40×40×2.0」
    source_type: Mapped[str] = mapped_column(String(16))
    project_no: Mapped[str | None] = mapped_column(ForeignKey("project.project_no"))
    std_class_code: Mapped[str | None] = mapped_column(ForeignKey("std_class.code"))
    spec: Mapped[dict | None] = mapped_column(JSONB)  # 结构化规格
    spec_text: Mapped[str | None] = mapped_column(String(255))  # 完整规格串（显示/搜索/采购）
    unit: Mapped[str] = mapped_column(String(16), default="件", server_default="件")
    brand: Mapped[str | None] = mapped_column(String(64))
    mfr_model: Mapped[str | None] = mapped_column(String(128))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # ★ 内部来源编号（ERP 等外部系统物料编码）：只用于**重复导入幂等**与交叉核对，
    #   **不出现在任何接口/页面/搜索**（docs/16「只搬数据、不搬编码规则」）。
    legacy_code: Mapped[str | None] = mapped_column(String(64), unique=True)

    __table_args__ = (
        # ★ 归属闸门：非标件必带项目号，标准件必须不带 —— 一条约束同时解决串项与跨项目复用
        CheckConstraint(
            "(source_type = '标准件' AND project_no IS NULL) "
            "OR (source_type <> '标准件' AND project_no IS NOT NULL)",
            name="item_scope",
        ),
    )


def render_spec_text(template: list[dict] | None, spec: dict | None) -> str:
    """按规格模板顺序把结构化规格拼成完整规格串（显示 / 搜索 / 采购都用它）。

    模板字段可带 `group`：同一组的字段拼成「40×40mm」（单位只出现一次），
    例如方通的 截面长/截面宽 归到 group="截面"。
    """
    if not template or not spec:
        return ""
    parts: list[str] = []
    used_groups: set[str] = set()
    for f in template:
        v = spec.get(f.get("code"))
        if v in (None, ""):
            continue
        unit = f.get("unit") or ""
        g = f.get("group")
        if g:
            if g in used_groups:
                continue
            used_groups.add(g)
            members = [x for x in template if x.get("group") == g]
            vals = [str(spec.get(x.get("code"))) for x in members if spec.get(x.get("code")) not in (None, "")]
            parts.append(f"{'×'.join(vals)}{unit}")
        else:
            parts.append(f"{v}{unit}")
    return " · ".join(parts)


def validate_spec(template: list[dict] | None, spec: dict | None) -> None:
    """规格必须完整：模板里 required 的字段一个都不能缺。"""
    if not template:
        return
    spec = spec or {}
    missing = [
        f.get("name") or f.get("code")
        for f in template
        if f.get("required") and spec.get(f.get("code")) in (None, "")
    ]
    if missing:
        raise ValueError(f"规格必须填完整，缺少：{'、'.join(str(m) for m in missing)}")
