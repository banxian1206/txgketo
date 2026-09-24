"""状态词表与派生字段一致性（防"实现跑出了契约里没有的状态"）。

背景：R2-01 引入了到货单状态「现场待验收」，但没同步进 RECEIPT_STATUS 枚举（D2）；
O3-A 的「预计到货日推算」在换货分支上把基准日用错（D1）。两条都在这里钉住。
"""

from datetime import date

import pytest
from fastapi import HTTPException

from app.api.routes.initiation import _resolve_expected
from app.models.initiation import RECEIPT_STATUS, REQUEST_STATUS
from app.models.shipment import SHIP_LOADED, SHIP_SHIPPING, SHIP_STATUS


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
