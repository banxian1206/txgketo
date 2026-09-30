# -*- coding: utf-8 -*-
"""降级视图的边界（2026-09-30 UI 真实场景测试 P0-1 的护栏）。

`GET /users` 对非管理者降级。**遮什么**是安全，**留什么**是可用性 —— 两边都要钉住：

· 遮：roles / permissions / phone / title（身份凭证与联系方式，全员摊开等于把权限地图给每个人）
· 留：org_id / position / profession（部门属性，项目详情/任务单上本来就看得见，
       而「经理拆分派工」正是按 profession + position 筛组员的 ——
       抹成 null 会让经理看到"本专业还没有组员"，05 卷 P2 派工链在 UI 上直接断掉）
"""
from __future__ import annotations

from types import SimpleNamespace

from app.api.routes.platform import _lite_row


def _u(**kw):
    base = dict(
        id=7, username="mech1", name="机械组员", org_id=16,
        position="组员", profession="机械", title="工程师", phone="13800000000",
        is_active=True, is_superuser=False,
    )
    return SimpleNamespace(**{**base, **kw})


def test_降级视图遮掉凭证类字段():
    row = _lite_row(_u())
    d = row.model_dump()
    assert not d["roles"], "角色清单不得下发"
    assert not d["permissions"], "权限清单不得下发"
    assert not d["phone"], "手机号不得下发"
    assert not d["title"], "称谓（岗位细分）不得下发"


def test_降级视图保留派工要用的部门属性():
    """★ 这条红了 = 拆分派工又会看不到组员（P0-1 回归）。"""
    row = _lite_row(_u())
    assert row.position == "组员"
    assert row.profession == "机械"
    assert row.org_id == 16


def test_拆分组员的筛选条件在降级视图上能命中():
    """前端 features/task/Page.tsx 的过滤条件：profession === 任务专业 && position in (组员, 成员)。

    直接把这个条件在真实返回行上跑一遍 —— 后端一改字段，这里立刻红。
    """
    rows = [_lite_row(_u(id=4, name="机械组员", profession="机械", position="组员")),
            _lite_row(_u(id=3, name="机械经理", profession="机械", position="经理")),
            _lite_row(_u(id=6, name="电气组员", profession="电气", position="组员"))]
    got = [r.name for r in rows
           if r.profession == "机械" and r.position in ("组员", "成员")]
    assert got == ["机械组员"], f"经理应能看到本专业组员，实际 {got}"
