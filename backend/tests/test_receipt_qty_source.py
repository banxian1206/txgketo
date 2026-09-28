"""护栏：到货单数量必须来自【实收 body】或【单行 line.qty】，**不得**来自【需求总量】。

教训（第三轮 N13）：`purchase_request`（需求）与 `purchase_order_line`（单行）是 1:N，
凡「到货/收货/记账」环节，数量要取自行、归属要落到行。
`_ensure_site_pending_receipt` 曾写 `qty=row.qty` → 一条需求拆给多家直发时，每张单各记全量（实收翻 N 倍）。

本护栏只拦**直接**把 `xxx.qty`（形如 `row.qty` / `request.qty`）当 `qty`/`qty_ok` 传进去的写法；
修好后的 `q_ = line.qty if line else row.qty`（中间变量）不会被误伤。
"""

from __future__ import annotations

import ast
from pathlib import Path

_APP = Path(__file__).resolve().parents[1] / "app"


def test_到货单数量不得直接取需求总量():
    bad: list[str] = []
    for p in _APP.rglob("*.py"):
        tree = ast.parse(p.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and getattr(node.func, "id", None) == "GoodsReceipt"):
                continue
            for kw in node.keywords:
                if kw.arg in ("qty", "qty_ok") and isinstance(kw.value, ast.Attribute):
                    bad.append(f"{p.name}:{node.lineno} {kw.arg}={ast.unparse(kw.value)}")
    assert bad == [], f"到货单数量不得直接取需求总量（应为 line.qty / body.qty）：{bad}"
