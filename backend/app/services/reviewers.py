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
    """总监（兜底：全局第一个，用于没有组织信息的老数据）。"""
    return session.scalar(
        select(User).where(User.position == POSITION_DIRECTOR, User.is_active.is_(True))
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


def director_for(session: Session, user: User) -> User | None:
    """提交人所在部门的总监（06 卷 §3）；部门没配就全局兜底。"""
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
    return director(session)


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
    boss = director_for(session, submitter)
    if boss is None:
        raise ReviewerError("没找到总监，先配置审核人")
    return lead, boss
