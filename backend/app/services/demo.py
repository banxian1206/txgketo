"""演示账号（06 卷 §4）：给客户一套可切换登录的测试账号，用来验证工作台/审核链/通知。

· 幂等：按 username 建，已存在就跳过
· 岗位统一三级：组员 / 经理 / 总监
· 只建「演示账号」（remark 标记），可一键停用
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.platform import Org, Role, User

DEMO_PASSWORD = "txgk@123"
DEMO_REMARK = "演示账号"

# (username, 姓名, 组织 code, 岗位, 专业, 角色 codes)
DEMO_USERS: list[tuple[str, str, str, str, str | None, list[str]]] = [
    # 工程部
    ("eng_director", "工程总监", "ENG", "总监", None, ["DESIGN_AUDIT"]),
    ("mech_manager", "机械经理", "ENG_MECH", "经理", "机械", ["DESIGN_AUDIT"]),
    ("mech1", "机械组员", "ENG_MECH", "组员", "机械", ["DESIGN"]),
    ("elec_manager", "电气经理", "ENG_ELEC", "经理", "电气", ["DESIGN_AUDIT"]),
    ("elec1", "电气组员", "ENG_ELEC", "组员", "电气", ["DESIGN"]),
    ("prog_manager", "程序经理", "ENG_PROG", "经理", "程序", ["DESIGN_AUDIT"]),
    ("prog1", "程序组员", "ENG_PROG", "组员", "程序", ["DESIGN"]),
    ("craft_manager", "工艺经理", "ENG_CRAFT", "经理", "工艺", ["CRAFT"]),
    ("craft1", "工艺组员", "ENG_CRAFT", "组员", "工艺", ["CRAFT"]),
    # 商务部
    ("sales1", "销售组员", "SALES", "组员", None, ["SALES"]),
    ("sales_director", "商务部总监", "SALES", "总监", None, ["SALES"]),
    # 采购部
    ("buyer1", "采购组员", "PURCHASE", "组员", None, ["PURCHASE"]),
    # ★ 经理账号（客户口径 #17 要「经理 + 总监」两个；缺了经理会全程自动跳级、两级审批退化成一级）
    ("purchase_manager", "采购经理", "PURCHASE", "经理", None, ["PURCHASE_LEAD"]),
    ("purchase_director", "采购总监", "PURCHASE", "总监", None, ["PURCHASE_LEAD"]),
    # 仓库
    ("wh1", "仓管组员", "WH", "组员", None, ["WAREHOUSE"]),
    ("wh_director", "仓库总监", "WH", "总监", None, ["WAREHOUSE"]),
    # 车间
    ("shop1", "车间联络组员", "MFG", "组员", None, ["MFG"]),
    ("assy1", "装配技师", "MFG", "组员", None, ["ASSY"]),
    ("qc1", "质检员", "MFG", "组员", None, ["QC"]),
    # 交付 / 现场 / 售后
    ("delivery1", "交付发运", "GM", "组员", None, ["DELIVERY"]),
    ("site1", "现场负责人", "GM", "组员", None, ["SITE"]),
    ("service1", "售后工程师", "GM", "组员", None, ["SERVICE"]),
    # 项目 / 总经办 / 财务
    ("pm1", "项目经理", "GM", "组员", None, ["PM"]),
    ("gm", "总经理", "GM", "总监", None, ["GM"]),
    ("fin1", "财务组员", "FIN", "组员", None, ["FIN"]),
]


def seed_demo(session: Session, password: str = DEMO_PASSWORD) -> list[dict]:
    """建演示账号（幂等）；返回账号清单（含是否新建）。"""
    orgs = {o.code: o for o in session.scalars(select(Org)).all()}
    roles = {r.code: r for r in session.scalars(select(Role)).all()}
    out: list[dict] = []
    for username, name, org_code, position, profession, role_codes in DEMO_USERS:
        org = orgs.get(org_code)
        row_roles = [roles[c] for c in role_codes if c in roles]
        user = session.scalar(select(User).where(User.username == username))
        created = user is None
        if user is None:
            user = User(
                username=username,
                password_hash=hash_password(password),
                name=name,
                org_id=org.id if org else None,
                position=position,
                profession=profession,
                roles=row_roles,
                remark=DEMO_REMARK,
            )
            session.add(user)
            session.flush()
        out.append(
            {
                "username": username,
                "name": name,
                "password": password,
                "org": org.name if org else None,
                "position": position,
                "profession": profession,
                "roles": [r.name for r in row_roles],
                "created": created,
            }
        )
    return out


def set_demo_active(session: Session, active: bool) -> int:
    """启用/停用演示账号（不删，留历史；停用后不能登录）。"""
    rows = session.scalars(select(User).where(User.remark == DEMO_REMARK)).all()
    for u in rows:
        u.is_active = active
    return len(rows)
