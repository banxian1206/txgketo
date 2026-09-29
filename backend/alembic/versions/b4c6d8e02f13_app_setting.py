"""系统设置表 `app_setting`（K-V）—— 现在用于「外部集成 / OCR」的 API Key 等配置。

背景（客户口径 2026-09-29）：OCR 走厂商 API（智谱 / 通义），但 **key 要在后台自己填**，
不能只靠环境变量 —— 所以需要一个能存配置的表 + 管理入口。

★ 安全约定（`services/settings.py`）：
  · `ocr.key` **只存不读回原文**（接口只回 `has_key` + 掩码尾 4 位）
  · 写入走白名单 `SETTING_KEYS`，不落审计详情/日志

Revision ID: b4c6d8e02f13
Revises: a3b5c7d91e02
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b4c6d8e02f13"
down_revision: str | None = "a3b5c7d91e02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_setting",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("app_user.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("app_setting")
