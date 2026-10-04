# -*- coding: utf-8 -*-
"""UI 真实场景测试（2026-09-30）中的 P1-7 / P1-8 护栏。

P1-7 生成领料单不幂等：同一设备连点两次 → 两张一模一样的单（MI26001 + MI26002），
     库存只有一份 → 第二张永远备不齐，还占着「待领料」待办。

P1-8 叶子/材料完整性口径：挂了标准件的自制件曾被当成“非叶子”，
     既不计入零件数，也不再被“自制件必须配原材料”检查 —— 工艺漏配材料从此隐形。
"""
from __future__ import annotations

from pathlib import Path

from app.api.routes.engineering import split_components_parts

ROOT = Path(__file__).resolve().parents[2]
BE = ROOT / "backend" / "app"

ROOT_NO = "TX26001-01A-00-00-00-00"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── P1-8：组件/零件切分 ───────────────────────────────────────────────
def test_root_assembly_is_neither_component_nor_part():
    comps, parts = split_components_parts([(ROOT_NO, None)], ROOT_NO)
    assert comps == set() and parts == set(), "设备总装图是设备本身，不算零件/组件"


def test_leaf_parts_include_those_carrying_standard_items():
    """★ 这条红了 = 挂了标准件的自制件又会从零件数/材料检查里消失（P1-8 回归）。"""
    rows = [
        (ROOT_NO, None),
        ("TX26001-01A-01-00-00-00", ROOT_NO),                 # 机架组件
        ("TX26001-01A-01-01-00-00", "TX26001-01A-01-00-00-00"),  # 机架框架（挂着标准件）
        ("TX26001-01A-01-02-00-00", "TX26001-01A-01-00-00-00"),  # 导轨安装板
        ("TX26001-01A-02-01-00-00", ROOT_NO),                 # 气缸支座（外协）
    ]
    comps, parts = split_components_parts(rows, ROOT_NO)
    assert comps == {"TX26001-01A-01-00-00-00"}
    assert parts == {
        "TX26001-01A-01-01-00-00",
        "TX26001-01A-01-02-00-00",
        "TX26001-01A-02-01-00-00",
    }


def test_both_design_views_share_one_rule():
    """设计详情页与设备列表页必须用同一个口径函数（否则两屏数字会漂）。"""
    src = _read(BE / "api" / "routes" / "engineering.py")
    assert src.count("split_components_parts(") >= 3, "两处调用 + 1 处定义"
    assert "children.get(d.drawing_no, 0) == 0 and d.drawing_no not in refs" not in src, "旧口径要清掉"


def test_parts_without_material_covers_self_made_leaves():
    import re as _re

    src = _re.sub(r"\s+", " ", _read(BE / "api" / "routes" / "engineering.py"))
    assert 'parts_without_material = [ p["drawing_no"] for p in leaves if p["source_type"] == "自制件"' in src


# ── P1-7：领料单幂等 ─────────────────────────────────────────────────
def test_generate_issue_reuses_open_sheet():
    src = _read(BE / "api" / "routes" / "warehouse.py")
    j = src.index("def generate_issue(")
    body = src[j : src.index("@router.post", j + 10)]
    assert "open_issue" in body and "ISSUE_DRAFT, ISSUE_PICKED, ISSUE_PARTIAL" in body, "未结的单要复用"
    assert '"reused"' in body and "reuse_hint" in body, "要告诉前端“用的是哪张、不是新建”"


def test_frontend_shows_reuse_instead_of_fake_success():
    s = _read(ROOT / "frontend" / "src" / "features" / "warehouse" / "Page.tsx")
    assert "if (r.reused)" in s, "复用时不能再提示“已生成领料单”（会让人以为建了第二张）"


# ── 走查 2026-10-04：设计面 BOM 行必须按【设备】收口 ─────────────────────
def test_design_tree_bom_rows_are_scoped_to_equipment():
    """`get_design_tree` 取 BOM 行只按 project_no → 同型第二台（01B）出现后，
    01A/01B 的设计面互相看到对方的标准件/材料（计数翻倍、列表重复，误导设计/采购）。
    修法：`BomItem.parent_ref.in_(本设备图纸集合)`。
    """
    s = _read(BE / "api" / "routes" / "engineering.py")
    j = s.index("def get_design_tree")
    body = s[j : s.index("\nclass DrawingIn", j)]
    assert "BomItem.parent_ref.in_(" in body, "设计面取 BOM 行必须按本设备图纸收口"
    assert "select(BomItem).where(BomItem.project_no == project_no)).all()" not in body, (
        "又回到只按 project_no 取整个项目的 BOM 行（同型设备会互相串项）"
    )
