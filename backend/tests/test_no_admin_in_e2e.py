"""护栏：**测试不得用 admin 执行业务操作**（客户口径 2026-09-28）。

为什么写死：
  `app/api/deps.py::has_permission` 是 `user.is_superuser or code in permissions_of(user)`
  —— 超管**绕过所有权限码**。用它跑 e2e 等于权限层/审批链**完全没被覆盖**；
  而且 admin 无部门（`org_id IS NULL`），会让审批链 `director_for` 全局兜底到别的部门总监，
  造出「单卡死在待总监审」这类**只有超管能复现**的假象。

规则：
  测试脚本里凡是把 `admin` 当**操作人**用的行，必须带 `# admin-ok: <原因>`（.mjs 用 `// admin-ok: <原因>`）。
  允许的例外只有三类：① 造账号（/demo-users、POST /users）② 系统管理读（/audit-logs 等仅 system:admin）
  ③ `seed.py` 首次初始化（不在本扫描范围）。

扫描范围：backend/scripts/e2e_*.py、backend/scripts/probe_*.py、frontend/e2e/*.mjs
"""

from __future__ import annotations

import re
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_TARGETS = [
    *sorted((_REPO / "backend" / "scripts").glob("e2e_*.py")),
    *sorted((_REPO / "backend" / "scripts").glob("probe_*.py")),
    *sorted((_REPO / "frontend" / "e2e").glob("*.mjs")),
]
# 把 admin 当「操作人」传： "admin" / 'admin' 出现在实参位置
_AS_ACTOR = re.compile(r"""["']admin["']""")
# 允许：登录帮助函数里的比较 / 口令常量 / 已带标记 / CSS 选择器（input[placeholder="admin"]）
_ALLOW = re.compile(r'''==\s*["']admin["']|admin-ok|admin12345\s*if|placeholder=''')


def test_测试脚本不得把admin当操作人():
    bad: list[str] = []
    for p in _TARGETS:
        for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if not _AS_ACTOR.search(line):
                continue
            if _ALLOW.search(line):
                continue
            bad.append(f"{p.relative_to(_REPO)}:{i}  {line.strip()[:100]}")
    assert bad == [], (
        "测试不得用 admin 执行业务操作（超管绕过所有权限码 + 无部门会造假象）。\n"
        "请改用责任角色（buyer1 / wh1 / pm1 / eng_director / craft1 …）；\n"
        "确需超管（造账号 / 系统管理读）请在该行加 `# admin-ok: 原因`（.mjs 用 // admin-ok: 原因）。\n\n"
        + "\n".join(bad)
    )


def test_扫描范围非空():
    """防止 glob 写错导致护栏静默失效。"""
    assert _TARGETS, "没有扫到任何测试脚本 —— 护栏范围写错了"
