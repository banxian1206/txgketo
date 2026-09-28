"""净需求抵扣（`bom_demand._cover` 与覆盖状态分组）单测 —— 08 卷 §8.2。

`_cover` 是纯函数（收一个「已抵扣量」字典），不需要数据库。
DB 侧的真实场景（直发/待入库/已入库+领走）由 `scripts/e2e_baseline.py` 的 BM-03~07 兜。
"""

from __future__ import annotations

from app.services.bom_demand import COVER_STATUS, OPEN_STATUS, DemandLine, _cover


def _line(item: str, qty: float, part: str | None = None) -> DemandLine:
    return DemandLine(item_no=item, part_no=part, qty=qty, unit="个")


class Test覆盖状态分组:
    def test_直发件必须进抵消(self):
        """回归 08 §8.2 场景 A：直发件从不进库存，只靠状态抵扣。"""
        assert "现场已验收" in COVER_STATUS
        assert "现场待验收" in OPEN_STATUS

    def test_死值已下单不在分组里(self):
        assert "已下单" not in COVER_STATUS

    def test_已入库不重复计(self):
        """已入库的量已由「可用库存 + 已领到车间」覆盖，不应在状态抵扣里再列一次。"""
        assert "已入库" not in COVER_STATUS

    def test_取消与退货不抵扣(self):
        assert "已取消" not in COVER_STATUS
        assert "已退货" not in COVER_STATUS


class Test净需求分摊:
    def test_部分抵扣(self):
        plan, stats = _cover([_line("A", 10)], {"A": 6})
        assert len(plan) == 1
        assert plan[0][0].item_no == "A"
        assert plan[0][1] == 4
        assert stats["covered_qty"] == 6

    def test_全额抵扣(self):
        plan, stats = _cover([_line("A", 10)], {"A": 10})
        assert plan == []
        assert stats["buy_qty"] == 0
        assert stats["covered_qty"] == 10

    def test_数量大的行先抵消(self):
        """同物料多行时按数量降序分摊，保证总数正确且可复现。"""
        plan, _ = _cover([_line("A", 6, "P1"), _line("A", 4, "P2")], {"A": 3})
        residuals = {p.part_no: q for p, q in plan}
        assert residuals == {"P1": 3, "P2": 4}

    def test_无覆盖则原样(self):
        plan, _ = _cover([_line("A", 5)], {})
        assert sum(q for _, q in plan) == 5

    def test_覆盖超过需求不产生负数(self):
        plan, stats = _cover([_line("A", 5)], {"A": 100})
        assert plan == []
        assert stats["buy_qty"] == 0

    def test_多物料各自抵扣(self):
        plan, _ = _cover([_line("A", 10), _line("B", 8)], {"A": 10, "B": 3})
        residuals = {p.item_no: q for p, q in plan}
        assert residuals == {"B": 5}
