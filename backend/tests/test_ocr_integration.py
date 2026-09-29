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
    assert 'available": True' in src and "hint" in src, "input 类要**软失败**（200 + 空候选 + 提示重拍）"
    assert 'kind="auth"' in src, "401/403 → kind=auth"
    p = _code("api/routes/platform.py")
    i = p.index("def test_ocr_integration(")
    seg = p[i : i + 2000]
    assert 'getattr(e, "kind", "") == "input"' in seg, "测试连接要把 input 类错误当「通了」"


def test_network_and_auth_are_distinguishable():
    """网络层要单独归 kind=network（而不是和业务报错混在一起）。"""
    src = _code("services/ocr.py")
    assert 'kind="network"' in src and 'kind="format"' in src


# ── R-1（第十轮报告）：把 OCR 的关键约定钉成护栏 ─────────────────────────────
def test_unavailable_engine_degrades_without_touching_anything(monkeypatch):
    """★ 未配置时**纯函数级**验证降级形态（**不碰真 Key** —— 报告的探针用 PUT 清 Key 验这条，
    结果把管理员填的 Key 覆盖掉了，那正是我要避免的）。"""
    from app.services import ocr, settings

    monkeypatch.setattr(
        settings, "ocr_config",
        lambda _s: {"api": "none", "model": None, "available": False},
    )
    out = ocr.recognize_location(None, b"x")  # session 用不到（未配置时不该碰它）
    assert out["available"] is False and out["candidates"] == []
    assert out["hint"], "要给出可执行提示（去后台填 / 手动选库位）"


def test_select_location_never_auto_fills_ocr_candidates():
    """★★ 护**铁律 7**：前端必须「人工点选」才填入，**不许**把识别结果直接 onChange。

    （第十轮报告 R-1 点名的风险：有人把 `SelectLocation` 改成 `onChange(candidates[0].code)`
     自动填入 → 直接违反铁律⑦，而当时没有任何断言会红。）
    """
    p = ROOT / "frontend" / "src" / "components" / "fields" / "SelectLocation.tsx"
    src = "\n".join(
        ln for ln in p.read_text(encoding="utf-8").splitlines() if not ln.strip().startswith(("//", "*", "/*"))
    )
    # ① onChange 只允许出现在 apply() 里（唯一写入点）
    assert src.count("onChange?.(") <= 1, "onChange 必须只有一个写入点（apply）"
    i = src.index("onChange?.(")
    seg = src[max(0, i - 400) : i]
    assert "const apply" in seg, "onChange 只能出现在 apply() 里"
    # ② apply 只能被「点击」触发，不能挂在 useEffect / 候选列表渲染上
    assert "onClick={() => apply(" in src, "apply 必须由用户点击触发"
    assert "useEffect" not in src[src.index("const apply") : src.index("onChange?.(")], (
        "不许在 effect 里自动 apply（那就等于自动填值）"
    )
    # ③ 候选列表里只给「用它」链接（人点）
    assert "用它" in src


def test_ocr_endpoint_requires_warehouse_edit():
    """仓管以外的角色不能调（第十轮 R-1 建议的第二条）。"""
    src = _code("api/routes/warehouse.py")
    i = src.index('"/ocr/location"')
    assert 'require_permission("warehouse:edit")' in src[i : i + 400]


def test_config_exposes_state_not_just_available():
    """`available` 是乐观值（配了就是 true）—— 面板要按 `state` 说实话。"""
    src = _code("services/settings.py")
    i = src.index("def ocr_config(")
    seg = src[i : i + 1400]
    assert '"state"' in seg and '"last_test"' in seg, "要下发 state 与上次测试结果"
    panel = (ROOT / "frontend" / "src" / "features" / "admin" / "IntegrationPanel.tsx").read_text(encoding="utf-8")
    assert "OCR_STATE_TEXT" in panel and "from '../../theme/status'" in panel, (
        "状态色/人话必须**从共享总表导入**（本地自己定义一份 = 绕过了 theme/status，也躲过 VIS-状态色Map 的初衷）"
    )
    assert 'placeholder="glm-ocr' not in panel, "placeholder 不许写死已被证伪的模型名（R-3）"
    # 状态色/人话必须在**共享总表**里（静态护栏 VIS-状态色Map 也要求这样）
    theme = (ROOT / "frontend" / "src" / "theme" / "status.ts").read_text(encoding="utf-8")
    assert "OCR_STATE_TEXT" in theme and "已配置（未验证）" in theme, "配置状态的人话要进 theme/status.ts"
    assert "OCR_STATE" in theme


# ── 模型下拉：清单由服务端下发，且不许放进"走不通"的模型 ─────────────────────
def test_model_list_is_served_and_verified():
    """★ 智谱这几条是 **2026-09-29 用真 key + 真库位图逐个实测**过的（都精确识别 A-03-12）。"""
    from app.services.settings import MODELS_BY_API

    zp = {m["value"] for m in MODELS_BY_API["zhipu"]}
    assert {"glm-4v-flash", "glm-4v-plus", "glm-4.5v", "glm-4.1v-thinking-flash"} <= zp
    assert MODELS_BY_API["dashscope"], "通义也要给清单"


def test_glm_ocr_is_never_offered():
    """★★ `glm-ocr` 是**文件级 OCR 接口**，走 chat 格式必报「仅支持 PDF/JPG/PNG/JPEG…」。

    （这一条曾经让我们白跑一轮：默认模型填了 `glm-ocr` → 调用直接 400。别再让它回到菜单里。）
    """
    from app.services.settings import DEFAULT_MODELS, MODELS_BY_API

    for models in MODELS_BY_API.values():
        assert not any(m["value"] == "glm-ocr" for m in models), "glm-ocr 不能进下拉（走不通 chat）"
    assert "glm-ocr" not in DEFAULT_MODELS.values(), "默认模型也不能是 glm-ocr"


def test_model_dropdown_comes_from_the_server_not_hardcoded():
    """前端不许自己写一份模型清单（否则又会出现"写死一个已被证伪的名字"）。"""
    raw = (ROOT / "frontend" / "src" / "features" / "admin" / "IntegrationPanel.tsx").read_text(encoding="utf-8")
    assert "cfg?.models" in raw, "下拉要用服务端下发的 models"
    assert "AutoComplete" in raw, "用 AutoComplete（下拉可选 + 允许手输别的）"
    # ★ 只在**代码**里查（注释里可以提历史模型名，比如"曾经写成 glm-ocr"）
    code = "\n".join(
        ln for ln in raw.splitlines() if not ln.strip().startswith(("//", "*", "/*"))
    )
    for hard in ("glm-4v-flash", "qwen-vl-ocr", "glm-4v-plus", "glm-ocr"):
        assert hard not in code, f"前端不许写死模型名：{hard}（要从服务端 models 取）"
