# -*- coding: utf-8 -*-
"""采购单一套状态机（客户口径 2026-10-07，实测 TX26005）。

现象：下的单单头「待经理审」、**单行却在途**、需求「审批中」——同一张单三个状态打架。
根因：单行建单那刻就写死「在途」；单头又有「已批准 / 执行中」两个只在内部用的影子状态，
靠 `_po_display_status` 折叠展示 → 单头真值与展示两套。

收口：**单头是唯一口径**，单头/单行共用一套词表：
  草稿 → 待经理审 → 待总监审 → 在途 → 部分到货 → 已完成；单行到货后走 待入库 → 已入库
  （直发客户现场 → 现场已验收）。审批阶段单行必须跟单头一致。
"""
from __future__ import annotations

from pathlib import Path

from app.models.purchase_order import PO_IN_TRANSIT, PO_LINE_STATUS, PO_PARTIAL, PO_STATUS
from app.services import purchase_order as po_svc

ROOT = Path(__file__).resolve().parents[2]
BE = ROOT / "backend" / "app"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_single_vocabulary_no_shadow_states():
    """不再有「已批准 / 执行中」这两个只在内部用的影子状态。"""
    assert "已批准" not in PO_STATUS, "单头不再有「已批准」——审批通过就是「在途」"
    assert "执行中" not in PO_STATUS, "单头不再有「执行中」——到货就是「部分到货」"
    assert PO_IN_TRANSIT in PO_STATUS and PO_PARTIAL in PO_STATUS
    # 单行跟单头同词表
    assert "在途" in PO_LINE_STATUS and "部分到货" in PO_LINE_STATUS
    assert "待入库" in PO_LINE_STATUS and "已入库" in PO_LINE_STATUS, (
        "验收合格=待入库、真入库=已入库（客户口径：入库了才算已入库）"
    )
    assert "现场已验收" in PO_LINE_STATUS, "直发件现场清点完 = 现场已验收"
    # 活跃单（供应商即接单）口径
    assert po_svc.PO_LIVE_STATUS == (PO_IN_TRANSIT, PO_PARTIAL, "已完成")


def test_create_order_line_mirrors_head_status():
    """建单时单行状态必须 = 单头状态，不能写死「在途」。"""
    src = _read(BE / "services" / "purchase_order.py")
    i = src.index("def create_order(")
    body = src[i : src.index("def recalc_delivery(", i)]
    assert "status=PO_LINE_OPEN" not in body, "单行不许一建单就是「在途」"
    assert "status=status" in body, "单行状态应跟单头（建单是草稿）"


def test_approval_transitions_sync_lines():
    """提交/通过/退回/撤回都要把审批阶段的行状态跟单头一起改。"""
    src = _read(BE / "services" / "purchase_order.py")
    assert "def sync_po_lines_status(" in src
    for fn in ("def submit_order(", "def approve_order(", "def withdraw_order("):
        i = src.index(fn)
        body = src[i : src.index("\ndef ", i + 1)]
        assert "sync_po_lines_status(session, po)" in body, f"{fn} 要同步单行状态"
    # 总监通过 → 在途（不是旧的「已批准」）
    i = src.index("def approve_order(")
    assert "po.status = PO_IN_TRANSIT if level == APPR_LEVEL_DIRECTOR" in src[i : i + 3000]


def test_no_display_folding_single_source():
    """不再有「展示口径」`_po_display_status` —— 单头是唯一口径。"""
    src = _read(BE / "api" / "routes" / "initiation.py")
    assert "_po_display_status" not in src, "已删的折叠函数不许长回来（单头就是显示值）"
    assert '"status": po.status' in src and '"po_status": po.status' in src


def test_store_marks_line_and_recomputes_head():
    """真入库才算「已入库」，且入库要重算单头（否则永远停在「执行中」）。"""
    src = _read(BE / "api" / "routes" / "initiation.py")
    i = src.index("def store_receipt(")
    body = src[i : src.index("@purchase_router", i + 10)]
    assert "recalc_order_status" in body, "入库后要重算单头（全部到齐 → 已完成）"
    # 验收合格 = 待入库（不是已入库）
    j = src.index("def _bump_line_on_receipt(")
    bump = src[j : src.index("\ndef ", j + 1)]
    assert 'line.status = "待入库"' in bump and 'line.status = "已入库"' not in bump, (
        "验收合格只到「待入库」；「已入库」只有 store 才给"
    )
