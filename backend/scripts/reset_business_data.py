#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""业务数据复位（独立入口）—— 供 e2e 跑完清理用。

跑法：`.venv/bin/python -m scripts.reset_business_data`（或前端 `npm run e2e:clean`）

为什么要它（第九轮报告 §7.4）：`e2e_baseline` / `e2e:api` / `e2e:ui` 都会**建测试数据**，
跑完不清理 → 多轮连跑会累积一堆测试项目。前端 e2e 是 Node、不能直连库（引 `pg` 就是新依赖），
所以复位只由后端提供 —— 与 `e2e_baseline` 开头那次复位**共用同一份实现**。

★ **保留**账号 / 组织 / 角色 / 权限 / 标准库类目；**清掉**项目与全部业务单据 + 审计 + 通知 + 物料档 + 编号流水。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # 让 "按路径跑" 与 "-m 跑" 都能 import scripts.*

from scripts._reset_business import reset_business_data, preview


MASTER_NOTE = {
    "item": "物料档（标准件/原材料/自制件）",
    "supplier": "供应商",
    "supplier_quote": "供应商报价/历史价",
    "supplier_catalog": "供应商能供品类",
    "warehouse_location": "库位",
}


def main() -> None:
    """跑法：`python -m scripts.reset_business_data [--yes]`

    ★ **默认只预演**（不删）—— 因为它**连主数据一起清**（`item → project` 外键决定的，绕不开），
    而这是给人手工敲的命令，手滑一次代价不小（第十轮报告 R-2）。
    确认无误再加 `--yes`。
    """
    import sys

    p = preview()
    print("将要清空（**保留**账号/组织/角色/权限/标准库类目）：")
    for k, v in p.items():
        note = f"   ← {MASTER_NOTE[k]}" if k in MASTER_NOTE and v else ""
        print(f"   {k:20s} {v}{note}")

    if "--yes" not in sys.argv:
        print("\n⚠ 以上都会删（**含主数据**：物料档/供应商/报价/库位）。确认请重跑：`--yes`")
        return

    reset_business_data()
    print("\n🧹 已复位。账号/组织/角色/权限/标准库类目不受影响。")


if __name__ == "__main__":
    main()
