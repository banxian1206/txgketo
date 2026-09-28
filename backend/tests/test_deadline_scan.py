# -*- coding: utf-8 -*-
"""到期扫描 / 超期提醒 护栏（AGENTS §8.3 第 6 条，2026-09-28）。

原来只**展示**超期，不吭声；现在推到该负责的人，且必须**幂等**（每天最多一次，不刷屏）。
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from app.models.project import Project
from app.services.deadline import NEAR_DAYS, _key

ROOT = Path(__file__).resolve().parents[2]
BE = ROOT / "backend" / "app"


def _code(rel: str) -> str:
    p = BE / rel
    return "\n".join(ln for ln in p.read_text(encoding="utf-8").splitlines() if not ln.strip().startswith("#"))


# ── 幂等键 ─────────────────────────────────────────────────────────────────
def test_dedup_key_is_per_day():
    """★ 同一天同一件事一个键（再扫不重复发）。"""
    d1, d2 = date(2026, 9, 28), date(2026, 9, 29)
    assert _key("task-overdue", 12, d1) == "task-overdue:12:2026-09-28"
    assert _key("task-overdue", 12, d1) != _key("task-overdue", 12, d2), "换天要能再提醒一次"
    assert _key("task-overdue", 12, d1) != _key("task-overdue", 13, d1), "不同对象各自一个键"


def test_all_three_rules_pass_a_dedup_key():
    src = _code("services/deadline.py")
    assert src.count("dedup_key=_key(") == 3, "三条规则都要带去重键，否则会刷屏"


def test_notify_skips_users_already_notified_for_the_key():
    src = _code("services/notify.py")
    i = src.index("def notify(")
    seg = src[i : i + 1400]
    assert "dedup_key" in seg and "Notification.dedup_key == dedup_key" in seg


# ── 三条规则都接上了 ────────────────────────────────────────────────────────
def test_scan_covers_task_project_purchase():
    src = _code("services/deadline.py")
    assert "Task.plan_end < day" in src, "任务超期"
    assert "delivery_end_date" in src, "项目交期临期/超期"
    assert "expected_date > PurchaseRequest.need_date" in src, "采购到货晚于需求"
    assert "team_lead_for(" in src, "任务超期要带上本专业经理"


# ── 交期口径只此一处（防“列表说还剩 3 天、提醒说已超期”）────────────────
def test_delivery_due_is_single_source():
    assert Project(period_start=date(2026, 1, 1), delivery_days=90).delivery_end_date == date(2026, 4, 1)
    # 没起算日 → 退回周期止
    assert Project(period_start=None, period_end=date(2026, 5, 1)).delivery_end_date == date(2026, 5, 1)
    assert Project(period_start=None, period_end=None).delivery_end_date is None
    routes = _code("api/routes/project.py")
    assert "p.delivery_end_date" in routes, "列表页也要用同一个口径（否则两处会漂移）"


def test_near_window_is_seven_days():
    assert NEAR_DAYS == 7


# ── 挂在工作台入口，且失败不能把工作台弄挂 ─────────────────────────────────
def test_scan_hooked_into_workbench_and_is_exception_safe():
    src = _code("api/routes/workbench.py")
    assert "scan_due(session)" in src, "要挂在一个“人人都会打开”的入口上（本系统没有调度器）"
    i = src.index("scan_due(session)")
    seg = src[max(0, i - 200) : i + 200]
    assert "except Exception" in seg, "提醒失败绝不能让工作台打不开"
    assert "overdue_tasks_count(" in src, "工作台要给出“我超期几项”的角标"


def test_lazy_scan_no_scheduler_dependency():
    """★ 技术栈铁律：不用 Redis / 消息队列 / 调度器 —— 到期只能“读时惰性扫”。

    只看**导入**不看正文（正文里正当地提了“不用 redis”这几个字）。
    """
    src = _code("services/deadline.py")
    imports = "\n".join(
        ln for ln in src.splitlines() if ln.strip().startswith(("import ", "from "))
    )
    for forbidden in ("celery", "apscheduler", "redis", "kombu"):
        assert forbidden not in imports.lower(), f"不得引入调度/消息中间件（导入了 {forbidden}）"
    # 只用标准库 + SQLAlchemy（没有新依赖）
    assert "timedelta" in imports
