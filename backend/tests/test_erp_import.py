# -*- coding: utf-8 -*-
"""ERP 历史数据导入 护栏（`docs/16-ERP历史数据导入方案.md`）。

要点：
  · 品类/类别映射表**完整且码不重复**（`std_class.code` 是主键，重码会直接写崩）；
  · 路径解析覆盖 2/3/4 级；
  · 价格取「含税折后价」优先，并正确打 `tax_incl`；
  · 读表头/数值/日期/截断这些纯函数行为固定。

不依赖数据库、不依赖 `xlrd`（`.csv` 路径走零依赖读取器）。
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from app.services.erp_legacy_map import (
    CATEGORY_MAP,
    CLASS_MAP,
    class_of,
    split_erp_category,
    supplier_kind,
)
from scripts import import_erp_legacy as imp


# ── 映射表完整性 ────────────────────────────────────────────────────────────
class Test映射表:
    def test_品类码全局唯一(self):
        codes = [c for _cat, c, _name in CLASS_MAP.values()]
        assert len(codes) == len(set(codes)), "品类码有重复（std_class.code 是主键）"

    def test_每个品类都指向已声明的类别(self):
        declared = set(CATEGORY_MAP.values())  # (cat_code, name) 集合
        cat_codes = {c for c, _ in declared}
        for cat, _cls, _name in CLASS_MAP.values():
            assert cat in cat_codes, f"品类挂在未声明的类别 {cat}"

    def test_码长合约束(self):
        for cat, _name in CATEGORY_MAP.values():
            assert 0 < len(cat) <= 8  # std_category.code String(8)
        for _cat, cls, _name in CLASS_MAP.values():
            assert 0 < len(cls) <= 16  # std_class.code String(16)
            assert "TX" not in cls

    def test_映射表规模(self):
        # 实测 139 个 (二级,三级) 组合；改动映射表时这里会提醒复核
        assert len(CLASS_MAP) == 139
        assert len({c for c, _ in CATEGORY_MAP.values()}) == 19

    def test_重用既有品类的码(self):
        # 伺服/气缸/螺丝/轴承 与既有 17 个品类同名 → 必须复用其码
        assert CLASS_MAP[("电气材料", "伺服")][1] == "SF"
        assert CLASS_MAP[("气动元件", "气缸")][1] == "QG"
        assert CLASS_MAP[("紧固件/连接件", "螺丝")][1] == "LS"
        assert CLASS_MAP[("轴承及配件", "轴承")][1] == "ZCT"


class Test路径解析:
    @pytest.mark.parametrize(
        "path,expect",
        [
            ("物料->原材料类->钢材", ("原材料类", "钢材")),
            ("车间/仓库耗材类->生产用品类", ("车间/仓库耗材类", "生产用品类")),
            ("标准化类->通用零件->链轮->链轮", ("通用零件", "链轮")),
            ("物料->其他->附图", ("其他", "附图")),
            ("", ("(空)", "(空)")),
        ],
    )
    def test_split(self, path, expect):
        assert split_erp_category(path) == expect

    def test_class_of_known_and_unknown(self):
        assert class_of("物料->原材料类->钢材") == ("YL", "GC", "钢材")
        assert class_of("物料->不存在->不存在") is None


class Test供应商分类:
    @pytest.mark.parametrize(
        "erp,ours",
        [
            ("机加工类", "机加工"), ("原材料", "原材料"), ("机械标准件", "标准件"),
            ("气动·真空类", "气动"), ("电气控制类", "电气"),
            ("辅材类", "其他"), ("耗材类", "其他"), ("没见过", "其他"), ("", "其他"),
        ],
    )
    def test_kind(self, erp, ours):
        assert supplier_kind(erp) == ours


# ── 纯函数 ──────────────────────────────────────────────────────────────────
class Test价格取值:
    def _row(self, **kw):
        names = [imp.D_TAX_FINAL, imp.D_TAX, imp.D_TAX_LIST, imp.D_FINAL, imp.D_LIST]
        row = [""] * len(names)
        for n, v in kw.items():
            row[names.index(n)] = v
        return row, {n: i for i, n in enumerate(names)}

    def test_优先含税折后价(self):
        row, idx = self._row(**{imp.D_TAX_FINAL: 70, imp.D_TAX: 80, imp.D_LIST: 61.9})
        assert imp._pick_price(row, idx) == (70.0, True)

    def test_回退到含税单价(self):
        row, idx = self._row(**{imp.D_TAX_LIST: 88})
        assert imp._pick_price(row, idx) == (88.0, True)

    def test_只给不含税价时标false(self):
        row, idx = self._row(**{imp.D_LIST: 61.947})
        assert imp._pick_price(row, idx) == (61.95, False)  # Numeric(14,2) 四舍五入

    def test_金额归一到两位(self):
        assert imp._money(61.944) == 61.94
        assert imp._money(139.823) == 139.82

    def test_全空为0(self):
        row, idx = self._row()
        assert imp._pick_price(row, idx) == (0.0, True)


class Test数值与日期:
    def test_to_num_去符号逗号(self):
        assert imp.to_num("￥1,234.50") == 1234.5
        assert imp.to_num("") == 0.0
        assert imp.to_num("abc") == 0.0

    def test_to_date_excel序列号(self):
        assert imp.to_date(46301.0) == date(2026, 10, 6)
        assert imp.to_date("2026-09-29") == date(2026, 9, 29)
        assert imp.to_date("") is None

    def test_trunc(self):
        assert imp.trunc("abc", 5) == "abc"
        assert len(imp.trunc("x" * 10, 5)) == 5
        assert imp.trunc("x" * 10, 5).endswith("…")


class Test读表:
    def test_iter_rows_csv(self, tmp_path: Path):
        p = tmp_path / "x.csv"
        p.write_text("产品编号,产品名称\nA1,螺丝\nA2,螺母\n", encoding="utf-8")
        rows = list(imp.iter_rows(p))
        assert len(rows) == 2
        idx, row = rows[0]
        assert imp.cell(row, idx, "产品编号") == "A1"

    def test_cell_缺失列给默认值(self):
        assert imp.cell(["x"], {"a": 0}, "nope") == ""
