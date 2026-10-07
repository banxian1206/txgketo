"""项目全生命周期时间线（2026-10-07）—— 护栏。

立这组测试的三个理由：
① **状态口径只有一个**：里程碑「完成/延期」以前谁也没算过（只有人工 PATCH 写 `status`），
   车间台/超期扫描各有一套“算不算超期”。时间线如果在前端再算一遍，就是
   AGENTS §8.5 那条“同一个概念在多处各算一套”（六通道六种答案的翻版）。
   所以状态集中在 `services/deadline.py::milestone_state`，接口下发，前端只做映射。
② **只读**：时间线是聚合展示，不许有写口子（铁律 3/5：改动走审批、写操作落审计）。
③ **六个时间源不许漏**：接口少一个字段，页面上就少一段 —— 静默降级最难发现。
"""

from __future__ import annotations

import inspect
from datetime import date

from app.api.routes import project as project_routes
from app.models.initiation import MILESTONE_STATUS, Milestone
from app.services import deadline

TODAY = date(2026, 10, 7)


def _ms(
    *,
    start: date | None = None,
    end: date | None = None,
    actual_end: date | None = None,
    status: str = "未开始",
) -> Milestone:
    return Milestone(name="工程设计", seq=1, plan_start=start, plan_end=end, actual_end=actual_end, status=status)


# ── ① 状态：单一口径 + 优先级 ──────────────────────────────────────────────


def test_milestone_state_values_match_model_contract():
    """状态取值必须落在模型词表里（新增一个值就是实现跑出了契约，见 test_status_contract）。"""
    got = {deadline.MS_DONE, deadline.MS_LATE, deadline.MS_IDLE, deadline.MS_NOW}
    assert got == set(MILESTONE_STATUS), f"milestone_state 的取值与 MILESTONE_STATUS 漂移：{got}"


def test_milestone_state_precedence():
    """优先级：实际完成 > 计划已过 > 计划未到 > 进行中。"""
    # ① 有实际完成日 → 已完成（哪怕状态字段还写着未开始 —— 人工维护常常落后）
    assert deadline.milestone_state(_ms(end=date(2026, 9, 1), actual_end=date(2026, 9, 3)), TODAY) == "已完成"
    assert deadline.milestone_state(_ms(end=date(2026, 12, 1), status="已完成"), TODAY) == "已完成"
    # ② 计划结束日已过、又没完成 → 延期
    assert deadline.milestone_state(_ms(start=date(2026, 9, 1), end=date(2026, 10, 1)), TODAY) == "延期"
    # ③ 计划开始日还没到 → 未开始
    assert deadline.milestone_state(_ms(start=date(2026, 11, 1), end=date(2026, 11, 20)), TODAY) == "未开始"
    # ④ 今天落在计划区间里 → 进行中
    assert deadline.milestone_state(_ms(start=date(2026, 10, 1), end=date(2026, 10, 20)), TODAY) == "进行中"
    # 边界：计划结束日 = 今天 → 还不算延期（当天还来得及）
    assert deadline.milestone_state(_ms(start=date(2026, 9, 1), end=TODAY), TODAY) == "进行中"


def test_milestone_state_survives_missing_dates():
    """两个日期都为空的节点不能炸，也不能被误判成延期。"""
    assert deadline.milestone_state(_ms(), TODAY) == "进行中"


# ── ② 只读 ────────────────────────────────────────────────────────────────


def test_lifecycle_route_is_read_only():
    """时间线接口整段源码里不许出现写操作（铁律 5：写操作必须落审计）。"""
    src = inspect.getsource(project_routes.get_project_lifecycle)
    for bad in (".add(", ".delete(", ".flush(", ".commit(", "audit.log(", "session.merge("):
        assert bad not in src, f"时间线接口里出现了写操作：{bad}"


def test_lifecycle_route_uses_the_single_state_source():
    """状态必须来自 `deadline.milestone_state`，不许在路由里内联一套判断。"""
    src = inspect.getsource(project_routes.get_project_lifecycle)
    assert "milestone_state(" in src, "时间线接口没有用 milestone_state（状态会各算一套）"
    for bad in ("plan_end <", "plan_end>", "actual_end is not None or", "date.today()"):
        assert bad not in src, f"路由里内联了状态判断：{bad}"


# ── ③ 六个时间源一个都不能少 ──────────────────────────────────────────────


def test_lifecycle_exposes_all_six_sources():
    """① 商机记录 ② 立项 ③ 里程碑 ④ 交付截止 ⑤ 质保 ⑥ 回款 —— 少一个页面上就少一段。"""
    src = inspect.getsource(project_routes.get_project_lifecycle)
    for key in ("created_at", "initiated_at", "milestones", "deadline", "warranty", "payments"):
        assert f'"{key}"' in src, f"时间线接口漏了时间源：{key}"


def test_lifecycle_does_not_leak_money():
    """回款节点只给日期 —— 不回传金额，省掉金额分档这一步（也不该在这里泄价）。"""
    src = inspect.getsource(project_routes.get_project_lifecycle)
    for bad in ("amount", "received_amount", "percent"):
        assert f'"{bad}"' not in src, f"时间线接口回传了金额字段：{bad}"
