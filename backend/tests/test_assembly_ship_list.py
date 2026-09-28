# -*- coding: utf-8 -*-
"""§2.1 装配结果决定发运清单结构（组装体）护栏 —— 09 卷 §2.1，2026-09-28。

客户口径：
  “一个设备有 100 个零件，但我只装配了 80 个，那么发货时怎么发？那肯定是发这个装了 80 件的
   **组装体**，勾选这个就可以了。装配完之后，清单其实就变成了**一个组装体 + 20 个零件**。”
  “组装体只是清单里面的一项，你**不需要去纠结**它是由 80 个零件组成的”；
  “他收货的时候肯定也是「组装体 + 20 个零件」，**干嘛要去拆？**”
  → 数量守恒：设计 100 = 1 个组装体 + 20 个未装零件
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from app.models.shipment import SHIP_ITEM_ASSEMBLY
from app.services.kitting import finish_assembly

ROOT = Path(__file__).resolve().parents[2]
BE = ROOT / "backend" / "app"


def _code(rel: str) -> str:
    p = BE / rel
    return "\n".join(ln for ln in p.read_text(encoding="utf-8").splitlines() if not ln.strip().startswith("#"))


def test_assembly_item_kind_exists():
    assert SHIP_ITEM_ASSEMBLY == "组装体"


def test_generate_items_collapses_assembled_equipment():
    """★ 装配完成的设备必须走「折叠成分组体」分支，并且**不再平铺结构**（靠 `continue`）。"""
    src = _code("services/shipping.py")
    i = src.index("def generate_items(")
    seg = src[i : i + 4200]
    assert "SHIP_ITEM_ASSEMBLY" in seg, "要有 kind=组装体 的那一项"
    assert "_assembled_record(" in seg, "要按装配记录判断是否折叠"
    # 折叠分支必须在打印结构之前 continue 掉，否则组装体和 100 个零件会同时出现
    j = seg.index("SHIP_ITEM_ASSEMBLY")
    assert "continue" in seg[j : j + 1600], "折叠后必须 continue（不展开已装的子件）"


def test_unassembled_is_normalized_and_optional():
    """未装清单：空 = 全部装齐；去空行；qty 缺省不带。"""
    rec = SimpleNamespace(status="装配中", photos=None, remark=None, unassembled=None)
    finish_assembly(None, rec, unassembled=[])
    assert rec.unassembled == []
    assert rec.status == "已装配"

    rec2 = SimpleNamespace(status="装配中", photos=None, remark=None, unassembled=None)
    finish_assembly(
        None,
        rec2,
        unassembled=[
            {"ref": " TX-1 ", "name": " 底板 ", "qty": 2, "unit": "件"},
            {"ref": "   "},  # 空行丢掉
        ],
    )
    assert rec2.unassembled == [{"ref": "TX-1", "name": "底板", "qty": 2.0, "unit": "件"}]


def test_finish_route_accepts_unassembled():
    src = (BE / "api" / "routes" / "assembly.py").read_text(encoding="utf-8")
    assert "unassembled" in src, "装配完成接口要收未装清单"


def test_shipment_item_dict_exposes_assembly_kind():
    """前端要能显示「组装体」这一项（kind 传到 items 里，不要被过滤掉）。"""
    src = _code("services/shipping.py")
    assert '"kind"' in src
