"""站内消息接口（06 卷 §9）：列表 / 未读数 / 已读 / 全部已读。"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_session
from app.models.notify import Notification
from app.models.platform import User
from app.services import notify

router = APIRouter(tags=["站内消息"])


def _dict(n: Notification) -> dict:
    return {
        "id": n.id,
        "type": n.type,
        "title": n.title,
        "body": n.body,
        "link": n.link,
        "is_read": n.is_read,
        "created_at": n.created_at,
    }


@router.get("/notifications")
def list_notifications(
    unread: bool = Query(default=False, description="只看未读"),
    limit: int = 100,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    rows = notify.list_for(session, current.id, unread_only=unread, limit=limit)
    return {
        "unread": notify.unread_count(session, current.id),
        "items": [_dict(n) for n in rows],
    }


@router.get("/notifications/unread-count")
def notifications_unread_count(
    session: Session = Depends(get_session), current: User = Depends(get_current_user)
):
    return {"count": notify.unread_count(session, current.id)}


@router.post("/notifications/{notification_id}/read")
def mark_read(
    notification_id: int,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    n = session.get(Notification, notification_id)
    if n is None or n.user_id != current.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "消息不存在")
    if not n.is_read:
        n.is_read = True
        n.read_at = datetime.now(UTC)
        session.commit()
    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all_read(
    session: Session = Depends(get_session), current: User = Depends(get_current_user)
):
    rows = session.scalars(
        select(Notification).where(
            Notification.user_id == current.id, Notification.is_read.is_(False)
        )
    ).all()
    now = datetime.now(UTC)
    for n in rows:
        n.is_read = True
        n.read_at = now
    session.commit()
    return {"ok": True, "count": len(rows)}
