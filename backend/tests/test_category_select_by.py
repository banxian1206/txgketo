"""挂料按职责收口（2026-10-07 客户口径）—— 护栏。

客户原话：
> 「作为机械设计师，他不会去选择原材料，只会选择那些商选件（比如马达、电机）。
>   原材料是属于工艺去选择的……我们是不是可以分个类，把哪些东西可以让他选、
>   哪些东西不可以让他选？」
> 「车间仓库耗材这里只给采购。」「其他外购先不管，隐藏吧。」

三条最容易弄错的：
① **「采购」这个取值的语义是"对设计/工艺隐藏"，不是"只有采购看得到"**
   —— 采购挂料/下单是**全量**（客户：「我在这个标准里面去买的时候，照样能买」）。
   如果谁把它写成 `in_([采购, 皆可])`，采购就买不到原材料了，而且没人会发现。
② 分类必须**可重复**：`e2e:clean` + `seed` 之后不能丢（否则退回"谁都能选到一切"）。
③ 归属是**数据**不是代码：改一个品类的归属不改代码。
"""

from __future__ import annotations

import inspect
from pathlib import Path

from app.api.routes import library as lib_routes
from app.models.library import (
    CATEGORY_SELECT_BY,
    SELECT_ANY,
    SELECT_DESIGN,
    SELECT_PROCESS,
    SELECT_PURCHASE,
    StdCategory,
)

# ── ① 取值契约 ────────────────────────────────────────────────────────────


def test_select_by_values_are_a_contract():
    """只有 4 个取值；模型列宽够放（String(8)）。"""
    assert {SELECT_DESIGN, SELECT_PROCESS, SELECT_PURCHASE, SELECT_ANY} == {
        "设计",
        "工艺",
        "采购",
        "皆可",
    }
    assert all(len(v) <= 8 for v in (SELECT_DESIGN, SELECT_PROCESS, SELECT_PURCHASE, SELECT_ANY))
    assert StdCategory.__table__.c.select_by.type.length == 8


def test_default_is_any_not_design():
    """默认必须是「皆可」——新导入的品类宁可谁都能看到，也不能静默藏起来。"""
    col = StdCategory.__table__.c.select_by
    assert col.server_default is not None
    assert SELECT_ANY in str(col.server_default.arg)


# ── ② 归属表（本次落值，与迁移一致）───────────────────────────────────────


def test_category_mapping_matches_the_agreed_classification():
    """19 个类别一个不少，且关键归属正确（客户逐条确认过）。"""
    assert CATEGORY_SELECT_BY["YL"] == SELECT_PROCESS, "原材料必须归工艺"
    assert CATEGORY_SELECT_BY["HC"] == SELECT_PURCHASE, "车间仓库耗材只给采购"
    assert CATEGORY_SELECT_BY["QT"] == SELECT_PURCHASE, "其他外购对设计/工艺隐藏"
    for code in ("ZJ", "BCP", "GLF"):
        assert CATEGORY_SELECT_BY[code] == SELECT_ANY, f"{code} 是「定不了的」→ 皆可"
    # 机械/电气的商选件归设计
    for code in ("DL", "DQ", "QD", "DGL", "ZC", "CD", "JJ"):
        assert CATEGORY_SELECT_BY[code] == SELECT_DESIGN, f"{code} 应归设计"
    assert len(CATEGORY_SELECT_BY) == 19, "19 个类别都要有归属（含 ERP 导入进来的）"


def test_migration_carries_the_same_mapping():
    """迁移里的落值不能和归属表漂移（否则新库与老库分类不一致）。"""
    mig = (
        Path(__file__).resolve().parents[1]
        / "alembic/versions/e5f6a7b8c9d0_std_category_select_by.py"
    ).read_text(encoding="utf-8")
    for code in CATEGORY_SELECT_BY:
        assert f'"{code}"' in mig, f"迁移漏了类别 {code}"


# ── ③ 「采购」不过滤 + 设计/工艺各自收口 ──────────────────────────────────


def test_purchase_is_not_a_filter():
    """★ 采购（与不传）必须是**全量** —— 不是 in_([采购, 皆可])。"""
    allowed = lib_routes._PICK_ALLOWED
    assert "purchase" not in allowed, "采购被写成了过滤条件 —— 采购会买不到原材料"
    assert allowed["design"] == (SELECT_DESIGN, SELECT_ANY)
    assert allowed["process"] == (SELECT_PROCESS, SELECT_ANY)
    # 真比 SQL：未传 / purchase → 语句原样（不加 where）；design → 加上品类收口
    from sqlalchemy import select

    from app.models.library import Item

    stmt = select(Item)
    assert str(lib_routes._apply_pick_for(stmt, None)) == str(stmt), "未传 pick_for 却改了语句"
    assert str(lib_routes._apply_pick_for(stmt, "purchase")) == str(stmt), "采购被过滤了 —— 会买不到原材料"
    assert "std_class" in str(lib_routes._apply_pick_for(stmt, "design")), "design 没收口"


def test_both_pickers_apply_the_filter():
    """/items（候选搜索）与 /items/page（台账）**都要**收口，少一个就是漏。"""
    for fn in (lib_routes.list_items, lib_routes.list_items_paged):
        assert "_apply_pick_for" in inspect.getsource(fn), f"{fn.__name__} 漏了收口"


def test_frontend_has_the_two_separate_pickers():
    """设计 BOM 与材料 BOM 必须是**两个列表**（以前共用一个 items → 一个列表没法服务两种职责）。"""
    fe = Path(__file__).resolve().parents[2] / "frontend/src"
    page = (fe / "features/design/Page.tsx").read_text(encoding="utf-8")
    assert "pick_for: 'design'" in page, "设计 BOM 没传 pick_for=design"
    assert "pick_for: 'process'" in page, "材料 BOM 没传 pick_for=process"
    modals = (fe / "components/design/DrawingsModals.tsx").read_text(encoding="utf-8")
    assert "显示全部物料" in modals, "缺「显示全部物料」兜底（客户同意允许 + 提示）"


# ── ④ 分类可重复（复位后不丢）─────────────────────────────────────────────


def test_seed_reapplies_the_mapping():
    """`seed` 每次重应用归属 —— 否则 e2e:clean+seed 之后分类就丢了。"""
    seed = (Path(__file__).resolve().parents[1] / "scripts/seed.py").read_text(encoding="utf-8")
    assert "CATEGORY_SELECT_BY" in seed
    assert "row.select_by = want" in seed, "seed 没有把归属写回"
