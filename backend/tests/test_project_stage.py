"""项目阶段状态机测试（纯逻辑，不需要数据库）。"""

import pytest

from app.services.project_stage import (
    CLOSED,
    DELIVERING,
    EXECUTING,
    LEAD,
    StageError,
    WARRANTY,
    WON_PENDING,
    assert_transition,
)


class TestStageFlow:
    def test_线索可以成交或关闭(self):
        assert_transition(LEAD, WON_PENDING)
        assert_transition(LEAD, CLOSED)

    def test_线索不能直接跳到执行中(self):
        with pytest.raises(StageError):
            assert_transition(LEAD, EXECUTING)

    def test_成交后可以立项或关闭(self):
        assert_transition(WON_PENDING, EXECUTING)
        assert_transition(WON_PENDING, CLOSED)

    def test_正常链路(self):
        assert_transition(EXECUTING, DELIVERING)
        assert_transition(DELIVERING, WARRANTY)
        assert_transition(WARRANTY, CLOSED)

    def test_不允许原地不动(self):
        # ★ 这是防“重复提交把数据覆盖成空”的关键
        with pytest.raises(StageError):
            assert_transition(CLOSED, CLOSED)
        with pytest.raises(StageError):
            assert_transition(WON_PENDING, WON_PENDING)

    def test_允许原地不动时显式放行(self):
        assert_transition(WON_PENDING, WON_PENDING, allow_same=True)

    def test_已关闭是终点(self):
        for target in (LEAD, WON_PENDING, EXECUTING, DELIVERING, WARRANTY):
            with pytest.raises(StageError):
                assert_transition(CLOSED, target)
