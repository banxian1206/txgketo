# -*- coding: utf-8 -*-
"""UI 真实场景测试（2026-09-30）里的**错数据三处**护栏：P1-2 / P1-3 / P1-4。

共同点：界面上看起来“能走通”，但落进库里的数字/主数据是错的，而且没人会报错 ——
所以护栏必须钉在“输入口 + 服务端口”两处，光钉界面文案不够。
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BE = ROOT / "backend" / "app"
FE = ROOT / "frontend" / "src"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _code(p: Path) -> str:
    return "\n".join(ln for ln in _read(p).splitlines() if not ln.strip().startswith("#"))


# ── P1-2 付款节点合计 ────────────────────────────────────────────────────
def test_backend_rejects_payment_terms_not_summing_to_100():
    """实测过的错法：默认模板 4 条 + 手工 4 条 = 170%、合计 ¥6.12M > 合同 ¥3.6M，照样成交。"""
    src = _code(BE / "api" / "routes" / "project.py")
    assert "abs(pct_sum - 100) > 0.5" in src, "后端必须校验比例合计=100%"
    assert "超过合同金额" in src, "金额合计也要和合同额对齐"


def test_frontend_blocks_and_shows_running_total():
    """界面上要有实时合计（不然用户不知道差多少），提交也要拦。"""
    s = _read(FE / "components" / "project" / "DealModals.tsx")
    assert "当前比例合计" in s
    assert "必须是 100%" in s
    assert "Form.useWatch('payment_terms', dealForm)" in s


def test_payment_term_without_amount_is_not_reported_as_collected():
    """金额没录的节点在详情里显示「已收齐」是误导（0 欠款 ≠ 收齐）。"""
    s = _read(FE / "components" / "project" / "DealCard.tsx")
    assert "未录金额" in s


# ── P1-3 到货数量清空 → 静默记 1 ──────────────────────────────────────────
def test_mobile_receipt_qty_is_not_silently_defaulted_to_one():
    """`Number(v ?? 1)` 让“清空数量”变成“收 1 件”：订 40 记 1，事后没人知道。

    实测三笔：GR26004（订 4 根）/GR26005（订 12 件）/GR26006（订 40 件）全部落库 1。
    """
    raw = _read(FE / "features" / "acceptance" / "MobilePage.tsx")
    # 注释里可以举例，代码里不行
    code_lines = [ln for ln in raw.splitlines() if not ln.strip().startswith("//")]
    s = "\n".join(code_lines)
    assert "Number(v ?? 1)" not in s, "不许再把清空当成 1"
    assert "setQty(null)" in s or "setQty(v === null || v === undefined ? null : Number(v))" in s
    assert "请填「本次到货数量」" in _read(FE / "features" / "acceptance" / "MobilePage.tsx")


def test_pc_receipt_qty_has_explicit_message():
    s = _read(FE / "features" / "warehouse" / "Page.tsx")
    assert "本次到货数量（入库/结算的依据，不能空）" in s


# ── P1-4 库位：不许凭空造主数据 + 手机端要能选/拍 ────────────────────────
def test_backend_never_invents_a_warehouse():
    """原来未填就造 `warehouse="深圳仓", code="待定"` —— 那个地名只是界面示例（公司在肇庆）。

    注：函数 docstring 里**可以**讲这件事（“过去/为何”），所以这里只钉实际代码语句。
    """
    src = _code(BE / "api" / "routes" / "initiation.py")
    j = src.index("def _resolve_location(")
    nxt = src.find("\ndef ", j + 1)
    body = src[j : nxt if nxt > 0 else len(src)]
    # 把 docstring 去掉再查（docstring 里可以讲这段往事）
    body_code = re.sub(r'""".*?"""', "", body, flags=re.S)
    assert 'WarehouseLocation(warehouse="深圳仓"' not in body_code, "不许再造示例仓库名"
    assert 'code="待定"' not in body_code, "不许再造「待定」库位"
    assert "入库必须定库位" in body_code, "空库位应 400 并要求写清"


def test_store_requires_location():
    src = _read(BE / "api" / "routes" / "initiation.py")
    assert 'location: str = Field(..., description="入库库位（仓库 + 编码' in src


def test_mobile_store_uses_the_shared_location_picker():
    """手机端两处入库曾用裸 Input（自由文本）→ 既选不到已建库位，也没有拍照识别。"""
    for name in ("MobilePage.tsx",):
        for fe in ("acceptance", "warehouse"):
            s = _read(FE / "features" / fe / name)
            assert "SelectLocation" in s, f"{fe}/{name} 要用统一库位控件"
            assert "深圳仓 A-03-12" not in s, f"{fe}/{name} 里别再用示例文案当库位格式说明"
