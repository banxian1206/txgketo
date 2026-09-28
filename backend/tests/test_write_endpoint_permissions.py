# -*- coding: utf-8 -*-
"""写接口权限护栏 —— 防「新接口忘挂权限码」（N22 / M-04 就是这类漏进来的）。

来源：第八轮报告 §4 建议（"B3/B4 收敛成 permission 回归护栏"）+ 本轮实测：
  原来 **40 个写接口**只做了「登录」（`Depends(get_current_user)`）没做「授权」，
  其中 4 个**实测真能被低权账号越权**（已修）：
    · `PATCH/DELETE /projects/{p}/milestones/{id}` —— 现场账号能改/删项目里程碑
    · `POST /projects/{p}/members` —— 现场账号能**任命项目团队成员**（甚至项目经理！
      而任命 PM 会写 `project.pm_id`，**所有"通知项目经理"都靠它定位**）
    · `PATCH /projects/{p}/equipment/{id}` —— 现场账号能改设备
  批量补齐后：写接口挂权限码 **120/131**，剩 11 条各有正当理由（见 `ALLOW`）。

★ 这条护栏只做一件事：**不许再新增"没声明权限的写接口"**。
   加新接口时，要么挂 `require_permission(...)` / `require_any_permission(...)`（或内联 `has_permission` 判断），
   要么在下面的 `ALLOW` 里**写清为什么它可以不管权限**。
"""
from __future__ import annotations

import inspect

from fastapi.routing import APIRoute

from app.main import app

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# 出现任一即视为"声明了授权"（服务层/路由层皆可）
GUARD_MARKERS = (
    "require_permission(",
    "require_any_permission(",
    "has_permission(",
    "_can_",          # 形如 _can_act_on_task / _can_site
    "_require",
    "is_superuser",
)

# ── 允许"不挂权限码"的接口（**新增一条必须写理由**）────────────────────────
ALLOW: dict[str, str] = {
    "POST /auth/login": "登录本身（还没有身份，谈不上权限）",
    "POST /notifications/{notification_id}/read": "本人数据：只能标记自己的消息",
    "POST /notifications/read-all": "本人数据：只能标记自己的消息",
    "POST /purchase/manual-request": "设计允许：任何人可提手工采购申请（免审核直入池，N22 已确认）",
    "POST /change-requests": "走 change_flow（服务层判权限/归属）",
    "POST /change-requests/{cr_id}/decide": "走 change_flow.decide —— 服务层限「申请人所在部门的总监」（ForbiddenOperation→403）",
    "POST /change-requests/{cr_id}/dispatch": "走 change_flow（服务层判归属）",
    "POST /change-requests/{cr_id}/revise-bom": "走 change_flow（服务层判归属）",
    "POST /review-tickets/{ticket_id}/review": "走 review_flow —— 服务层校验「只有本专业经理/工程部总监能审这一级」",
    "POST /review-tickets/{ticket_id}/withdraw": "走 review_flow —— 提交人本人撤回",
    # 注意：这条**不是**漏的 —— review_flow.submit_round 里判了 `task.owner_id != user.id`
    # （“只能提交自己负责的任务”）。干活的人（负责人）不受影响，正是 M-04 要求的方向。
    "POST /tasks/{task_id}/submit-review": "走 review_flow.submit_round —— 服务层已判「只能提交自己负责的任务」",
}


def _iter_api_routes(routes):
    """递归展开（新版 FastAPI 的 include_router 会保留 `_IncludedRouter`，不再拍平）。"""
    for r in routes:
        if isinstance(r, APIRoute):
            yield r
        elif hasattr(r, "original_router"):
            yield from _iter_api_routes(r.original_router.routes)
        elif hasattr(r, "routes"):
            yield from _iter_api_routes(r.routes)


def _write_routes() -> list[tuple[str, APIRoute]]:
    out = []
    for r in _iter_api_routes(app.routes):
        methods = set(r.methods or ())
        if methods & WRITE_METHODS:
            out.append((f"{sorted(methods & WRITE_METHODS)[0]} {r.path}", r))
    return out


def _is_guarded(route: APIRoute) -> bool:
    try:
        src = inspect.getsource(route.endpoint)
    except OSError:  # pragma: no cover - 源码取不到时保守判为已守（避免假红）
        return True
    return any(k in src for k in GUARD_MARKERS)


def test_write_endpoint_inventory_is_not_empty():
    """自检：枚举器还能找到写接口（否则这条护栏会"绿得毫无意义"）。"""
    routes = _write_routes()
    assert len(routes) > 100, f"只枚举到 {len(routes)} 个写接口 —— 枚举逻辑可能坏了"


def test_no_new_write_endpoint_without_a_permission_code():
    """★ 核心：每一个"没声明权限"的写接口都必须在 `ALLOW` 里写明理由。"""
    unguarded = sorted(key for key, r in _write_routes() if not _is_guarded(r))
    new = [k for k in unguarded if k not in ALLOW]
    assert not new, (
        "发现没有声明权限、也没在 ALLOW 里写理由的写接口：\n  "
        + "\n  ".join(new)
        + "\n请挂 require_permission(...)（或内联 has_permission 判断）；"
        "确实无需权限的，加到 tests/test_write_endpoint_permissions.py 的 ALLOW 并写清为什么。"
    )


def test_allow_list_has_no_stale_entries():
    """ALLOW 里的条目必须仍然真实存在且仍然未挂（防止名单腐烂后掩盖新洞）。"""
    unguarded = {key for key, r in _write_routes() if not _is_guarded(r)}
    stale = sorted(k for k in ALLOW if k not in unguarded)
    assert not stale, f"ALLOW 里这些已经不存在/已经挂了权限，请从名单删掉：{stale}"


def test_every_allow_entry_has_a_reason():
    thin = [k for k, v in ALLOW.items() if len((v or "").strip()) < 8]
    assert not thin, f"ALLOW 里这些没写清理由：{thin}"
