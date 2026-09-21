"""S0 商机 → S1 立项：清库（保留账号/组织/标准库类目）→ 重建常用物料 → 按真实接口走一遍。

    DATABASE_URL=... .venv/bin/python -m scripts.seed_s0_s1
"""

from datetime import date, timedelta
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from app.main import app  # noqa: E402

today = date.today()
d = lambda n: (today + timedelta(days=n)).isoformat()  # noqa: E731

TABLES = [
    "acceptance_document", "acceptance", "spare_part_move", "spare_part", "service_order",
    "site_incoming", "site_commission", "site_issue", "site_daily", "site_survey", "site_receipt",
    "packing_list", "shipment_line", "shipment", "kitting_snapshot", "assembly_record",
    "prod_acceptance", "prod_task", "prod_order", "outsource_task", "material_issue_line",
    "material_issue", "stock_move", "stock_item", "warehouse_location", "goods_receipt",
    "purchase_request", "supplier_quote", "supplier_catalog", "supplier", "task",
    "review_ticket_item", "review_ticket", "design_release", "change_request",
    "equipment_program_version", "equipment_program", "drawing_version", "drawing", "bom_item",
    "milestone", "project_member", "equipment", "payment_term", "contact", "customer", "project",
    "notification", "audit_log", "number_seq",
]

ITEMS = [
    ("DJ", {"brand": "台达", "model": "ECMA-C21310", "power": "1kW", "voltage": "220V"}, "台"),
    ("JSJ", {"brand": "纽氏达特", "model": "PLE60-10", "ratio": "1:10"}, "台"),
    ("QG", {"brand": "SMC", "model": "CDQ2B32-100", "bore": "32", "stroke": "100"}, "只"),
    ("FT", {"material": "Q235", "w": "40", "h": "40", "t": "2.0", "len": "6000"}, "米"),
    ("BC", {"material": "Q235", "t": "2.0", "size": "1220x2440"}, "张"),
    ("PLC", {"brand": "汇川", "series": "AM401", "model": "AM401-CPU1602", "io": "32点"}, "套"),
    ("SF", {"brand": "台达", "model": "ASDA-B3", "power": "750W"}, "台"),
    ("ZCT", {"brand": "NSK", "model": "6204DDU"}, "个"),
]

MEMBERS = [
    ("pm1", "项目经理"), ("mech_manager", "机械负责人"), ("elec_manager", "电气负责人"),
    ("prog_manager", "程序负责人"), ("craft_manager", "工艺负责人"), ("buyer1", "采购负责人"),
    ("shop1", "生产负责人"), ("assy1", "装配负责人"), ("site1", "现场负责人"), ("service1", "售后负责人"),
]


def main() -> None:
    url = os.environ["DATABASE_URL"]
    e = create_engine(url)
    with e.begin() as c:
        c.execute(text(f'TRUNCATE TABLE {", ".join(TABLES)} RESTART IDENTITY CASCADE'))
        c.execute(text("delete from item"))
    print("🧹 业务数据已清空（编号序列归零）")

    with TestClient(app) as c:
        def login(u):
            pwd = "admin12345" if u == "admin" else "txgk@123"
            r = c.post("/api/v1/auth/login", json={"username": u, "password": pwd})
            assert r.status_code == 200, (u, r.text)
            return {"Authorization": f"Bearer {r.json()['access_token']}"}

        def call(method, url_, who, label, ok=(200,), **kw):
            r = getattr(c, method)(url_, headers=login(who), **kw)
            okk = r.status_code in ok
            print(("  ✅" if okk else "  ❌"), label, "" if okk else f"→ {r.status_code}: {r.text[:200]}")
            assert okk, label
            return r.json() if r.content else None

        for cls, spec, unit in ITEMS:
            r = c.post("/api/v1/library/items", headers=login("admin"),
                       json={"std_class_code": cls, "spec": spec, "unit": unit})
            assert r.status_code == 201, r.text
        print(f"📦 标准库物料重建 {len(ITEMS)} 条")

        users = {u["username"]: u["id"] for u in c.get("/api/v1/users", headers=login("admin")).json()}
        p = call("post", "/api/v1/projects", "sales1", "① 新建商机（选销售负责人=sales1）", ok=(201,), json={
            "sales_id": users["sales1"],
            "customer_name": "创维rgb电子", "project_name": "65寸电视后壳自动锁附线",
            "contacts": [{"name": "刘工", "title": "设备科", "phone": "13800000000", "role_tag": "技术对接人"}],
            "deadline": d(14), "delivery_days": 120, "deal_mode": "直签", "source": "老客户复购",
            "est_amount": 1600000, "project_desc": "1 台升降贴合机 + 输送段，节拍 12s/台"})["project_no"]
        print("     → 商机号", p, "（阶段：线索）")

        call("post", f"/api/v1/projects/{p}/deal", "sales1", "② 成交登记：168 万 / 质保 12 月 / 4 付款节点", ok=(200,), json={
            "period_start": d(0), "period_end": d(120), "amount": 1680000,
            "contract_no_customer": "SW-2026-0311", "warranty_months": 12, "warranty_amount": 84000,
            "tech_agreement_frozen": True, "acceptance_standard": "节拍 12s/台，72h 良率 ≥98%",
            "payment_terms": [
                {"node_name": "预付款", "percent": 30, "amount": 504000, "condition": "合同签订 7 日内"},
                {"node_name": "发货款", "percent": 30, "amount": 504000, "condition": "发货前"},
                {"node_name": "验收款", "percent": 30, "amount": 504000, "condition": "验收合格后"},
                {"node_name": "质保金", "percent": 10, "amount": 168000, "condition": "质保期满"}]})
        print("     → 阶段：", c.get(f"/api/v1/projects/{p}", headers=login("sales1")).json()["stage"])

        users = {u["username"]: u["id"] for u in c.get("/api/v1/users", headers=login("admin")).json()}
        for u, role in MEMBERS:
            call("post", f"/api/v1/projects/{p}/members", "pm1", f"③ 任命 {role}={u}", ok=(201,),
                 json={"user_id": users[u], "project_role": role})
        call("post", f"/api/v1/projects/{p}/equipment", "pm1", "④ 设备：01A OC 贴合机", ok=(201,),
             json={"equip_name": "OC 贴合机", "kind": "单机"})
        call("post", f"/api/v1/projects/{p}/milestones/generate", "pm1", "⑤ 标准节点", ok=(200,))
        it = c.get("/api/v1/library/items", headers=login("pm1"), params={"q": "减速机"}).json()[0]
        call("post", f"/api/v1/projects/{p}/purchase-requests", "pm1",
             f"⑥ 长周期件 {it['item_no']} ×2（立项即下单）", ok=(201,),
             json={"item_no": it["item_no"], "qty": 2, "lead_days": 60, "need_date": d(90),
                   "ordered_at": d(0), "supplier_name": "华信传动", "equip_no": "01A"})
        call("post", f"/api/v1/projects/{p}/generate-tasks", "pm1",
             "⑦ 生成任务：4 专业设计（派给经理）+ 采购", ok=(200,),
             json={"professions": ["机械", "电气", "程序", "工艺"], "with_purchase": True})
        call("post", f"/api/v1/projects/{p}/initiate", "pm1", "⑧ 立项 → 执行中", ok=(200,))

        st = c.get(f"/api/v1/projects/{p}", headers=login("pm1")).json()
        mem = c.get(f"/api/v1/projects/{p}/members", headers=login("pm1")).json()
        ms = c.get(f"/api/v1/projects/{p}/milestones", headers=login("pm1")).json()
        pr = c.get(f"/api/v1/projects/{p}/purchase-requests", headers=login("buyer1")).json()
        dr = c.get(f"/api/v1/projects/{p}/equipment/01A/design", headers=login("mech_manager")).json()
        root = (dr.get("root") or {}) if isinstance(dr, dict) else {}
        print("—— 自检 ——")
        print("  阶段：", st["stage"], "| 合同额：", st.get("amount"), "| 质保：", st.get("warranty_months"), "个月")
        print("  团队：", len(mem), "人 | 设备：01A | 节点：", len(ms if isinstance(ms, list) else ms.get("items", [])), "个")
        print("  总装图：", root.get("drawing_no"), "（草稿）")
        print("  机械经理待办：", [(t["task_no"], t["title"]) for t in c.get("/api/v1/my-tasks", headers=login("mech_manager")).json()][:1])
        print("  采购待办：", [(t["task_no"], t["title"]) for t in c.get("/api/v1/my-tasks", headers=login("buyer1")).json()][:1])
        print("  长周期件：", [(x["item_no"], x["qty"], x["status"]) for x in pr])
        print(f"\n🎉 S0→S1 完成：{p}")


if __name__ == "__main__":
    main()
