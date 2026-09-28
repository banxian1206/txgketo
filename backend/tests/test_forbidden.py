"""越权异常 → 403 的接线（AZ-04）：`ForbiddenOperation` 与域错误的边界。"""

from __future__ import annotations

from app.core.errors import ForbiddenOperation
from app.services.change_flow import ChangeFlowError
from app.services.review_flow import ReviewFlowError


class Test越权异常不被域错误吞掉:
    def test_不被改版域错误吞(self):
        """否则路由的 `except ChangeFlowError` 会把越权转成 400。"""
        assert not issubclass(ForbiddenOperation, ChangeFlowError)

    def test_不被评审域错误吞(self):
        assert not issubclass(ForbiddenOperation, ReviewFlowError)

    def test_全局处理器已注册(self):
        """`main.py` 必须把它映射成 403，否则会变成 500。"""
        from app.main import app

        assert ForbiddenOperation in app.exception_handlers
