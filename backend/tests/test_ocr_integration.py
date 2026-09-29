# -*- coding: utf-8 -*-
"""OCR 外部集成护栏（客户口径 2026-09-29：走厂商 API，但 key 在后台自己填）。

三条不能被破坏的约定：
1. **密钥永不回传原文**（接口只有 `has_key` + 掩码尾 4 位）
2. **只有系统管理员能看/改**（`system:admin`）；仓管等一律 403
3. **结果只作候选**（铁律 7：必须人工确认后才写库）；未配引擎时 `available=false`，**不假装能用**
"""
from __future__ import annotations

import inspect
from pathlib import Path

from app.services.settings import mask_secret

ROOT = Path(__file__).resolve().parents[2]
BE = ROOT / "backend" / "app"


def _code(rel: str) -> str:
    p = BE / rel
    return "\n".join(
        ln for ln in p.read_text(encoding="utf-8").splitlines() if not ln.strip().startswith("#")
    )


def test_mask_secret_never_reveals_the_key():
    assert mask_secret("sk-1234567890abcd") == "****abcd"
    assert mask_secret("short") == "****", "短值一律全星号（露尾 4 位等于泄露一大半）"
    assert mask_secret("1234567890123") == "****0123", "够长才露尾 4 位"
    assert mask_secret(None) is None
    assert "1234567890ab" not in (mask_secret("sk-1234567890abcd") or "")


def test_config_never_returns_the_raw_key():
    src = _code("services/settings.py")
    i = src.index("def ocr_config(")
    seg = src[i : i + 900]
    assert "key_masked" in seg and "mask_secret(" in seg
    assert '"key":' not in seg.replace('"key_masked"', "").replace('"key_source"', ""), (
        "ocr_config 不能回 `key` 原文"
    )


def test_only_system_admin_can_read_or_write():
    src = _code("api/routes/platform.py")
    for path in ('"/admin/integrations/ocr"', '"/admin/integrations/ocr/test"'):
        i = src.index(path)
        seg = src[i : i + 400]
        assert 'require_permission("system:admin")' in seg, f"{path} 必须是 system:admin"
    # 拍照识别本身是仓库的活
    w = _code("api/routes/warehouse.py")
    j = w.index('"/ocr/location"')
    assert 'require_permission("warehouse:edit")' in w[j : j + 400]


def test_ocr_route_never_writes_stock():
    """★ 铁律 7：OCR 只作候选，**不得**在识别接口里写库存/库位。"""
    w = _code("api/routes/warehouse.py")
    i = w.index('"/ocr/location"')
    seg = w[i : i + 1800]
    for forbidden in ("StockItem(", "qty_on_hand", "_apply_stock", "session.add("):
        assert forbidden not in seg, f"识别接口里不该出现写库动作：{forbidden}"


def test_unavailable_engine_is_explicit_not_fake():
    src = _code("services/ocr.py")
    assert '"available": False' in src, "没引擎时必须明确 available=false"
    assert "hint" in src, "要给出可执行提示（去后台填 key / 手动选库位）"


def test_audit_never_records_the_key_value():
    """审计只记「改过哪个键」，不记值。"""
    src = _code("api/routes/platform.py")
    i = src.index("def set_ocr_integration(")
    seg = src[i : i + 1800]
    assert "payload[field]" in seg and "summary=" in seg
    assert "payload[field]}" not in seg.split("summary=")[1][:600], "别把值拼进审计摘要"


def test_endpoints_are_openai_compatible():
    """两家都用 OpenAI 兼容的 /chat/completions（这样只靠 httpx，零新依赖）。"""
    src = _code("services/ocr.py")
    assert src.count("/chat/completions") == 2
    assert "dashscope.aliyuncs.com" in src and "open.bigmodel.cn" in src
    assert "image_url" in src and "base64" in src


# ── 失败分类：别把"模型嫌图"误报成"连接不通"（实测踩过）────────────────────
def test_ocr_error_carries_a_kind():
    from app.services.ocr import OcrError

    assert OcrError("x").kind == "http"
    assert OcrError("x", kind="auth").kind == "auth"


def test_test_connection_does_not_false_alarm_on_image_errors():
    """★ 实测踩过：拿 1×1 占位图问 glm-4v-flash，它回「图片输入格式/解析错误」→
    原来被当成"连接不通"。**能收到它的结构化报错，说明端点+密钥都是对的**。"""
    src = _code("services/ocr.py")
    assert 'kind = "input"' in src, "400/422 且提到图片/格式 → kind=input"
    assert 'kind="auth"' in src, "401/403 → kind=auth"
    p = _code("api/routes/platform.py")
    i = p.index("def test_ocr_integration(")
    seg = p[i : i + 2000]
    assert 'getattr(e, "kind", "") == "input"' in seg, "测试连接要把 input 类错误当「通了」"


def test_network_and_auth_are_distinguishable():
    """网络层要单独归 kind=network（而不是和业务报错混在一起）。"""
    src = _code("services/ocr.py")
    assert 'kind="network"' in src and 'kind="format"' in src
