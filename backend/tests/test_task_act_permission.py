# -*- coding: utf-8 -*-
"""M-04 护栏：任务推进门禁（routes/tasks.py::_can_act_on_task）。

来源：docs/99-全局端到端测试报告-2026-09-28-第八轮.md §3 M-04 【P1】
背景：N22 给 `PATCH /tasks/{id}` 挂了 `require_permission("project:edit")`，
      但 DESIGN / DESIGN_AUDIT / CRAFT 三个角色**都没有 `project:edit`**
      → 设计师连自己名下任务的「开始/完成」都被 403（S2 设计推进走不动）。
修法：门禁按「能不能动**这张**任务」判 —— 负责人本人 / 同专业经理 / 总监 / 有 project:edit 任一。

这条测试是报告点名缺的那半条护栏（原来只有"别人进不来"的反控，没有"干活的人还在门上"的正控）。
"""
from __future__ import annotations

from types import SimpleNamespace

from app.api.routes.tasks import _can_act_on_task
from app.models.platform import POSITION_DIRECTOR, POSITION_LEAD


def _user(uid, position=None, profession=None, perms=(), superuser=False):
    roles = [SimpleNamespace(permissions=[SimpleNamespace(code=c) for c in perms])] if perms else []
    return SimpleNamespace(
        id=uid, position=position, profession=profession, is_superuser=superuser, roles=roles
    )


def _task(owner_id, profession):
    return SimpleNamespace(owner_id=owner_id, profession=profession)


def test_owner_can_act_on_own_task():
    """★ 正控（M-04 的核心）：设计师能推进自己名下的任务。"""
    mech1 = _user(7, profession="机械")  # DESIGN 角色：无 project:edit
    assert _can_act_on_task(mech1, _task(owner_id=7, profession="机械")) is True


def test_same_profession_leader_can_act():
    """同专业经理能推进本组任务（我组任务页）。"""
    mgr = _user(3, position=POSITION_LEAD, profession="电气")
    assert _can_act_on_task(mgr, _task(owner_id=99, profession="电气")) is True


def test_cross_profession_leader_cannot_act():
    """★ 反控：专业不同的经理不能动别人的任务（门禁不是"是经理就行"）。"""
    mgr = _user(3, position=POSITION_LEAD, profession="机械")
    assert _can_act_on_task(mgr, _task(owner_id=99, profession="电气")) is False


def test_director_and_superuser_can_act():
    assert _can_act_on_task(_user(2, position=POSITION_DIRECTOR), _task(1, "机械")) is True
    assert _can_act_on_task(_user(1, superuser=True), _task(1, "机械")) is True


def test_project_edit_holder_can_act():
    """有 project:edit（PM/商务）仍可改任意任务 —— 保持 N22 之前的既有语义。"""
    pm = _user(18, perms=["project:edit"])
    assert _can_act_on_task(pm, _task(owner_id=99, profession="机械")) is True


def test_unrelated_user_cannot_act():
    """★ 反控：无关人（仓管/车间/售后）不得改。"""
    for who in (_user(20, profession="仓库"), _user(21, profession="制造")):
        assert _can_act_on_task(who, _task(owner_id=99, profession="机械")) is False


def test_owner_none_does_not_open_door():
    """未派工的任务（owner_id=None）不能被"本人"规则误放行。"""
    stranger = _user(30, profession="机械")
    assert _can_act_on_task(stranger, _task(owner_id=None, profession="机械")) is False


def test_leader_without_profession_cannot_act():
    """经理但专业为空 → 不得凭"是经理"放行（避免 profession 为空时人人可动）。"""
    mgr = _user(3, position=POSITION_LEAD, profession=None)
    assert _can_act_on_task(mgr, _task(owner_id=99, profession="机械")) is False
