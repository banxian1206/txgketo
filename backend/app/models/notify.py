"""站内消息（06 卷 §9）：事件型通知 + 未读红点。

· 通知是「轮到你干了」/「你关心的有结果了」，不做营销推送
· 永久保留，不自动清理
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# ★ 通知类型词表 = **契约**（2026-10-05 走查加）
# 为什么要立契约：前端要把它翻成中文（`site`/`ship` 曾经漏翻，消息列表直接裸露英文 type），
# 而前端的中文映射表在另一个仓里 —— 没有这张表就没有"对账"的地方。
# 规矩同 AGENTS §8.1「状态枚举 = 契约」：**代码里出现的 type 必须在表内**（tests/test_notify_type_contract.py 扫），
# 前端 `theme/status.ts::NOTIF_TYPE_LABEL` 必须覆盖全集（e2e:static 前后端对账）。
NOTIF_TYPES: tuple[str, ...] = (
    "task",        # 任务派工 / 转派 / 拆分
    "review",      # 设计评审（提交 / 通过 / 退回 / 发布）
    "change",      # 改版 ECN（申请 / 裁决 / 下发 / 完成）
    "release",     # 发布扇出
    "warehouse",   # 仓库（验收 / 入库 / 领料）
    "purchase",    # 采购（进池 / 审批 / 验收不合格）
    "acceptance",  # 客户验收
    "service",     # 售后工单
    "site",        # 现场（勘测 / 日报 / 问题 / 调试）★ 最高频，曾漏翻
    "ship",        # 发运（叫车 / 装车 / 到货）★ 曾漏翻
    "mfg",         # 制造（下发 / 验收 / 外协）
    "payment",     # 付款 / 回款 / 变更单
)


class Notification(Base, TimestampMixin):
    __tablename__ = "notification"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(16))  # 见 NOTIF_TYPES（不许自造）
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(255))  # 前端路由，点了直接跳
    biz_type: Mapped[str | None] = mapped_column(String(24))
    biz_id: Mapped[int | None] = mapped_column()
    # ★ 到期扫描去重键（§8.3 超期提醒）—— 同一天同一件事只提醒一次，不刷屏
    dedup_key: Mapped[str | None] = mapped_column(String(96))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
