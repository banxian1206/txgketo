"""系统设置（K-V）读写 —— 现在只有「外部集成 / OCR」用。

★ 安全约定（务必遵守）：
1. **敏感值只存不读回**：`ocr.key` 通过接口**永不返回原文**（只回 `has_key` + 掩码尾 4 位）。
   掩码函数 `mask_secret()` 是唯一给前端看的东西。
2. **写入走白名单** `SETTING_KEYS`（防止这个 KV 变成什么都能塞的杂物间）。
3. **不落审计详情/日志**：`audit.log` 只记"改过哪个键"和"是否设置了 key"，**不记值**。
4. 取配置的优先级：**数据库**（后台填的） > **环境变量**（部署时可留一份兜底） > 默认 `none`。
"""

from __future__ import annotations

import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.platform import (
    SETTING_KEYS,
    SETTING_OCR_API,
    SETTING_OCR_KEY,
    SETTING_OCR_MODEL,
    AppSetting,
)

# 各家的默认模型（后台只填 key 也能跑起来）
# ★ 默认模型（实测 2026-09-29）：
#   · dashscope → qwen-vl-ocr（专用 OCR，走标准 chat+image_url）
#   · zhipu     → **glm-4v-flash** —— 注意 ** 不能走 chat 格式**（它会报
#     "OCR仅支持PDF/JPG/PNG/JPEG"），那是智谱**文件级 OCR 接口**，与这里的 OpenAI 兼容调用不兼容
DEFAULT_MODELS = {
    "dashscope": "qwen-vl-ocr",
    "zhipu": "glm-4v-flash",
}
# 环境变量兜底（部署时可用，但后台填的优先）
ENV_KEYS = {
    SETTING_OCR_API: ("TXGK_OCR_API",),
    SETTING_OCR_KEY: ("TXGK_OCR_KEY", "DASHSCOPE_API_KEY", "ZHIPU_API_KEY"),
    SETTING_OCR_MODEL: ("TXGK_OCR_MODEL",),
}


class SettingError(Exception):
    """设置相关的业务错误。"""


def mask_secret(v: str | None) -> str | None:
    """把密钥掩码成 `****abcd`（**唯一**能回给前端的形式）。

    ★ 只有**够长**的值才露尾 4 位：短值（≤12 位）露 4 位等于泄露一大半 → 一律全星号。
    （真实 API Key 都是 30~50 位，所以正常情况仍能看到尾 4 位便于核对。）
    """
    if not v:
        return None
    return f"****{v[-4:]}" if len(v) > 12 else "****"


def get_raw(session: Session, key: str) -> str | None:
    row = session.get(AppSetting, key)
    return row.value if row and row.value else None


def get(session: Session, key: str) -> str | None:
    """取设置值：数据库优先，否则环境变量。"""
    v = get_raw(session, key)
    if v:
        return v
    for env_name in ENV_KEYS.get(key, ()):
        ev = os.environ.get(env_name)
        if ev:
            return ev.strip()
    return None


def set_value(session: Session, key: str, value: str | None, *, actor_id: int | None = None) -> None:
    """写设置（白名单校验）。`value=None` 或空串 = 清空该键。"""
    if key not in SETTING_KEYS:
        raise SettingError(f"不认识这个设置项：{key}")
    row = session.get(AppSetting, key)
    v = (value or "").strip() or None
    if row is None:
        session.add(AppSetting(key=key, value=v, updated_by=actor_id))
    else:
        row.value = v
        row.updated_by = actor_id
    session.flush()


def ocr_config(session: Session) -> dict:
    """OCR 当前配置（**给接口用**：不含密钥原文）。

    `source` 说明配置是从哪来的 —— 后台填的 / 环境变量 / 没配。
    """
    api = (get(session, SETTING_OCR_API) or "none").lower()
    key = get(session, SETTING_OCR_KEY)
    from_db = bool(get_raw(session, SETTING_OCR_KEY))
    model = get(session, SETTING_OCR_MODEL) or DEFAULT_MODELS.get(api)
    return {
        "api": api,
        "model": model,
        "has_key": bool(key),
        "key_masked": mask_secret(key),
        "key_source": "后台填写" if from_db else ("环境变量" if key else "未配置"),
        "available": api in ("dashscope", "zhipu") and bool(key),
    }
