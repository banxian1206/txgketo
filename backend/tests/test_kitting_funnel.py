# -*- coding: utf-8 -*-
"""G5 多视角齐套率 —— 项目漏斗分格护栏（09 卷 §3-G5，2026-09-28）。

客户口径：
  “其他人基本上都是按照项目去看齐套情况的…比如整个项目我要买 200 个零件：
   是还没有买，还是在途，还是验收已入库，还是说**已经做成了成品（即组装件）**？”
"""
from __future__ import annotations

from app.services.kitting import (
    FUNNEL_BUY,
    FUNNEL_ISSUED,
    FUNNEL_STATES,
    FUNNEL_STORED,
    FUNNEL_TRANSIT,
    _bucket,
)


def _line(*, ready=False, issued_qty=0.0, qty=10.0, state="在途"):
    return {"ready": ready, "issued_qty": issued_qty, "qty": qty, "state": state}


def test_funnel_has_the_five_client_states():
    """★ 5 个态就是客户点名的口径（含「已做成成品」）。"""
    assert FUNNEL_STATES == ("未买", "在途", "验收已入库", "已领料", "已做成成品")


def test_not_bought_yet_states():
    for st in ("未采购", "未到", "未排产", "未发出"):
        assert _bucket(_line(state=st)) == FUNNEL_BUY


def test_in_transit_is_default_for_ordered_not_arrived():
    for st in ("在途", "已下单在途", "待入库", "部分到货", "有 3"):
        assert _bucket(_line(state=st)) == FUNNEL_TRANSIT


def test_arrived_but_not_issued_is_stored():
    assert _bucket(_line(ready=True, state="已入库")) == FUNNEL_STORED


def test_fully_issued_counts_as_issued_not_stored():
    """★ 已领到车间的料算「已领料」，不再算「已入库」（客户要能看到这一态）。"""
    assert _bucket(_line(ready=True, issued_qty=10.0, qty=10.0)) == FUNNEL_ISSUED


def test_partially_issued_still_counts_as_stored():
    """只领了一部分 → 还留在「已入库」（不算领完）。"""
    assert _bucket(_line(ready=True, issued_qty=4.0, qty=10.0)) == FUNNEL_STORED


def test_not_ready_but_partially_issued_is_transit():
    assert _bucket(_line(ready=False, issued_qty=4.0, qty=10.0, state="在途")) == FUNNEL_TRANSIT
