"""一键生成演示账号（06 卷 §4）。管理员在页面上点，或命令行跑：

    .venv/bin/python -m scripts.seed_demo_users
    .venv/bin/python -m scripts.seed_demo_users --disable   # 停用演示账号

统一密码：txgk@123（可用环境变量 DEMO_PASSWORD 覆盖）
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import SessionLocal  # noqa: E402
from app.services import audit  # noqa: E402
from app.services.demo import DEMO_PASSWORD, seed_demo, set_demo_active  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--disable", action="store_true", help="停用演示账号（不删）")
    args = parser.parse_args()

    password = os.getenv("DEMO_PASSWORD", DEMO_PASSWORD)
    with SessionLocal() as session:
        if args.disable:
            n = set_demo_active(session, False)
            session.commit()
            print(f"已停用 {n} 个演示账号")
            return
        rows = seed_demo(session, password)
        audit.log(
            session,
            user=None,
            action="seed_demo",
            object_type="user",
            object_ref="demo",
            summary=f"生成/校验演示账号 {len(rows)} 个",
        )
        session.commit()

    print(f"\n演示账号（密码统一 {password}）：\n")
    print(f"{'账号':<18}{'姓名':<14}{'部门':<10}{'岗位':<6}{'专业':<6}角色")
    print("-" * 72)
    for r in rows:
        flag = "" if r["created"] else "（已存在）"
        print(
            f"{r['username']:<18}{r['name']:<14}{(r['org'] or '—'):<10}"
            f"{r['position']:<6}{(r['profession'] or ''):<6}{'/'.join(r['roles'])} {flag}"
        )
    print("\n提示：登录后按角色看工作台；两级审核要用两个不同账号（如 mech1 提交 → mech_manager → eng_director）。")


if __name__ == "__main__":
    main()
