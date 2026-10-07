# -*- coding: utf-8 -*-
"""「生成采购需求」失败时要说清原因（客户实测 TX26005，2026-10-07）。

现象：设计面已挂了图纸 + BOM 行，点「生成采购需求（进池）」却提示
「这台设备还没有可采购的 BOM（标准件 / 原材料 BOM 都是空的）」—— 用户以为自己白填了。

根因：采购只认【已发布（冻结）】的 BOM（05 卷 §4/§5），而该设备的 BOM 行还是「草稿」；
旧文案把「没挂 BOM」和「挂了但没发布」混成一句，是**说假话**。

本护栏钉住：`need_lines == 0` 时必须区分两种情况，且带出草稿/审核中的行数。
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BE = ROOT / "backend" / "app"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_route_distinguishes_draft_bom_from_empty_bom():
    src = _read(BE / "api" / "routes" / "initiation.py")
    i = src.index("def generate_equipment_purchase(")
    body = src[i : src.index("class MergeLineIn(", i)]
    assert "bom_draft" in body and "bom_reviewing" in body, (
        "要把「草稿 / 审核中」的行数带出来，才能说清为什么没有可采购 BOM"
    )
    assert "还没发布（冻结）" in body, "草稿/审核中 → 应提示先评审发布"
    assert "还没有 BOM 行" in body, "真的没挂 → 应提示去挂 BOM"
    # 那句把两种情况混为一谈的旧文案不许再出现（它就是误解的来源）
    assert "标准件 / 原材料 BOM 都是空的" not in body


def test_bom_demand_exposes_status_counts():
    src = _read(BE / "services" / "bom_demand.py")
    assert "def equipment_bom_counts(" in src
    assert "BOM_ROW_REVIEWING" in src, "要能区分「审核中」与「草稿」"
    assert '"bom_frozen"' in src and '"bom_draft"' in src
