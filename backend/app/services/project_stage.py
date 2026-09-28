"""项目阶段状态机（依据《00 方案·业务与建设》§3）。

商机、订单、合同、项目是**同一行记录的不同阶段**，`stage` 只能按合法路径推进，
且每次推进都落操作记录（谁、何时、从哪个阶段到哪个阶段）。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.project import Project
from app.services import audit

# 阶段
LEAD = "线索"
WON_PENDING = "成交待立项"
EXECUTING = "执行中"
DELIVERING = "交付中"
WARRANTY = "质保"
ARCHIVED = "已归档"  # ★ G1（09 卷 §3）：质保期过 → 自动归档（终态、只读）
CLOSED = "已关闭"

ALL_STAGES = (LEAD, WON_PENDING, EXECUTING, DELIVERING, WARRANTY, ARCHIVED, CLOSED)

# 合法流转
STAGE_FLOW: dict[str, set[str]] = {
    LEAD: {WON_PENDING, CLOSED},
    WON_PENDING: {EXECUTING, CLOSED},
    EXECUTING: {DELIVERING, CLOSED},
    DELIVERING: {WARRANTY, CLOSED},
    WARRANTY: {ARCHIVED, CLOSED},
    ARCHIVED: set(),  # 终态：归档后只读（要改先走变更/解归档）
    CLOSED: set(),
}

# 关闭原因
CLOSE_REASONS = ("价格", "交期", "技术不满足", "客户取消", "对手中标", "其他")


class StageError(Exception):
    """非法阶段流转。"""


def assert_transition(current: str, target: str, *, allow_same: bool = False) -> None:
    """校验阶段流转。

    默认**不允许“原地不动”** —— 否则重复提交（比如已成交又点一次成交登记）会
    把已有数据整片覆盖成空值，或者已关闭的项目再关闭一次。
    """
    if current == target:
        if allow_same:
            return
        raise StageError(f"项目已经是「{current}」阶段，不能重复执行该操作")
    allowed = STAGE_FLOW.get(current, set())
    if target not in allowed:
        raise StageError(
            f"阶段不能从「{current}」直接变成「{target}」（允许：{'/'.join(sorted(allowed)) or '无'}）"
        )


def assert_writable(project) -> None:
    """★ G1：已归档项目**只读**（要改先走变更/解归档）。"""
    if getattr(project, "stage", None) == ARCHIVED:
        raise StageError(
            f"项目 {project.project_no} 已归档（质保期已过）—— 只能看，不能改；要改先走变更流程"
        )


def archive_due_projects(session: Session) -> int:
    """★ G1（09 卷 §3）：**质保期过 → 自动归档**（惰性扫描）。

    客户口径：“归档是自动的。我们不是有一个质保期嘛，质保期过了就自动归档。”

    实现说明 —— 本系统**不用 Redis / 消息队列 / K8s**（技术栈铁律），**也没有调度器**，
    所以做成**读时惰性扫描**（与现有 `manufacturing.overdue` 同一套路）：
    谁来读项目列表 / 详情 / 工作台，顺手把到期该归档的置掉。幂等、无新依赖、无需定时任务。
    :returns 本次归档了几个（便于审计/测试）。
    """
    from datetime import UTC, date, datetime

    rows = session.scalars(
        select(Project).where(
            Project.stage == WARRANTY,
            Project.warranty_end.is_not(None),
            Project.warranty_end < date.today(),
        )
    ).all()
    for p in rows:
        p.stage = ARCHIVED
        p.archived_at = datetime.now(UTC)
        audit.log(
            session,
            user=None,
            action="archive",
            object_type="project",
            object_ref=p.project_no,
            summary=f"自动归档 {p.project_no}：质保期 {p.warranty_end} 已过",
        )
    if rows:
        session.commit()
    return len(rows)
