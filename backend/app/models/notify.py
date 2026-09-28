"""站内消息（06 卷 §9）：事件型通知 + 未读红点。

· 通知是「轮到你干了」/「你关心的有结果了」，不做营销推送
· 永久保留，不自动清理
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Notification(Base, TimestampMixin):
    __tablename__ = "notification"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(16))  # task / review / change / warehouse / purchase
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(255))  # 前端路由，点了直接跳
    biz_type: Mapped[str | None] = mapped_column(String(24))
    biz_id: Mapped[int | None] = mapped_column()
    # ★ 到期扫描去重键（§8.3 超期提醒）—— 同一天同一件事只提醒一次，不刷屏
    dedup_key: Mapped[str | None] = mapped_column(String(96))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
