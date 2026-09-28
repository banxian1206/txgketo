# -*- coding: utf-8 -*-
"""G1 项目归档 + 域错误全局处理器 护栏（09 卷 §3-G1，2026-09-28）。

来源：`docs/09-从商机到归档-口径确认与缺口计划.md` §3-G1
  客户口径：“归档是**自动**的。我们不是有一个质保期嘛，**质保期过了就自动归档**。”
"""
from __future__ import annotations

import pytest

from app.services import project_stage as ps


# ── G1：阶段机 ──────────────────────────────────────────────────────────────
def test_warranty_can_archive():
    assert ps.ARCHIVED in ps.STAGE_FLOW[ps.WARRANTY]


def test_archived_is_terminal():
    """已归档是终态：出不去（要改先走变更/解归档）。"""
    assert ps.STAGE_FLOW[ps.ARCHIVED] == set()
    with pytest.raises(ps.StageError):
        ps.assert_transition(ps.ARCHIVED, ps.WARRANTY)
    with pytest.raises(ps.StageError):
        ps.assert_transition(ps.ARCHIVED, ps.CLOSED)


def test_archived_in_all_stages():
    assert ps.ARCHIVED in ps.ALL_STAGES


def test_assert_writable_blocks_archived():
    class _P:
        project_no = "TX99999"
        stage = ps.ARCHIVED

    with pytest.raises(ps.StageError, match="已归档"):
        ps.assert_writable(_P())


def test_assert_writable_allows_normal_stages():
    class _P:
        project_no = "TX99999"
        stage = ps.WARRANTY

    ps.assert_writable(_P())  # 不抛


# ── 域错误全局处理器（防“路由忘了 try/except → 500”这一类）──────────────
def _domain_error_classes():
    from app.services.acceptance import AcceptanceError
    from app.services.change_flow import ChangeFlowError
    from app.services.manufacturing import ManufacturingError
    from app.services.numbering import NumberingError
    from app.services.project_stage import StageError
    from app.services.purchase_order import PurchaseOrderError
    from app.services.review_flow import ReviewFlowError
    from app.services.reviewers import ReviewerError
    from app.services.shipping import ShippingError
    from app.services.site import SiteError

    return (
        SiteError,
        AcceptanceError,
        PurchaseOrderError,
        ChangeFlowError,
        ReviewFlowError,
        ReviewerError,
        StageError,
        ShippingError,
        ManufacturingError,
        NumberingError,
    )


def test_all_domain_errors_have_a_global_400_handler():
    """★ 每个域错误类都必须有全局处理器 → 400。

    为什么单独立这条：同一个坑踩过三次 —— `merge_order`(N2)、`acceptance.confirm`(N25)、
    `site.add_issue`(G3)，都是**路由没接住域异常 → 500 空响应**。
    逐个 route 去 try/except 靠人记，迟早再漏；这条护栏让它**结构上不可能漏**。
    """
    from app.main import app

    missing = [e.__name__ for e in _domain_error_classes() if e not in app.exception_handlers]
    assert not missing, f"这些域错误没有全局处理器（会 500）：{missing}"


def test_forbidden_operation_stays_403():
    """越权仍是 403（不要被上面那批 400 吞掉语义）。"""
    from app.core.errors import ForbiddenOperation
    from app.main import app

    assert ForbiddenOperation in app.exception_handlers
