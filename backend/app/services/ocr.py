"""OCR 适配器（可插拔）—— 现在用于「入库拍照识别库位」。

**为什么是可插拔的**（客户口径 2026-09-29）：
- 走**厂商 API**（智谱 `glm-ocr` / 通义 `qwen-vl-ocr`，两家都是 **OpenAI 兼容**格式），
  所以调用只有一个 `httpx` POST —— **零新依赖**（`httpx` 早就在用）
- 但 **key 在后台自己填**（`/admin/integrations/ocr`，存在 `app_setting`）
- **没配 key 时明确不可用**（`available=False`）—— 前端按钮置灰、**绝不假装能用**
- 将来要换内网模型服务：**只改这个文件**（把 `_call_*` 换掉），路由/前端不动

★ 铁律 7：**OCR 结果永远只作候选**，必须人工确认后才写入（`candidates` → 用户点选 → 才落库）。
"""

from __future__ import annotations

import base64
import json
import re

import httpx
from sqlalchemy.orm import Session

from app.services import settings

# 各家端点（都是 OpenAI 兼容的 /chat/completions）
ENDPOINTS = {
    "dashscope": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
}

# 库位码的样子：A-03-12 / A03012 / 12-3-4 都认
_CODE_RE = re.compile(r"\b([A-Za-z]{0,3}-?\d{1,3}(?:-\d{1,3}){0,2})\b")

PROMPT = (
    "这是一张仓库库位标签的照片。请只输出图中的**库位编号**本身（例如 A-03-12），"
    "不要任何解释、不要标点。如果看不清楚，输出 NONE。"
)


class OcrError(Exception):
    """OCR 调用失败（网络/鉴权/返回格式）。

    `kind` 用来区分**是哪种**失败 —— 「测试连接」要据此判断：
    · `auth`    密钥不对 / 过期      → **不通**
    · `network` 连不上 / 超时        → **不通**
    · `format`  返回不是 OpenAI 兼容 → **不通**
    · `input`   模型说**图片**有问题  → **通了**！（能收到它的结构化报错，说明端点+密钥都对）
                  典型：拿 1×1 占位图去问，模型回「图片输入格式/解析错误」
    """

    def __init__(self, message: str, *, kind: str = "http") -> None:
        super().__init__(message)
        self.kind = kind


def _extract_codes(text: str) -> list[dict]:
    """从模型回答里抽库位码候选（去重、保序）。"""
    out: list[dict] = []
    seen: set[str] = set()
    for m in _CODE_RE.finditer((text or "").upper()):
        code = m.group(1)
        if len(code.replace("-", "")) < 3:  # 太短的别当真
            continue
        if code in seen:
            continue
        seen.add(code)
        out.append({"code": code, "raw": code})
    return out


def _call_openai_compatible(url: str, key: str, model: str, image: bytes, mime: str) -> str:
    """一次 OpenAI 兼容的视觉调用（两家共用）。"""
    b64 = base64.b64encode(image).decode()
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                    {"type": "text", "text": PROMPT},
                ],
            }
        ],
        # 关掉思考模式（qwen3-vl 系默认已关；这里显式写，免得有些模型默认开导致慢）
        "enable_thinking": False,
    }
    try:
        r = httpx.post(
            url,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            content=json.dumps(payload, ensure_ascii=False).encode(),
            timeout=30.0,
        )
    except httpx.HTTPError as e:  # 网络层
        raise OcrError(f"调用识别服务失败：{type(e).__name__}", kind="network") from e
    if r.status_code in (401, 403):
        raise OcrError("识别服务的 API Key 不对或没权限（401/403）—— 请到「用户与权限 → 外部集成」重新填", kind="auth")
    if r.status_code >= 400:
        # ⚠ 不回显请求（含 base64 图）与 Authorization；只截一小段响应体
        body = r.text[:180]
        # 400/422：多半是它嫌**图片**（太小/太大/格式），说明鉴权已经过了 → kind=input
        lower = body.lower()
        kind = "input" if r.status_code in (400, 422) and any(
            k in lower for k in ("图片", "image", "format", "格式", "解析", "file", "文件")
        ) else "http"
        raise OcrError(f"识别服务返回 {r.status_code}：{body}", kind=kind)
    try:
        return (r.json()["choices"][0]["message"]["content"] or "")
    except (KeyError, IndexError, ValueError) as e:
        raise OcrError("识别服务返回的格式看不懂（不是 OpenAI 兼容？）", kind="format") from e


def recognize_location(
    session: Session, image: bytes, *, mime: str = "image/jpeg"
) -> dict:
    """识别库位码 → **候选**（铁律 7：调用方必须人工确认后才写库）。

    :returns {engine, available, model, candidates:[{code,raw}], hint}
    """
    cfg = settings.ocr_config(session)
    if not cfg["available"]:
        hint = (
            "还没配识别服务 —— 到「用户与权限 → 外部集成」填 API Key（智谱 / 通义），"
            "或继续手动选库位"
        )
        return {"engine": cfg["api"], "available": False, "model": cfg["model"], "candidates": [], "hint": hint}
    url = ENDPOINTS.get(cfg["api"])
    if url is None:
        return {"engine": cfg["api"], "available": False, "model": cfg["model"], "candidates": [], "hint": "不认识这个识别服务"}

    key = settings.get(session, settings.SETTING_OCR_KEY) or ""
    text = _call_openai_compatible(url, key, cfg["model"] or "", image, mime)
    cands = _extract_codes(text)
    hint = "" if cands else "没认出库位编号，请重拍或手动选库位"
    return {
        "engine": cfg["api"],
        "available": True,
        "model": cfg["model"],
        "candidates": cands,
        "raw": text[:120],
        "hint": hint,
    }
