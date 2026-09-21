"""审核链的纯逻辑单测（05 卷 §2.1 / §0.1#13、06 卷 §3）。

岗位统一三级：组员（一级） / 经理（二级） / 总监（三级）。
"""

from __future__ import annotations

import pytest

from app.services.reviewers import ReviewerError, chain_levels


def test_member_needs_two_levels() -> None:
    assert chain_levels("组员") == (True, True)
    assert chain_levels(None) == (True, True)


def test_manager_skips_first_level() -> None:
    assert chain_levels("经理") == (False, True)


def test_director_does_not_submit() -> None:
    with pytest.raises(ReviewerError):
        chain_levels("总监")


def test_legacy_positions_still_work() -> None:
    assert chain_levels("成员") == (True, True)
    assert chain_levels("设计师") == (True, True)
    assert chain_levels("组长") == (False, True)
    assert chain_levels("主管") == (False, True)
    with pytest.raises(ReviewerError):
        chain_levels("部门负责人")
    with pytest.raises(ReviewerError):
        chain_levels("工程总监")
