"""付款计划变更流程（2026-09-30 客户拍板）。

**业务背景**：成交登记只在「线索」阶段能提交（`routes/project.deal`），成交后付款节点没有任何修改口 ——
录错（实测过比例合计 170%、金额超合同）或客户后来改分期，都只能一直错下去。

**客户口径**：“按你的建议走，做付款计划变更单” + 铁律 4「一切改动都是变更，必须走审批」。

**口径（写死在代码里，UI 与文档要说同一句）**：
1. **只改未来节点**：`received_amount > 0` 的节点是既成事实，不许改不许删；变更单只填“还没收的节点”。
2. 校验：`Σ(已收比例) + Σ(新计划比例) = 100%`；金额合计不得超合同额（与 `deal()` 同一口径）。
3. 审批人 = **商务部总监**（付款归商务，铁律 13「按单据归属部门找人」）；提交人不能自己审。
4. 留痕：`before_terms` 快照 + 变更明细 + 审批人/时间/意见 + `audit_log`。
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.payment_change import (
    PAY_CHANGE_APPROVED,
    PAY_CHANGE_PENDING,
    PAY_CHANGE_REJECTED,
    PAY_CHANGE_WITHDRAWN,
    PaymentChange,
    PaymentChangeLine,
)
from app.models.platform import User
from app.models.project import PaymentTerm, Project
from app.services import notify
from app.services import payment as payment_svc
from app.services.numbering import next_number, year_scope_key
from app.services.reviewers import director_in_dept

# 付款归商务（AGENTS §8.1：收款提醒发给项目销售负责人 + 销售部总监）
PAY_DEPT = "SALES"


class PaymentChangeError(Exception):
    """付款计划变更的域错误（路由统一转 400，见 main.py 的域错误处理器）。"""


def _received(t: PaymentTerm) -> float:
    return float(t.received_amount or 0)


def _snapshot(t: PaymentTerm) -> dict:
    """把一条付款节点拍成快照（留痕用；金额/比例/收款都留）。"""
    return {
        "seq": t.seq,
        "node_name": t.node_name,
        "trigger_node": t.trigger_node,
        "percent": float(t.percent) if t.percent is not None else None,
        "amount": float(t.amount) if t.amount is not None else None,
        "expect_date": t.expect_date.isoformat() if t.expect_date else None,
        "condition": t.condition,
        "received_amount": float(t.received_amount or 0),
        "received_date": t.received_date.isoformat() if t.received_date else None,
    }


def plan_errors(*, contract_amount: float, current: list[PaymentTerm], terms: list[dict]) -> list[str]:
    """校验新计划（**纯函数**，不碰库 —— 单测直接打它；`submit()` 也用它）。

    三条口径（缺一不可，客户 2026-09-30 拍板的“只改未来节点”）：
      1. **已收款的节点不许改**：它的名字不能出现在新计划里
      2. **比例**：Σ(已收比例) + Σ(新计划比例) = 100%
      3. **金额**：Σ(已收节点应收) + Σ(新计划) ≤ 合同额
    """
    errs: list[str] = []
    if not terms:
        return ["请填新的付款计划（还没收的节点）"]
    if any(not (t.get("node_name") or "").strip() for t in terms):
        errs.append("每个付款节点都要有节点名")
    paid = [t for t in current if _received(t) > 0]
    paid_names = {t.node_name for t in paid}
    clash = [t["node_name"] for t in terms if (t.get("node_name") or "") in paid_names]
    if clash:
        errs.append(
            f"「{'、'.join(clash)}」已经收到过款，不能改 —— "
            "变更单只填还没收的节点；要表达“同一阶段分两期”，请换个名字（如「发货款（尾）」）"
        )
    paid_pct = sum(float(t.percent or 0) for t in paid)
    new_pct = sum(float(t.get("percent") or 0) for t in terms if t.get("percent") is not None)
    if new_pct and abs(paid_pct + new_pct - 100) > 0.5:
        errs.append(
            f"比例对不上：已收 {round(paid_pct, 2)}% + 新计划 {round(new_pct, 2)}% = "
            f"{round(paid_pct + new_pct, 2)}%，必须是 100%"
        )
    if contract_amount:
        paid_due = sum(float(t.amount or 0) for t in paid)
        new_amt = sum(float(t.get("amount") or 0) for t in terms)
        if not new_amt:  # 只填了比例没填金额 → 按合同额折算后再比
            new_amt = sum(
                contract_amount * float(t["percent"]) / 100
                for t in terms
                if t.get("percent") is not None
            )
        if paid_due + new_amt - contract_amount > 1:
            errs.append(
                f"金额超合同额：已收节点应收 ¥{paid_due:,.0f} + 新计划 ¥{new_amt:,.0f} "
                f"> 合同 ¥{contract_amount:,.0f}"
            )
    return errs


def list_terms(session: Session, project_no: str) -> list[PaymentTerm]:
    return list(
        session.scalars(
            select(PaymentTerm).where(PaymentTerm.project_no == project_no).order_by(PaymentTerm.seq)
        ).all()
    )


def change_lines(session: Session, change_id: int) -> list[PaymentChangeLine]:
    return list(
        session.scalars(
            select(PaymentChangeLine)
            .where(PaymentChangeLine.change_id == change_id)
            .order_by(PaymentChangeLine.seq)
        ).all()
    )


def change_dict(session: Session, c: PaymentChange) -> dict:
    """变更单（供接口返回）。"""
    names = {u.id: u.name for u in session.scalars(select(User)).all()}
    lines = change_lines(session, c.id)
    return {
        "id": c.id,
        "change_no": c.change_no,
        "project_no": c.project_no,
        "reason": c.reason,
        "status": c.status,
        "before_terms": c.before_terms or [],
        "terms": [
            {
                "seq": ln.seq,
                "node_name": ln.node_name,
                "trigger_node": ln.trigger_node,
                "percent": float(ln.percent) if ln.percent is not None else None,
                "amount": float(ln.amount) if ln.amount is not None else None,
                "expect_date": ln.expect_date.isoformat() if ln.expect_date else None,
                "condition": ln.condition,
            }
            for ln in lines
        ],
        "requested_by": c.requested_by,
        "requested_by_name": names.get(c.requested_by) if c.requested_by else None,
        "requested_at": c.requested_at,
        "decided_by": c.decided_by,
        "decided_by_name": names.get(c.decided_by) if c.decided_by else None,
        "decided_at": c.decided_at,
        "decision_note": c.decision_note,
    }


def approver_for(session: Session) -> User | None:
    """这一单该谁批 = 商务部总监（不全局兜底 —— N21/M-01 的教训）。"""
    return director_in_dept(session, PAY_DEPT)


def submit(
    session: Session,
    *,
    project_no: str,
    reason: str,
    terms: list[dict],
    actor: User,
) -> PaymentChange:
    """发起变更单（只填未来节点）。校验不通过直接 400。"""
    project = session.scalar(select(Project).where(Project.project_no == project_no))
    if project is None:
        raise PaymentChangeError(f"项目不存在：{project_no}")
    if project.stage == "已归档":
        raise PaymentChangeError("项目已归档 —— 只能看，不能改")

    current = list_terms(session, project_no)
    if not current:
        raise PaymentChangeError("这个项目还没有付款节点（先做成交登记）")
    reason = (reason or "").strip()
    if not reason:
        raise PaymentChangeError("请写清为什么要改（审批人要看依据）")
    # 三条口径走**纯函数**（plan_errors）—— 单测直接打它，不靠起库
    errs = plan_errors(contract_amount=float(project.amount or 0), current=current, terms=terms)
    if errs:
        raise PaymentChangeError(errs[0])
    paid = [t for t in current if _received(t) > 0]

    c = PaymentChange(
        change_no=next_number(session, "PAY_CHANGE", scope_key=year_scope_key()),
        project_no=project_no,
        reason=reason,
        status=PAY_CHANGE_PENDING,
        before_terms=[_snapshot(t) for t in current],
        requested_by=actor.id,
        requested_at=datetime.now(UTC),
    )
    session.add(c)
    session.flush()
    contract_amount = float(project.amount or 0)
    for i, t in enumerate(terms, start=1):
        amount = float(t.get("amount") or 0)
        pct = t.get("percent")
        if not amount and pct and contract_amount:
            # 只填比例没填金额 → 按合同额折算（与 deal() 一致）
            amount = contract_amount * float(pct) / 100
        session.add(
            PaymentChangeLine(
                change_id=c.id,
                seq=i,
                node_name=t["node_name"],
                # 与 deal() 同一口径：显式优先，否则按节点名推断（G2）
                trigger_node=payment_svc.normalize_trigger(t.get("trigger_node"), t["node_name"]),
                percent=pct,
                amount=amount or None,
                expect_date=t.get("expect_date"),
                condition=t.get("condition"),
            )
        )
    session.flush()

    boss = approver_for(session)
    if boss is None:
        raise PaymentChangeError("商务部还没有配总监 —— 先到「用户与权限」配审核人")
    link = f"/projects/{project_no}?focus=contract"
    notify.notify(
        session,
        [boss.id],
        type_="payment",
        title=f"待审批：付款计划变更 {c.change_no}（{project_no}）",
        body=f"{actor.name} 提交：{reason}",
        link=link,
        biz_type="payment_change",
        biz_id=c.id,
        actor_id=actor.id,
    )
    return c


def decide(
    session: Session,
    change: PaymentChange,
    *,
    approve: bool,
    note: str | None,
    actor: User,
) -> PaymentChange:
    """商务总监审批。批准 = 替换未收节点（已收的保持原样）。"""
    if change.status != PAY_CHANGE_PENDING:
        raise PaymentChangeError(f"这张单当前是「{change.status}」，不在待审状态")
    boss = approver_for(session)
    if boss is None:
        raise PaymentChangeError("商务部还没配总监 —— 先到「用户与权限」配审核人")
    if boss.id != actor.id:
        raise PaymentChangeError("只有本部门（商务部）总监能审这一级")
    if change.requested_by == actor.id:
        raise PaymentChangeError("不能审自己提交的变更单")
    note = (note or "").strip()
    if not approve and not note:
        raise PaymentChangeError("否决必须写清理由")

    if approve:
        _apply(session, change)
    change.status = PAY_CHANGE_APPROVED if approve else PAY_CHANGE_REJECTED
    change.decided_by = actor.id
    change.decided_at = datetime.now(UTC)
    change.decision_note = note or None
    session.flush()

    link = f"/projects/{change.project_no}?focus=contract"
    who = [change.requested_by] if change.requested_by else []
    project = session.scalar(select(Project).where(Project.project_no == change.project_no))
    if project and project.sales_id:
        who.append(project.sales_id)
    notify.notify(
        session,
        who,
        type_="payment",
        title=f"付款计划变更 {change.change_no} {'已批准' if approve else '被否决'}（{change.project_no}）",
        body=(note or "已按新计划执行（只改未收节点，已收的原样保留）"),
        link=link,
        biz_type="payment_change",
        biz_id=change.id,
        actor_id=actor.id,
    )
    return change


def _apply(session: Session, change: PaymentChange) -> None:
    """把新计划落到付款节点上：**已收的原地保留**，未收的整体替换。

    ★ 为什么保留已收节点而不是“按新比例重算”：钱已经进账了，重算会让台账与银行流水对不上。
      已收节点还欠的尾款（amount - received）也留在原节点上 —— 那是客户按旧计划欠的，不能凭空抹掉。
    """
    current = list_terms(session, change.project_no)
    paid = [t for t in current if _received(t) > 0]
    if paid:
        # 已收节点留在最前（seq 顺序稳定：1..k）
        for i, t in enumerate(paid, start=1):
            t.seq = i
        session.flush()
    else:
        session.execute(delete(PaymentTerm).where(PaymentTerm.project_no == change.project_no))
        session.flush()

    # 未收节点整体替换
    session.execute(
        delete(PaymentTerm).where(
            PaymentTerm.project_no == change.project_no,
            PaymentTerm.received_amount.is_(None) | (PaymentTerm.received_amount <= 0),
        )
    )
    session.flush()
    base = len(paid)
    for i, ln in enumerate(change_lines(session, change.id), start=1):
        amount = float(ln.amount or 0)
        session.add(
            PaymentTerm(
                project_no=change.project_no,
                seq=base + i,
                node_name=ln.node_name,
                # 与 deal() 同一口径（G2）
                trigger_node=payment_svc.normalize_trigger(ln.trigger_node, ln.node_name),
                percent=ln.percent,
                amount=amount or None,
                expect_date=ln.expect_date,
                condition=ln.condition,
            )
        )
    session.flush()
    # ★ 质保金按**变更后**的完整计划重算（与 deal() 同一条规则：名字含「质保」的那条）——
    #   新计划里没有质保金节点（客户全额早付）时，这里要归零，否则报表上会留着已不存在的质保金。
    project = session.scalar(select(Project).where(Project.project_no == change.project_no))
    if project is not None:
        project.warranty_amount = sum(
            float(t.amount or 0)
            for t in list_terms(session, change.project_no)
            if "质保" in t.node_name
        ) or None


def withdraw(session: Session, change: PaymentChange, *, actor: User) -> PaymentChange:
    """提交人撤回（待审 → 已撤销），解锁后可重新提一张。"""
    if change.status != PAY_CHANGE_PENDING:
        raise PaymentChangeError(f"这张单当前是「{change.status}」，不能撤回")
    if change.requested_by != actor.id:
        raise PaymentChangeError("只有提交人能撤回")
    change.status = PAY_CHANGE_WITHDRAWN
    change.decided_at = datetime.now(UTC)
    session.flush()
    return change
