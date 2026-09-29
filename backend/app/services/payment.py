"""G2（09 卷 §3）：付款节点绑业务节点 → 节点达成时**提醒商务部**收款。

客户口径 2026-09-28：
  “这些节点要跟物流能够对上。因为我**发了之后**，就必须要**催商务部**的人去把这个款给拿下来。”
  “（提醒）肯定只是提醒商务，**不能卡住流程**。比如提醒你‘我们已经发货了，你要收款了’，
   或者‘我们已经验收了，你要收款了’。这个提醒就挂在那里，相当于是提示你还有多少未收款。”

设计要点：
- **只提醒、不卡流程** —— 节点照常推进，只是发一条站内消息给商务部
- 付款节点绑哪个业务节点：`node_name` 关键词推断（与既有“名字含「质保」= 质保金”同一套路），
  也可由payload显式传 `trigger_node` 覆盖
- 已收满的节点不再提醒
"""

from __future__ import annotations


from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.project import (
    PAYMENT_TRIGGERS,
    PAY_TRIGGER_ACCEPT,
    PAY_TRIGGER_ARRIVE,
    PAY_TRIGGER_SHIP,
    PAY_TRIGGER_WARRANTY,
    PaymentTerm,
    Project,
)
from app.services import notify
from app.services.reviewers import director_in_dept

# 关键词 → 业务节点（顺序敏感：先匹配更具体的前缀）
_KEYWORD_RULES: tuple[tuple[str, str], ...] = (
    ("质保", PAY_TRIGGER_WARRANTY),
    ("验收", PAY_TRIGGER_ACCEPT),
    ("到货", PAY_TRIGGER_ARRIVE),
    ("发货", PAY_TRIGGER_SHIP),
)


def infer_trigger(node_name: str | None) -> str | None:
    """从付款节点名字推断它由哪个业务节点触发（推不出就返回 None = 纯时间点/预收款）。"""
    name = (node_name or "").strip()
    if not name:
        return None
    for kw, node in _KEYWORD_RULES:
        if kw in name:
            return node
    return None


def normalize_trigger(value: str | None, node_name: str | None = None) -> str | None:
    """显式传入的值优先；否则按名字推断。非法值报错（不静默丢）。"""
    if value is None or value == "":
        return infer_trigger(node_name)
    if value not in PAYMENT_TRIGGERS:
        raise ValueError(f"付款节点的关联节点只能是：{'/'.join(PAYMENT_TRIGGERS)}")
    return value


def remind(session: Session, project_no: str, node: str, *, actor_id: int | None = None) -> int:
    """★ 节点达成 → 提醒商务部收款（**只提醒，不卡流程**）。

    **收件人精度**（第九轮报告 Q-2）：只发**项目自己的销售负责人** + **销售部总监**，
    不再 `notify_role("SALES")` 群发 —— 销售多于 2 人时，每人都会被别人项目的催款打扰。
    口径与 `deadline.py`（任务超期精确到负责人 + 同专业经理）对齐。

    **幂等**（Q-3）：带 `dedup_key`，同一项目同一节点**每天最多催一次** ——
    否则分批发运时每趟 `depart` 都让同一笔发货款再催一次（未收额相同时看着就是刷屏）。

    :returns 实际发出条数。
    """
    terms = session.scalars(
        select(PaymentTerm).where(
            PaymentTerm.project_no == project_no, PaymentTerm.trigger_node == node
        )
    ).all()
    outstanding = [
        t for t in terms if float(t.amount or 0) - float(t.received_amount or 0) > 1e-6
    ]
    if not outstanding:
        return 0
    total = sum(float(t.amount or 0) - float(t.received_amount or 0) for t in outstanding)
    project = session.get(Project, project_no)
    boss = director_in_dept(session, "SALES")
    names = "、".join(t.node_name for t in outstanding)
    title = f"该收款了：{project_no} 已「{node}」（未收 ¥{total:,.0f}）"
    body = (
        f"付款节点：{names}。项目 {project.project_name if project else project_no}"
        f"已到达「{node}」节点，请去收款并登记回款。"
    )
    key = notify.daily_key("payment-remind", f"{project_no}:{node}", date.today())
    # ① 项目自己的销售负责人 + ② 销售部总监（按**部门**找 —— N21/M-01 口径，不按提交人）
    targets = [t for t in (project.sales_id if project else None, boss.id if boss else None) if t]
    if not targets:
        # 兵底：老数据没填销售负责人、部门也没配总监 → 群发 SALES（**钱的事不能静默丢掉**）
        return notify.notify_role(
            session,
            "SALES",
            type_=notify.TYPE_TASK,
            title=title,
            body=body,
            link=f"/projects/{project_no}",
            biz_type="payment_term",
            biz_id=outstanding[0].id,
            actor_id=actor_id,
            dedup_key=key,
        )
    # ⚠ 注意：**不能靠 `sent == 0` 判“没配收件人”** —— 去重命中时它也是 0，
    #   那样会把“今天已经催过了”误当成“没人可催”，转而触发下面那个兜底群发（反而扰乱无关销售）。
    return notify.notify(
        session,
        targets,
        type_=notify.TYPE_TASK,
        title=title,
        body=body,
        link=f"/projects/{project_no}",
        biz_type="payment_term",
        biz_id=outstanding[0].id,
        actor_id=actor_id,
        dedup_key=key,
    )


def trigger_for_shipment(session: Session, project_no: str, *, actor_id: int | None = None) -> int:
    """发运 → 提醒「发货款」。"""
    return remind(session, project_no, PAY_TRIGGER_SHIP, actor_id=actor_id)


def trigger_for_arrival(session: Session, project_no: str, *, actor_id: int | None = None) -> int:
    """到货 → 提醒「到货款」。"""
    return remind(session, project_no, PAY_TRIGGER_ARRIVE, actor_id=actor_id)


def trigger_for_acceptance(session: Session, project_no: str, *, actor_id: int | None = None) -> int:
    """客户验收通过 → 提醒「验收款」+「质保金」（两者同在验收时点）。"""
    n = remind(session, project_no, PAY_TRIGGER_ACCEPT, actor_id=actor_id)
    return n + remind(session, project_no, PAY_TRIGGER_WARRANTY, actor_id=actor_id)
