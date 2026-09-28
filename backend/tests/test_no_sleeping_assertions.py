# -*- coding: utf-8 -*-
"""护栏的护栏：`e2e/api.mjs` 不允许再出现「休眠断言」（SKIP）。

来源：第八轮报告 §4 —— *"休眠的护栏永远绿 = 没有"*。
当时 `api.mjs` 有 5 条断言靠"扫库碰运气"，数据不合就 `check(id, true, '...跳过', 'SKIP')`：
**把 FAIL 悄悄换成了 SKIP**，看着全绿，实际上一条都没测。2026-09-28 全部改成**自建靶**
（P-02 辅料需求、P-05 新建商机、R5 造一台装配完成的设备），复位后单跑 **PASS 15 / FAIL 0 / SKIP 0**。

这条静态护栏拦两件事：
1. **`check(..., true, ..., 'SKIP')`** —— 假绿（把失败包装成跳过）；
2. **`api.mjs` 里出现任何 `'SKIP'`** —— 休眠就是没测；真要跳过，请先改这条护栏并说明理由。
"""
from __future__ import annotations

import re
from pathlib import Path

API_MJS = Path(__file__).resolve().parents[2] / "frontend" / "e2e" / "api.mjs"


def _src() -> str:
    return API_MJS.read_text(encoding="utf-8")


def test_no_fake_green_skip():
    """★ 不许把 FAIL 包装成 SKIP（`check(id, true, 'xxx跳过', 'SKIP')`）。"""
    bad = [
        m.group(0)
        for m in re.finditer(r"check\([^)]*?,\s*true\s*,[^)]*?'SKIP'\s*\)", _src(), re.S)
    ]
    assert not bad, f"发现假绿（把失败当跳过）：{bad[:2]}"


def test_api_suite_has_no_sleeping_assertions():
    """★ `api.mjs` 必须 0 SKIP（自建靶，不靠残留数据）。

    真要加跳过 → 先改这条护栏，并写清为什么这条**没法**造靶。
    """
    hits = re.findall(r"'SKIP'", _src())
    assert not hits, (
        f"e2e/api.mjs 里还有 {len(hits)} 处 SKIP —— 休眠的断言永远是绿的，等于没测；"
        "请改成自建靶（造数据 → 断言），不要靠扫库碰运气"
    )


def test_self_seeding_probes_are_present():
    """三个自建靶的关键动作必须在（防止有人"清理"掉造数逻辑又变回扫库）。"""
    src = _src()
    assert "purchase/manual-request" in src, "P-02 要自己造一条辅料（无项目）需求"
    assert "assembly/records" in src, "R5 要自己造一台装配完成的设备"
    assert "method: 'POST', headers:" in src and "/api/v1/projects" in src, "P-05 要自己建一个商机"
