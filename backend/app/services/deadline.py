"""到期扫描 / 超期提醒（AGENTS §8.3 第 6 条）。

原来只**展示**超期（车间台 `overdue` 是读时算的），谁是超期了、该找谁，系统不吭声。
本模块把"超期/临期"推给**该负责的人**：

| 规则 | 判据 | 提醒谁 |
|---|---|---|
| **任务超期** | `plan_end < 今天` 且任务未完成 | 负责人本人 + 本专业经理 |
| **项目交期临期/超期** | `delivery_end ≤ 今天+7` 且阶段在执行中/交付中 | 项目经理 + 销售负责人 |
| **采购到货超期** | `expected_date > need_date`（到货晚于需求）且还在跑 | 采购（PURCHASE 角色） |
| **里程碑节点状态** | 见 `milestone_state()`（不单独提醒；供时间线等展示共用） | — |

实现方式 —— **惰性扫描**（与 G1 项目自动归档同一套路）：
本系统**不用 Redis / 消息队列 / 调度器**（技术栈铁律），所以不做后台定时任务，
而是在 `GET /workbench/me` 这类"人人都会打开"的入口顺手扫一遍。
幂等靠 `notification.dedup_key`（同一件事**每天最多提醒一次**，不刷屏）。
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.initiation import Milestone, PurchaseRequest
from app.models.project import Project
from app.models.task import Task
from app.services import notify
from app.services.reviewers import team_lead_for

# 交期提前多少天开始提醒
NEAR_DAYS = 7
# 还在"跑"的项目阶段（已关闭/已归档不用再催）
_ACTIVE_STAGES = ("执行中", "交付中")
# 采购还在跑的（末态不用再催）
_OPEN_REQ = ("待采购", "在途", "待入库", "部分到货", "现场待验收", "不合格")

# 里程碑节点状态（4 个值，作为**契约**：前端不再自己算一套）
MS_DONE, MS_LATE, MS_IDLE, MS_NOW = "已完成", "延期", "未开始", "进行中"


def milestone_state(m: Milestone, today: date | None = None) -> str:
    """节点状态的**单一口径**（2026-10-07）。

    为什么要集中：项目详情顶部的全生命周期时间线要看「哪些节点拖了」，
    而车间台 / 超期扫描各自也有一套“算不算超期”的判断 —— 再各算一套就是
    AGENTS §8.5 那条“同一个概念在多处各算一套”（六通道六种答案的翻版）。

    判据（顺序敏感）：
      ① 有实际完成日 或 状态已是「已完成」 → 已完成
      ② 计划结束日 < 今天、且没完成   → 延期
      ③ 计划开始日 > 今天             → 未开始
      ④ 其余                           → 进行中
    """
    day = today or date.today()
    if m.actual_end is not None or m.status == MS_DONE:
        return MS_DONE
    if m.plan_end is not None and m.plan_end < day:
        return MS_LATE
    if m.plan_start is not None and m.plan_start > day:
        return MS_IDLE
    return MS_NOW


# 提醒键统一由 notify.daily_key 提供（收款提醒也用同一套去重口径）
_key = notify.daily_key


def scan_due(session: Session, *, today: date | None = None) -> dict:
    """扫一遍超期/临期并提醒（幂等）。:returns 各类发了多少条。"""
    day = today or date.today()
    out = {"task_overdue": 0, "project_due": 0, "purchase_overdue": 0}

    # ── ① 任务超期 ────────────────────────────────────────────────────────
    tasks = session.scalars(
        select(Task).where(
            Task.status.not_in(("已完成", "已取消")),
            Task.plan_end.is_not(None),
            Task.plan_end < day,
        )
    ).all()
    for t in tasks:
        days = (day - t.plan_end).days
        targets = [t.owner_id] if t.owner_id else []
        lead = team_lead_for(session, t.profession)
        if lead is not None:
            targets.append(lead.id)
        out["task_overdue"] += notify.notify(
            session,
            targets,
            type_=notify.TYPE_TASK,
            title=f"任务超期 {days} 天：{t.task_no} {t.title}",
            body=f"计划完成 {t.plan_end}，现在还差着。项目 {t.project_no}"
            + (f" / 设备 {t.equip_no}" if t.equip_no else ""),
            link="/my-tasks",
            biz_type="task",
            biz_id=t.id,
            dedup_key=_key("task-overdue", t.id, day),
        )

    # ── ② 项目交期临期 / 超期 ────────────────────────────────────────────
    projects = session.scalars(select(Project).where(Project.stage.in_(_ACTIVE_STAGES))).all()
    for p in projects:
        due = p.delivery_end_date  # ★ 与项目列表同一口径（Project.delivery_end_date）
        if due is None or due > day + timedelta(days=NEAR_DAYS):
            continue
        days = (due - day).days  # 负数 = 已超期
        when = f"已超期 {-days} 天" if days < 0 else (f"还剩 {days} 天" if days else "就是今天")
        out["project_due"] += notify.notify(
            session,
            [p.pm_id, p.sales_id],
            type_=notify.TYPE_TASK,
            title=f"项目交期{when}：{p.project_no} {p.project_name}",
            body=f"合同交期 {due}（阶段：{p.stage}）。",
            link=f"/projects/{p.project_no}",
            biz_type="project",
            dedup_key=_key("project-due", p.project_no, day),
        )

    # ── ③ 采购到货超期（到货晚于需求）────────────────────────────────────
    reqs = session.scalars(
        select(PurchaseRequest).where(
            PurchaseRequest.status.in_(_OPEN_REQ),
            PurchaseRequest.expected_date.is_not(None),
            PurchaseRequest.need_date.is_not(None),
            PurchaseRequest.expected_date > PurchaseRequest.need_date,
        )
    ).all()
    for r in reqs:
        late = (r.expected_date - r.need_date).days
        out["purchase_overdue"] += notify.notify_role(
            session,
            "PURCHASE",
            type_=notify.TYPE_PURCHASE,
            title=f"到货晚于需求 {late} 天：{r.item_no}",
            body=f"{r.project_no or '—'}：需求 {r.need_date}，供应商承诺 {r.expected_date}（状态 {r.status}）。",
            link="/purchase",
            biz_type="purchase_request",
            biz_id=r.id,
            dedup_key=_key("purchase-overdue", r.id, day),
        )

    if any(out.values()):
        session.commit()
    return out


def overdue_tasks_count(session: Session, owner_id: int, *, today: date | None = None) -> int:
    """某人名下超期未完成的任务数（工作台角标用，读时算，不写库）。"""
    day = today or date.today()
    from sqlalchemy import func

    return int(
        session.scalar(
            select(func.count())
            .select_from(Task)
            .where(
                Task.owner_id == owner_id,
                Task.status.not_in(("已完成", "已取消")),
                Task.plan_end.is_not(None),
                Task.plan_end < day,
            )
        )
        or 0
    )
