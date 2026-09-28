# -*- coding: utf-8 -*-
"""离线照片队列护栏：flush **只能处理本 picker 自己的照片**。

来源：本轮实测发现的一个真 bug（03 卷「离线队列」）。
`MfgPhotoPicker.flush()` 原来拿的是**整条队列**：

    const items = await queueList('photo')      // ← 全部离线照片
    ...
    onChangeRef.current([...value, ...token])   // ← 追加到「当前这个」表单
    await queueRemove(it.id)

同一个页面/会话里会有**多个** picker（`daily` / `incoming` / `issue` / 按设备 / 按批次…），
每个 picker 挂载或联网时都会 flush。于是：

  · 为「现场问题」拍的照片，会被追加到**先挂载的那个**表单（比如「每日汇报」）上；
  · 照片随即被移出队列 → 它对应的表单**永远拿不到自己的 token**。
  → **服务端有文件，业务上那张照片却"丢了"**（还挂错了单）。

修法：flush / 计数一律先按 `(projectNo, refNo)` 过滤出**本 picker** 的（`myQueued()`）。
"""
from __future__ import annotations

from pathlib import Path

PICKER = Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "MfgPhotoPicker.tsx"


def _code() -> str:
    # 去掉注释行，避免"注释里提到了"被当成实现
    return "\n".join(
        ln for ln in PICKER.read_text(encoding="utf-8").splitlines() if not ln.strip().startswith(("//", "*", "/*"))
    )


def test_flush_filters_by_this_picker():
    src = _code()
    assert "it.projectNo === projectNo && it.refNo === myRef" in src, (
        "flush/计数必须按 (projectNo, refNo) 过滤出本 picker 的照片"
    )
    assert "myQueued" in src, "应通过 myQueued() 取本 picker 的队列"


def test_flush_never_takes_the_whole_queue():
    """★ 直接禁止"拿整条队列再往自己表单上追加"这个写法。"""
    src = _code()
    bad = [
        ln.strip()
        for ln in src.splitlines()
        if "await queueList('photo')" in ln and "filter" not in ln and "const all = " not in ln
    ]
    assert not bad, f"这些地方拿了整条队列（会串到别的表单上）：{bad}"


def test_token_is_appended_only_to_own_value():
    """追加 token 的行必须紧跟着过滤后的 items（结构自检：items 来自 myQueued）。"""
    src = _code()
    assert "const items = await myQueued()" in src
