# -*- coding: utf-8 -*-
"""长周期件必须走采购流程（客户口径 2026-10-07，实测 TX26005）。

现象：登记长周期件后 `purchase_request` 直接变成 `status=在途` + 一个 `po_no`，
但**没有采购单/供应商/审批** —— 仓库按状态「在途」把它列进「待验收」，
看起来像「没走采购就跑到仓库」。客户要求：长周期件也走
「采购池 → 采购下单 → 审批 → 在途 → 到货验收」。

本护栏是**静态钉子**：这类“少走一步”的回归在普通功能测试里最难发现
（数据看起来都在，只是流程被抄近道）。钉两件事：
  ① 登记接口只把需求放进采购池，不许自己发号 / 置「在途」；
  ② 登记表单 / schema 不再要求「下单日期」（那是采购下单时填的）。
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BE = ROOT / "backend" / "app"
FE = ROOT / "frontend" / "src"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _between(text: str, start: str, end: str) -> str:
    i = text.index(start)
    j = text.index(end, i + len(start))
    return text[i:j]


def test_long_lead_create_only_enters_purchase_pool():
    src = _read(BE / "api" / "routes" / "initiation.py")
    body = _between(src, "def add_purchase_request(", "class LongLeadPatch(")
    assert 'status="待采购"' in body, "登记长周期件应进采购池（status=待采购）"
    assert 'status="在途"' not in body, "登记长周期件不许直接置「在途」（那会跳过采购单/审批）"
    assert 'next_number(session, "PURCHASE_ORDER")' not in body, (
        "登记长周期件不许自己发采购单号 —— PO 号只能由采购下单（create_order）生成"
    )
    assert "ordered_at" not in body, "登记长周期件不该落「下单日期」（那是采购下单时写的）"


def test_long_lead_schema_does_not_require_order_date():
    src = _read(BE / "api" / "routes" / "initiation.py")
    seg = _between(src, "class LongLeadIn(", "def _request_dict(")
    assert "ordered_at: date = Field(...)" not in seg, "登记 schema 不再要求「下单日期」"


def test_long_lead_form_has_no_order_date_field():
    fe = _read(FE / "components" / "InitiationEditors.tsx")
    seg = _between(fe, "export function LongLeadEditor(", "function StdItemSelect(")
    assert 'name="ordered_at"' not in seg, "前端登记表单不该再让 PM 填「下单日期」"
    assert "进采购池" in seg, "表单说明要写清长周期件进采购池、由采购下单"
