"""BOM 数量口径的**唯一出处**（《08 采购域重构》§8 · AGENTS §8.5 教训）。

同一个「这个零件在整机上要几个」只允许在这里算一套。目前六处共用：

  ① 发布进池   `bom_demand.release_demand`
  ② 手动补跑   `bom_demand.equipment_demand`
  ③ 排产       `manufacturing.generate_orders`
  ④ 齐套率     `kitting.compute`
  ⑤ 领料       `warehouse.generate_issue`
  ⑥ 发运清单   `shipping.generate_items`

**为什么要有这个文件（实测教训）**：`qty>1` 的多级结构下，六处曾各自算出不同答案 ——
  · `equipment_demand` 图纸分支：`d.qty × cum[d]` → **qty²**（3 算成 18）
  · `kitting`：完全不乘父级 → 一律少一半
  · `generate_issue` 标准件分支：完全不乘；原材料分支：只乘直接父件一层
而 `qty=1` 时全部隐身（`1²=1`、`1×n=n`），所以潜伏至今。
详见 `docs/99-E2E测试报告-2026-09-28-采购域重构前基线.md` §2、`docs/08-采购域重构方案.md` §8.1。
"""

from __future__ import annotations

from app.models.engineering import BomItem, Drawing


def cumulative_qty(drawings: list[Drawing]) -> dict[str, float]:
    """图纸在整机上的累计倍数：父子 qty 连乘。

    `cum[X] = X.qty × cum[X.parent]`，即「X 这个节点自己在整台设备上要几个」。
    例：总装(qty=1) → 组件(qty=2) → 零件(qty=3)，则 `cum[零件] = 3×2×1 = 6`。
    `qty` 为空按 1 计（与既有行为一致）。
    """
    by_no = {d.drawing_no: d for d in drawings}
    cache: dict[str, float] = {}

    def calc(no: str, seen: frozenset[str]) -> float:
        if no in cache:
            return cache[no]
        d = by_no.get(no)
        if d is None or no in seen:  # 不在树里 / 成环（层次码结构上不可能，防御性）
            return 1.0
        q = float(d.qty or 1)
        parent = d.parent_drawing_no
        if parent and parent in by_no:
            q *= calc(parent, seen | {no})
        cache[no] = q
        return q

    for d in drawings:
        calc(d.drawing_no, frozenset())
    return cache


def drawing_demand(drawing: Drawing, cum: dict[str, float]) -> float:
    """一个图号件（自制 / 外协 / 定制 / 标准）在整机上的真实需求 = 它的累计倍数。

    ★ 不要再乘一次 `drawing.qty` —— `cum` 里已经含了自身 qty，再乘就是 qty²。
    """
    return float(cum.get(drawing.drawing_no, 1.0))


def scaled_qty(qty: float | None, parent_ref: str | None, cum: dict[str, float]) -> float:
    """数量 × 父件累计倍数（父件在整机上要几个）。BOM 行与发布批次条目共用。"""
    return float(qty or 0) * float(cum.get(parent_ref, 1.0))


def bom_line_demand(bom_row: BomItem, cum: dict[str, float]) -> float:
    """一条 BOM 行的真实需求 = 行数量 × 父件累计倍数。"""
    return scaled_qty(bom_row.qty, bom_row.parent_ref, cum)


def is_ready(have: float, need: float) -> bool:
    """通用「到位」判定：手上（库存 + 已领到车间）≥ 需求。带浮点容差。"""
    return float(have or 0) + 1e-9 >= float(need or 0)
