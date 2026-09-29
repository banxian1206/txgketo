from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, effective_permissions, get_current_user
from app.api.schemas import LoginIn, LoginOut, UserOut
from app.core.db import get_session
from app.core.security import create_access_token, verify_password
from app.models.platform import User
from app.services import audit

router = APIRouter(tags=["认证"])


def _user_out(session: Session, user: User) -> UserOut:
    """登录/me 下发的权限码 = 角色码 + **派生码**（admin:users / admin:audit）。

    前端拿它做可见性判断（页签、侧栏、按钮），后端拿同一套 `_scope()` 做门禁 ——
    所以「看得见」必然「调得动」（重整方案 docs/10 硬规则 5：前端可见 ⊆ 后端可调用）。
    """
    out = UserOut.model_validate(user)
    out.permissions = sorted(effective_permissions(session, user))
    return out


@router.post("/auth/login", response_model=LoginOut)
def login(body: LoginIn, request: Request, session: Session = Depends(get_session)) -> LoginOut:
    user = session.scalar(select(User).where(User.username == body.username))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "账号或密码错误")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "账号已停用")

    user.last_login_at = datetime.now(UTC)
    audit.log(
        session,
        user=user,
        action="login",
        object_type="user",
        object_ref=user.username,
        summary=f"{user.name} 登录",
        ip=client_ip(request),
    )
    session.commit()
    return LoginOut(access_token=create_access_token(user.username), user=_user_out(session, user))


@router.get("/auth/me", response_model=UserOut)
def me(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserOut:
    return _user_out(session, user)
