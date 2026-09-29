# -*- coding: utf-8 -*-
"""G2 付款节点绑业务节点 + 提醒护栏（09 卷 §3-G2，2026-09-28）。

客户口径：
  “这些节点要跟物流能够对上。因为我**发了之后**，就必须要**催商务部**的人去把这个款给拿下来。”
  “（提醒）肯定只是提醒商务，**不能卡住流程**…这个提醒就挂在那里，提示你还有多少未收款。”
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.models.project import PAYMENT_TRIGGERS
from app.services.payment import infer_trigger, normalize_trigger

ROOT = Path(__file__).resolve().parents[2]
BE = ROOT / "backend" / "app"


def _code(rel: str) -> str:
    p = BE / rel
    return "\n".join(ln for ln in p.read_text(encoding="utf-8").splitlines() if not ln.strip().startswith("#"))


# ── 绑定规则 ────────────────────────────────────────────────────────────────
def test_trigger_word_table():
    assert PAYMENT_TRIGGERS == ("发货", "到货", "验收", "质保")


def test_infer_from_node_name():
    assert infer_trigger("预付款") is None  # 纯时间点，不挂业务节点
    assert infer_trigger("发货款") == "发货"
    assert infer_trigger("到货款") == "到货"
    assert infer_trigger("验收款") == "验收"
    assert infer_trigger("质保金") == "质保"
    assert infer_trigger("尾款") is None
    assert infer_trigger(None) is None


def test_infer_is_specific_first():
    """同时含多个关键词时，取更具体的（“质保” > “验收” > “到货” > “发货”）。"""
    assert infer_trigger("验收后质保款") == "质保"
    assert infer_trigger("到货验收款") == "验收"


def test_explicit_trigger_wins_and_invalid_is_rejected():
    assert normalize_trigger("发货", "质保金") == "发货"  # 显式优先
    with pytest.raises(ValueError):
        normalize_trigger("随便写的", "发货款")


# ── 钩子摆放（只提醒、不卡流程）────────────────────────────────────────────
def test_hooks_are_wired():
    ship = _code("services/shipping.py")
    assert "trigger_for_shipment(" in ship, "发运要提醒「发货款」"
    assert "trigger_for_arrival(" in ship, "到货要提醒「到货款」"
    acc = _code("services/acceptance.py")
    assert "trigger_for_acceptance(" in acc, "验收通过要提醒「验收款」+「质保金」"


def test_reminder_never_raises_so_it_cannot_block_the_flow():
    """★ 客户口径：**只提醒，不卡流程** —— remind 里不允许 raise。"""
    src = _code("services/payment.py")
    i = src.index("def remind(")
    body = src[i : i + 1600]
    assert "raise" not in body, "提醒不能抛异常（否则会卡住发运/验收流程）"


def test_reminder_targets_the_project_owner_not_the_whole_role():
    """★ Q-2（第九轮报告）：只发**项目自己的销售负责人** + **销售部总监**，不群发 SALES 角色。

    群发的毛病：销售多于 2 人时，每人都会被**别人项目**的催款打扰。
    """
    src = _code("services/payment.py")
    assert "project.sales_id" in src, "要精确定位到项目自己的销售负责人"
    assert 'director_in_dept(session, "SALES")' in src, "并带上销售部总监（按部门找，不按提交人）"
    # 群发只能作为"谁都没有"时的兵底，且必须有 `if not targets:` 把住
    i = src.index("return notify.notify_role(")   # 找真实调用（docstring 里也提到了这个词）
    assert "if not targets:" in src[max(0, i - 400) : i], "群发 SALES 只能是兜底（`if not targets:`）"


def test_fallback_is_not_triggered_by_a_dedup_hit():
    """★ 我自己踩过的坑：**不能拿 `sent == 0` 判"没配收件人"** —— 去重命中时它也是 0，
    那样会把"今天已经催过了"误当"没人可催"，转而触发兜底群发（反而扰乱无关销售）。"""
    src = _code("services/payment.py")
    assert "sent == 0" not in src, "别用 sent==0 判「没配收件人」—— 去重命中时它也是 0"


def test_reminder_has_a_dedup_key():
    """★ Q-3：同一项目同一节点**每天最多催一次**（分批发运不再反复催同一笔）。"""
    src = _code("services/payment.py")
    assert 'daily_key("payment-remind"' in src
    assert src.count("dedup_key=key") >= 2, "主路径与兵底都要带去重键"


def test_settled_terms_are_not_reminded():
    """已收满的节点不再提醒（不然天天骚扰商务）。"""
    src = _code("services/payment.py")
    i = src.index("def remind(")
    body = src[i : i + 1600]
    assert "received_amount" in body and "1e-6" in body
