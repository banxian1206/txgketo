"""平台基础接口：组织 / 用户 / 角色。"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user
from app.api.schemas import UserOut
from app.core.db import get_session
from app.core.security import hash_password
from app.models.platform import PROFESSIONS, POSITIONS, AuditLog, Org, Role, User
from app.services import audit

router = APIRouter(tags=["平台"])


def _check_profession_position(profession: str | None, position: str | None) -> None:
    """专业 / 岗位取值校验（05 卷 §2.1）。"""
    if profession is not None and profession not in PROFESSIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"专业只能是：{'/'.join(PROFESSIONS)}")
    if position is not None and position not in POSITIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"岗位只能是：{'/'.join(POSITIONS)}")


class OrgOut(BaseModel):
    id: int
    code: str
    name: str
    parent_id: int | None = None
    kind: str | None = None


class RoleOut(BaseModel):
    id: int
    code: str
    name: str


class UserCreateIn(BaseModel):
    username: str
    password: str
    name: str
    phone: str | None = None
    org_id: int | None = None
    profession: str | None = None  # 机械/电气/程序/工艺（工程部）
    position: str | None = None  # 设计师/设计组长/工程总监
    role_codes: list[str] = []


class UserUpdateIn(BaseModel):
    """改用户：配专业/岗位/组织/角色、停用、重置密码。"""

    name: str | None = None
    phone: str | None = None
    org_id: int | None = None
    profession: str | None = None
    position: str | None = None
    role_codes: list[str] | None = None
    is_active: bool | None = None
    password: str | None = None


@router.get("/orgs", response_model=list[OrgOut])
def list_orgs(
    include_inactive: bool = False,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    stmt = select(Org).order_by(Org.id)
    if not include_inactive:
        stmt = stmt.where(Org.is_active.is_(True))
    rows = session.scalars(stmt).all()
    return [OrgOut(id=r.id, code=r.code, name=r.name, parent_id=r.parent_id, kind=r.kind) for r in rows]


@router.get("/roles", response_model=list[RoleOut])
def list_roles(session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    rows = session.scalars(select(Role).order_by(Role.id)).all()
    return [RoleOut(id=r.id, code=r.code, name=r.name) for r in rows]


@router.get("/users", response_model=list[UserOut])
def list_users(session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    rows = session.scalars(select(User).order_by(User.id)).all()
    return [UserOut.model_validate(r) for r in rows]


@router.get("/audit-logs")
def list_audit_logs(
    object_type: str | None = None,
    object_ref: str | None = None,
    limit: int = 100,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
) -> list[dict]:
    """操作记录（谁、什么时候、干了什么）—— 商机详情抽屉的“操作记录”页签用。"""
    stmt = select(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 500))
    if object_type:
        stmt = stmt.where(AuditLog.object_type == object_type)
    if object_ref:
        stmt = stmt.where(AuditLog.object_ref == object_ref)
    rows = session.scalars(stmt).all()
    return [
        {
            "id": r.id,
            "username": r.username,
            "action": r.action,
            "object_type": r.object_type,
            "object_ref": r.object_ref,
            "summary": r.summary,
            "detail": r.detail,
            "created_at": r.created_at,
        }
        for r in rows
    ]


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    body: UserCreateIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    if session.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "账号已存在")
    _check_profession_position(body.profession, body.position)
    roles: list[Role] = []
    for code in body.role_codes:
        role = session.scalar(select(Role).where(Role.code == code))
        if role is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"角色不存在：{code}")
        roles.append(role)
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        name=body.name,
        phone=body.phone,
        org_id=body.org_id,
        profession=body.profession,
        position=body.position,
        roles=roles,
    )
    session.add(user)
    session.flush()
    audit.log(
        session,
        user=current,
        action="create",
        object_type="user",
        object_ref=user.username,
        summary=f"新建用户 {user.name}",
        detail={"roles": body.role_codes, "profession": body.profession, "position": body.position},
        ip=client_ip(request),
    )
    session.commit()
    return UserOut.model_validate(user)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    body: UserUpdateIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """配专业/岗位/组织/角色 —— 审核人（组长/总监）就是在这里配出来的。"""
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用户不存在")
    _check_profession_position(body.profession, body.position)
    changed: list[str] = []
    for field in ("name", "phone", "org_id", "profession", "position"):
        value = getattr(body, field)
        if value is not None:
            setattr(user, field, value)
            changed.append(field)
    if body.is_active is not None:
        user.is_active = body.is_active
        changed.append("is_active")
    if body.role_codes is not None:
        roles: list[Role] = []
        for code in body.role_codes:
            role = session.scalar(select(Role).where(Role.code == code))
            if role is None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"角色不存在：{code}")
            roles.append(role)
        user.roles = roles
        changed.append("roles")
    if body.password:
        user.password_hash = hash_password(body.password)
        changed.append("password")
    audit.log(
        session,
        user=current,
        action="update",
        object_type="user",
        object_ref=user.username,
        summary=f"更新用户 {user.name}（{'/'.join(changed) or '无变化'}）",
        detail={"profession": user.profession, "position": user.position},
        ip=client_ip(request),
    )
    session.commit()
    return UserOut.model_validate(user)
