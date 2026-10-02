# -*- coding: utf-8 -*-
"""付款计划变更单护栏（2026-09-30 客户拍板）。

背景：成交登记只在「线索」阶段能提交，成交后付款节点**没有任何修改口** ——
实测过比例 170%、金额超合同的脏计划只能一直错下去。客户确认：“按你的建议走，做付款计划变更单”。

口径（服务层 `services/payment_change.py` 顶部写死，这里逐条钉住）：
  1. **只改未来节点**：已收款的节点不许改不许删
  2. 比例：Σ(已收) + Σ(新计划) = 100%
  3. 金额：Σ(已收节点应收) + Σ(新计划) ≤ 合同额
  4. 审批人 = **商务部总监**（按单据归属部门找人，铁律 13），且不能审自己提交的
  5. 批准时**只替换未收节点**，已收的原样保留
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from app.models.payment_change import (
    PAY_CHANGE_APPROVED,
    PAY_CHANGE_PENDING,
    PAY_CHANGE_REJECTED,
    PAY_CHANGE_STATUS,
    PAY_CHANGE_WITHDRAWN,
)
from app.services.payment_change import PAY_DEPT, plan_errors

ROOT = Path(__file__).resolve().parents[2]  # 仓库根
BE = ROOT / "backend" / "app"
MIG = ROOT / "backend" / "alembic" / "versions"
FE = ROOT / "frontend" / "src"


def _term(name, percent=None, amount=None, received=0.0):
    return SimpleNamespace(node_name=name, percent=percent, amount=amount, received_amount=received)


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── 状态词表（枚举 = 契约） ───────────────────────────────────────────────
def test_status_vocabulary():
    assert PAY_CHANGE_STATUS == (
        PAY_CHANGE_PENDING,
        PAY_CHANGE_APPROVED,
        PAY_CHANGE_REJECTED,
        PAY_CHANGE_WITHDRAWN,
    )
    assert PAY_CHANGE_PENDING == "待商务总监审"


# ── 口径 1：只改未来节点 ─────────────────────────────────────────────────
def test_paid_node_cannot_be_changed():
    cur = [_term("预付款", 30, 1_080_000, received=1_080_000)]
    errs = plan_errors(
        contract_amount=3_600_000,
        current=cur,
        terms=[{"node_name": "预付款", "percent": 30, "amount": 1_080_000}],
    )
    assert any("已经收到过款" in e for e in errs), errs


# ── 口径 2：比例合计 ────────────────────────────────────────────────────
def test_percent_must_add_up_to_100_with_paid_part():
    cur = [_term("预付款", 30, 1_080_000, received=1_080_000), _term("发货款", 70, 2_520_000)]
    ok = plan_errors(
        contract_amount=3_600_000,
        current=cur,
        terms=[{"node_name": "发货款", "percent": 40}, {"node_name": "验收款", "percent": 20}, {"node_name": "质保金", "percent": 10}],
    )
    bad = plan_errors(
        contract_amount=3_600_000,
        current=cur,
        terms=[{"node_name": "发货款", "percent": 40}, {"node_name": "验收款", "percent": 20}],
    )
    assert ok == []
    assert any("必须是 100%" in e for e in bad)


# ── 口径 3：金额上限 ────────────────────────────────────────────────────
def test_amount_must_not_exceed_contract():
    cur = [_term("预付款", 30, 1_080_000, received=1_080_000)]
    errs = plan_errors(
        contract_amount=3_600_000,
        current=cur,
        terms=[{"node_name": "发货款", "percent": 50, "amount": 3_000_000}, {"node_name": "质保金", "percent": 20, "amount": 720_000}],
    )
    assert any("金额超合同额" in e for e in errs), errs


def test_empty_plan_rejected():
    assert plan_errors(contract_amount=1, current=[], terms=[]) == ["请填新的付款计划（还没收的节点）"]


# ── 口径 4：审批人 = 商务部总监，且不能自审 ───────────────────────────────
def test_approver_is_sales_director_and_not_self():
    src = _read(BE / "services" / "payment_change.py")
    assert 'PAY_DEPT = "SALES"' in src and "director_in_dept(session, PAY_DEPT)" in src
    assert "不能审自己提交的变更单" in src
    j = src.index("def decide(")
    body = src[j : src.index("def _apply(", j)]
    assert "只有本部门（商务部）总监能审这一级" in body
    assert "否决必须写清理由" in body


# ── 口径 5：批准只替换未收节点 ───────────────────────────────────────────
def test_apply_preserves_paid_terms():
    src = _read(BE / "services" / "payment_change.py")
    j = src.index("def _apply(")
    body = src[j : src.index("def withdraw(", j)]
    assert "已收节点留在最前" in body, "已收节点要保留且排在最前"
    assert "PaymentTerm.received_amount.is_(None) | (PaymentTerm.received_amount <= 0)" in body, (
        "只删未收节点"
    )
    assert "before_terms" in _read(BE / "models" / "payment_change.py"), "改前快照要留痕"
    assert "project.warranty_amount = sum(" in body, "质保金要按变更后的完整计划重算（没有质保节点就归零）"


# ── 编号只能由发号引擎出（铁律 1）+ 迁移要给存量库补规则 ──────────────────
def test_number_comes_from_engine_and_migration_seeds_rule():
    src = _read(BE / "services" / "payment_change.py")
    assert 'next_number(session, "PAY_CHANGE", scope_key=year_scope_key())' in src
    mig = _read(MIG / "c5d7e9f13a24_payment_change.py")
    assert "INSERT INTO number_rule" in mig and "'PAY_CHANGE'" in mig
    seed = _read(BE / "models" / "library_seed.py")
    assert "PAY_CHANGE_RULE" in seed and '"template": "PC{YY}{seq:03}"' in seed


# ── 前端要有入口（在项目详情「合同与商务」，不是藏在别的台） ──────────────
def test_frontend_has_the_entry():
    api = _read(FE / "api" / "paymentChange.ts") if (FE / "api" / "paymentChange.ts").exists() else ""
    assert "payment-changes" in api, "要有 API 客户端"
    page = _read(FE / "features" / "project" / "DetailPage.tsx")
    assert "PaymentChangeCard" in page, "项目详情「合同与商务」泳道里要挂上这张卡"
