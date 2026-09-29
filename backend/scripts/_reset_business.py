"""业务数据复位（**共用一份来源**，不要再各写一份）。

为什么要独立出来（第九轮报告 §7.4）：
`e2e_baseline` / `e2e:api` / `e2e:ui` 都会**建测试数据**（自建靶：商机、PO、批次、装配记录…），
跑完不清理 → 多轮连跑会累积一堆测试项目（我核对 Q-5 时就被坑过：9 个"单预付款"项目全是这么来的）。
前端 e2e 是 Node，**不能直连库**（引 `pg` 就是新依赖），所以复位只能由后端提供 → 就是这里。

保留的业务数据：**账号 / 组织 / 角色 / 权限 / 标准库类目**（都不在下面的表里）。
清掉的：项目、单据、批次、通知、审计、**物料档（item）**、编号流水（`number_seq`，让编号从头开始）。
"""

from __future__ import annotations

import os

from sqlalchemy import create_engine, text

DBURL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg://txgk:txgk@127.0.0.1:35432/txgk"
)

# 业务表（顺序无关，TRUNCATE ... CASCADE 一次搞定）
BUSINESS_TABLES = [
    "acceptance_document", "acceptance", "spare_part_move", "spare_part", "service_order",
    "site_incoming", "site_commission", "site_issue", "site_daily", "site_survey", "site_receipt",
    "shipment_item", "shipment_line", "shipment", "kitting_snapshot", "assembly_record",
    "prod_acceptance", "prod_task", "prod_order", "outsource_task", "material_issue_line",
    "material_issue", "stock_move", "stock_item", "warehouse_location", "goods_receipt",
    "purchase_approval", "purchase_order_line", "purchase_order",
    "purchase_request", "supplier_quote", "supplier_catalog", "supplier", "task",
    "review_ticket_item", "review_action", "review_ticket", "design_release", "change_request",
    "equipment_program_version", "equipment_program", "drawing_version", "drawing", "bom_item",
    "milestone", "project_member", "equipment", "payment_term", "contact", "customer",
    "project", "notification", "audit_log", "number_seq", "attachment",
]


def reset_business_data() -> None:
    """清空业务数据（**保留账号/组织/角色/标准库类目**），编号流水归零。"""
    e = create_engine(DBURL)
    with e.begin() as c:
        c.execute(text(f'TRUNCATE TABLE {", ".join(BUSINESS_TABLES)} RESTART IDENTITY CASCADE'))
        c.execute(text("DELETE FROM item"))
