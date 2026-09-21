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

from app.models.platform import POSITION_DIRECTOR, POSITION_LEAD, User


class ReviewerError(ValueError):
    """审核链缺人 / 自审等非法情况。"""


def chain_levels(submitter_position: str | None) -> tuple[bool, bool]:
    """按提交人岗位判断要走几级：返回（是否要一级组长审, 是否要二级总监审）。"""
    if submitter_position == POSITION_DIRECTOR:
        raise ReviewerError("工程总监不能自己提交自审")
    if submitter_position == POSITION_LEAD:
        return False, True  # 组长本人提交：跳过一级，总监直审（单上留痕）
    return True, True


def team_lead_for(session: Session, profession: str | None) -> User | None:
    """本专业的设计组长。"""
    return session.scalar(
        select(User).where(
            User.position == POSITION_LEAD,
            User.profession == profession,
            User.is_active.is_(True),
        )
    )


def director(session: Session) -> User | None:
    """工程部总监。"""
    return session.scalar(
        select(User).where(User.position == POSITION_DIRECTOR, User.is_active.is_(True))
    )


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
                f"没找到「{submitter.profession or '未定专业'}」的设计组长，先配置审核人"
            )
    boss = director(session)
    if boss is None:
        raise ReviewerError("没找到工程总监，先配置审核人")
    return lead, boss
