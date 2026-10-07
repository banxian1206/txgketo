"""价格库台账（2026-10-07 客户口径）—— 护栏。

三个要防的：
① **口径不能漂**：`可比价 / 可放心推荐` 的阈值必须是 `pricing` 里那两个常量，
   且推荐服务用的是同一套 —— 前端拿到的是接口下发的 `thresholds`，不在前端写数字。
② **只读 + 金额分档**：三个接口一个写操作都没有，且都要 `purchase:price`（铁律 N23）。
③ **导入权限提上来了**：`import-history` 从 `purchase:edit`（采购员）改成
   `price:import`（只有采购经理）—— 价格库是公司级主数据，采购员不该能改。
"""

from __future__ import annotations

import inspect

from app.api.routes import suppliers
from app.services import pricing


# ── ① 阈值单一口径 ────────────────────────────────────────────────────────


def test_thresholds_are_the_single_source():
    assert pricing.MIN_COMPARABLE >= 2
    assert pricing.MIN_RECOMMENDABLE >= pricing.MIN_COMPARABLE


def test_thresholds_are_published_to_frontend():
    """前端不许自己写 3 / 2 —— 必须从 stats 接口拿 `thresholds`。"""
    src = inspect.getsource(pricing.stats)
    assert '"thresholds"' in src, "stats 没下发 thresholds（前端会各写一份数字）"


def test_page_does_not_hardcode_comparable_threshold():
    """价格库页的前端代码里不许出现 ≥3 家 / ≥2 家的硬数字。"""
    from pathlib import Path

    page = (
        Path(__file__).resolve().parents[2]
        / "frontend/src/features/admin/PriceLibraryPage.tsx"
    )
    src = page.read_text(encoding="utf-8")
    for bad in (">= 3", "≥3", ">= 2 家", "≥2 家", "recommendable ? '3'"):
        assert bad not in src, f"价格库页把比价阈值写死了：{bad}（要从 stats.thresholds 读）"


# ── ② 只读 + 金额分档 ────────────────────────────────────────────────────


def test_price_library_endpoints_are_read_only():
    """三个价格库接口全是 GET（台账/浏览不许写）。"""
    for fn in (suppliers.price_library_stats, suppliers.price_library_items, suppliers.price_library_by_item):
        src = inspect.getsource(fn)
        assert "@router.post" not in src
        assert "@router.delete" not in src
        assert "@router.put" not in src
        assert "@router.patch" not in src


def test_price_library_requires_price_permission():
    """没有 purchase:price 一律 403（不是返回 0 / 空表 —— 铁律 N23 金额分档）。"""
    for fn in (suppliers.price_library_stats, suppliers.price_library_items, suppliers.price_library_by_item):
        src = inspect.getsource(fn)
        assert 'require_permission("purchase:price")' in src, f"{fn.__name__} 少了金额分档"


# ── ③ 导入权限提上来了 ────────────────────────────────────────────────────


def test_import_history_requires_price_import_not_purchase_edit():
    """历史导入必须用 price:import（采购员 purchase:edit 不该能改公司级价格库）。"""
    src = inspect.getsource(suppliers.import_purchase_history)
    assert 'require_permission("price:import")' in src
    assert 'require_permission("purchase:edit")' not in src


def test_price_import_permission_exists_in_seed():
    """新权限码必须在 seed 的 PERMISSIONS 里登记，且只给采购经理。"""
    from pathlib import Path

    seed = (Path(__file__).resolve().parents[1] / "scripts/seed.py").read_text(encoding="utf-8")
    assert '("price:import"' in seed, "price:import 没在 PERMISSIONS 里登记"
    # 只给 PURCHASE_LEAD（采购经理）
    line = next(x for x in seed.splitlines() if '"PURCHASE_LEAD"' in x and "price:import" in x)
    assert '"PURCHASE"' not in line.replace('"PURCHASE_LEAD"', ""), "price:import 不该给采购员 PURCHASE"
