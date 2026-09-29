# -*- coding: utf-8 -*-
"""页签/路由权限码契约（重整方案 docs/10 §4 · G3 的后端一半）。

前端 `frontend/e2e/static.mjs` 里有一份 KNOWN 码表，但那份表自己也会漂——
这条测试拿**后端权限表 + 派生码**去对账，做到：
  1. 前端 anyOf 用到的每个码，后端必须真的认识（否则就是 `perm: 'mfg'` 那种假码：
     门永远打不开，或更糟——永远开着）；
  2. 派生码 admin:users / admin:audit 必须由 `deps.effective_permissions` 下发
     （登录/me 的 permissions 里能看到），前端才允许拿 hasPerm 判可见性。
"""

from __future__ import annotations

import re
from pathlib import Path

from app.api.deps import PERM_ADMIN_AUDIT, PERM_ADMIN_USERS
from app.models.platform import Permission

_REPO = Path(__file__).resolve().parents[2]
_FRONT = _REPO / "frontend" / "src"

# 这些码是「只在前端做路由守卫」用的（后端对应接口另有内联判断），仍必须在后端权限表里存在
_WANTED_FILES = ["configs/tabs.ts", "configs/domain.tsx", "App.tsx"]


def _front_codes() -> set[str]:
    codes: set[str] = set()
    for f in _WANTED_FILES:
        src = (_FRONT / f).read_text(encoding="utf-8")
        for m in re.finditer(r"anyOf:\s*\[([^\]]*)\]", src):
            codes |= set(re.findall(r"'([^']+)'", m.group(1)))
    return codes


def test_前端页签用的权限码后端都认识():
    codes = _front_codes()
    assert codes, "一个 anyOf 都没抓到 —— 扫描逻辑可能坏了（护栏不许空转）"
    known = {PERM_ADMIN_USERS, PERM_ADMIN_AUDIT}
    from app.core.db import SessionLocal

    s = SessionLocal()
    try:
        known |= {p.code for p in s.query(Permission).all()}
    finally:
        s.close()
    fake = sorted(codes - known)
    assert not fake, (
        f"前端页签/路由用了后端不存在的权限码：{fake}\n"
        "要么是假码（旧例：侧栏 perm:'mfg' —— 后端只有 mfg:view/mfg:edit），"
        "要么是新码：请加进 seed.py 的 PERMISSIONS + 角色表，再重跑 seed。"
    )


def test_派生码由后端随登录下发():
    """hasPerm('admin:users') 能有意义，前提是这两个码真在登录响应的 permissions 里。"""
    import sqlalchemy as sa

    from app.api.deps import effective_permissions
    from app.core.db import SessionLocal
    from app.models.platform import User

    s = SessionLocal()
    try:
        boss = s.scalar(sa.select(User).where(User.username == "admin"))
        eng_director = s.scalar(sa.select(User).where(User.username == "eng_director"))
        buyer = s.scalar(sa.select(User).where(User.username == "buyer1"))
        assert PERM_ADMIN_USERS in effective_permissions(s, boss)
        assert PERM_ADMIN_AUDIT in effective_permissions(s, boss)
        # 总监：能管本部门 → 有派生码（前端据此显示「用户与权限」，不会再出现「看得见点了 403」）
        assert PERM_ADMIN_USERS in effective_permissions(s, eng_director)
        # 采购员：既非超管也非总监 → 不该有
        assert PERM_ADMIN_USERS not in effective_permissions(s, buyer)
        assert PERM_ADMIN_AUDIT not in effective_permissions(s, buyer)
    finally:
        s.close()
