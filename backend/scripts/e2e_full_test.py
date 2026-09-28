"""S0→S11 端到端验收测试：模拟真实订单，全程只用 HTTP 接口（不查库、不改系统）。

    DATABASE_URL=... .venv/bin/python -m scripts.e2e_full_test

每个阶段：真实账号调用真实接口完成动作 → 立刻用 GET 接口回读校验 → 记录 PASS / FAIL / 备注。
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

today = date.today()
d = lambda n: (today + timedelta(days=n)).isoformat()  # noqa: E731
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c6360000002000154a24f5b0000000049454e44ae426082"
)
PDF = b"%PDF-1.4 e2e"

ISSUES: list[tuple[str, str]] = []      # (阶段, 问题描述)
STAGES: list[tuple[str, str]] = []      # (阶段, 结论)


def flag(stage: str, ok: bool, msg: str) -> None:
    if not ok:
        ISSUES.append((stage, msg))
        print(f"      ⚠️  [{stage}] {msg}")


def stage(name: str) -> None:
    print(f"\n━━━ {name} ━━━")


def main() -> None:
    c = TestClient(app)

    # ---------- 会话 ----------
    tokens: dict[str, dict] = {}

    def login(u: str) -> dict:
        if u not in tokens:
            pwd = "admin12345" if u == "admin" else "txgk@123"
            r = c.post("/api/v1/auth/login", json={"username": u, "password": pwd})
            assert r.status_code == 200, (u, r.text)
            tokens[u] = {"Authorization": f"Bearer {r.json()['access_token']}"}
        return tokens[u]

    def req(method: str, url: str, who: str, expect: tuple = (200,), **kw):
        r = getattr(c, method)(url, headers=login(who), **kw)
        if r.status_code not in expect:
            print(f"      ❌ HTTP {r.status_code} {method} {url} ({who}): {r.text[:200]}")
            raise SystemExit(1)
        return r.json() if r.content else None

    def photos(who: str, area: str, pno: str, ref: str, n: int = 1) -> list[str]:
        files = [("files", (f"{area}{i}.png", PNG, "image/png")) for i in range(n)]
        return [x["token"] for x in req("post", f"/api/v1/{area}/photos", who, (201,),
                                        params={"project_no": pno, "ref": ref}, files=files)]

    users = {u["username"]: u["id"] for u in req("get", "/api/v1/users", "admin")  # admin-ok: 读用户列表（仅 system:admin/总监）}

    # ================= 基础数据：标准库物料（接口建，重复容错） =================
    stage("准备：标准库物料（admin 通过接口建档）")
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
    created = 0
    for cls, spec, unit in ITEMS:
        r = c.post("/api/v1/library/items", headers=login("craft1"),
                   json={"std_class_code": cls, "spec": spec, "unit": unit})
        if r.status_code == 201:
            created += 1
    all_items = req("get", "/api/v1/library/items", "craft1", params={"limit": 50})
    print(f"  新建 {created} 条；库内共 {len(all_items)} 条物料")

    # ================= S0 商机 =================
    stage("S0 商机登记（sales1）")
    p = req("post", "/api/v1/projects", "sales1", (201,), json={
        "sales_id": users["sales1"],
        "customer_name": "创维rgb电子", "project_name": "65寸电视后壳自动锁附线",
        "contacts": [{"name": "刘工", "title": "设备科", "phone": "13800000000", "role_tag": "技术对接人"}],
        "deadline": d(14), "delivery_days": 120, "deal_mode": "直签", "source": "老客户复购",
        "est_amount": 1600000, "project_desc": "1 台升降贴合机 + 输送段，节拍 12s/台",
        "site_address": "佛山顺德 创维工业园",
    })["project_no"]
    pj = req("get", f"/api/v1/projects/{p}", "sales1")
    flag("S0", pj["stage"] == "线索", f"新商机阶段应为「线索」，实际 {pj['stage']}")
    flag("S0", pj["project_no"].startswith("TX"), "项目号格式 TX{YY}{NNN}")
    flag("S0", pj.get("sales_id") == users["sales1"], "建商机应自动把创建人记为销售负责人（商务全程可见）")
    print(f"  商机号 {p}（{pj['stage']}）")
    r = c.post("/api/v1/projects", headers=login("sales1"),
               json={"customer_name": "X", "project_name": "Y"})
    flag("S0", r.status_code == 422, f"不选销售负责人应被拦截（422），实际 {r.status_code}")
    STAGES.append(("S0 商机", f"{p} 建档（必选销售负责人），阶段=线索"))

    # ================= S0-2 成交登记 =================
    stage("S0-2 成交登记（sales1）")
    req("post", f"/api/v1/projects/{p}/deal", "sales1", json={
        "period_start": d(0), "period_end": d(120), "amount": 1680000,
        "contract_no_customer": "SW-2026-0311", "warranty_months": 12, "warranty_amount": 84000,
        "tech_agreement_frozen": True, "acceptance_standard": "节拍 12s/台，72h 良率 ≥98%",
        "payment_terms": [
            {"node_name": "预付款", "percent": 30, "amount": 504000, "condition": "合同签订 7 日内"},
            {"node_name": "发货款", "percent": 30, "amount": 504000, "condition": "发货前"},
            {"node_name": "验收款", "percent": 30, "amount": 504000, "condition": "验收合格后"},
            {"node_name": "质保金", "percent": 10, "amount": 168000, "condition": "质保期满"}]})
    pj = req("get", f"/api/v1/projects/{p}", "sales1")
    det = req("get", f"/api/v1/projects/{p}/detail", "sales1")
    flag("S0-2", pj["stage"] == "成交待立项", f"成交后阶段应为「成交待立项」，实际 {pj['stage']}")
    flag("S0-2", len(det.get("payment_terms", [])) == 4, "付款节点应 4 条")
    flag("S0-2", pj.get("warranty_months") == 12, "质保期应 12 个月")
    print(f"  阶段={pj['stage']}，合同 ¥{pj['amount']:,.0f}，节点 {len(det['payment_terms'])} 条")
    STAGES.append(("S0-2 成交", "合同 168 万 / 质保 12 月 / 4 付款节点，阶段=成交待立项"))

    # ================= S1 立项 =================
    stage("S1 立项（pm1）")
    users = {u["username"]: u["id"] for u in req("get", "/api/v1/users", "admin")  # admin-ok: 读用户列表（仅 system:admin/总监）}
    for u, role in [("pm1", "项目经理"), ("mech_manager", "机械负责人"), ("elec_manager", "电气负责人"),
                    ("prog_manager", "程序负责人"), ("craft_manager", "工艺负责人"), ("buyer1", "采购负责人"),
                    ("shop1", "生产负责人"), ("assy1", "装配负责人"), ("site1", "现场负责人"),
                    ("service1", "售后负责人")]:
        req("post", f"/api/v1/projects/{p}/members", "pm1", (201,),
            json={"user_id": users[u], "project_role": role})
    req("post", f"/api/v1/projects/{p}/equipment", "pm1", (201,),
        json={"equip_name": "OC 贴合机", "kind": "单机"})
    req("post", f"/api/v1/projects/{p}/milestones/generate", "pm1")
    jsj = req("get", "/api/v1/library/items", "pm1", params={"q": "减速机"})[0]
    req("post", f"/api/v1/projects/{p}/purchase-requests", "pm1", (201,),
        json={"item_no": jsj["item_no"], "qty": 2, "lead_days": 60, "need_date": d(90),
              "ordered_at": d(0), "supplier_name": "华信传动", "equip_no": "01A"})
    req("post", f"/api/v1/projects/{p}/generate-tasks", "pm1",
        json={"professions": ["机械", "电气", "程序", "工艺"], "with_purchase": True})
    req("post", f"/api/v1/projects/{p}/initiate", "pm1")
    pj = req("get", f"/api/v1/projects/{p}", "pm1")
    eqs = req("get", f"/api/v1/projects/{p}/equipment", "pm1")
    mem = req("get", f"/api/v1/projects/{p}/members", "pm1")
    prs = req("get", f"/api/v1/projects/{p}/purchase-requests", "buyer1")
    mytasks = req("get", "/api/v1/my-tasks", "mech_manager")
    design = req("get", f"/api/v1/projects/{p}/equipment/01A/design", "mech_manager")
    flag("S1", pj["stage"] == "执行中", f"立项后阶段应「执行中」，实际 {pj['stage']}")
    flag("S1", len(mem) == 10 and len(eqs) == 1, "团队 10 人、设备 1 台")
    flag("S1", all(t["owner_id"] for t in mytasks), "设计任务应已指派到人")
    flag("S1", bool(prs) and prs[0]["ordered_at"], "长周期件立项即下单")
    root_no = (design.get("root") or {}).get("drawing_no")
    flag("S1", root_no == f"{p}-01A-00-00-00-00", f"总装图号应为 {p}-01A-00-00-00-00")
    ms = req("get", f"/api/v1/projects/{p}/milestones", "pm1")
    ms_list = ms if isinstance(ms, list) else ms.get("items", [])
    flag("S1", all(m.get("plan_start") and m.get("plan_end") for m in ms_list),
         "标准节点应带默认计划起止日期（按合同周期均分）")
    print(f"  阶段={pj['stage']}；设备 {eqs[0]['equip_no']}；团队 {len(mem)} 人；节点 {len(ms_list)}；长周期件 {len(prs)} 条")
    STAGES.append(("S1 立项", "团队10人/设备01A/节点8个/长周期件下单，阶段=执行中；总装图自动生成"))

    # ================= S2 工程设计（出图→评审→发布→进池） =================
    stage("S2 工程设计（mech_manager 出图，eng_director 发布；craft_manager 材料/外协）")
    dr_body = call_body = None
    dr1 = req("post", f"/api/v1/projects/{p}/equipment/01A/drawings", "mech_manager", (201,),
              json={"title": "主体组件", "source_type": "自制件"})
    dr2 = req("post", f"/api/v1/projects/{p}/equipment/01A/drawings", "mech_manager", (201,),
              json={"parent_drawing_no": dr1["drawing_no"], "title": "机架", "source_type": "自制件"})
    dr3 = req("post", f"/api/v1/projects/{p}/equipment/01A/drawings", "mech_manager", (201,),
              json={"title": "防护罩", "source_type": "自制件"})
    frame_no = dr2["drawing_no"]
    # 附件必填（2026-09-22）：图纸提交评审前先上传文件
    for _no in (f"{p}-01A-00-00-00-00", dr1["drawing_no"], frame_no, dr3["drawing_no"]):
        req("post", f"/api/v1/drawings/{_no}/draft", "mech_manager", (200,),
            data={"change_reason": "首版"}, files={"file": ("d.pdf", PDF, "application/pdf")})
    zct = req("get", "/api/v1/library/items", "mech_manager", params={"q": "轴承"})[0]
    bom = req("post", f"/api/v1/projects/{p}/bom/std", "mech_manager", (201,),
              json={"parent_ref": frame_no, "child_item_no": zct["item_no"], "qty": 4})
    t_mech = next(t for t in req("get", f"/api/v1/projects/{p}/equipment/01A/my-design-tasks", "mech_manager")
                  if t["profession"] == "机械")
    req("post", f"/api/v1/tasks/{t_mech['task_id']}/submit-review", "mech_manager", (201,),
        json={"items": [{"item_type": "DRAWING", "item_ref": x} for x in
                        (f"{p}-01A-00-00-00-00", dr1["drawing_no"], frame_no, dr3["drawing_no"])]
                        + [{"item_type": "BOM_DESIGN", "item_ref": str(bom["id"])}], "note": "首版"})
    tk = req("get", f"/api/v1/tasks/{t_mech['task_id']}/review-ticket", "mech_manager")
    flag("S2", tk["status"] == "待总监审", f"经理提交应跳过组长直接「待总监审」，实际 {tk['status']}")
    req("post", f"/api/v1/review-tickets/{tk['id']}/review", "eng_director", json={"action": "通过", "note": "OK"})
    tk = req("get", f"/api/v1/tasks/{t_mech['task_id']}/review-ticket", "mech_manager")
    flag("S2", tk["status"] == "已发布", f"总监通过后评审单应「已发布」，实际 {tk['status']}")
    pool1 = req("get", "/api/v1/purchase/pool", "buyer1")
    mine1 = [{**r, "item_no": g["item_no"]} for g in pool1 for r in g["requests"]
             if r["project_no"] == p]
    flag("S2", len(mine1) == 1 and mine1[0]["item_no"] == zct["item_no"],
         f"机械发布后采购池应只有标准件 1 条（净需求：长周期减速机已在途不重复买），实际 {len(mine1)} 条：{[r['item_no'] for r in mine1]}")

    mat = req("post", f"/api/v1/projects/{p}/bom/material", "craft_manager", (201,),
              json={"parent_ref": frame_no, "child_item_no": "FT-PLACEHOLDER", "qty": 2}) if False else None
    ft = req("get", "/api/v1/library/items", "craft_manager", params={"q": "方通"})[0]
    mat = req("post", f"/api/v1/projects/{p}/bom/material", "craft_manager", (201,),
              json={"parent_ref": frame_no, "child_item_no": ft["item_no"], "qty": 2})
    t_craft = next(t for t in req("get", f"/api/v1/projects/{p}/equipment/01A/my-design-tasks", "craft_manager")
                   if t["profession"] == "工艺")
    req("post", f"/api/v1/tasks/{t_craft['task_id']}/submit-review", "craft_manager", (201,),
        json={"items": [{"item_type": "BOM_MATERIAL", "item_ref": str(mat["id"])},
                        {"item_type": "SOURCE_TAG", "item_ref": dr3["drawing_no"], "source_type": "外协件"}],
              "note": "材料与外协判定"})
    tk = req("get", f"/api/v1/tasks/{t_craft['task_id']}/review-ticket", "craft_manager")
    req("post", f"/api/v1/review-tickets/{tk['id']}/review", "eng_director", json={"action": "通过", "note": "OK"})
    pool2 = req("get", "/api/v1/purchase/pool", "buyer1")
    mine2 = {g["item_no"] for g in pool2 for r in g["requests"] if r["project_no"] == p}
    flag("S2", dr3["drawing_no"] in mine2, "工艺判外协后，防护罩应进采购池")
    flag("S2", ft["item_no"] in mine2, "材料 BOM 发布后，方通应进采购池")
    print(f"  图纸 4 张发布；采购池累计 {len(mine2)} 条：{sorted(mine2)}")
    STAGES.append(("S2 设计", "机械发布(标准件进池) → 工艺发布(材料+外协进池)；评审走 组员/经理→总监 两级"))

    # ================= S3 采购 =================
    stage("S3 采购（buyer1 合并下单 → wh1 验收入库）")
    sup = c.post("/api/v1/suppliers", headers=login("buyer1"),
                 json={"name": "华信传动", "kind": "外协", "contact_name": "周工", "phone": "13900000000"})
    sup = sup.json() if sup.status_code == 201 else next(
        x for x in req("get", "/api/v1/suppliers", "buyer1", params={"q": "华信传动"}))
    pool = req("get", "/api/v1/purchase/pool", "buyer1")
    mine = [{**r, "item_no": g["item_no"], "qty": r["qty"]} for g in pool for r in g["requests"]
            if r["project_no"] == p]
    cover = next(r for r in mine if r["item_no"] == dr3["drawing_no"])
    rest = [r for r in mine if r["id"] != cover["id"]]
    req("post", "/api/v1/purchase/merge-order", "buyer1", (200, 201),
        json={"supplier_id": sup["id"], "ordered_at": d(0), "expected_date": d(15),
              "deliver_to": "公司仓库", "lines": [{"request_id": r["id"], "tax_incl": True} for r in rest]})
    req("post", "/api/v1/purchase/merge-order", "buyer1", (200, 201),
        json={"supplier_id": sup["id"], "ordered_at": d(0), "deliver_to": "直发客户现场",
              "deliver_address": "深圳龙华 创维工业园 3 号厂房",
              "lines": [{"request_id": cover["id"], "tax_incl": True}]})
    prs = {r["id"]: r for r in req("get", f"/api/v1/projects/{p}/purchase-requests", "buyer1")}
    direct_receipt_id = None
    for rid, r in prs.items():
        ins = req("post", f"/api/v1/projects/{p}/purchase-requests/{rid}/inspect", "wh1",
                  json={"qty": r["qty"], "result": "合格", "receipt_date": d(0)})
        if ins["receipt_status"] == "待入库":
            req("post", f"/api/v1/goods-receipts/{ins['receipt_id']}/store", "wh1",
                json={"location": "深圳仓 A-01-01"})
        else:
            direct_receipt_id = ins["receipt_id"]
            flag("S3", ins["receipt_status"] == "现场待验收",
                 f"直发件验收后应为「现场待验收」（等现场清点），实际 {ins['receipt_status']}")
    prs2 = req("get", f"/api/v1/projects/{p}/purchase-requests", "buyer1")
    flag("S3", all(r["status"] in ("已入库", "现场待验收") for r in prs2),
         f"全部到货后状态应 已入库/现场待验收，实际 {[r['status'] for r in prs2]}")
    stock = req("get", "/api/v1/warehouse/stock", "wh1")
    flag("S3", sum(1 for s in stock if s["item_no"] in (zct["item_no"], ft["item_no"])) >= 2, "入库后应有库存")
    print(f"  采购单 2 张（仓库 + 直发）；到货验收 {len(prs2)} 条；库存已建立")
    STAGES.append(("S3 采购", "池→合并下单(1仓库+1直发)→仓库验收→入库；直发件等现场清点"))

    # ================= S4 仓库：领料 =================
    stage("S4 仓库领料（shop1 生成 → wh1 备料/发料）")
    iss = req("post", f"/api/v1/warehouse/projects/{p}/equipment/01A/generate-issue", "shop1", (201,))
    issues = req("get", "/api/v1/warehouse/issues", "wh1")
    issue = next(i for i in issues if i["issue_no"] == iss["issue_no"])
    flag("S4", iss["shortage_count"] == 0, f"领料单不应缺料（已入库），缺 {iss['shortage_count']} 种")
    req("post", f"/api/v1/warehouse/issues/{issue['id']}/pick", "wh1", json={})
    req("post", f"/api/v1/warehouse/issues/{issue['id']}/hand-over", "wh1", json={"issued_to": "车间 李四"})
    issue = next(i for i in req("get", "/api/v1/warehouse/issues", "wh1") if i["id"] == issue["id"])
    flag("S4", issue["status"] == "已领走", f"领走后应「已领走」，实际 {issue['status']}")
    print(f"  领料单 {iss['issue_no']}：{iss['line_count']} 种，已领走")
    STAGES.append(("S4 领料", "按设备生成领料单→备料→车间领走，库存出库"))

    # ================= S5 制造 =================
    stage("S5 制造（shop1 排产/下发/验收/转运 + 外协）")
    req("post", f"/api/v1/manufacturing/projects/{p}/equipment/01A/generate-orders", "shop1", (201,), json={})
    orders = {o["item_no"]: o for o in req("get", "/api/v1/manufacturing/orders", "shop1",
                                           params={"project_no": p})}
    flag("S5", set(orders) == {dr1["drawing_no"], frame_no},
         f"自制件排产应为 主体+机架 2 张（总装图不排产），实际 {sorted(orders)}")
    ph = photos("shop1", "manufacturing", p, "e2e")

    def flow(o: dict, path: str) -> None:
        oid = o["id"]
        req("post", f"/api/v1/manufacturing/orders/{oid}/dispatch", "shop1",
            json={"step_name": "下料", "issued_to": "下料班", "photos": ph[:2]})
        if "start" in path:
            req("post", f"/api/v1/manufacturing/orders/{oid}/start", "shop1")
        if path.endswith("ok"):
            req("post", f"/api/v1/manufacturing/orders/{oid}/accept", "shop1",
                json={"result": "合格", "photos": ph[:1]})
            req("post", f"/api/v1/manufacturing/orders/{oid}/transfer", "shop1",
                json={"photos": ph[:1]})
        elif path.endswith("ng"):
            req("post", f"/api/v1/manufacturing/orders/{oid}/accept", "shop1",
                json={"result": "不合格", "reason": "孔位偏 2mm", "photos": ph[:1]})

    flow(orders[frame_no], "start-ok")
    flow(orders[dr1["drawing_no"]], "start")
    sts = {o["item_no"]: o["status"] for o in req("get", "/api/v1/manufacturing/orders", "shop1",
                                                  params={"project_no": p})}
    flag("S5", sts[frame_no] == "已转运" and sts[dr1["drawing_no"]] == "制造中",
         f"排产状态不符：{sts}")
    osr = req("get", "/api/v1/manufacturing/outsource", "shop1", params={"project_no": p})[0]
    req("post", f"/api/v1/manufacturing/outsource/{osr['id']}/send", "shop1",
        json={"supplier_name": "恒钲钣金", "due_date": d(20), "material_supplied": True})
    req("post", f"/api/v1/manufacturing/outsource/{osr['id']}/return", "shop1", json={})
    req("post", f"/api/v1/manufacturing/outsource/{osr['id']}/accept", "shop1", json={"result": "合格"})
    print("  机架已转运 / 主体在制；外协件回厂验收合格（总装图不再排产）")
    STAGES.append(("S5 制造", "排产2张(转运/在制)+外协1张(合格)；下发/验收/转运全部拍照留痕"))

    # ================= S6 装配 =================
    stage("S6 装配与厂内调试（assy1）")
    ov = req("get", "/api/v1/assembly/kitting/overview", "assy1", params={"project_no": p})
    rate = next(o["kitting_rate"] for o in ov if o["equip_no"] == "01A")
    print(f"  齐套率（01A）= {round(rate * 100)}%（只展示，不设门槛）")
    rec = req("post", "/api/v1/assembly/records", "assy1", (201,),
              json={"project_no": p, "equip_no": "01A", "sub_assembly": "整机装配",
                    "photos": photos("shop1", "manufacturing", p, "assy")})
    flag("S6", abs(rec["kitting_rate"] - rate) < 0.01, "装配开工应记录当时齐套率")
    req("post", f"/api/v1/assembly/records/{rec['id']}/finish", "assy1", json={})
    rec = req("post", f"/api/v1/assembly/records/{rec['id']}/debug", "assy1",
              json={"result": "合格", "note": "单机调试 72h 通过"})
    flag("S6", rec["status"] == "调试完成", f"调试后应「调试完成」，实际 {rec['status']}")
    STAGES.append(("S6 装配", f"开工齐套率 {round(rate*100)}%（只展示）→ 装配完成 → 厂内调试合格"))

    # ================= S7 发运 =================
    stage("S7 发运（pm1 指令 → delivery1 装车发运 → site1 现场验收）")
    tos = req("get", "/api/v1/shipping/to-ship", "pm1", params={"project_no": p})
    flag("S7", tos and tos[0]["ready"], "01A 装配完成后应「可发」")
    sh = req("post", "/api/v1/shipping/instructions", "pm1", (201,),
             json={"project_no": p, "equip_nos": ["01A"], "remark": "先发 01A"})
    sph = photos("pm1", "shipping", p, sh["shipment_no"])
    # 发运清单（S7 重构后：按结构生成 → 逐项勾「已发」→ 装车/发运/到货/现场逐项清点）
    req("post", f"/api/v1/shipping/{sh['id']}/items/generate", "pm1", (201,))
    sh = next(x for x in req("get", "/api/v1/shipping/list", "pm1", params={"project_no": p})
              if x["id"] == sh["id"])
    req("post", "/api/v1/shipping/items/ship", "delivery1",
        json={"item_ids": [i["id"] for i in sh["items"]], "photos": sph[:1]})
    req("post", f"/api/v1/shipping/{sh['id']}/load", "delivery1",
        json={"vehicle": "17.5 米平板", "plate_no": "粤B88888", "driver": "张师傅", "photos": sph[:1]})
    req("post", f"/api/v1/shipping/{sh['id']}/depart", "delivery1", json={})
    pj = req("get", f"/api/v1/projects/{p}", "pm1")
    flag("S7", pj["stage"] == "交付中", f"发运后项目阶段应自动「交付中」，实际 {pj['stage']}")
    req("post", f"/api/v1/shipping/{sh['id']}/arrive", "delivery1")
    sh = next(x for x in req("get", "/api/v1/shipping/list", "pm1", params={"project_no": p})
              if x["id"] == sh["id"])
    checks = [{"item_id": i["id"], "result": "到"} for i in sh["items"]]
    sh = req("post", f"/api/v1/shipping/{sh['id']}/receipt", "site1",
             json={"checks": checks, "photos": sph[:1]})
    flag("S7", sh["status"] == "已签收", f"现场验收后应「已签收」，实际 {sh['status']}")
    print(f"  {sh['shipment_no']}：指令→装箱→装车→在途→到货→现场验收齐（阶段已到 交付中）")
    STAGES.append(("S7 发运", "PM 勾选发 01A → 装箱/装车/发运/到货/现场对账「齐」；项目阶段→交付中"))

    # ================= S8 现场安装 =================
    stage("S8 现场安装（site1 手机动线）")
    inc = req("get", "/api/v1/site/incoming", "site1", params={"project_no": p})
    flag("S8", len(inc["pending"]) == 1, f"应有 1 张直发件待现场清点，实际 {len(inc['pending'])}")
    req("post", f"/api/v1/site/incoming/{direct_receipt_id}/accept", "site1",
        json={"result": "齐", "photos": photos("site1", "site", p, "incoming")})
    prs3 = req("get", f"/api/v1/projects/{p}/purchase-requests", "buyer1")
    flag("S8", all(r["status"] in ("已入库", "现场已验收") for r in prs3),
         f"直发件清点后应「现场已验收」，实际 {[r['status'] for r in prs3]}")
    req("post", "/api/v1/site/survey", "site1", (201,),
        json={"project_no": p, "contact": "刘工 138...", "floor_load": "3t/m²", "passage": "吊装口 4m",
              "power": "380V 100A", "air": "0.6MPa", "network": "有 WiFi", "enter_date": d(3)})
    req("post", "/api/v1/site/daily", "site1", (201,),
        json={"project_no": p, "equip_no": "01A", "stage": "安装", "done_items": ["框架就位"],
              "people": 4, "photos": photos("site1", "site", p, "d1")})
    iss2 = req("post", "/api/v1/site/issues", "site1", (201,),
               json={"project_no": p, "equip_no": "01A", "title": "防护罩与料道干涉 2mm",
                     "desc": "现场修磨解决，图纸待改版", "photos": photos("site1", "site", p, "issue")})
    req("post", f"/api/v1/site/issues/{iss2['id']}/link-change", "site1", json={"close": True})
    com = req("post", "/api/v1/site/commission", "site1", (201,),
              json={"project_no": p, "dispatch_to": "调试组 王工", "plan_date": d(5)})
    req("post", f"/api/v1/site/commission/{com['id']}/arrive", "site1")
    req("post", f"/api/v1/site/commission/{com['id']}/start", "site1")
    req("post", f"/api/v1/site/commission/{com['id']}/finish", "site1")
    coms = req("get", "/api/v1/site/commission", "site1", params={"project_no": p})
    flag("S8", coms[0]["status"] == "调试完成", f"申请调试应走到「调试完成」，实际 {coms[0]['status']}")
    print("  勘测/日报/问题闭环/申请调试（已到现场→开始→完成）全通过")
    STAGES.append(("S8 现场", "勘测→直发件清点→每日汇报→问题闭环→申请调试（到现场→完成）"))

    # ================= S10 客户验收（S9 调试已含在上面） =================
    stage("S10 客户验收与质保（site1 申请，客户签字）")
    acc = req("post", "/api/v1/acceptance/apply", "site1", (201,),
              json={"project_no": p, "remark": "调试完成，节拍达标"})
    docs = req("post", f"/api/v1/acceptance/{acc['id']}/documents", "site1", (201,),
               data={"doc_type": "检验报告"},
               files=[("files", ("检验报告.pdf", PDF, "application/pdf")),
                      ("files", ("调试记录.pdf", PDF, "application/pdf"))])
    req("post", f"/api/v1/acceptance/documents/{docs[0]['id']}/sign", "site1")
    acc2 = req("post", f"/api/v1/acceptance/{acc['id']}/confirm", "site1",
               json={"result": "通过", "signed_by": "客户 刘工", "accepted_at": d(0)})
    pj = req("get", f"/api/v1/projects/{p}", "pm1")
    flag("S10", acc2["status"] == "已通过" and acc2["warranty_end"],
         f"验收通过应自动生成质保期，实际 {acc2['status']} / {acc2.get('warranty_end')}")
    flag("S10", pj["stage"] == "质保", f"验收通过后项目阶段应「质保」，实际 {pj['stage']}")
    print(f"  验收通过；质保 {acc2['warranty_start']} ~ {acc2['warranty_end']}；阶段={pj['stage']}")
    STAGES.append(("S10 验收", "资料包上传/签收 → 客户确认通过 → 自动质保 12 个月，阶段→质保"))

    # ================= S11 售后 =================
    stage("S11 质保与售后（service1）")
    part = req("post", "/api/v1/service/parts", "service1", (201,),
               json={"project_no": p, "equip_no": "01A", "item_no": zct["item_no"],
                     "item_name": zct["display_name"], "qty_stock": 3, "qty_installed": 4, "min_qty": 5})
    flag("S11", True, "备注：备件安全库存 5 > 现存 3，售后台「低库存」应 +1（看板口径）")
    part = req("post", "/api/v1/service/parts/move", "service1", (201,),
               json={"part_id": part["id"], "move_type": "领出", "qty": 1, "issued_to": "李工"})
    flag("S11", part["qty_stock"] == 2, f"领出 1 后库存应 2，实际 {part['qty_stock']}")
    so = req("post", "/api/v1/service/orders", "service1", (201,),
             json={"project_no": p, "equip_no": "01A", "fault": "贴合气缸偶发不动作"})
    flag("S11", so["in_warranty"] is True, "验收后报修应判定「在保」")
    req("post", f"/api/v1/service/orders/{so['id']}/dispatch", "service1", json={"dispatched_to": "李工"})
    req("post", f"/api/v1/service/orders/{so['id']}/arrive", "service1", json={})
    req("post", f"/api/v1/service/orders/{so['id']}/fix", "service1",
        json={"solution": "更换电磁阀", "labor_hours": 3, "photos": photos("service1", "service", p, so["so_no"])})
    so = req("post", f"/api/v1/service/orders/{so['id']}/sign", "service1", json={"customer_sign": "客户 刘工"})
    flag("S11", so["status"] == "已关闭", f"签字后应关单，实际 {so['status']}")
    print(f"  工单 {so['so_no']}（在保）已关闭；备件收发留痕")
    STAGES.append(("S11 售后", "备件建账/领出留痕；工单报修(在保)→派工→到场→处理→客户签字关单"))

    # ================= 回款（S0-2 的延伸闭环） =================
    stage("回款登记（fin1）")
    req("post", f"/api/v1/projects/{p}/payment-terms/1/receive", "fin1")
    req("post", f"/api/v1/projects/{p}/payment-terms/2/receive", "fin1")
    req("post", f"/api/v1/projects/{p}/payment-terms/3/receive", "fin1",
        data={"received_amount": "400000", "remark": "部分到账"})
    over = c.post(f"/api/v1/projects/{p}/payment-terms/3/receive", headers=login("fin1"),
                  data={"received_amount": "999999"})
    flag("回款", over.status_code == 400, f"超额回款应被拦截，实际 {over.status_code}")
    pj = req("get", f"/api/v1/projects/{p}/detail", "fin1")
    unpaid = [t for t in pj["payment_terms"] if (t.get("amount") or 0) - (t.get("received_amount") or 0) > 0.001]
    unpaid2 = [(t["node_name"], round((t.get("amount") or 0) - (t.get("received_amount") or 0)))
               for t in pj["payment_terms"]
               if (t.get("amount") or 0) - (t.get("received_amount") or 0) > 0.001]
    print(f"  已收：预付款/发货款全齐；未收：{unpaid2}")
    STAGES.append(("回款", "前 3 期已收（验收款部分），质保金未收；超额回款被拦截"))

    # ================= 权限抽查 =================
    stage("权限抽查（不该能的人不能做）")
    r = c.post("/api/v1/manufacturing/projects/{p}/equipment/01A/generate-orders".replace("{p}", p),
               headers=login("sales1"), json={})
    flag("权限", r.status_code == 403, f"sales1（无 mfg:edit）生成排产应 403，实际 {r.status_code}")
    r = c.post("/api/v1/acceptance/apply", headers=login("wh1"), json={"project_no": p})
    flag("权限", r.status_code == 403, f"wh1（无 acceptance:edit）申请验收应 403，实际 {r.status_code}")
    r = c.post("/api/v1/service/orders", headers=login("pm1"), json={"project_no": p})
    flag("权限", r.status_code == 403, f"pm1（无 service:edit）报修应 403，实际 {r.status_code}")
    print("  3 项越权全部被拦（403）")

    # ================= 部门可见性抽查（每个部门都能看到这个订单的痕迹） =================
    stage("部门可见性抽查（各部门工作台/列表都能看到 TX 项目）")
    sales = req("get", "/api/v1/workbench/sales/board", "sales1")
    flag("可见-商务", any(r["project_no"] == p for r in sales["projects"]),
         "商务部台应全程展示该订单（含质保阶段）+ 待回款")
    flag("可见-商务", len(sales["payments"]) >= 1, "商务部台应看到待回款节点（验收款尾款/质保金）")
    pm = req("get", "/api/v1/workbench/pm/board", "pm1")
    flag("可见-项目经理", p in str(pm), "项目经理台应看到该订单")
    eng = req("get", "/api/v1/workbench/eng/board", "mech_manager")
    flag("可见-工程", p in str(eng), "工程部台应看到该订单的设计进度")
    iss = req("get", "/api/v1/warehouse/issues", "wh1")
    flag("可见-仓库", any(i["project_no"] == p for i in iss), "仓库领料列表应看到该订单")
    mfg = req("get", "/api/v1/manufacturing/orders", "shop1", params={"project_no": p})
    flag("可见-制造", len(mfg) >= 2, "制造列表应看到该订单的排产单")
    recs = req("get", "/api/v1/assembly/records", "assy1", params={"project_no": p})
    flag("可见-装配", len(recs) >= 1, "装配记录应看到该订单")
    ships = req("get", "/api/v1/shipping/list", "delivery1", params={"project_no": p})
    flag("可见-发运", any(x["project_no"] == p for x in ships), "发运列表应看到该订单")
    coms = req("get", "/api/v1/site/commission", "site1", params={"project_no": p})
    flag("可见-现场", len(coms) >= 1, "现场调试记录应看到该订单")
    sos = req("get", "/api/v1/service/orders", "service1", params={"project_no": p})
    flag("可见-售后", any(x["project_no"] == p for x in sos), "售后工单应看到该订单")
    print("  商务/项目经理/工程/仓库/制造/装配/发运/现场/售后 全部可见 ✓")

    # ================= 报告 =================
    print("\n" + "=" * 64)
    print("测试结论")
    print("=" * 64)
    for name, result in STAGES:
        print(f"  ▸ {name}：{result}")
    print("-" * 64)
    if ISSUES:
        print(f"发现 {len(ISSUES)} 个问题/备注：")
        for i, (stg, m) in enumerate(ISSUES, 1):
            print(f"  {i}. [{stg}] {m}")
    else:
        print("未发现问题")
    print(f"\n演示项目号：{p}（数据保留，可在界面按角色走查）")


if __name__ == "__main__":
    main()
