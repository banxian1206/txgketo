"""API 公共依赖：当前用户、会话。"""

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.security import decode_access_token
from app.models.platform import User

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: Session = Depends(get_session),
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "未登录")
    payload = decode_access_token(creds.credentials)
    if not payload or not payload.get("sub"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登录已过期，请重新登录")
    user = session.scalar(select(User).where(User.username == payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户不存在或已停用")

    # ★ 管理员「以某人身份查看」（06 卷 §4）：只对 GET 生效（写操作被中间件拦截）
    impersonate = request.headers.get("x-impersonate")
    if impersonate and user.is_superuser:
        try:
            target = session.get(User, int(impersonate))
        except ValueError:
            target = None
        if target is not None and target.is_active:
            return target
    return user


def client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


# ---------------------------------------------------------------------------
# 权限（06 卷 §4/§10）：关键动作强校验
# ---------------------------------------------------------------------------


def permissions_of(user: User) -> set[str]:
    return {p.code for r in user.roles for p in r.permissions}


def has_permission(user: User, code: str) -> bool:
    return user.is_superuser or code in permissions_of(user)


def require_permission(code: str):
    """用法：current: User = Depends(require_permission("purchase:edit"))"""

    def dep(current: User = Depends(get_current_user)) -> User:
        if not has_permission(current, code):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"没有权限：{code}")
        return current

    return dep


# 金额字段名（无对应权限时抹成 None，前端直接不显示）
MONEY_KEYS = {
    "unit_price",
    "amount",
    "amount_tax_incl",
    "total_amount",
    "est_amount",
    "price",
    "avg_price",
    "min_price",
    "max_price",
    "last_price",
    "performance_deposit",
    "warranty_amount",
}


def scrub_money(obj):
    """递归把金额字段抹掉（无金额权限时用）。"""
    if isinstance(obj, dict):
        return {k: (None if k in MONEY_KEYS else scrub_money(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [scrub_money(x) for x in obj]
    return obj
