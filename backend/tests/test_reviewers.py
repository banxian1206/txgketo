"""审核链的纯逻辑单测（05 卷 §2.1 / §0.1#13）。"""

from __future__ import annotations

import pytest

from app.services.reviewers import ReviewerError, chain_levels


def test_designer_needs_two_levels() -> None:
    assert chain_levels("设计师") == (True, True)
    assert chain_levels(None) == (True, True)


def test_lead_skips_first_level() -> None:
    assert chain_levels("设计组长") == (False, True)


def test_director_cannot_self_review() -> None:
    with pytest.raises(ReviewerError):
        chain_levels("工程总监")
