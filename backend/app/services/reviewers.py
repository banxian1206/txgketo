"""审核链查找（05 卷 §2.1 / §0.1#13）。

设计提交的两级审核：**本专业设计组长 → 工程部总监**。
· 提交人本人是组长 → 跳过一级，总监直审
· 提交人本人是总监 → 拒绝（不允许自审）
审核人按**部门岗位**找（`app_user.profession` / `app_user.position`），
不按项目团队角色——两者可以是同一个人，但语义分开。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.platform import LEGACY_POSITIONS, POSITION_DIRECTOR, POSITION_LEAD, Org, User


class ReviewerError(ValueError):
    """审核链缺人 / 自审等非法情况。"""


def chain_levels(submitter_position: str | None) -> tuple[bool, bool]:
    """按提交人岗位判断要走几级：返回（是否要一级经理审, 是否要二级总监审）。"""
    position = LEGACY_POSITIONS.get(submitter_position or "", submitter_position)
    if position == POSITION_DIRECTOR:
        raise ReviewerError("总监不提交（他负责审批）；请用组员的帐号提交")
    if position == POSITION_LEAD:
        return False, True  # 经理本人提交：跳过一级，总监直审
    return True, True


def team_lead_for(session: Session, profession: str | None) -> User | None:
    """本专业的经理（二级）。"""
    return session.scalar(
        select(User).where(
            User.position == POSITION_LEAD,
            User.profession == profession,
            User.is_active.is_(True),
        )
    )


def director(session: Session) -> User | None:
    """总监（兜底：全局第一个，用于没有组织信息的老数据）。

    注：**不再**用于评审/改版链求二级审核人（M-01）—— 5 个总监里只有工程总监有
    `design:audit`，无 ORDER BY 地取一个可能落到销售/采购/仓管/总经理，
    拿到的人无权审 → 单据永久卡死。链上请用 `design_director()`。
    加 `order_by` 至少让这个兼容兜底**确定**下来（原来同一输入多次结果不同）。
    """
    return session.scalar(
        select(User)
        .where(User.position == POSITION_DIRECTOR, User.is_active.is_(True))
        .order_by(User.id)
    )


def _department_root(session: Session, org_id: int | None) -> Org | None:
    org = session.get(Org, org_id) if org_id else None
    seen: set[int] = set()
    while org is not None and org.parent_id and org.parent_id not in seen:
        seen.add(org.id)
        parent = session.get(Org, org.parent_id)
        if parent is None:
            break
        org = parent
    return org


def _subtree_ids(session: Session, root_id: int) -> set[int]:
    ids = {root_id}
    frontier = [root_id]
    while frontier:
        rows = session.scalars(select(Org).where(Org.parent_id.in_(frontier))).all()
        frontier = [r.id for r in rows if r.id not in ids]
        ids.update(frontier)
    return ids


def lead_for_dept(session: Session, user: User) -> User | None:
    """提交人所在部门的经理（对标 `director_for`）。采购员没有 profession，不能复用 `team_lead_for`。"""
    dept = _department_root(session, user.org_id)
    if dept is not None:
        lead = session.scalar(
            select(User)
            .where(
                User.position == POSITION_LEAD,
                User.is_active.is_(True),
                User.org_id.in_(_subtree_ids(session, dept.id)),
            )
            .order_by(User.id)
        )
        if lead is not None:
            return lead
    return None


def dept_code_of(session: Session, user: User) -> str | None:
    """用户所属**部门根**的 code（如 SALES / PURCHASE / ENG）；无部门返回 None。

    用于"本部门才能改本部门的东西"这类硬拦（客户口径 2026-09-28）。
    """
    dept = _department_root(session, user.org_id)
    return dept.code if dept is not None else None


def _dept_by_code(session: Session, code: str) -> Org | None:
    """按部门 code 取根（如 PURCHASE / ENG / SALES）。"""
    return session.scalar(select(Org).where(Org.code == code))


def lead_in_dept(session: Session, dept_code: str) -> User | None:
    """指定部门的经理（本部门及下级）。

    与 `lead_for_dept` 的区别：**按单据归属的业务部门**找，而不是按提交人所在部门。
    采购单审批要用它 —— 单据归哪个部门批，取决于"这是采购"，与谁提交无关
    （客户口径 2026-09-28：**审批流程都在本部门之内走**）。
    """
    dept = _dept_by_code(session, dept_code)
    if dept is None:
        return None
    return session.scalar(
        select(User)
        .where(
            User.position == POSITION_LEAD,
            User.is_active.is_(True),
            User.org_id.in_(_subtree_ids(session, dept.id)),
        )
        .order_by(User.id)
    )


def director_in_dept(session: Session, dept_code: str) -> User | None:
    """指定部门的总监（本部门及下级）。

    ★ 不全局兜底：兜底到别的部门的总监会造成**跨部门审批**（应审本单的人反而被拦），
    并造出"单据永久卡在待审"（N21，2026-09-28 实测）。找不到就返回 None，由调用方明确报错。
    """
    dept = _dept_by_code(session, dept_code)
    if dept is None:
        return None
    return session.scalar(
        select(User)
        .where(
            User.position == POSITION_DIRECTOR,
            User.is_active.is_(True),
            User.org_id.in_(_subtree_ids(session, dept.id)),
        )
        .order_by(User.id)
    )


def director_for(session: Session, user: User, *, allow_global: bool = True) -> User | None:
    """提交人所在部门的总监（06 卷 §3）；部门没配就全局兜底。

    `allow_global=False` → 部门没配直接返回 None，**不做全局随机兜底**（评审/改版链用，见 M-01）。
    """
    dept = _department_root(session, user.org_id)
    if dept is not None:
        boss = session.scalar(
            select(User).where(
                User.position == POSITION_DIRECTOR,
                User.is_active.is_(True),
                User.org_id.in_(_subtree_ids(session, dept.id)),
            ).order_by(User.id)
        )
        if boss is not None:
            return boss
    return director(session) if allow_global else None


DESIGN_DEPT = "ENG"  # 工程部：评审链的归属部门（机械/电气/程序/工艺组都在它下面）


def design_director(session: Session, submitter: User | None = None) -> User | None:
    """评审链的二级审核人 = **工程部总监**（`reviewers` 模块开头就是这口径）。

    ★ M-01（第八轮 §3）：原来走 `director_for(提交人)`，提交人没部门时落到 `director()`
    （无 ORDER BY 的“全局第一个总监”）。实测 5 个总监里只有 `eng_director` 有
    `design:audit`，命中销售/采购/仓管/总经理任一 → **这张评审单没人能审**
    （即 N21“跨部门审批卡死”在设计域的孪生）。

    与 N21 的修法对齐：按**单据归属的业务部门**找人，而不是按提交人。
    """
    boss = director_in_dept(session, DESIGN_DEPT)
    if boss is not None:
        return boss
    # 部门未配（老数据）：退回提交人所在部门的总监，**不做全局随机兜底**
    if submitter is not None:
        return director_for(session, submitter, allow_global=False)
    return None


def resolve_chain(session: Session, submitter: User) -> tuple[User | None, User]:
    """返回（一级审核人 | None, 二级审核人）。

    一级为 None 表示跳过（提交人本人是组长）。
    缺人或非法时抛 ReviewerError，调用方转成 400 提示。
    """
    need_lead, _ = chain_levels(submitter.position)
    lead: User | None = None
    if need_lead:
        lead = team_lead_for(session, submitter.profession)
        if lead is None:
            raise ReviewerError(
                f"没找到「{submitter.profession or '未定专业'}」的经理，先配置审核人"
            )
    boss = design_director(session, submitter)
    if boss is None:
        raise ReviewerError("没找到总监，先配置审核人")
    return lead, boss
