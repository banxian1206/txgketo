"""状态词表与派生字段一致性（防"实现跑出了契约里没有的状态"）。

背景：R2-01 引入了到货单状态「现场待验收」，但没同步进 RECEIPT_STATUS 枚举（D2）；
O3-A 的「预计到货日推算」在换货分支上把基准日用错（D1）。两条都在这里钉住。
"""

from datetime import date
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.api.routes.initiation import _resolve_expected
from app.models.initiation import RECEIPT_STATUS, REQUEST_STATUS
from app.models.shipment import SHIP_LOADED, SHIP_SHIPPING, SHIP_STATUS

# 扫代码用：backend/app
_APP = Path(__file__).resolve().parents[1] / "app"


class Test状态枚举完整性:
    def test_到货单枚举含现场待验收(self):
        """直发件下单即建的到货单状态必须在枚举内（曾经缺，D2）"""
        assert "现场待验收" in RECEIPT_STATUS

    def test_到货单状态与需求状态不串线(self):
        """到货单只用 RECEIPT_STATUS；现场相关两个状态两边同名，避免同义词漂移"""
        assert "现场已验收" in RECEIPT_STATUS and "现场已验收" in REQUEST_STATUS

    def test_发运状态顺序符合s7原序(self):
        """勾已发 → 装车 → 发运：枚举里 已装车 必须排在 发货中 之后（流程位置可核对）"""
        assert SHIP_STATUS.index(SHIP_SHIPPING) < SHIP_STATUS.index(SHIP_LOADED)


class Test预计到货日推算:
    def test_下单_按下单日加周期(self):
        assert _resolve_expected(None, date(2026, 9, 1), 30) == date(2026, 10, 1)

    def test_换货_按基准日加周期(self):
        """换货没有新的下单日，基准日（今天）+ 周期也要能推出来（曾经误报 400，D1）"""
        assert _resolve_expected(None, None, 30, base=date(2026, 9, 24)) == date(2026, 10, 24)

    def test_手填优先于推算(self):
        assert _resolve_expected(date(2026, 10, 5), date(2026, 9, 1), 30) == date(2026, 10, 5)

    def test_既无日期也无周期才报错(self):
        with pytest.raises(HTTPException) as e:
            _resolve_expected(None, None, None)
        assert e.value.status_code == 400
        assert "预计到货" in e.value.detail


class Test状态字面量护栏:
    """拦住「实现跑出契约里没有的状态」——P3-17/P3-18 的教训。

    旧版只断言「枚举里有没有某个值」（方向反了，拦不住代码里写了枚举之外的字面量）。
    """

    def test_不再出现死状态已下单(self):
        """AGENTS §8.1 / 99 审计 P3-17：'已下单' 旧中间态已废弃（迁移 e9c06543ffaa）。"""
        bad = [
            str(p.relative_to(_APP.parent))
            for p in _APP.rglob("*.py")
            if '"已下单"' in p.read_text(encoding="utf-8")
            or "'已下单'" in p.read_text(encoding="utf-8")
        ]
        assert bad == [], f"发现死状态字面量「已下单」：{bad}"

    def test_到货判定状态都是合法需求状态(self):
        """P3-18：ARRIVED_STATUS 曾含非法值「已完成」、缺合法值。"""
        from app.services.kitting import ARRIVED_STATUS

        for v in ARRIVED_STATUS:
            assert v in REQUEST_STATUS, f"ARRIVED_STATUS 含非法需求状态：{v}"

    def test_直发件在到货判定里(self):
        """P3-18：缺「现场已验收」会让直发件齐套率永远判「未采购」。"""
        from app.services.kitting import ARRIVED_STATUS

        assert "现场已验收" in ARRIVED_STATUS
        assert "已完成" not in ARRIVED_STATUS

    def test_净需求覆盖状态都是合法需求状态(self):
        from app.services.bom_demand import COVER_STATUS

        for v in COVER_STATUS:
            assert v in REQUEST_STATUS, f"COVER_STATUS 含非法需求状态：{v}"
        assert "现场已验收" in COVER_STATUS  # 直发件必须抵扣（08 §8.2 场景 A）

    def test_领料部分状态在契约内(self):
        from app.models.warehouse import ISSUE_PARTIAL, ISSUE_STATUS

        assert ISSUE_PARTIAL in ISSUE_STATUS


class Test需求来源词表:
    def test_所有SOURCE常量都在REQUEST_SOURCES里(self):
        """N17：`REQUEST_SOURCES` 必须收全所有 `SOURCE_*`（以前写死 3 个值、漂移了）。"""
        import app.models.initiation as m

        sources = {
            v for k, v in vars(m).items() if k.startswith("SOURCE_") and isinstance(v, str)
        }
        assert sources, "没有找到 SOURCE_* 常量"
        missing = sources - set(m.REQUEST_SOURCES)
        assert missing == set(), f"这些 SOURCE_* 不在 REQUEST_SOURCES 里：{missing}"
