# -*- coding: utf-8 -*-
"""UI 真实场景测试（2026-09-30）P2 批次护栏：可发现性 / 一致性 / 少误导。

这些都不是“功能没做”，而是“做了但人看不见 / 看错”—— 只有静态钉子最省钱。
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BE = ROOT / "backend" / "app"
FE = ROOT / "frontend" / "src"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _flatten(p: Path) -> str:
    import re

    return re.sub(r"\s+", " ", _read(p))


# ── P2-2 角色下拉要能按中文名搜 ──────────────────────────────────────────
def test_role_selects_search_by_label():
    s = _read(FE / "features" / "admin" / "Page.tsx")
    assert s.count('optionFilterProp="label"') >= 2, "编辑用户 + 列表筛选两处角色下拉都要按 label 搜"


# ── P2-3 新建物料弹窗不许出现 undefined ─────────────────────────────────
def test_library_categories_include_category_code():
    s = _read(BE / "api" / "routes" / "library.py")
    j = s.index('@router.get("/categories")')
    body = s[j : s.index("@router.get", j + 10)]
    assert '"category_code": k.category_code' in body, "标准库品类要带父类别码（否则弹窗显示 undefined-LC-0001）"
    # 弹窗里拼编码时用的是 activeClass.category_code —— 后端给了才不会渲染成 undefined
    lib = _read(FE / "features" / "admin" / "LibraryPage.tsx")
    assert "${activeClass?.category_code}-${activeClass?.code}" in lib


# ── P2-4 评审明细要写人话（别只甩数据库 id） ────────────────────────────
def test_review_items_are_enriched_with_material_detail():
    s = _read(BE / "api" / "routes" / "reviews.py")
    assert "item_detail" in s and "挂在 " in s, "BOM 行要富化出“什么料 × 多少 · 挂在哪个件下”"
    fe = _read(FE / "components" / "ReviewDetailModal.tsx")
    assert "i.item_detail ?? i.item_ref" in fe


# ── P2-6 没权限就别发那个请求（403 噪音） ───────────────────────────────
def test_project_detail_gates_kitting_by_permission():
    s = _flatten(FE / "features" / "project" / "DetailPage.tsx")
    assert "if (hasPerm('mfg:view')) {" in s and "kittingOverview(projectNo)" in s


# ── P2-7 站内消息跳转要带来源（两处入口） ───────────────────────────────
def test_notification_links_carry_from():
    drawer = _read(FE / "components" / "NotificationsDrawer.tsx")
    assert "useGoFrom" in drawer and "go(onMobile" in drawer
    wb = _read(FE / "features" / "workbench" / "Page.tsx")
    assert "if (n.link) go(n.link)" in wb, "我的工作台消息区也要带来源"


# ── P2-8 没拍照就不能勾「已发」 ─────────────────────────────────────────
def test_ship_item_checkbox_disabled_without_photo():
    s = _flatten(FE / "features" / "shipping" / "Page.tsx")
    assert "disabled={!it.shipped && !shipPhotos.length}" in s
    assert "先拍这个件的发货照片" in s


# ── P2-9 长周期件：空库要给出路 ─────────────────────────────────────────
def test_std_item_picker_guides_when_library_empty():
    s = _read(FE / "components" / "InitiationEditors.tsx")
    assert "基础数据 → 标准库" in s, "搜不到时要告诉人去哪建码"


# ── P2-10 报修/备件不许手打项目号、物料号 ───────────────────────────────
def test_service_forms_use_pickers():
    mob = _read(FE / "features" / "service" / "MobilePage.tsx")
    assert 'name="project_no" label="项目"' in mob and "<Select" in mob, "手机端报修项目要下拉"
    pc = _read(FE / "features" / "service" / "Page.tsx")
    assert "<ItemSelect />" in pc, "备件建账的物料要能搜"
