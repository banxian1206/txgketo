"""平台基础接口：组织（可维护）/ 用户 / 角色（06 卷）。

三个层（06 卷 §1）：系统角色（功能/可见性）· 部门岗位（范围/审核链）· 项目角色（项目内指派）。
本模块管：组织树增改停用、用户管理（管理员 + 总监管本部门）、角色只读列表、我的权限范围。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user
from app.api.schemas import UserAdminOut, UserOut
from app.core.db import get_session
from app.core.security import hash_password
from app.models.platform import (
    DEPT_ROLE_CODES,
    LEGACY_POSITIONS,
    POSITION_DIRECTOR,
    POSITIONS,
    PROFESSIONS,
    AuditLog,
    Org,
    Role,
    User,
)
from app.services import audit

router = APIRouter(tags=["平台"])


# ---------------------------------------------------------------------------
# 组织：祖先 / 子树 / 权限范围
# ---------------------------------------------------------------------------


def _ancestors(session: Session, org: Org) -> list[Org]:
    out: list[Org] = [org]
    seen = {org.id}
    cur = org
    while cur.parent_id and cur.parent_id not in seen:
        parent = session.get(Org, cur.parent_id)
        if parent is None:
            break
        out.append(parent)
        seen.add(parent.id)
        cur = parent
    return out


def _department_root(session: Session, org_id: int | None) -> Org | None:
    """往上走到顶级 = 部门。"""
    org = session.get(Org, org_id) if org_id else None
    if org is None:
        return None
    return _ancestors(session, org)[-1]


def _subtree_ids(session: Session, root_id: int) -> set[int]:
    ids = {root_id}
    frontier = [root_id]
    while frontier:
        rows = session.scalars(select(Org).where(Org.parent_id.in_(frontier))).all()
        frontier = [r.id for r in rows if r.id not in ids]
        ids.update(frontier)
    return ids


def _scope(session: Session, current: User) -> dict:
    """当前用户能管什么：管理员=全部；总监=本部门；其他人=不能管。"""
    if current.is_superuser:
        return {"admin": True, "department": None, "role_codes": None, "can_manage": True}
    if current.position == POSITION_DIRECTOR and current.org_id:
        dept = _department_root(session, current.org_id)
        if dept is not None:
            codes = DEPT_ROLE_CODES.get(dept.code)
            if codes is None:  # 自定义部门：退回“他自己拥有的角色”（去掉 ADMIN）
                codes = tuple(sorted({r.code for r in current.roles if r.code != "ADMIN"}))
            return {
                "admin": False,
                "department": dept,
                "role_codes": set(codes),
                "can_manage": True,
            }
    return {"admin": False, "department": None, "role_codes": set(), "can_manage": False}


def _require_manage(session: Session, current: User) -> dict:
    scope = _scope(session, current)
    if not scope["can_manage"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "只有系统管理员或总监能维护用户")
    return scope


def _check_profession_position(profession: str | None, position: str | None) -> str | None:
    """专业 / 岗位取值校验（06 卷 §3）；旧岗位名自动折算成新三级。"""
    if profession is not None and profession not in PROFESSIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"专业只能是：{'/'.join(PROFESSIONS)}")
    if position is None:
        return None
    position = LEGACY_POSITIONS.get(position, position)
    if position not in POSITIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"岗位只能是：{'/'.join(POSITIONS)}")
    return position


class OrgOut(BaseModel):
    id: int
    code: str
    name: str
    parent_id: int | None = None
    kind: str | None = None
    is_active: bool = True
    user_count: int = 0


class OrgIn(BaseModel):
    name: str
    code: str | None = None
    parent_id: int | None = None
    kind: str | None = None


class OrgPatch(BaseModel):
    name: str | None = None
    parent_id: int | None = None
    kind: str | None = None
    is_active: bool | None = None


class RoleOut(BaseModel):
    id: int
    code: str
    name: str


def _next_org_code(session: Session) -> str:
    n = session.scalar(select(func.count()).select_from(Org)) or 0
    while True:
        n += 1
        code = f"ORG{n:03d}"
        if session.scalar(select(Org).where(Org.code == code)) is None:
            return code


def _org_dict(session: Session, o: Org, counts: dict[int, int] | None = None) -> OrgOut:
    return OrgOut(
        id=o.id,
        code=o.code,
        name=o.name,
        parent_id=o.parent_id,
        kind=o.kind,
        is_active=o.is_active,
        user_count=(counts or {}).get(o.id, 0),
    )


def _org_user_counts(session: Session) -> dict[int, int]:
    rows = session.execute(
        select(User.org_id, func.count()).where(User.is_active.is_(True)).group_by(User.org_id)
    ).all()
    return {org_id: n for org_id, n in rows if org_id is not None}


@router.get("/orgs", response_model=list[OrgOut])
def list_orgs(
    include_inactive: bool = False,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    stmt = select(Org).order_by(Org.id)
    if not include_inactive:
        stmt = stmt.where(Org.is_active.is_(True))
    counts = _org_user_counts(session)
    return [_org_dict(session, r, counts) for r in session.scalars(stmt).all()]


class DemoUsersIn(BaseModel):
    action: str = "create"  # create / disable / enable


@router.post("/demo-users")
def demo_users(
    body: DemoUsersIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """一键生成/停用演示账号（06 卷 §4；仅系统管理员）。"""
    if not current.is_superuser:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "只有系统管理员能生成演示账号")
    from app.services.demo import DEMO_PASSWORD, seed_demo, set_demo_active

    if body.action == "disable":
        n = set_demo_active(session, False)
        result: dict = {"action": "disable", "count": n}
    elif body.action == "enable":
        n = set_demo_active(session, True)
        result = {"action": "enable", "count": n}
    else:
        rows = seed_demo(session)
        result = {"action": "create", "password": DEMO_PASSWORD, "users": rows}
    audit.log(
        session,
        user=current,
        action="demo_users",
        object_type="user",
        object_ref="demo",
        summary=f"演示账号：{result['action']}",
        ip=client_ip(request),
    )
    session.commit()
    return result


@router.get("/my-scope")
def my_scope(session: Session = Depends(get_session), current: User = Depends(get_current_user)):
    """我能不能管用户/组织、能勾哪些角色（06 卷 §4）。"""
    scope = _scope(session, current)
    return {
        "is_admin": scope["admin"],
        "can_manage_users": scope["can_manage"],
        "can_manage_org": scope["can_manage"],
        "department": (
            {"id": scope["department"].id, "code": scope["department"].code, "name": scope["department"].name}
            if scope["department"]
            else None
        ),
        "assignable_role_codes": (
            None if scope["role_codes"] is None else sorted(scope["role_codes"])
        ),
        "positions": list(POSITIONS),
    }


@router.post("/orgs", response_model=OrgOut, status_code=status.HTTP_201_CREATED)
def create_org(
    body: OrgIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """新增部门 / 组（06 卷 §2）：管理员建部门，总监只能在自己部门下建组。"""
    scope = _require_manage(session, current)
    parent = session.get(Org, body.parent_id) if body.parent_id else None
    if body.parent_id and parent is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "上级组织不存在")
    if not body.name.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "名称不能为空")
    if not scope["admin"]:
        if parent is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "总监不能新建顶级部门")
        if parent.id not in _subtree_ids(session, scope["department"].id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "只能在自己部门下新增组")
    if body.code:
        if session.scalar(select(Org).where(Org.code == body.code)):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"组织代码已存在：{body.code}")
        code = body.code
    else:
        code = _next_org_code(session)
    row = Org(code=code, name=body.name.strip(), parent_id=body.parent_id, kind=body.kind)
    session.add(row)
    session.flush()
    audit.log(
        session,
        user=current,
        action="create",
        object_type="org",
        object_ref=code,
        summary=f"新增组织 {row.name}（上级 {parent.name if parent else '—'}）",
        ip=client_ip(request),
    )
    session.commit()
    return _org_dict(session, row, _org_user_counts(session))


@router.patch("/orgs/{org_id}", response_model=OrgOut)
def update_org(
    org_id: int,
    body: OrgPatch,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """改名 / 调整上级 / 停用（停用不删，留历史）（06 卷 §2）。"""
    scope = _require_manage(session, current)
    row = session.get(Org, org_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "组织不存在")
    if not scope["admin"]:
        allowed = _subtree_ids(session, scope["department"].id)
        if row.id not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "只能维护自己部门下的组织")
    data = body.model_dump(exclude_unset=True)
    if "parent_id" in data:
        new_parent_id = data["parent_id"]
        if new_parent_id == row.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "上级不能是自己")
        if new_parent_id is not None:
            if new_parent_id in _subtree_ids(session, row.id):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "不能把组织挂到自己的下级下面")
            new_parent = session.get(Org, new_parent_id)
            if new_parent is None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "上级组织不存在")
            if not scope["admin"] and new_parent_id not in _subtree_ids(
                session, scope["department"].id
            ):
                raise HTTPException(status.HTTP_403_FORBIDDEN, "不能把组织移出自己部门")
        row.parent_id = new_parent_id
    if "name" in data:
        if not (data["name"] or "").strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "名称不能为空")
        row.name = data["name"].strip()
    if "kind" in data:
        row.kind = data["kind"]
    if "is_active" in data:
        row.is_active = data["is_active"]
    audit.log(
        session,
        user=current,
        action="update",
        object_type="org",
        object_ref=row.code,
        summary=f"更新组织 {row.name}（{row.is_active and '启用' or '停用'}）",
        detail=data,
        ip=client_ip(request),
    )
    session.commit()
    return _org_dict(session, row, _org_user_counts(session))


@router.get("/roles", response_model=list[RoleOut])
def list_roles(session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    rows = session.scalars(select(Role).order_by(Role.id)).all()
    return [RoleOut(id=r.id, code=r.code, name=r.name) for r in rows]


@router.get("/users", response_model=list[UserAdminOut])
def list_users(
    org_id: int | None = Query(default=None, description="按组织（含下级）过滤"),
    role_code: str | None = None,
    is_active: bool | None = None,
    q: str | None = Query(default=None, description="账号/姓名关键字"),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    stmt = select(User).order_by(User.id)
    if org_id:
        stmt = stmt.where(User.org_id.in_(_subtree_ids(session, org_id)))
    if is_active is not None:
        stmt = stmt.where(User.is_active.is_(is_active))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(User.username.like(like), User.name.like(like)))
    rows = session.scalars(stmt).all()
    if role_code:
        rows = [u for u in rows if any(r.code == role_code for r in u.roles)]
    return [
        UserAdminOut(**UserOut.model_validate(u).model_dump(), roles=[x.code for x in u.roles])
        for u in rows
    ]


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


class UserCreateIn(BaseModel):
    username: str
    password: str
    name: str
    phone: str | None = None
    org_id: int | None = None
    profession: str | None = None  # 机械/电气/程序/工艺（工程部）
    position: str | None = None  # 组员 / 经理 / 总监
    title: str | None = None  # 称谓（可选填，如“设计师”）
    role_codes: list[str] = []


class UserUpdateIn(BaseModel):
    """改用户：配部门/岗位/角色、停用、重置密码。"""

    name: str | None = None
    phone: str | None = None
    org_id: int | None = None
    profession: str | None = None
    position: str | None = None
    title: str | None = None
    role_codes: list[str] | None = None
    is_active: bool | None = None
    password: str | None = None


def _validate_roles(session: Session, codes: list[str]) -> list[Role]:
    roles: list[Role] = []
    for code in codes:
        role = session.scalar(select(Role).where(Role.code == code))
        if role is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"角色不存在：{code}")
        roles.append(role)
    return roles


def _enforce_scope(
    session: Session,
    scope: dict,
    org_id: int | None,
    role_codes: list[str] | None,
    position: str | None,
) -> None:
    """总监：只能管本部门的人、只能勾本部门角色、只能定组员/经理。"""
    if scope["admin"]:
        return
    dept: Org = scope["department"]
    allowed_orgs = _subtree_ids(session, dept.id)
    if org_id is None or org_id not in allowed_orgs:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "只能把人员放在自己部门下")
    if position == POSITION_DIRECTOR:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "总监不能任命其他总监")
    if role_codes:
        bad = [c for c in role_codes if c not in scope["role_codes"]]
        if bad:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"这些角色不在本部门可勾范围内：{'/'.join(bad)}",
            )


@router.post("/users", response_model=UserAdminOut, status_code=status.HTTP_201_CREATED)
def create_user(
    body: UserCreateIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    scope = _require_manage(session, current)
    if session.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "账号已存在")
    position = _check_profession_position(body.profession, body.position)
    _enforce_scope(session, scope, body.org_id, body.role_codes, position)
    roles = _validate_roles(session, body.role_codes)
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        name=body.name,
        phone=body.phone,
        org_id=body.org_id,
        profession=body.profession,
        position=position,
        title=(body.title or "").strip() or None,
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
        detail={"roles": body.role_codes, "position": position, "org_id": body.org_id},
        ip=client_ip(request),
    )
    session.commit()
    return UserAdminOut(**UserOut.model_validate(user).model_dump(), roles=[r.code for r in roles])


@router.patch("/users/{user_id}", response_model=UserAdminOut)
def update_user(
    user_id: int,
    body: UserUpdateIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """改部门 / 岗位 / 角色 / 停用 / 重置密码；审核人（经理、总监）就是在这里配出来的。"""
    scope = _require_manage(session, current)
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用户不存在")
    if user.is_superuser and not current.is_superuser:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "不能修改系统管理员")
    if not scope["admin"] and user.org_id not in _subtree_ids(session, scope["department"].id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "只能维护自己部门的人")

    data = body.model_dump(exclude_unset=True)
    position = _check_profession_position(data.get("profession"), data.get("position"))
    role_codes = data.get("role_codes")
    target_org = data.get("org_id", user.org_id)
    _enforce_scope(session, scope, target_org, role_codes, position)

    changed: list[str] = []
    for field in ("name", "phone", "org_id", "profession", "title"):
        if field in data and data[field] is not None:
            setattr(user, field, data[field])
            changed.append(field)
    if position is not None:
        user.position = position
        changed.append("position")
    if user.title is not None and not str(user.title).strip():
        user.title = None
    if data.get("is_active") is not None:
        user.is_active = data["is_active"]
        changed.append("is_active")
    if role_codes is not None:
        user.roles = _validate_roles(session, role_codes)
        changed.append("roles")
    if data.get("password"):
        user.password_hash = hash_password(data["password"])
        changed.append("password")
    audit.log(
        session,
        user=current,
        action="update",
        object_type="user",
        object_ref=user.username,
        summary=f"更新用户 {user.name}（{'/'.join(changed) or '无变化'}）",
        detail={"position": user.position, "org_id": user.org_id},
        ip=client_ip(request),
    )
    session.commit()
    return UserAdminOut(
        **UserOut.model_validate(user).model_dump(), roles=[r.code for r in user.roles]
    )
