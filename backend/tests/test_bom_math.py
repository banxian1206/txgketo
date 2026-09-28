"""`services/bom_math.py` 纯函数单测（08 卷 §8.1 的 5 行 × 5 通道真值表）。

不需要数据库：传入轻量替身对象即可。故意构造 `qty>1` 的多级树 ——
`qty=1` 时四种错法都会隐身，测不出问题（这正是它们潜伏至今的原因）。
"""

from __future__ import annotations

from types import SimpleNamespace

from app.services.bom_math import (
    bom_line_demand,
    cumulative_qty,
    drawing_demand,
    is_ready,
    scaled_qty,
)


def _d(no, qty=1, parent=None):
    return SimpleNamespace(drawing_no=no, qty=qty, parent_drawing_no=parent)


def _b(qty, parent_ref, child="X"):
    return SimpleNamespace(qty=qty, parent_ref=parent_ref, child_item_no=child)


# 实测用的 BOM 树（08 §8.1 / 99-E2E §2）：
# 总装(1) → body(2) → { cust(3, 定制件) · out(1, 外协件) · 轴承(4, BOM) · 方通(5, BOM) }
def _tree():
    return [
        _d("ASSY", 1, None),
        _d("body", 2, "ASSY"),
        _d("cust", 3, "body"),
        _d("out", 1, "body"),
    ]


class Test累计倍数:
    def test_父子连乘(self):
        cum = cumulative_qty(_tree())
        assert cum["ASSY"] == 1
        assert cum["body"] == 2
        assert cum["cust"] == 6  # 3×2×1
        assert cum["out"] == 2  # 1×2×1

    def test_qty为空按1计(self):
        cum = cumulative_qty([_d("A", None, None), _d("B", 3, "A")])
        assert cum["A"] == 1
        assert cum["B"] == 3

    def test_孤立节点按自身qty(self):
        cum = cumulative_qty([_d("X", 4, None)])
        assert cum["X"] == 4


class Test图纸件需求:
    def test_不再乘自身qty_即不平方(self):
        """★ 回归：`d.qty × cum[d]` 会让 3 变 18；正确应为 cum[d] = 6。"""
        cum = cumulative_qty(_tree())
        assert drawing_demand(_d("cust", 3, "body"), cum) == 6
        assert drawing_demand(_d("out", 1, "body"), cum) == 2
        assert drawing_demand(_d("body", 2, "ASSY"), cum) == 2

    def test_不在树里的图号(self):
        cum = cumulative_qty(_tree())
        assert drawing_demand(_d("ghost", 5), cum) == 1.0


class TestBOM行需求:
    def test_行数量乘父件累计(self):
        cum = cumulative_qty(_tree())
        assert bom_line_demand(_b(4, "body"), cum) == 8  # 轴承 4×2
        assert bom_line_demand(_b(5, "body"), cum) == 10  # 方通 5×2

    def test_三级及以上不只乘一层(self):
        """回归：只乘直接父件（旧 generate_issue 原材料分支）会少领。"""
        drawings = [_d("ASSY", 1, None), _d("body", 2, "ASSY"), _d("part", 3, "body")]
        cum = cumulative_qty(drawings)
        # 材料挂在 part 下，行数量 5 → 5 × cum[part]=6 = 30（不是 5×3=15）
        assert bom_line_demand(_b(5, "part"), cum) == 30

    def test_scaled_qty_用于发布批次条目(self):
        cum = cumulative_qty(_tree())
        assert scaled_qty(4, "body", cum) == 8
        assert scaled_qty(None, "body", cum) == 0


class Test比例性:
    def test_qty1与qty大于1成比例(self):
        """qty=1 时四种错法隐身；这里保证口径本身是成比例的。"""
        one = cumulative_qty([_d("A", 1), _d("B", 1, "A"), _d("C", 1, "B")])
        multi = cumulative_qty([_d("A", 1), _d("B", 2, "A"), _d("C", 3, "B")])
        assert one["C"] == 1
        assert multi["C"] == 6


class Test到位判定:
    def test_够就是够(self):
        assert is_ready(5, 5) is True
        assert is_ready(6, 5) is True

    def test_不够就是不够_不能一有就算到位(self):
        """★ 回归 kitting「库存>0 即 ready」：需 5 有 1 必须 False。"""
        assert is_ready(1, 5) is False
        assert is_ready(0, 5) is False

    def test_浮点容差(self):
        assert is_ready(0.1 + 0.2, 0.3) is True
