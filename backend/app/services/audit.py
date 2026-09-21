"""操作日志（所有写操作留痕）。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.platform import AuditLog, User


def log(
    session: Session,
    *,
    user: User | None,
    action: str,
    object_type: str | None = None,
    object_ref: str | None = None,
    summary: str | None = None,
    detail: dict | None = None,
    ip: str | None = None,
) -> AuditLog:
    row = AuditLog(
        user_id=user.id if user else None,
        username=user.username if user else None,
        action=action,
        object_type=object_type,
        object_ref=object_ref,
        summary=summary,
        detail=detail,
        ip=ip,
    )
    session.add(row)
    return row
