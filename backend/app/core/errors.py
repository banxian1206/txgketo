"""跨域异常类型：与 FastAPI、各域业务错误解耦，供服务层抛出、全局映射状态码。

`02-数据模型` / `06-用户-角色-权限` 口径：授权失败必须与「请求格式错误」区分开。
"""

from __future__ import annotations


class ForbiddenOperation(Exception):
    """越权：服务层识别到「不是这个人 / 这个角色能做的动作」。

    ★ 与各域业务错误（`ChangeFlowError` / `ReviewFlowError` / …，路由统一转 400）**故意不继承**：
    越权不该被记成「请求格式错误」（AZ-04），也不该被路由的 `except XxxError` 吞成 400。
    由 `app/main.py` 的全局处理器统一转 **403**。
    """
