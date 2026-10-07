# -*- coding: utf-8 -*-
"""机械只定「外购 / 自制」；外协由工艺判定（客户口径 2026-10-07）。

规则：
  · 机械负责 BOM 结构，并决定每个件是「外购」还是「自制」——
    外购标品（电机/机器人…）从标准库挂设计 BOM，**不出图**；
  · 自制件出图后，**是否需外协由工艺评审改判**（source_tag: 外协件/定制件）；
  · 外协 = 直接购买这个定制件（采购侧和定制件同一条通道）。

所以：建图只能是「自制件」；机械台面上不再有「生成采购需求」主按钮
（发布即自动进池，那个按钮是旧模型遗留、容易误导）。
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BE = ROOT / "backend" / "app"
FE = ROOT / "frontend" / "src"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_add_drawing_only_allows_self_made():
    src = _read(BE / "api" / "routes" / "engineering.py")
    assert 'SOURCE_KINDS = ("自制件",)' in src, "建图只允许「自制件」（外协是工艺定的）"
    i = src.index("def add_drawing(")
    body = src[i : src.index("class DrawingPatch(", i)]
    assert "外协" in body and "自制件" in body, "错误文案要说清：外协由工艺在评审里改判"


def test_drawing_form_only_offers_self_made_or_standard():
    fe = _read(FE / "components" / "design" / "DrawingsModals.tsx")
    assert "外协件（发出去加工）" not in fe, "机械建图不该能直接选「外协件」"
    assert "外购件（买现成的非标件）" not in fe, "外购标品走标准库，不该是建图类型"
    assert "自制件（出图" in fe and "标准件（外购标品" in fe


def test_design_header_has_no_manual_purchase_button():
    header = _read(FE / "components" / "design" / "DesignHeaderCard.tsx")
    assert "生成采购需求" not in header, "发布即进池，设计面不该再摆手动「生成采购需求」主按钮"
    assert "设备档案" in header
