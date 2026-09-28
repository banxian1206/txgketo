"""初始化数据（幂等，可重复执行）：组织 / 权限 / 角色 / 管理员 / 编号规则。

用法： python -m scripts.seed
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models.library import StdCategory, StdClass  # noqa: E402
from app.models.library_seed import (  # noqa: E402
    CATEGORIES,
    CHANGE_REQUEST_RULE,
    CLASSES,
    DESIGN_RELEASE_RULE,
    ISSUE_RULE,
    PO_RULE,
    RECEIPT_RULE,
    REVIEW_TICKET_RULE,
    SUPPLIER_RULE,
    STD_ITEM_RULE,
    TASK_RULE,
)
from app.models.numbering import NumberRule  # noqa: E402
from app.models.platform import Org, Permission, Role, User  # noqa: E402
from app.services.numbering import DEFAULT_RULES  # noqa: E402

# 组织（部门 → 小组用 parent_code 表达；05 卷 §2.1 工程部 → 四个专业组）
ORGS: list[tuple[str, str, str, str | None]] = [
    ("GM", "总经办", "管理", None),
    ("SALES", "销售部", "业务", None),
    ("SCHEME", "方案部", "业务", None),
    ("ENG", "工程部", "技术", None),
    ("ENG_MECH", "机械组", "技术", "ENG"),
    ("ENG_ELEC", "电气组", "技术", "ENG"),
    ("ENG_PROG", "程序组", "技术", "ENG"),
    ("ENG_CRAFT", "工艺组", "技术", "ENG"),
    ("PURCHASE", "采购部", "供应链", None),
    ("WH", "仓库", "供应链", None),
    ("MFG", "制造车间", "制造", None),
    ("ASSY", "装配车间", "制造", None),
    ("QC", "质量部", "质量", None),
    ("DELIVERY", "交付发运", "交付", None),
    ("SITE", "现场服务", "交付", None),
    ("SERVICE", "售后部", "售后", None),
    ("FIN", "财务部", "职能", None),
]

# 旧模型遗留：设计部 / 工艺部已并入「工程部 → 四个专业组」，保留行、置为停用
RETIRED_ORGS = ("DESIGN", "CRAFT")

PERMISSIONS: list[tuple[str, str, str]] = [
    ("project:view", "查看项目", "项目"),
    ("project:edit", "新建/编辑项目", "项目"),
    ("project:close", "关闭项目", "项目"),
    ("project:amount", "查看项目金额", "项目"),
    ("customer:view", "查看客户", "项目"),
    ("customer:edit", "维护客户", "项目"),
    ("contract:view", "查看合同金额", "商务"),
    ("contract:edit", "登记合同与付款", "商务"),
    ("design:edit", "图纸与 BOM 提交", "工程"),
    ("design:audit", "图纸/BOM 审核发布", "工程"),
    ("std:view", "查看标准库", "标准库"),
    ("std:edit", "维护标准库", "标准库"),
    ("purchase:view", "查看采购", "采购"),
    ("purchase:edit", "采购下单", "采购"),
    ("purchase:price", "查看采购价格", "采购"),
    ("purchase:payment", "标记付款/上传付款凭证", "采购"),
    ("warehouse:view", "查看库存", "仓库"),
    ("warehouse:edit", "到货验收/入库/领料", "仓库"),
    ("mfg:view", "查看制造任务", "制造"),
    ("mfg:edit", "排产与验收", "制造"),
    ("ship:edit", "发货指令与发运", "交付"),
    ("site:edit", "现场汇报", "现场"),
    ("acceptance:edit", "验收与资料包", "交付"),
    ("service:edit", "售后工单", "售后"),
    ("cost:view", "查看成本与毛利", "财务"),
    ("payment:edit", "回款登记", "财务"),
    ("system:admin", "系统管理", "系统"),
]

ROLES: list[tuple[str, str, list[str]]] = [
    ("ADMIN", "系统管理员", ["system:admin"]),
    ("GM", "经营决策", ["project:view", "project:amount", "contract:view", "cost:view", "purchase:price"]),
    ("SALES", "销售/商务", ["project:view", "project:edit", "project:close", "project:amount", "customer:view", "customer:edit", "contract:view", "contract:edit", "payment:edit"]),
    ("SCHEME", "方案工程师", ["project:view", "customer:view"]),
    ("DESIGN", "设计", ["project:view", "design:edit", "std:view"]),
    ("DESIGN_AUDIT", "技术审核", ["project:view", "design:edit", "design:audit", "std:view"]),
    ("CRAFT", "工艺", ["project:view", "design:edit", "std:view", "std:edit"]),
    ("PM", "项目经理", ["project:view", "project:edit", "project:amount", "contract:view", "design:edit", "purchase:view", "mfg:view", "ship:edit", "site:edit", "acceptance:edit"]),
    ("PURCHASE", "采购", ["project:view", "purchase:view", "purchase:edit", "purchase:price", "purchase:payment", "std:view", "warehouse:view"]),
    ("PURCHASE_LEAD", "采购经理", ["project:view", "purchase:view", "purchase:edit", "purchase:price", "purchase:payment", "std:view", "std:edit", "warehouse:view", "cost:view"]),
    ("WAREHOUSE", "仓库", ["project:view", "warehouse:view", "warehouse:edit", "purchase:view", "std:view"]),
    ("MFG", "制造执行", ["project:view", "mfg:view", "mfg:edit", "warehouse:edit"]),
    ("ASSY", "装配", ["project:view", "mfg:view", "mfg:edit"]),
    ("QC", "质量", ["project:view", "mfg:view", "mfg:edit", "design:edit"]),
    ("DELIVERY", "交付发运", ["project:view", "ship:edit", "warehouse:view"]),
    ("SITE", "现场服务", ["project:view", "site:edit", "acceptance:edit"]),
    ("SERVICE", "售后", ["project:view", "service:edit"]),
    ("FIN", "财务", ["project:view", "project:amount", "contract:view", "cost:view", "purchase:price", "purchase:payment", "payment:edit"]),
]

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin12345"


def main() -> None:
    with SessionLocal() as session:
        # 组织（父级先建；已存在的行同步名称/父级并恢复启用）
        org_map: dict[str, Org] = {o.code: o for o in session.scalars(select(Org)).all()}
        for code, name, kind, parent_code in ORGS:
            row = org_map.get(code)
            if row is None:
                row = Org(code=code, name=name, kind=kind)
                session.add(row)
                session.flush()
                org_map[code] = row
            row.name = name
            row.kind = kind
            row.is_active = True
            row.parent_id = org_map[parent_code].id if parent_code else None
        for code in RETIRED_ORGS:
            row = org_map.get(code)
            if row is not None:
                row.is_active = False
        session.flush()

        # 权限
        perm_map: dict[str, Permission] = {}
        for code, name, module in PERMISSIONS:
            row = session.scalar(select(Permission).where(Permission.code == code))
            if row is None:
                row = Permission(code=code, name=name, module=module)
                session.add(row)
            perm_map[code] = row
        session.flush()

        # 角色
        for code, name, perms in ROLES:
            role = session.scalar(select(Role).where(Role.code == code))
            if role is None:
                role = Role(code=code, name=name)
                session.add(role)
                session.flush()
            role.permissions = [perm_map[c] for c in perms if c in perm_map]
        session.flush()

        # 标准库：类别 + 品类（含规格模板）
        for c in CATEGORIES:
            if not session.get(StdCategory, c["code"]):
                session.add(StdCategory(**c))
        session.flush()
        for k in CLASSES:
            row = session.get(StdClass, k["code"])
            if row is None:
                session.add(StdClass(**k))
            else:
                row.name = k["name"]
                row.category_code = k["category_code"]
                row.spec_template = k["spec_template"]
                row.seq = k["seq"]
        session.flush()

        # 编号规则
        for rule in [
            *DEFAULT_RULES,
            STD_ITEM_RULE,
            TASK_RULE,
            RECEIPT_RULE,
            SUPPLIER_RULE,
            ISSUE_RULE,
            PO_RULE,
            REVIEW_TICKET_RULE,
            DESIGN_RELEASE_RULE,
            CHANGE_REQUEST_RULE,
        ]:
            row = session.scalar(select(NumberRule).where(NumberRule.object_type == rule["object_type"]))
            if row is None:
                session.add(NumberRule(**rule))
        session.flush()

        # 管理员
        admin = session.scalar(select(User).where(User.username == ADMIN_USERNAME))
        if admin is None:
            admin_role = session.scalar(select(Role).where(Role.code == "ADMIN"))
            admin = User(
                username=ADMIN_USERNAME,
                password_hash=hash_password(ADMIN_PASSWORD),
                name="系统管理员",
                is_superuser=True,
                roles=[admin_role] if admin_role else [],
            )
            session.add(admin)

        session.commit()
    print("seed 完成：组织 / 权限 / 角色 / 编号规则 / 标准库 / 管理员")
    print(f"初始账号：{ADMIN_USERNAME} / {ADMIN_PASSWORD}（上线前必须改密）")


if __name__ == "__main__":
    main()
