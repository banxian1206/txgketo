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

from sqlalchemy import create_engine, text

from scripts._reset_business import DBURL, reset_business_data


def main() -> None:
    e = create_engine(DBURL)
    with e.connect() as c:
        n = c.execute(text("SELECT count(*) FROM project")).scalar() or 0
    reset_business_data()
    print(f"🧹 业务数据已复位（清掉 {n} 个项目及其全部单据）。账号/组织/角色/标准库不受影响。")


if __name__ == "__main__":
    main()
