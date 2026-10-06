"""把所有账号的密码统一为一个（客户口径 2026-10-05：「把所有账号的密码统一为一个，这样子就方便登录」）。

为什么需要这个脚本（而不是只改 `seed.py`）：
  · `seed.py` 只影响**新建**账号；已存在于库里的 26 个账号密码各不相同（admin 一套、演示账号一套）
  · 而且 `seed.py` 是**幂等但不覆盖密码**的（已存在的用户不动），所以改常量不会改到存量
  · 演示/测试阶段需要“拿任何一个账号都能登”，所以要有一次性的批量重置

口径：
  · 默认目标是与 `services/demo.py::DEMO_PASSWORD`（`txgk@123`）一致 —— 单一事实源，不再两套
  · **默认预演**（不加 `--yes` 只看要改谁），与 `reset_business_data.py` 同一保护习惯
  · 每次执行都落 `audit_log`（AGENTS 铁律 5：所有写操作留痕）；**审计里不记密码本身**

用法：
    python -m scripts.set_uniform_password            # 预演
    python -m scripts.set_uniform_password --yes      # 真改
    python -m scripts.set_uniform_password --yes --password 'Xxx123'   # 指定密码
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.models.platform import User  # noqa: E402
from app.services.audit import log  # noqa: E402
from app.services.demo import DEMO_PASSWORD  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="真改（不加只预演）")
    ap.add_argument("--password", default=DEMO_PASSWORD, help=f"统一密码（默认 {DEMO_PASSWORD}）")
    args = ap.parse_args()

    with SessionLocal() as session:
        users = session.scalars(select(User).order_by(User.id)).all()
        print(f"将要统一 {len(users)} 个账号的密码为「{args.password}」：")
        for u in users:
            tag = "超管" if u.is_superuser else "    "
            state = "" if u.is_active else "（已停用，仍会重置，启用后可用）"
            print(f"   {u.id:>3} {tag} {u.username:<20} {u.name}{state}")

        if not args.yes:
            print("\n⚠ 预演模式：上面这些账号的密码**没有改**。确认请重跑：`--yes`")
            return

        # 一次性 sqlalchemy update（26 行，不必逐行 flush）
        for u in users:
            u.password_hash = hash_password(args.password)
        log(
            session,
            user=None,
            action="user.set_uniform_password",
            object_type="user",
            summary=f"把 {len(users)} 个账号的密码统一（不记密码原文）",
        )
        session.commit()
        print(f"\n🔑 已统一：{len(users)} 个账号，密码 = {args.password}（已写 audit_log）")
        print("⚠ 上线前必须改掉（AGENTS §5：演示阶段才允许弱密码）")


if __name__ == "__main__":
    main()
