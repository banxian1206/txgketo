"""通知类型词表对账（防「消息列表裸露英文 type」）。

背景（2026-10-05 逐页走查）：我的工作台的消息区直接渲染 `n.type` → 首屏上出现
`service` / `acceptance` / `site` 三个英文标签；顶栏抽屉虽然有中文映射表，却**漏了
`site`（最高频，库里 65 条）和 `ship`**，于是 `?? n.type` 兜底照样露英文。
根因是**没有契约**：前端那张中文表在另一个仓里，后端发什么类型没人管。

所以这里立两条：
  ① 后端：`NOTIF_TYPES` 是唯一事实源，代码里出现的 `type_="…"` 字面量必须在表内
     （同 `test_status_contract.py` 的做法：扫字面量，不是只断言枚举里有什么）。
  ② 前端：`theme/status.ts::NOTIF_TYPE_LABEL` 覆盖全集（在 `frontend/e2e/static.mjs`
     的 `NOTIF-消息类型不许裸露英文` 里做前后端对账，那条要能红才有效）。
"""

from __future__ import annotations

import re
from pathlib import Path

from app.models.notify import NOTIF_TYPES

_APP = Path(__file__).resolve().parents[1] / "app"
# notify(type_="…") 的字面量；也覆盖 notify_role(..., type_="…")
_LITERAL = re.compile(r"""type_\s*=\s*["']([a-z_]+)["']""")


class Test通知类型契约:
    def test_词表非空且无重复(self):
        assert NOTIF_TYPES, "NOTIF_TYPES 不能为空"
        assert len(set(NOTIF_TYPES)) == len(NOTIF_TYPES), f"NOTIF_TYPES 有重复：{NOTIF_TYPES}"

    def test_库里出现过的类型都在词表内(self):
        """存量数据兜底：历史通知里的 type 也要能翻成中文（否则老消息永远露英文）。"""
        assert "site" in NOTIF_TYPES and "ship" in NOTIF_TYPES, "site/ship 是实际最高频的两个类型，必须在表内"

    def test_代码里的type字面量都在词表内(self):
        """★ 方向是「扫代码」，不是「扫枚举」——只断言枚举里有什么，拦不住新写的类型。"""
        bad: dict[str, list[str]] = {}
        for p in _APP.rglob("*.py"):
            for t in _LITERAL.findall(p.read_text(encoding="utf-8")):
                if t not in NOTIF_TYPES:
                    bad.setdefault(t, []).append(str(p.relative_to(_APP.parent)))
        assert bad == {}, f"发现 NOTIF_TYPES 之外的 type_ 字面量：{bad}"
