# -*- coding: utf-8 -*-
"""§2.2 发货指令跨部门（采购叫车 + 发货日）护栏 —— 09 卷 §2.2，2026-09-28。

客户口径：
  “PM 发出指令需要**叫车服务**，**采购**就去采购车辆回来，**发运**就开始装车并进行交付。
   这相当于是一条指令，但是**指挥了两个部门**的人在干事情。
   同时这个指令也是需要有**时间**的：PM 定一个发货时间（如定在十几号）→ 采购按这个时间
   **当天**把车采购回来 → **装货的人就知道当天需要装几车**。”
  车辆服务**不进价格库**（地方/车型/时间不同价格必不同），只填本次价格。
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BE = ROOT / "backend" / "app"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _code(p: Path) -> str:
    return "\n".join(
        ln for ln in _read(p).splitlines() if not ln.strip().startswith("#")
    )


def test_vehicle_status_word_table():
    """叫车状态必须是具名词表（状态枚举 = 契约，别裸写字符串）。"""
    from app.models.shipment import VEHICLE_PENDING, VEHICLE_READY, VEHICLE_STATUS

    assert VEHICLE_STATUS == (VEHICLE_PENDING, VEHICLE_READY)
    assert (VEHICLE_PENDING, VEHICLE_READY) == ("待叫车", "已叫车")


def test_load_is_gated_by_vehicle_ready():
    """★ 装车必须先叫车 —— 否则“一条指令指挥两个部门”就是空话（采购可被绕过）。"""
    src = _code(BE / "services" / "shipping.py")
    i = src.index("def load(")
    seg = src[i : i + 1400]
    assert "vehicle_status != VEHICLE_READY" in seg, "load() 里必须有“采购还没叫车”的硬拦"


def test_request_vehicle_is_purchase_duty_and_needs_count():
    """叫车是采购的活（purchase:edit），且必须填几车（装货的人要知道当天几车）。"""
    src = _code(BE / "api" / "routes" / "shipping.py")
    i = src.index('"/{ship_id}/request-vehicle"')
    seg = src[i : i + 700]
    assert 'require_permission("purchase:edit")' in seg, "叫车必须是采购（purchase:edit），不是发运/项目"
    svc = _code(BE / "services" / "shipping.py")
    j = svc.index("def request_vehicle(")
    body = svc[j : j + 900]
    assert "要填几辆车" in body, "count 必填"
    for closed in ("SHIP_TRANSIT", "SHIP_ARRIVED", "SHIP_SIGNED"):
        assert closed in body, f"终态（{closed}）不能再改车辆安排"


def test_plan_ship_date_is_not_overwritten_by_depart():
    """发货日是**计划**：发运时不能把它覆盖掉（原来 `plan_ship_date = depart_at` 会毁掉计划）。"""
    src = _code(BE / "services" / "shipping.py")
    assert "if depart_at and not sh.plan_ship_date:" in src


def test_purchase_has_a_to_vehicle_todo():
    """采购侧要能看到“待叫车”待办（另一个部门的活要出现在他自己台面上）。"""
    src = _read(BE / "api" / "routes" / "initiation.py")
    assert '"/purchase/to-vehicle"' in src


def test_vehicle_fee_is_not_written_to_price_library():
    """车辆服务不进价格库 —— 只记本次金额（客户口径）。"""
    src = _code(BE / "services" / "shipping.py")
    j = src.index("def request_vehicle(")
    body = src[j : j + 900]
    for forbidden in ("SupplierQuote", "PriceReference", "supplier_quote", "price_reference"):
        assert forbidden not in body, f"叫车不该写入价格库（出现 {forbidden}）"
