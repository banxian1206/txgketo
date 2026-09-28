"""站内消息服务（06 卷 §9）：创建通知 / 未读数 / 按角色·岗位群发。

★ 不通知「操作人自己」——你干的事不会弹给你。
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.notify import Notification
from app.models.platform import POSITION_DIRECTOR, Role, User, user_role

TYPE_TASK = "task"
TYPE_REVIEW = "review"
TYPE_CHANGE = "change"
TYPE_RELEASE = "release"  # 设计发布（= 冻结）：通知链条上要接着干活的人
TYPE_WAREHOUSE = "warehouse"
TYPE_PURCHASE = "purchase"


def _user_ids(session: Session, user_ids: list[int] | set[int], actor_id: int | None) -> list[int]:
    return sorted({u for u in user_ids if u and u != actor_id})


def notify(
    session: Session,
    user_ids: list[int] | set[int],
    *,
    type_: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    biz_type: str | None = None,
    biz_id: int | None = None,
    actor_id: int | None = None,
    dedup_key: str | None = None,
) -> int:
    """给一批人发站内消息；返回实际发出条数。

    `dedup_key`（★ 到期扫描用）：已给某人发过同 key 的消息 → **跳过**，不重复刷屏。
    """
    targets = _user_ids(session, user_ids, actor_id)
    if not targets:
        return 0
    if dedup_key:
        sent = set(
            session.scalars(
                select(Notification.user_id).where(Notification.dedup_key == dedup_key)
            ).all()
        )
        targets = [u for u in targets if u not in sent]
    if not targets:
        return 0
    now = datetime.now(UTC)
    for uid in targets:
        session.add(
            Notification(
                user_id=uid,
                type=type_,
                title=title,
                body=body,
                link=link,
                biz_type=biz_type,
                biz_id=biz_id,
                dedup_key=dedup_key,
                is_read=False,
            )
        )
    session.flush()
    return len(targets)


def notify_role(
    session: Session,
    role_code: str,
    *,
    type_: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    biz_type: str | None = None,
    biz_id: int | None = None,
    actor_id: int | None = None,
    dedup_key: str | None = None,
) -> int:
    """给拥有某角色的人发（如 WAREHOUSE → 仓库、PURCHASE → 采购）。"""
    ids = list(
        session.scalars(
            select(User.id)
            .join(user_role, user_role.c.user_id == User.id)
            .join(Role, Role.id == user_role.c.role_id)
            .where(User.is_active.is_(True), Role.code == role_code)
        ).all()
    )
    return notify(
        session, ids, type_=type_, title=title, body=body, link=link,
        biz_type=biz_type, biz_id=biz_id, actor_id=actor_id, dedup_key=dedup_key,
    )


def notify_directors(
    session: Session,
    *,
    type_: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    biz_type: str | None = None,
    biz_id: int | None = None,
    actor_id: int | None = None,
) -> int:
    """给所有部门负责人发（改版裁决、部门审批）。"""
    ids = list(
        session.scalars(
            select(User.id).where(User.position == POSITION_DIRECTOR, User.is_active.is_(True))
        ).all()
    )
    return notify(
        session, ids, type_=type_, title=title, body=body, link=link,
        biz_type=biz_type, biz_id=biz_id, actor_id=actor_id,
    )


def unread_count(session: Session, user_id: int) -> int:
    return int(
        session.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user_id, Notification.is_read.is_(False))
        )
        or 0
    )


def list_for(session: Session, user_id: int, unread_only: bool = False, limit: int = 100) -> list[Notification]:
    stmt = (
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.id.desc())
        .limit(min(limit, 500))
    )
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    return list(session.scalars(stmt).all())
