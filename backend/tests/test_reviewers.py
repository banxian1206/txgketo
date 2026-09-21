"""审核链的纯逻辑单测（05 卷 §2.1 / §0.1#13、06 卷 §3）。"""

from __future__ import annotations

import pytest

from app.services.reviewers import ReviewerError, chain_levels


def test_member_needs_two_levels() -> None:
    assert chain_levels("成员") == (True, True)
    assert chain_levels(None) == (True, True)


def test_lead_skips_first_level() -> None:
    assert chain_levels("组长") == (False, True)


def test_director_does_not_submit() -> None:
    with pytest.raises(ReviewerError):
        chain_levels("部门负责人")


def test_legacy_positions_still_work() -> None:
    assert chain_levels("设计师") == (True, True)
    assert chain_levels("设计组长") == (False, True)
    with pytest.raises(ReviewerError):
        chain_levels("工程总监")
