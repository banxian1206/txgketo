"""项目阶段状态机（依据《00 方案·业务与建设》§3）。

商机、订单、合同、项目是**同一行记录的不同阶段**，`stage` 只能按合法路径推进，
且每次推进都落操作记录（谁、何时、从哪个阶段到哪个阶段）。
"""

from __future__ import annotations

# 阶段
LEAD = "线索"
WON_PENDING = "成交待立项"
EXECUTING = "执行中"
DELIVERING = "交付中"
WARRANTY = "质保"
CLOSED = "已关闭"

ALL_STAGES = (LEAD, WON_PENDING, EXECUTING, DELIVERING, WARRANTY, CLOSED)

# 合法流转
STAGE_FLOW: dict[str, set[str]] = {
    LEAD: {WON_PENDING, CLOSED},
    WON_PENDING: {EXECUTING, CLOSED},
    EXECUTING: {DELIVERING, CLOSED},
    DELIVERING: {WARRANTY, CLOSED},
    WARRANTY: {CLOSED},
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
