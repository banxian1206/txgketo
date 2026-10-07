"""初始化数据（幂等，可重复执行）：组织 / 权限 / 角色 / 管理员 / 编号规则。

用法： python -m scripts.seed
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models.library import Item, StdCategory, StdClass  # noqa: E402
from app.models.library_seed import (  # noqa: E402
    CATEGORIES,
    CHANGE_REQUEST_RULE,
    PAY_CHANGE_RULE,
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
from app.services.erp_legacy_map import CATEGORY_MAP as ERP_CATEGORY_MAP  # noqa: E402
from app.services.erp_legacy_map import CLASS_MAP as ERP_CLASS_MAP  # noqa: E402
from app.services.numbering import DEFAULT_RULES  # noqa: E402

# ★ 以 ERP 为准（docs/16，客户 2026-10-06）：下面这些「本地设的种子品类」不再建；
#   若库里已存在且没被物料引用，seed 时顺手清掉。
#   保留的 4 个（SF 伺服 / QG 气缸 / LS 螺丝 / ZCT 轴承）带规格模板，仍由 library_seed 建。
RETIRED_STD_CATEGORIES = {"BZ"}  # 外购标准件（ERP 无此类别）
RETIRED_STD_CLASSES = {
    "FT", "BT", "CG", "BC", "YG", "LC",  # 原材料细类 → ERP 统归「钢材/铁材/铝材…」
    "DG", "SG", "DJ", "JSJ", "JQR",       # → ERP「导轨类 / 动力类」
    "PLC", "CAM",                            # ERP 无对应物料
}

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
    # ★ 2026-10-07：价格库搬进「基础数据」后，**导入**单独拆一个码。
    #   以前导入挂在 purchase:edit（采购员也能改公司级价格库），导错一条会影响后面所有项目的比价。
    ("price:import", "导入历史价格库", "采购"),
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
    ("PURCHASE_LEAD", "采购经理", ["project:view", "purchase:view", "purchase:edit", "purchase:price", "purchase:payment", "std:view", "std:edit", "warehouse:view", "cost:view", "price:import"]),
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
# ★ 2026-10-05 客户拍板：**全站账号统一一个密码**（方便登录/测试）。
#   原来 admin 是 `admin12345`、25 个演示账号是 `txgk@123` 两套，
#   导致“以某人身份查看”被当成必需（因为它能免密看别人视角）。那个功能已删，
#   改为：要测谁就用谁的账号直接登录 —— 前提是密码统一且所有人都知道。
#   ⚠ **上线前必须改掉**（演示阶段才允许弱密码；且与 `services/demo.py` 的 DEMO_PASSWORD 保持一致，
#     否则又会变成两套）。
ADMIN_PASSWORD = "txgk@123"


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
            if c["code"] in RETIRED_STD_CATEGORIES:
                continue
            if not session.get(StdCategory, c["code"]):
                session.add(StdCategory(**c))
        session.flush()
        for k in CLASSES:
            if k["code"] in RETIRED_STD_CLASSES:
                continue
            row = session.get(StdClass, k["code"])
            if row is None:
                session.add(StdClass(**k))
            else:
                row.name = k["name"]
                row.category_code = k["category_code"]
                row.spec_template = k["spec_template"]
                row.seq = k["seq"]
        session.flush()

        # ★ 品类树以 ERP 为准：把 ERP 映射表也落库（只跑 seed 不跑 ERP 导入的开发库也有完整品类树）
        erp_cat_names: dict[str, str] = {}
        for _erp, (code, name) in ERP_CATEGORY_MAP.items():
            erp_cat_names[code] = name
        cat_seq = 100
        for code, name in erp_cat_names.items():
            if not session.get(StdCategory, code):
                session.add(StdCategory(code=code, name=name, seq=cat_seq))
                cat_seq += 1
        session.flush()
        cls_seq: dict[str, int] = {}
        for (_erp, _cls), (cat, cls, cls_name) in ERP_CLASS_MAP.items():
            if session.get(StdClass, cls) is None:
                cls_seq[cat] = cls_seq.get(cat, 100)
                session.add(StdClass(code=cls, name=cls_name, category_code=cat,
                                     spec_template=None, seq=cls_seq[cat]))
                cls_seq[cat] += 1
        session.flush()

        # ★ 清掉已废弃的本地种子品类（仅当没有任何物料引用它）
        retired = 0
        for code in RETIRED_STD_CLASSES:
            row = session.get(StdClass, code)
            if row is not None and not session.scalar(
                select(func.count()).select_from(Item).where(Item.std_class_code == code)
            ):
                session.delete(row)
                retired += 1
        session.flush()  # 先让品类删除落库，否则下面数类别下还剩几个品类会数到未删的
        for code in RETIRED_STD_CATEGORIES:
            row = session.get(StdCategory, code)
            if row is not None and not session.scalar(
                select(func.count()).select_from(StdClass).where(StdClass.category_code == code)
            ):
                session.delete(row)
                retired += 1
        session.flush()
        if retired:
            print(f"已按 ERP 为准清掉废弃种子品类 {retired} 个")

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
            PAY_CHANGE_RULE,
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
