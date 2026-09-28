"""一键生成「从商机到售后」全链路演示项目。

    .venv/bin/python -m scripts.seed_demo_project            # 对开发库跑（默认 DATABASE_URL）
    DATABASE_URL=... .venv/bin/python -m scripts.seed_demo_project

用演示账号（txgk@123）走**真实 API**：数据、操作留痕、站内通知全部是真的。
跑完你会得到一个新项目号（打印在最后），可以按角色登录把整条链点一遍。

每次运行都会新建一个项目（编号自动发），不会动已有数据。
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

DEMO_PASSWORD = "txgk@123"
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c6360000002000154a24f5b0000000049454e44ae426082"
)
PDF = b"%PDF-1.4 demo"

today = date.today()
d = lambda n: (today + timedelta(days=n)).isoformat()  # noqa: E731


def price_of(item_no: str) -> float:
    """演示用单价（P-17）：让价格参考 / 金额分档有数据可看。"""
    if item_no.startswith("ZC"):
        return 45.0
    if item_no.startswith("QD"):
        return 120.0
    if item_no.startswith("BZ-DJ"):
        return 1800.0
    if item_no.startswith("BZ-JSJ"):
        return 3200.0
    if item_no.startswith("DQ-PLC"):
        return 2600.0
    if item_no.startswith("DQ-SF"):
        return 1500.0
    if item_no.startswith("YL-FT"):
        return 35.0
    if item_no.startswith("YL-BC"):
        return 210.0
    return 500.0


def main() -> None:
    with TestClient(app) as c:
        # ---------- 登录 ----------
        tokens: dict[str, dict] = {}

        def login(u: str, pwd: str = DEMO_PASSWORD) -> dict:
            if u not in tokens:
                r = c.post("/api/v1/auth/login", json={"username": u, "password": pwd})
                assert r.status_code == 200, (u, r.text)
                tokens[u] = {"Authorization": f"Bearer {r.json()['access_token']}"}
            return tokens[u]

        def h(*users: str) -> dict:
            return login(users[0])

        def call(method: str, url: str, *, who: str, ok=(200,), label: str = "", **kw):
            r = getattr(c, method)(url, headers=login(who), **kw)
            if r.status_code not in ok:
                print(f"❌ {label or url} [{who}] → {r.status_code}: {r.text[:300]}")
                raise SystemExit(1)
            print(f"  ✅ {label or url}")
            return r.json() if r.content else None

        def photos(who: str, area: str, project_no: str, ref: str, n: int = 1) -> list[str]:
            files = [("files", (f"{area}-{i}.png", PNG, "image/png")) for i in range(n)]
            r = c.post(
                f"/api/v1/{area}/photos",
                headers=login(who),
                params={"project_no": project_no, "ref": ref},
                files=files,
            )
            assert r.status_code == 201, r.text
            return [x["token"] for x in r.json()]

        print("=" * 60)
        print("全链路演示项目生成中（S0 商机 → S11 售后）")
        print("=" * 60)

        # ---------- 用户 id ----------
        admin = login("admin", "admin12345")
        users = {u["username"]: u["id"] for u in c.get("/api/v1/users", headers=admin).json()}
        print(f"✅ 演示账号 {len(users)} 个")

        # ---------- S0 商机 ----------
        p = call(
            "post", "/api/v1/projects", who="sales1", ok=(201,),
            label="S0 新建商机",
            json={
                "sales_id": users["sales1"],
                "customer_name": "创维rgb电子",
                "project_name": "65寸电视后壳自动锁附线",
                "contacts": [{"name": "刘工", "title": "设备科", "phone": "13800000000", "role_tag": "技术对接人"}],
                "deadline": d(14),
                "delivery_days": 120,
                "deal_mode": "直签",
                "source": "老客户复购",
                "est_amount": 1600000,
                "project_desc": "整线含 1 台升降贴合机 + 输送段，节拍 12s/台",
                "site_address": "佛山顺德 创维工业园",
            },
        )["project_no"]
        print(f"  → 项目号 {p}")

        # ---------- S0-2 成交登记 ----------
        call(
            "post", f"/api/v1/projects/{p}/deal", who="sales1", ok=(200,),
            label="成交登记（合同 168 万 · 质保 12 个月 · 4 个付款节点）",
            json={
                "period_start": d(0),
                "period_end": d(120),
                "amount": 1680000,
                "warranty_months": 12,
                "warranty_amount": 84000,
                "tech_agreement_frozen": True,
                "acceptance_standard": "节拍 12s/台，连续 72h 良率 ≥98%",
                "payment_terms": [
                    {"node_name": "预付款", "percent": 30, "amount": 504000, "condition": "合同签订 7 日内"},
                    {"node_name": "发货款", "percent": 30, "amount": 504000, "condition": "发货前"},
                    {"node_name": "验收款", "percent": 30, "amount": 504000, "condition": "验收合格后"},
                    {"node_name": "质保金", "percent": 10, "amount": 168000, "condition": "质保期满"},
                ],
            },
        )

        # ---------- S1 立项 ----------
        members = [
            ("pm1", "项目经理"), ("mech_manager", "机械负责人"), ("elec_manager", "电气负责人"),
            ("prog_manager", "程序负责人"), ("craft_manager", "工艺负责人"), ("buyer1", "采购负责人"),
            ("shop1", "生产负责人"), ("assy1", "装配负责人"), ("site1", "现场负责人"), ("service1", "售后负责人"),
        ]
        for u, role in members:
            call("post", f"/api/v1/projects/{p}/members", who="pm1", ok=(201,), label=f"任命 {role}={u}",
                 json={"user_id": users[u], "project_role": role})
        call("post", f"/api/v1/projects/{p}/equipment", who="pm1", ok=(201,),
             label="设备清单：01A OC 贴合机", json={"equip_name": "OC 贴合机", "kind": "单机"})
        call("post", f"/api/v1/projects/{p}/milestones/generate", who="pm1", ok=(200,), label="生成标准节点")
        # 长周期件：立项即下单
        items = c.get("/api/v1/library/items", headers=login("admin"), params={"limit": 5}).json()
        it1, it2 = items[0], items[1]
        call("post", f"/api/v1/projects/{p}/purchase-requests", who="pm1", ok=(201,),
             label=f"长周期件 {it1['item_no']}（60 天，立项即下单）",
             json={"item_no": it1["item_no"], "qty": 2, "lead_days": 60, "need_date": d(90),
                   "ordered_at": d(0), "supplier_name": "华信传动", "unit_price": price_of(it1["item_no"]), "equip_no": "01A"})
        call("post", f"/api/v1/projects/{p}/generate-tasks", who="pm1", ok=(200,),
             label="生成任务：01A × 机械/电气/程序/工艺 + 采购",
             json={"professions": ["机械", "电气", "程序", "工艺"], "with_purchase": True})
        call("post", f"/api/v1/projects/{p}/initiate", who="pm1", ok=(200,), label="立项 → 执行中")

        # ---------- S2 工程设计（机械：出图 + 设计 BOM → 提交 → 总监发布） ----------
        dr_root = call("post", f"/api/v1/projects/{p}/equipment/01A/drawings", who="mech_manager", ok=(201,),
                       label="图纸：主体组件（自制件）", json={"title": "主体组件", "source_type": "自制件", "qty": 1})
        dr_frame = call("post", f"/api/v1/projects/{p}/equipment/01A/drawings", who="mech_manager", ok=(201,),
                        label="图纸：机架（自制件，挂主体下）",
                        json={"parent_drawing_no": dr_root["drawing_no"], "title": "机架", "source_type": "自制件", "qty": 1})
        dr_cover = call("post", f"/api/v1/projects/{p}/equipment/01A/drawings", who="mech_manager", ok=(201,),
                        label="图纸：防护罩（自制件，待工艺判定外协）", json={"title": "防护罩", "source_type": "自制件", "qty": 1})
        bom = call("post", f"/api/v1/projects/{p}/bom/std", who="mech_manager", ok=(201,),
                   label=f"设计 BOM：机架 ← {it2['item_no']} × 4",
                   json={"parent_ref": dr_frame["drawing_no"], "child_item_no": it2["item_no"], "qty": 4})
        # 机械任务：提交 → 总监发布
        t_mech = c.get(f"/api/v1/projects/{p}/equipment/01A/my-design-tasks", headers=login("mech_manager")).json()
        tid = next(t["task_id"] for t in t_mech if t["profession"] == "机械")
        call("post", f"/api/v1/tasks/{tid}/submit-review", who="mech_manager", ok=(201,),
             label="机械提交评审（4 图 + 1 BOM）",
             json={"items": [{"item_type": "DRAWING", "item_ref": x} for x in
                             (f"{p}-01A-00-00-00-00", dr_root["drawing_no"], dr_frame["drawing_no"], dr_cover["drawing_no"])]
                             + [{"item_type": "BOM_DESIGN", "item_ref": str(bom["id"])}],
                    "note": "首版提交"})
        tk = c.get(f"/api/v1/tasks/{tid}/review-ticket", headers=login("eng_director")).json()
        call("post", f"/api/v1/review-tickets/{tk['id']}/review", who="eng_director", ok=(200,),
             label="总监审核通过 → 发布（标准件进采购池）", json={"action": "通过", "note": "OK"})

        # 工艺：材料 BOM + 外协判定 → 提交 → 发布（原材料/外协件进池）
        mat = call("post", f"/api/v1/projects/{p}/bom/material", who="craft_manager", ok=(201,),
                   label=f"材料 BOM：机架 ← {it1['item_no']} × 2",
                   json={"parent_ref": dr_frame["drawing_no"], "child_item_no": it1["item_no"], "qty": 2})
        t_craft = c.get(f"/api/v1/projects/{p}/equipment/01A/my-design-tasks", headers=login("craft_manager")).json()
        tid = next(t["task_id"] for t in t_craft if t["profession"] == "工艺")
        call("post", f"/api/v1/tasks/{tid}/submit-review", who="craft_manager", ok=(201,),
             label="工艺提交（材料 BOM + 防护罩判外协）",
             json={"items": [{"item_type": "BOM_MATERIAL", "item_ref": str(mat["id"])},
                             {"item_type": "SOURCE_TAG", "item_ref": dr_cover["drawing_no"], "source_type": "外协件"}],
                    "note": "材料与外协判定"})
        tk = c.get(f"/api/v1/tasks/{tid}/review-ticket", headers=login("eng_director")).json()
        call("post", f"/api/v1/review-tickets/{tk['id']}/review", who="eng_director", ok=(200,),
             label="总监审核通过 → 发布（原材料/外协件进采购池）", json={"action": "通过", "note": "OK"})

        # ---------- S3 采购（池 → 合并下单 → 到货验收 → 入库） ----------
        r = c.post("/api/v1/suppliers", headers=login("buyer1"),
                   json={"name": "华信传动", "kind": "标准件", "contact_name": "周工", "phone": "13900000000"})
        if r.status_code == 201:
            sup = r.json()
        else:
            sup = next(x for x in c.get("/api/v1/suppliers", headers=login("buyer1"), params={"q": "华信传动"}).json())
        pool = c.get("/api/v1/purchase/pool", headers=login("buyer1")).json()
        mine = [{**req, "item_no": g["item_no"]} for g in pool for req in g["requests"] if req["project_no"] == p]
        assert mine, "采购池里没有本项目的需求"
        print(f"  ✅ 采购池：本项目 {len(mine)} 条需求")
        cover_req = next(r for r in mine if r["item_no"] == dr_cover["drawing_no"])
        rest = [r for r in mine if r["id"] != cover_req["id"]]
        call("post", "/api/v1/purchase/merge-order", who="buyer1", ok=(200, 201),
             label=f"合并下单 {len(rest)} 条 → 采购单（到公司仓库）",
             json={"supplier_id": sup["id"], "ordered_at": d(0), "expected_date": d(15),
                   "deliver_to": "公司仓库", "lines": [{"request_id": r["id"], "tax_incl": True, "unit_price": price_of(r["item_no"])} for r in rest]})
        call("post", "/api/v1/purchase/merge-order", who="buyer1", ok=(200, 201),
             label="外协防护罩：直发客户现场",
             json={"supplier_id": sup["id"], "ordered_at": d(0), "deliver_to": "直发客户现场",
                   "deliver_address": "深圳龙华 创维工业园 3 号厂房",
                   "lines": [{"request_id": cover_req["id"], "tax_incl": True, "unit_price": price_of(cover_req["item_no"])}]})
        reqs = {r["id"]: r for r in c.get(f"/api/v1/projects/{p}/purchase-requests", headers=login("buyer1")).json()}
        for rid, r in reqs.items():
            ins = call("post", f"/api/v1/projects/{p}/purchase-requests/{rid}/inspect", who="wh1", ok=(200,),
                       label=f"仓库验收 {r['item_no']} × {r['qty']}", json={"qty": r["qty"], "result": "合格", "receipt_date": d(0)})
            if ins["receipt_status"] == "待入库":
                call("post", f"/api/v1/goods-receipts/{ins['receipt_id']}/store", who="wh1", ok=(200,),
                     label="入库（深圳仓 A-01-01）", json={"location": "深圳仓 A-01-01"})
            else:
                print(f"    → 直发件 {ins['receipt_no']} 状态：{ins['receipt_status']}（等现场清点）")
                direct_receipt_id = ins["receipt_id"]

        # ---------- S4 仓库：领料（备料 → 车间领走） ----------
        iss = call("post", f"/api/v1/warehouse/projects/{p}/equipment/01A/generate-issue", who="shop1", ok=(201,),
                   label="生成领料单（标准件 + 原材料）")
        issues = c.get("/api/v1/warehouse/issues", headers=login("wh1")).json()
        issue = next(i for i in issues if i["issue_no"] == iss["issue_no"])
        call("post", f"/api/v1/warehouse/issues/{issue['id']}/pick", who="wh1", ok=(200,), label="仓库备料", json={})
        call("post", f"/api/v1/warehouse/issues/{issue['id']}/hand-over", who="wh1", ok=(200,),
             label="车间领走（李四）", json={"issued_to": "车间 李四"})

        # ---------- S5 制造（只管两头） ----------
        call("post", f"/api/v1/manufacturing/projects/{p}/equipment/01A/generate-orders", who="shop1", ok=(201,),
             label="生成排产单（自制件）+ 外协任务（外协件）", json={})
        orders = {o["item_no"]: o for o in c.get("/api/v1/manufacturing/orders", headers=login("shop1"),
                                                 params={"project_no": p}).json()}
        ph = photos("shop1", "manufacturing", p, "demo")
        body_no, frame_no = f"{p}-01A-01-00-00-00", dr_frame["drawing_no"]

        def mfg_flow(o: dict, path: str) -> None:
            oid = o["id"]
            call("post", f"/api/v1/manufacturing/orders/{oid}/dispatch", who="shop1", ok=(200,),
                 label=f"下发 {o['item_no']}（原材料+图纸，拍照）",
                 json={"step_name": "下料", "issued_to": "下料班", "photos": ph[:2]})
            if "start" in path:
                call("post", f"/api/v1/manufacturing/orders/{oid}/start", who="shop1", ok=(200,), label=f"开工 {o['item_no']}")
            if path.endswith("ok"):
                call("post", f"/api/v1/manufacturing/orders/{oid}/accept", who="shop1", ok=(200,),
                     label=f"验收合格 {o['item_no']}（拍照）", json={"result": "合格", "photos": ph[:1]})
                call("post", f"/api/v1/manufacturing/orders/{oid}/transfer", who="shop1", ok=(200,),
                     label=f"转运装配区 {o['item_no']}（拍照）", json={"photos": ph[:1]})
            elif path.endswith("ng"):
                call("post", f"/api/v1/manufacturing/orders/{oid}/accept", who="shop1", ok=(200,),
                     label=f"验收不合格 {o['item_no']} → 返工", json={"result": "不合格", "reason": "孔位偏 2mm", "photos": ph[:1]})

        mfg_flow(orders[frame_no], "start-ok")   # 机架：做完 → 转运装配区
        mfg_flow(orders[body_no], "start")        # 主体：在制（看板能看到）
        # 总装图（00-00-00-00）不再排产：它是装配对象，不是加工零件

        # 外协：发出 → 回厂 → 合格
        osr = c.get("/api/v1/manufacturing/outsource", headers=login("shop1"), params={"project_no": p}).json()
        if osr:
            x = osr[0]
            call("post", f"/api/v1/manufacturing/outsource/{x['id']}/send", who="shop1", ok=(200,),
                 label=f"外协发出 {x['item_no']}（恒钲钣金）",
                 json={"supplier_name": "恒钲钣金", "due_date": d(20), "material_supplied": True})
            call("post", f"/api/v1/manufacturing/outsource/{x['id']}/return", who="shop1", ok=(200,), label="外协回厂待检", json={})
            call("post", f"/api/v1/manufacturing/outsource/{x['id']}/accept", who="shop1", ok=(200,), label="外协验收合格", json={"result": "合格"})

        # ---------- S6 装配（齐套率只展示，随时可开装） ----------
        ov = c.get("/api/v1/assembly/kitting/overview", headers=login("assy1"), params={"project_no": p}).json()
        rate = next((o["kitting_rate"] for o in ov if o["equip_no"] == "01A"), 0)
        print(f"  ✅ 齐套率（01A）：{round(rate * 100)}%（只展示，不设门槛）")
        rec = call("post", "/api/v1/assembly/records", who="assy1", ok=(201,),
                   label="开始装配（整机装配，记录开工齐套率）",
                   json={"project_no": p, "equip_no": "01A", "sub_assembly": "整机装配", "photos": ph[:1]})
        call("post", f"/api/v1/assembly/records/{rec['id']}/finish", who="assy1", ok=(200,), label="装配完成", json={})
        call("post", f"/api/v1/assembly/records/{rec['id']}/debug", who="assy1", ok=(200,),
             label="厂内调试合格", json={"result": "合格", "note": "单机调试 72h 通过"})

        # ---------- S7 发运 ----------
        call("post", "/api/v1/shipping/instructions", who="pm1", ok=(201,),
             label="发货指令：本次只发 01A", json={"project_no": p, "equip_nos": ["01A"], "remark": "先发 01A"})
        ships = c.get("/api/v1/shipping/list", headers=login("pm1"), params={"project_no": p}).json()
        sh = ships[0]
        sph = photos("pm1", "shipping", p, sh["shipment_no"])
        call("post", f"/api/v1/shipping/{sh['id']}/items/generate", who="pm1", ok=(201,),
             label="按结构生成发运清单")
        sh = next(x for x in c.get("/api/v1/shipping/list", headers=login("pm1"), params={"project_no": p}).json()
                  if x["id"] == sh["id"])
        all_ids = [i["id"] for i in sh["items"]]
        call("post", "/api/v1/shipping/items/ship", who="delivery1", ok=(200,),
             label=f"逐项勾「已发」（{len(all_ids)} 项，含拍照）", json={"item_ids": all_ids, "photos": sph[:1]})
        call("post", f"/api/v1/shipping/{sh['id']}/request-vehicle", who="buyer1", ok=(200,),
             label="采购叫车（当天把车叫回来）", json={"count": 1, "fee": 1200, "note": "演示物流"})
        call("post", f"/api/v1/shipping/{sh['id']}/load", who="delivery1", ok=(200,),
             label="装车（拍照）", json={"vehicle": "17.5 米平板", "plate_no": "粤B88888", "driver": "张师傅 137...", "photos": sph[:1]})
        call("post", f"/api/v1/shipping/{sh['id']}/depart", who="delivery1", ok=(200,), label="发运（在途）", json={})
        call("post", f"/api/v1/shipping/{sh['id']}/arrive", who="delivery1", ok=(200,), label="登记到货")
        checks = [{"item_id": i["id"], "result": "到"} for i in sh["items"]]
        call("post", f"/api/v1/shipping/{sh['id']}/receipt", who="site1", ok=(200,),
             label="现场按发运清单清点：齐", json={"checks": checks, "photos": sph[:1]})

        # ---------- S8 现场安装 ----------
        call("post", f"/api/v1/site/incoming/{direct_receipt_id}/accept", who="site1", ok=(200,),
             label="直发件现场清点：齐", json={"result": "齐", "photos": photos("site1", "site", p, "incoming")})
        call("post", "/api/v1/site/survey", who="site1", ok=(201,),
             label="现场勘测（约定入场）",
             json={"project_no": p, "contact": "刘工 138...", "floor_load": "3t/m²", "passage": "吊装口 4m",
                   "power": "380V 100A", "air": "0.6MPa", "network": "有 WiFi", "enter_date": d(3)})
        call("post", "/api/v1/site/daily", who="site1", ok=(201,),
             label="每日汇报 D1（安装）",
             json={"project_no": p, "equip_no": "01A", "stage": "安装", "done_items": ["框架就位", "水平校调"],
                   "people": 4, "photos": photos("site1", "site", p, "daily1")})
        call("post", "/api/v1/site/daily", who="site1", ok=(201,),
             label="每日汇报 D2（安装完成）",
             json={"project_no": p, "equip_no": "01A", "stage": "安装", "done_items": ["主体装配", "管路连接", "通电前检查"],
                   "people": 5, "photos": photos("site1", "site", p, "daily2"),
                   "videos": photos("site1", "site", p, "daily2v")})
        iss2 = call("post", "/api/v1/site/issues", who="site1", ok=(201,),
                    label="现场问题：护罩干涉（已闭环）",
                    json={"project_no": p, "equip_no": "01A", "title": "防护罩与料道干涉 2mm",
                          "desc": "现场修磨解决，图纸待改版", "photos": photos("site1", "site", p, "issue")})
        call("post", f"/api/v1/site/issues/{iss2['id']}/link-change", who="site1", ok=(200,), label="问题闭环", json={"close": True})
        com = call("post", "/api/v1/site/commission", who="site1", ok=(201,),
                   label="申请调试（必须派人到现场）",
                   json={"project_no": p, "dispatch_to": "调试组 王工", "plan_date": d(5)})
        call("post", f"/api/v1/site/commission/{com['id']}/arrive", who="site1", ok=(200,), label="调试人员已到现场")
        call("post", f"/api/v1/site/commission/{com['id']}/start", who="site1", ok=(200,), label="开始现场调试")
        call("post", "/api/v1/site/daily", who="site1", ok=(201,),
             label="每日汇报 D3（联调）",
             json={"project_no": p, "equip_no": "01A", "stage": "联调", "done_items": ["全线联调", "节拍测试 11.6s"],
                   "people": 6, "photos": photos("site1", "site", p, "daily3")})
        call("post", f"/api/v1/site/commission/{com['id']}/finish", who="site1", ok=(200,), label="调试完成 → 可申请验收")

        # ---------- S10 客户验收（★ 自动质保） ----------
        acc = call("post", "/api/v1/acceptance/apply", who="site1", ok=(201,), label="申请客户验收",
                   json={"project_no": p, "remark": "调试完成，节拍达标"})
        pdf1 = [("files", ("检验报告.pdf", PDF, "application/pdf")), ("files", ("调试记录.pdf", PDF, "application/pdf"))]
        docs = c.post(f"/api/v1/acceptance/{acc['id']}/documents", headers=login("site1"),
                      data={"doc_type": "检验报告"}, files=pdf1).json()
        print(f"  ✅ 验收资料包上传 {len(docs)} 份")
        c.post(f"/api/v1/acceptance/documents/{docs[0]['id']}/sign", headers=login("site1"))
        print("  ✅ 资料【检验报告.pdf】标记已签")
        acc2 = call("post", f"/api/v1/acceptance/{acc['id']}/confirm", who="site1", ok=(200,),
                    label="客户确认验收：通过 → 自动进入质保期",
                    json={"result": "通过", "signed_by": "客户 刘工", "accepted_at": d(0)})
        print(f"    → 质保 {acc2['warranty_start']} ~ {acc2['warranty_end']}（{acc2['warranty_months']} 个月），项目阶段 → 质保")

        # ---------- S11 售后 ----------
        part = call("post", "/api/v1/service/parts", who="service1", ok=(201,),
                    label="备件建账（易损件）",
                    json={"project_no": p, "equip_no": "01A", "item_no": it2["item_no"], "item_name": it2["display_name"],
                          "qty_stock": 3, "qty_installed": 4, "min_qty": 2})
        call("post", "/api/v1/service/parts/move", who="service1", ok=(201,),
             label="备件领出 ×1（留痕）", json={"part_id": part["id"], "move_type": "领出", "qty": 1, "issued_to": "李工"})
        so = call("post", "/api/v1/service/orders", who="service1", ok=(201,),
                  label="报修（自动判定在保）",
                  json={"project_no": p, "equip_no": "01A", "fault": "贴合气缸偶发不动作"})
        call("post", f"/api/v1/service/orders/{so['id']}/dispatch", who="service1", ok=(200,),
             label="派工（李工）", json={"dispatched_to": "李工 137..."})
        call("post", f"/api/v1/service/orders/{so['id']}/arrive", who="service1", ok=(200,), label="到场", json={})
        call("post", f"/api/v1/service/orders/{so['id']}/fix", who="service1", ok=(200,),
             label="处理完成（换电磁阀）",
             json={"solution": "更换电磁阀，重设节拍", "labor_hours": 3, "photos": photos("service1", "service", p, so["so_no"])})
        call("post", f"/api/v1/service/orders/{so['id']}/sign", who="service1", ok=(200,),
             label="客户签字关单", json={"customer_sign": "客户 刘工"})

        # ---------- 回款 ----------
        call("post", f"/api/v1/projects/{p}/payment-terms/1/receive", who="fin1", ok=(200,), label="回款：预付款 50.4 万（收齐）")
        call("post", f"/api/v1/projects/{p}/payment-terms/2/receive", who="fin1", ok=(200,), label="回款：发货款 50.4 万（收齐）")
        call("post", f"/api/v1/projects/{p}/payment-terms/3/receive", who="fin1", ok=(200,),
             label="回款：验收款先收 40 万", data={"received_amount": "400000", "remark": "部分到账"})

        print("=" * 60)
        print(f"🎉 全链路演示项目完成：{p}（创维 · 65寸电视后壳自动锁附线）")
        print("=" * 60)
        print("按角色登录（密码 txgk@123）看点：")
        print(f"  sales1    商务部台：商机/回款（{p}）")
        print(f"  pm1       项目经理台 + 项目详情全链进度；发运指令")
        print(f"  mech_manager / eng_director   设计评审单（已发布）；改版可试 ECN")
        print(f"  buyer1    采购工作台：采购单/在途")
        print(f"  wh1       仓库：验收/入库/库存/领料单")
        print(f"  shop1     制造（车间台）：排产单（1 转运 / 1 在制 / 1 返工）+ 外协")
        print(f"  assy1     装配 · 齐套率：齐套率进度条 + 装配/调试记录")
        print(f"  site1     现场（手机端 /m/site 最佳）：勘测/日报/调试/验收")
        print(f"  service1  售后：已关单工单 + 备件收发")
        print(f"  fin1      回款：项目详情付款节点（前 3 期已收，质保金未收）")
        print(f"  admin     用户与权限 → 操作日志：整条链的每一步都留了痕")


if __name__ == "__main__":
    main()
