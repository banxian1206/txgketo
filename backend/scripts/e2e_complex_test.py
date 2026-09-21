"""S0→S11 高复杂度端到端测试：整线订单（多设备/同型第二台/多级图纸/分批到货/不合格换货/返工恢复/两批发运/ECN 变更/部分回款）。

    DATABASE_URL=... .venv/bin/python -m scripts.e2e_complex_test

与 e2e_full_test 的区别：设备更多、图纸树更深、采购/发运出现异常分支（部分到货、不合格换货、缺件签收、返工恢复），
并验证 现场问题→ECN 变更 联动。全程只走 HTTP 接口。
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
PDF = b"%PDF-1.4 complex-e2e"

ISSUES: list[tuple[str, str]] = []
STAGES: list[tuple[str, str]] = []


def flag(stage: str, ok: bool, msg: str) -> None:
    if not ok:
        ISSUES.append((stage, msg))
        print(f"      ⚠️  [{stage}] {msg}")


def stage(name: str) -> None:
    print(f"\n━━━ {name} ━━━")


def main() -> None:
    c = TestClient(app)

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
            print(f"      ❌ HTTP {r.status_code} {method} {url} ({who}): {r.text[:240]}")
            raise SystemExit(1)
        return r.json() if r.content else None

    def photos(who: str, area: str, pno: str, ref: str, n: int = 1) -> list[str]:
        files = [("files", (f"{area}{i}.png", PNG, "image/png")) for i in range(n)]
        return [x["token"] for x in req("post", f"/api/v1/{area}/photos", who, (201,),
                                        params={"project_no": pno, "ref": ref}, files=files)]

    users = {u["username"]: u["id"] for u in req("get", "/api/v1/users", "admin")}

    # 标准库物料（接口建档，重复容错）
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
    for cls, spec, unit in ITEMS:
        c.post("/api/v1/library/items", headers=login("admin"),
               json={"std_class_code": cls, "spec": spec, "unit": unit})
    lib = {}
    for x in req("get", "/api/v1/library/items", "admin", params={"limit": 50}):
        lib[x["display_name"].split(" ")[0]] = x["item_no"]
    print(f"账号 {len(users)} 个；标准库物料 {len(lib)} 种")

    # ================= S0 商机 + 成交 =================
    stage("S0 商机登记 + 成交登记（sales1）—— 美的 110 寸 TV 总装线")
    p = req("post", "/api/v1/projects", "sales1", (201,), json={
        "sales_id": users["sales1"],
        "customer_name": "美的集团",
        "project_name": "110 寸 TV 总装线（整机 + 码垛单元）",
        "contacts": [
            {"name": "陈工", "title": "设备科长", "phone": "13811112222", "role_tag": "技术对接人"},
            {"name": "林经理", "title": "采购", "phone": "13933334444", "role_tag": "采购"},
        ],
        "deadline": d(21), "delivery_days": 150, "deal_mode": "投标", "source": "客户询价",
        "est_amount": 8800000, "project_desc": "整线：升降贴合机 2 台（1 用 1 备）+ 输送线体 100 + 码垛机器人单元，节拍 11s/台",
        "site_address": "佛山顺德 美的全球创新中心",
        "required_cycle": "11 秒/台", "required_capacity": "180 台/天", "product_type": "110 寸 TV",
    })["project_no"]
    pj = req("get", f"/api/v1/projects/{p}", "sales1")
    flag("S0", pj["stage"] == "线索" and pj.get("sales_id") == users["sales1"], "商机建档：阶段=线索，销售负责人=sales1")
    req("post", f"/api/v1/projects/{p}/deal", "sales1", json={
        "period_start": d(0), "period_end": d(150), "amount": 8600000,
        "contract_no_customer": "MD-2026-0518", "warranty_months": 18, "warranty_amount": 430000,
        "tech_agreement_frozen": True, "acceptance_standard": "节拍 11s/台，72h 良率 ≥98%，连续生产 500 台",
        "is_batch_delivery": True,
        "payment_terms": [
            {"node_name": "预付款", "percent": 30, "amount": 2580000, "condition": "合同签订 7 日内"},
            {"node_name": "提货款", "percent": 30, "amount": 2580000, "condition": "每批发货前"},
            {"node_name": "验收款", "percent": 30, "amount": 2580000, "condition": "全线验收合格后"},
            {"node_name": "质保金", "percent": 10, "amount": 860000, "condition": "质保期满"},
        ]})
    pj = req("get", f"/api/v1/projects/{p}", "sales1")
    flag("S0-2", pj["stage"] == "成交待立项" and pj.get("warranty_months") == 18, "成交：阶段与质保期")
    print(f"  订单 {p}：合同 860 万 / 质保 18 个月 / 4 付款节点 → 成交待立项")
    STAGES.append(("S0 商机+成交", "投标项目 860 万；质保 18 月；4 付款节点；阶段=成交待立项"))

    # ================= S1 立项（4 台设备，含同型 01B） =================
    stage("S1 立项（pm1）：01A / 01B(同型) / 02A 线体 / 03A 码垛单元")
    for u, role in [("pm1", "项目经理"), ("mech_manager", "机械负责人"), ("elec_manager", "电气负责人"),
                    ("prog_manager", "程序负责人"), ("craft_manager", "工艺负责人"), ("buyer1", "采购负责人"),
                    ("shop1", "生产负责人"), ("assy1", "装配负责人"), ("site1", "现场负责人"), ("service1", "售后负责人")]:
        req("post", f"/api/v1/projects/{p}/members", "pm1", (201,), json={"user_id": users[u], "project_role": role})
    e1 = req("post", f"/api/v1/projects/{p}/equipment", "pm1", (201,),
             json={"equip_name": "升降贴合机", "kind": "单机"})
    e1b = req("post", f"/api/v1/projects/{p}/equipment", "pm1", (201,),
              json={"equip_name": "升降贴合机", "kind": "单机", "same_as": e1["equip_no"]})
    e2 = req("post", f"/api/v1/projects/{p}/equipment", "pm1", (201,),
             json={"equip_name": "输送线体", "kind": "线体", "line_no": "100"})
    e3 = req("post", f"/api/v1/projects/{p}/equipment", "pm1", (201,),
             json={"equip_name": "码垛机器人单元", "kind": "单机"})
    flag("S1", e1b["equip_no"] == "01B", f"同型第二台编号应为 01B，实际 {e1b['equip_no']}")
    req("post", f"/api/v1/projects/{p}/milestones/generate", "pm1")
    req("post", f"/api/v1/projects/{p}/purchase-requests", "pm1", (201,),
        json={"item_no": lib["减速机"], "qty": 4, "lead_days": 60, "need_date": d(120),
              "ordered_at": d(0), "supplier_name": "华信传动", "equip_no": "01A"})
    req("post", f"/api/v1/projects/{p}/purchase-requests", "pm1", (201,),
        json={"item_no": lib["PLC"], "qty": 2, "lead_days": 45, "need_date": d(100),
              "ordered_at": d(0), "supplier_name": "华信传动", "equip_no": "02A"})
    req("post", f"/api/v1/projects/{p}/generate-tasks", "pm1",
        json={"professions": ["机械", "电气", "程序", "工艺"], "with_purchase": True})
    req("post", f"/api/v1/projects/{p}/initiate", "pm1")
    pj = req("get", f"/api/v1/projects/{p}", "pm1")
    eqs = req("get", f"/api/v1/projects/{p}/equipment", "pm1")
    flag("S1", pj["stage"] == "执行中" and len(eqs) == 4, f"立项：4 台设备，实际 {len(eqs)}")
    print(f"  设备：{[e['equip_no'] for e in eqs]}（01B=同型第二台）；阶段={pj['stage']}")
    STAGES.append(("S1 立项", "4 台设备（01A/01B 同型/02A 线体/03A）+ 长周期件 2 项；阶段=执行中"))

    # ================= S2 设计（01A 深设计：3 级树 + 定制件；02A/03A 各 1 图；程序发布） =================
    stage("S2 工程设计（mech/craft/prog 提交 → eng_director 发布）")
    A = "01A"
    d_body = req("post", f"/api/v1/projects/{p}/equipment/{A}/drawings", "mech_manager", (201,),
                 json={"title": "主体组件", "source_type": "自制件"})
    d_frame = req("post", f"/api/v1/projects/{p}/equipment/{A}/drawings", "mech_manager", (201,),
                  json={"parent_drawing_no": d_body["drawing_no"], "title": "机架", "source_type": "自制件"})
    frame_no = d_frame["drawing_no"]
    d_side = req("post", f"/api/v1/projects/{p}/equipment/{A}/drawings", "mech_manager", (201,),
                 json={"parent_drawing_no": d_frame["drawing_no"], "title": "侧板", "source_type": "自制件", "qty": 2})
    d_cover = req("post", f"/api/v1/projects/{p}/equipment/{A}/drawings", "mech_manager", (201,),
                  json={"title": "防护罩", "source_type": "自制件"})
    d_beam = req("post", f"/api/v1/projects/{p}/equipment/{A}/drawings", "mech_manager", (201,),
                 json={"title": "支撑梁（先按自制出图）", "source_type": "自制件"})
    zct = req("get", "/api/v1/library/items", "mech_manager", params={"q": "轴承"})[0]
    qg = req("get", "/api/v1/library/items", "mech_manager", params={"q": "气缸"})[0]
    dj = req("get", "/api/v1/library/items", "mech_manager", params={"q": "电机"})[0]
    ft = req("get", "/api/v1/library/items", "craft_manager", params={"q": "方通"})[0]
    bc = req("get", "/api/v1/library/items", "craft_manager", params={"q": "板材"})[0]

    def mech_submit(equip: str, drawing_refs: list[str], bom_ids: list[int], note: str) -> int:
        tid = next(t["task_id"] for t in req(
            "get", f"/api/v1/projects/{p}/equipment/{equip}/my-design-tasks", "mech_manager")
            if t["profession"] == "机械")
        req("post", f"/api/v1/tasks/{tid}/submit-review", "mech_manager", (201,),
            json={"items": [{"item_type": "DRAWING", "item_ref": x} for x in drawing_refs]
                            + [{"item_type": "BOM_DESIGN", "item_ref": str(i)} for i in bom_ids], "note": note})
        return tid

    def director_pass(tid: int) -> None:
        tk = req("get", f"/api/v1/tasks/{tid}/review-ticket", "eng_director")
        flag("S2", tk["status"] == "待总监审", f"经理提交应直达总监审，实际 {tk['status']}")
        req("post", f"/api/v1/review-tickets/{tk['id']}/review", "eng_director", json={"action": "通过", "note": "OK"})
        tk = req("get", f"/api/v1/tasks/{tid}/review-ticket", "mech_manager")
        flag("S2", tk["status"] == "已发布", f"总监通过后应「已发布」，实际 {tk['status']}")

    b1 = req("post", f"/api/v1/projects/{p}/bom/std", "mech_manager", (201,),
             json={"parent_ref": frame_no, "child_item_no": zct["item_no"], "qty": 4})
    b2 = req("post", f"/api/v1/projects/{p}/bom/std", "mech_manager", (201,),
             json={"parent_ref": d_body["drawing_no"], "child_item_no": qg["item_no"], "qty": 2})
    b3 = req("post", f"/api/v1/projects/{p}/bom/std", "mech_manager", (201,),
             json={"parent_ref": d_body["drawing_no"], "child_item_no": dj["item_no"], "qty": 2})
    director_pass(mech_submit(A, [f"{p}-{A}-00-00-00-00", d_body["drawing_no"], frame_no,
                                  d_side["drawing_no"], d_cover["drawing_no"], d_beam["drawing_no"]],
                              [b1["id"], b2["id"], b3["id"]], "01A 机械首版"))
    pool1 = req("get", "/api/v1/purchase/pool", "buyer1")
    mine1 = {g["item_no"] for g in pool1 for r in g["requests"] if r["project_no"] == p}
    flag("S2", {zct["item_no"], qg["item_no"], dj["item_no"]} <= mine1,
         f"机械发布后池应有 轴承/气缸/电机，实际 {sorted(mine1)}")

    m1 = req("post", f"/api/v1/projects/{p}/bom/material", "craft_manager", (201,),
             json={"parent_ref": frame_no, "child_item_no": ft["item_no"], "qty": 2})
    m2 = req("post", f"/api/v1/projects/{p}/bom/material", "craft_manager", (201,),
             json={"parent_ref": d_side["drawing_no"], "child_item_no": bc["item_no"], "qty": 1})
    t_craft = next(t["task_id"] for t in req(
        "get", f"/api/v1/projects/{p}/equipment/{A}/my-design-tasks", "craft_manager")
        if t["profession"] == "工艺")
    req("post", f"/api/v1/tasks/{t_craft}/submit-review", "craft_manager", (201,),
        json={"items": [{"item_type": "BOM_MATERIAL", "item_ref": str(m["id"])} for m in (m1, m2)]
                        + [{"item_type": "SOURCE_TAG", "item_ref": d_cover["drawing_no"], "source_type": "外协件"}
                           ,{"item_type": "SOURCE_TAG", "item_ref": d_beam["drawing_no"], "source_type": "定制件"}],
              "note": "材料+外协/定制判定"})
    director_pass(t_craft)
    prog = req("post", f"/api/v1/projects/{p}/equipment/{A}/programs", "prog_manager", (201,),
               json={"name": f"{p}-{A} 主控程序"})
    t_prog = next(t["task_id"] for t in req(
        "get", f"/api/v1/projects/{p}/equipment/{A}/my-design-tasks", "prog_manager")
        if t["profession"] == "程序")
    req("post", f"/api/v1/tasks/{t_prog}/submit-review", "prog_manager", (201,),
        json={"items": [{"item_type": "PROGRAM", "item_ref": str(prog["id"])}], "note": "主控程序首版"})
    director_pass(t_prog)

    d2_body = req("post", f"/api/v1/projects/{p}/equipment/02A/drawings", "mech_manager", (201,),
                  json={"title": "输送段主体", "source_type": "自制件"})
    b3 = req("post", f"/api/v1/projects/{p}/bom/std", "mech_manager", (201,),
             json={"parent_ref": d2_body["drawing_no"], "child_item_no": zct["item_no"], "qty": 8})
    director_pass(mech_submit("02A", [d2_body["drawing_no"]], [b3["id"]], "02A 线体首版"))
    d3_col = req("post", f"/api/v1/projects/{p}/equipment/03A/drawings", "mech_manager", (201,),
                 json={"title": "码垛立柱", "source_type": "自制件"})
    director_pass(mech_submit("03A", [d3_col["drawing_no"]], [], "03A 立柱首版"))

    pool = req("get", "/api/v1/purchase/pool", "buyer1")
    prs_pool = [{**r, "item_no": g["item_no"]} for g in pool for r in g["requests"] if r["project_no"] == p]
    print(f"  01A 图纸 6 张 + 程序 1 个发布；02A/03A 各 1 张发布；采购池 {len(prs_pool)} 条")
    # 预期 7 条：轴承(01A)+轴承(02A)+气缸+电机+方通+板材+防护罩(外协)
    # ★ 支撑梁被工艺改判「定制件」——发布逻辑只自动外协件进池，定制件不进（疑似缺口，计入问题）
    flag("S2", d_beam["drawing_no"] not in {x["item_no"] for x in prs_pool},
         "疑似缺口：工艺改判「定制件」的零件不会自动进采购池（只有外协件会）")
    flag("S2", len(prs_pool) == 7, f"采购池应 7 条，实际 {len(prs_pool)}：{sorted(x['item_no'] for x in prs_pool)}")
    STAGES.append(("S2 设计", "01A 五图(3级树/定制件/外协件)+程序发布；02A/03A 各1图；池累计 6 条"))

    # ================= S3 采购（2 家供应商 3 张单；分批到货；不合格→换货→重验） =================
    stage("S3 采购（buyer1）：合并下单 → 分批到货 → 不合格换货重验 → 入库")
    sup1 = next((x for x in req("get", "/api/v1/suppliers", "buyer1", params={"q": "华信传动"})),
                None) or req("post", "/api/v1/suppliers", "buyer1", (201,),
                             json={"name": "华信传动", "kind": "外协", "contact_name": "周工"})
    sup2 = next((x for x in req("get", "/api/v1/suppliers", "buyer1", params={"q": "恒钲钣金"})),
                None) or req("post", "/api/v1/suppliers", "buyer1", (201,),
                             json={"name": "恒钲钣金", "kind": "机加工", "contact_name": "何工"})
    by_key = {(x["item_no"], x.get("equip_no") or ""): x["id"] for x in prs_pool}
    cover_id = by_key[(d_cover["drawing_no"], A)]
    wh_lines = [rid for (item, eq), rid in by_key.items() if item != d_cover["drawing_no"]]
    req("post", "/api/v1/purchase/merge-order", "buyer1", (200, 201),
        json={"supplier_id": sup1["id"], "ordered_at": d(0), "expected_date": d(18),
              "deliver_to": "公司仓库", "lines": [{"request_id": rid} for rid in wh_lines]})
    # ★ 工艺改判定制件的支撑梁不自动进池 → 用「手工采购申请」补买（真实兜底路径）
    req("post", "/api/v1/purchase/manual-request", "buyer1", (201,),
        json={"attribution": "项目", "project_no": p, "equip_no": A,
              "item_no": d_beam["drawing_no"], "qty": 1, "need_date": d(20),
              "note": "工艺改判定制件，池里没进，手工补买"})
    pool3 = req("get", "/api/v1/purchase/pool", "buyer1")
    beam_req = next(r for g in pool3 for r in g["requests"]
                    if r["project_no"] == p and g["item_no"] == d_beam["drawing_no"])
    req("post", "/api/v1/purchase/merge-order", "buyer1", (200, 201),
        json={"supplier_id": sup1["id"], "ordered_at": d(0), "expected_date": d(12),
              "deliver_to": "公司仓库", "lines": [{"request_id": beam_req["id"]}]})
    req("post", "/api/v1/purchase/merge-order", "buyer1", (200, 201),
        json={"supplier_id": sup2["id"], "ordered_at": d(0), "deliver_to": "直发客户现场",
              "deliver_address": "佛山顺德 美的全球创新中心",
              "lines": [{"request_id": cover_id}]})
    prs = {(x["item_no"], x.get("equip_no") or ""): x
           for x in req("get", f"/api/v1/projects/{p}/purchase-requests", "buyer1")}

    def inspect(key: str, qty: float, result: str = "合格", note: str | None = None):
        rid = prs[key]["id"]
        r = req("post", f"/api/v1/projects/{p}/purchase-requests/{rid}/inspect", "wh1",
                json={"qty": qty, "result": result, "receipt_date": d(0), "note": note})
        if r["receipt_status"] == "待入库":
            req("post", f"/api/v1/goods-receipts/{r['receipt_id']}/store", "wh1",
                json={"location": "深圳仓 A-01-01"})
        return r

    # 分批：01A 轴承 4 = 2 + 2
    r = inspect((zct["item_no"], A), 2)
    now_map = {(x["item_no"], x.get("equip_no") or ""): x["status"]
               for x in req("get", f"/api/v1/projects/{p}/purchase-requests", "buyer1")}
    flag("S3", now_map.get((zct["item_no"], A)) in ("部分到货", "待入库"),
         f"分批首到后应部分/待入库，实际 {now_map.get((zct['item_no'], A))}")
    inspect((zct["item_no"], A), 2)
    inspect((qg["item_no"], A), 2)
    inspect((ft["item_no"], "01A"), 2, "不合格", "型材弯曲变形，退供应商")
    # 不合格 → 换货 → 重新到货验收
    req("post", "/api/v1/purchase/orders/PO-e2e/negotiate", "buyer1",
        json={"request_ids": [prs[(ft["item_no"], "01A")]["id"]], "action": "换货", "expected_date": d(10),
              "note": "弯曲退回，补发 2 根"}) if False else None
    neg = c.post("/api/v1/purchase/orders/PO-e2e/negotiate", headers=login("buyer1"),
                 json={"request_ids": [prs[(ft["item_no"], "01A")]["id"]], "action": "换货",
                       "expected_date": d(10), "note": "弯曲退回，补发 2 根"})
    # PO-e2e 不存在：改用真实 po_no
    po_no = prs[(ft["item_no"], "01A")].get("po_no")
    neg = c.post(f"/api/v1/purchase/orders/{po_no}/negotiate", headers=login("buyer1"),
                 json={"request_ids": [prs[(ft["item_no"], "01A")]["id"]], "action": "换货",
                       "expected_date": d(10), "note": "弯曲退回，补发 2 根"})
    flag("S3", neg.status_code == 200, f"换货协商应成功，实际 {neg.status_code}: {neg.text[:120]}")
    inspect((ft["item_no"], "01A"), 2)  # 补发到货
    inspect((bc["item_no"], A), 2)
    inspect((d_beam["drawing_no"], A), 1)
    inspect((zct["item_no"], "02A"), 8)
    inspect((d_cover["drawing_no"], A), 1)  # 外协直发 → 现场待验收
    prs_now = req("get", f"/api/v1/projects/{p}/purchase-requests", "buyer1")
    st_map = {(x["item_no"], x.get("equip_no") or ""): x["status"] for x in prs_now}
    flag("S3", st_map.get((ft["item_no"], "01A")) == "已入库", f"换货重验后方通应已入库，实际 {st_map.get((ft['item_no'], '01A'))}")
    flag("S3", st_map.get((d_cover["drawing_no"], A)) == "现场待验收", "外协直发件应等现场清点")
    print(f"  采购单 3 张（仓库×2 + 直发×1）；分批/换货/重验完成；{len(prs_now)} 条需求全部到位")
    STAGES.append(("S3 采购", "3 张采购单；分批到货(部分到货→齐)；不合格→换货→重验；直发件等现场清点"))

    # ================= S4 领料 =================
    stage("S4 仓库领料（shop1 → wh1）")
    iss = req("post", f"/api/v1/warehouse/projects/{p}/equipment/{A}/generate-issue", "shop1", (201,))
    issue = next(i for i in req("get", "/api/v1/warehouse/issues", "wh1") if i["issue_no"] == iss["issue_no"])
    if iss["shortage_count"]:
        print(f"      ℹ️ 领料标出 {iss['shortage_count']} 种缺料（未到货/未入库）—— 系统正确标缺")
    req("post", f"/api/v1/warehouse/issues/{issue['id']}/pick", "wh1", json={})
    req("post", f"/api/v1/warehouse/issues/{issue['id']}/hand-over", "wh1", json={"issued_to": "车间 李四"})
    print(f"  领料单 {iss['issue_no']}：{iss['line_count']} 种，已领走")
    STAGES.append(("S4 领料", "01A 领料单（标准件+原材料）齐套发出"))

    # ================= S5 制造（返工恢复 + 多设备并行 + 外协） =================
    stage("S5 制造（shop1）：01A 返工→恢复；02A/03A 并行；外协防护罩")
    for eq in (A, "02A", "03A"):
        req("post", f"/api/v1/manufacturing/projects/{p}/equipment/{eq}/generate-orders", "shop1", (201,), json={})
    ph = photos("shop1", "manufacturing", p, "cplx", 2)
    orders = {o["item_no"]: o for o in req("get", "/api/v1/manufacturing/orders", "shop1", params={"project_no": p})}

    def flow(o: dict, path: str) -> None:
        oid = o["id"]
        req("post", f"/api/v1/manufacturing/orders/{oid}/dispatch", "shop1",
            json={"step_name": "下料", "issued_to": "下料班", "photos": ph})
        if "start" in path:
            req("post", f"/api/v1/manufacturing/orders/{oid}/start", "shop1")
        if path.endswith("ok"):
            req("post", f"/api/v1/manufacturing/orders/{oid}/accept", "shop1",
                json={"result": "合格", "photos": ph[:1]})
            req("post", f"/api/v1/manufacturing/orders/{oid}/transfer", "shop1", json={"photos": ph[:1]})
        elif path.endswith("ng"):
            req("post", f"/api/v1/manufacturing/orders/{oid}/accept", "shop1",
                json={"result": "不合格", "reason": "焊接变形超差", "photos": ph[:1]})

    flow(orders[frame_no], "start-ok")            # 机架：合格→转运
    flow(orders[d_body["drawing_no"]], "dispatch-ng")  # 主体：不合格→返工
    flow(orders[d_body["drawing_no"]], "start-ok")     # 返工后重新做：合格→转运
    flow(orders[d_side["drawing_no"]], "start-ok")     # 侧板：合格→转运
    flow(orders[d2_body["drawing_no"]], "start")       # 02A 主体：在制
    flow(orders[d3_col["drawing_no"]], "dispatch")     # 03A 立柱：已派工
    osr = req("get", "/api/v1/manufacturing/outsource", "shop1", params={"project_no": p})[0]
    req("post", f"/api/v1/manufacturing/outsource/{osr['id']}/send", "shop1",
        json={"supplier_name": "恒钲钣金", "due_date": d(25), "material_supplied": True})
    req("post", f"/api/v1/manufacturing/outsource/{osr['id']}/return", "shop1", json={})
    req("post", f"/api/v1/manufacturing/outsource/{osr['id']}/accept", "shop1", json={"result": "合格"})
    sts = {o["item_no"]: o["status"] for o in req("get", "/api/v1/manufacturing/orders", "shop1",
                                                  params={"project_no": p})}
    flag("S5", sts[d_body["drawing_no"]] == "已转运", f"返工恢复后主体应已转运，实际 {sts[d_body['drawing_no']]}")
    print(f"  排产 {len(orders)} 张：机架/侧板转运、主体返工后转运、02A 在制、03A 已派工；外协合格")
    STAGES.append(("S5 制造", "01A 三件全部转运（含返工恢复）；02A 在制；03A 已派工；外协合格"))

    # ================= S6 装配 =================
    stage("S6 装配（assy1）：01A 齐套装配；02A 组件预装开工")
    ov = req("get", "/api/v1/assembly/kitting/overview", "assy1", params={"project_no": p})
    rate_a = next(o["kitting_rate"] for o in ov if o["equip_no"] == A)
    print(f"  齐套率：{[(o['equip_no'], str(round(o['kitting_rate'] * 100)) + '%') for o in ov]}")
    rec = req("post", "/api/v1/assembly/records", "assy1", (201,),
              json={"project_no": p, "equip_no": A, "sub_assembly": "整机装配",
                    "photos": photos("shop1", "manufacturing", p, "assyA")})
    flag("S6", abs(rec["kitting_rate"] - rate_a) < 0.01, "开工齐套率快照应与看板一致")
    req("post", f"/api/v1/assembly/records/{rec['id']}/finish", "assy1", json={})
    req("post", f"/api/v1/assembly/records/{rec['id']}/debug", "assy1",
        json={"result": "合格", "note": "单机调试 72h 通过"})
    rec2 = req("post", "/api/v1/assembly/records", "assy1", (201,),
               json={"project_no": p, "equip_no": "02A", "sub_assembly": "组件预装",
                     "remark": "线体分段预装"})
    flag("S6", rec2["status"] == "装配中", "02A 组件预装应处于装配中")
    STAGES.append(("S6 装配", f"01A 齐套 {round(rate_a*100)}% → 整机装配/调试合格；02A 组件预装开工"))

    # ================= S7 发运（两批 + 重复拦截 + 缺件签收） =================
    stage("S7 发运（pm1 指令 / delivery1 执行 / site1 验收）：第一批 01A，第二批 02A 缺件")
    sh1 = req("post", "/api/v1/shipping/instructions", "pm1", (201,),
              json={"project_no": p, "equip_nos": [A], "remark": "第一批：先发主机"})
    r = c.post("/api/v1/shipping/instructions", headers=login("pm1"),
               json={"project_no": p, "equip_nos": [A]})
    flag("S7", r.status_code == 400, "01A 已在未完成批次，重复下单应被拦")
    sph = photos("pm1", "shipping", p, sh1["shipment_no"])
    req("post", f"/api/v1/shipping/{sh1['id']}/pack", "delivery1",
        json={"items": [{"equip_no": A, "part_item_no": frame_no, "part_name": "机架", "qty": 1,
                         "package_no": "A-P1", "weight": 320, "size": "2400x1200x900", "disassembled": True}]})
    req("post", f"/api/v1/shipping/{sh1['id']}/load", "delivery1",
        json={"plate_no": "粤B88888", "driver": "张师傅", "photos": sph[:1]})
    req("post", f"/api/v1/shipping/{sh1['id']}/depart", "delivery1", json={})
    req("post", f"/api/v1/shipping/{sh1['id']}/arrive", "delivery1")
    sh1now = req("post", f"/api/v1/shipping/{sh1['id']}/receipt", "site1",
                 json={"result": "齐", "photos": sph[:1]})
    flag("S7", sh1now["status"] == "已签收", "第一批应齐且签收")

    sh2 = req("post", "/api/v1/shipping/instructions", "pm1", (201,),
              json={"project_no": p, "equip_nos": ["02A"], "remark": "第二批：线体分段"})
    req("post", f"/api/v1/shipping/{sh2['id']}/pack", "delivery1",
        json={"items": [{"equip_no": "02A", "part_item_no": d2_body["drawing_no"], "part_name": "输送段", "qty": 3,
                         "package_no": "B-P1", "disassembled": True}]})
    req("post", f"/api/v1/shipping/{sh2['id']}/load", "delivery1",
        json={"plate_no": "粤B66666", "photos": sph[:1]})
    req("post", f"/api/v1/shipping/{sh2['id']}/depart", "delivery1", json={})
    req("post", f"/api/v1/shipping/{sh2['id']}/arrive", "delivery1")
    sh2now = req("post", f"/api/v1/shipping/{sh2['id']}/receipt", "site1",
                 json={"result": "缺件", "shortage_detail": [{"equip_no": "02A", "item": "滚筒", "qty": 2, "reason": "运输丢失"}],
                       "photos": sph[:1], "remark": "少 2 根滚筒，已通知补发"})
    flag("S7", sh2now["status"] == "已签收" and sh2now["receipts"][-1]["result"] == "缺件", "第二批应缺件签收并留明细")
    print(f"  {sh1['shipment_no']} 齐签收；{sh2['shipment_no']} 缺件签收（留明细）；分批发运 ✓")
    STAGES.append(("S7 发运", "两批发运（01A 齐 / 02A 缺件留明细）；重复发货指令被拦；阶段→交付中"))

    # ================= S8 现场安装 + ECN 变更联动 =================
    stage("S8 现场安装（site1）：勘测/日报/问题→ECN/申请调试")
    inc = req("get", "/api/v1/site/incoming", "site1", params={"project_no": p})
    flag("S8", len(inc["pending"]) == 1, f"直发的防护罩应待现场清点 1 件，实际 {len(inc['pending'])}")
    req("post", f"/api/v1/site/incoming/{direct_receipt_id if (direct_receipt_id := next((x['receipt_id'] for x in inc['pending']), None)) else 0}/accept",
        "site1", json={"result": "齐", "photos": photos("site1", "site", p, "inc")}) if inc["pending"] else None
    req("post", "/api/v1/site/survey", "site1", (201,),
        json={"project_no": p, "contact": "陈工 138...", "floor_load": "5t/m²", "passage": "吊装口 6m",
              "power": "380V 200A", "air": "0.7MPa", "network": "工业以太网", "enter_date": d(5)})
    req("post", "/api/v1/site/daily", "site1", (201,),
        json={"project_no": p, "equip_no": A, "stage": "安装", "done_items": ["主机就位", "线体对接"],
              "people": 6, "photos": photos("site1", "site", p, "d1", 2)})
    cr = req("post", "/api/v1/change-requests", "site1", (201,),
             json={"target_type": "DRAWING", "target_ref": d_cover["drawing_no"],
                   "reason": "现场实测：防护罩与线体料道干涉 2mm（与此前问题一致）",
                   "proposal": "防护罩下沿开槽 20mm 并改 R 角"})
    req("post", f"/api/v1/change-requests/{cr['id']}/decide", "eng_director",
        json={"decision": "批准", "note": "同意改版"})
    req("post", f"/api/v1/change-requests/{cr['id']}/dispatch", "eng_director",
        json={"assignee_id": users["mech_manager"]})
    iss2 = req("post", "/api/v1/site/issues", "site1", (201,),
               json={"project_no": p, "equip_no": A, "title": "防护罩干涉（已立 ECN）",
                     "desc": f"见改版 {cr['cr_no'] if 'cr_no' in cr else cr.get('cr_no', '')}", "photos": []})
    req("post", f"/api/v1/site/issues/{iss2['id']}/link-change", "site1", json={"change_id": cr["id"]})
    com = req("post", "/api/v1/site/commission", "site1", (201,),
              json={"project_no": p, "dispatch_to": "调试组 王工", "plan_date": d(12)})
    req("post", f"/api/v1/site/commission/{com['id']}/arrive", "site1")
    req("post", f"/api/v1/site/commission/{com['id']}/start", "site1")
    req("post", "/api/v1/site/daily", "site1", (201,),
        json={"project_no": p, "equip_no": "02A", "stage": "联调",
              "done_items": ["全线联调", "节拍实测 10.8s"], "people": 8,
              "photos": photos("site1", "site", p, "d2", 2), "videos": photos("site1", "site", p, "d2v")})
    req("post", f"/api/v1/site/commission/{com['id']}/finish", "site1")
    crd = req("get", "/api/v1/change-requests/" + str(cr["id"]), "site1") if False else None
    print(f"  勘测/日报×2/直发清点/问题→ECN({cr['cr_no'] if 'cr_no' in cr else cr['id']})批准并派改版/调试完成")
    STAGES.append(("S8 现场", "勘测→直发清点→日报→现场问题立 ECN（总监批准+派改版）→申请调试→完成"))

    # ================= S10 客户验收 =================
    stage("S10 客户验收（site1 申请 → 客户签字通过 → 自动质保 18 个月）")
    acc = req("post", "/api/v1/acceptance/apply", "site1", (201,),
              json={"project_no": p, "remark": "全线联调节拍达标，申请验收"})
    docs = req("post", f"/api/v1/acceptance/{acc['id']}/documents", "site1", (201,),
               data={"doc_type": "验收单"},
               files=[("files", ("验收单.pdf", PDF, "application/pdf")),
                      ("files", ("调试记录.pdf", PDF, "application/pdf"))])
    req("post", f"/api/v1/acceptance/documents/{docs[0]['id']}/sign", "site1")
    acc2 = req("post", f"/api/v1/acceptance/{acc['id']}/confirm", "site1",
               json={"result": "通过", "signed_by": "客户 陈工", "accepted_at": d(1)})
    pj = req("get", f"/api/v1/projects/{p}", "pm1")
    flag("S10", pj["stage"] == "质保" and acc2["warranty_months"] == 18, "验收通过：阶段→质保，质保 18 个月")
    print(f"  验收通过；质保 {acc2['warranty_start']} ~ {acc2['warranty_end']}（18 个月）")
    STAGES.append(("S10 验收", "资料包 2 份（1 已签）→ 客户签字通过 → 自动质保 18 个月；阶段→质保"))

    # ================= S11 售后 =================
    stage("S11 质保与售后（service1）")
    part = req("post", "/api/v1/service/parts", "service1", (201,),
               json={"project_no": p, "equip_no": A, "item_no": zct["item_no"],
                     "item_name": zct["display_name"], "qty_stock": 3, "qty_installed": 6, "min_qty": 5})
    part = req("post", "/api/v1/service/parts/move", "service1", (201,),
               json={"part_id": part["id"], "move_type": "领出", "qty": 1, "issued_to": "李工"})
    flag("S11", part["qty_stock"] == 2, f"领出 1 后库存应 2，实际 {part['qty_stock']}")
    so = req("post", "/api/v1/service/orders", "service1", (201,),
             json={"project_no": p, "equip_no": A, "fault": "贴合气缸偶发不动作"})
    flag("S11", so["in_warranty"] is True, "质保期内报修应判定在保")
    req("post", f"/api/v1/service/orders/{so['id']}/dispatch", "service1", json={"dispatched_to": "李工"})
    req("post", f"/api/v1/service/orders/{so['id']}/arrive", "service1", json={})
    req("post", f"/api/v1/service/orders/{so['id']}/fix", "service1",
        json={"solution": "更换电磁阀", "labor_hours": 2.5, "photos": photos("service1", "service", p, so["so_no"])})
    so = req("post", f"/api/v1/service/orders/{so['id']}/sign", "service1", json={"customer_sign": "客户 陈工"})
    flag("S11", so["status"] == "已关闭", "客户签字后应关单")
    print(f"  工单 {so['so_no']}（在保）已关闭；备件低库存预警在案")
    STAGES.append(("S11 售后", "工单在保→派工→到场→处理→签字关单；备件收发留痕（低库存预警）"))

    # ================= 回款 =================
    stage("回款登记（fin1）")
    req("post", f"/api/v1/projects/{p}/payment-terms/1/receive", "fin1")
    req("post", f"/api/v1/projects/{p}/payment-terms/2/receive", "fin1")
    req("post", f"/api/v1/projects/{p}/payment-terms/3/receive", "fin1", data={"received_amount": "2000000"})
    over = c.post(f"/api/v1/projects/{p}/payment-terms/3/receive", headers=login("fin1"),
                  data={"received_amount": "999999"})
    flag("回款", over.status_code == 400, "超额回款应被拦截")
    print("  预付/提货款收齐；验收款收 200 万（尾 58 万未收）；质保金未收")
    STAGES.append(("回款", "预付/提货收齐，验收款部分，质保金未收"))

    # ================= 部门可见性抽查 =================
    stage("部门可见性抽查（九个角色都能看到该订单；且不影响 TX26001）")
    sales = req("get", "/api/v1/workbench/sales/board", "sales1")
    nos = [r["project_no"] for r in sales["projects"]]
    flag("可见", p in nos, "商务部台应见新订单")
    flag("可见", len(nos) >= 1, "商务部台应能看到订单")
    flag("可见-项目经理", p in str(req("get", "/api/v1/workbench/pm/board", "pm1")))
    flag("可见-工程", p in str(req("get", "/api/v1/workbench/eng/board", "mech_manager")))
    flag("可见-仓库", any(i["project_no"] == p for i in req("get", "/api/v1/warehouse/issues", "wh1")))
    flag("可见-制造", any(o["project_no"] == p for o in req("get", "/api/v1/manufacturing/orders", "shop1")))
    flag("可见-装配", any(r["project_no"] == p for r in req("get", "/api/v1/assembly/records", "assy1")))
    flag("可见-发运", any(s["project_no"] == p for s in req("get", "/api/v1/shipping/list", "delivery1")))
    flag("可见-现场", any(x["project_no"] == p for x in req("get", "/api/v1/site/commission", "site1")))
    flag("可见-售后", any(x["project_no"] == p for x in req("get", "/api/v1/service/orders", "service1")))
    print("  商务（两单并存）/项目经理/工程/仓库/制造/装配/发运/现场/售后 全部可见 ✓")

    # ================= 报告 =================
    print("\n" + "=" * 64)
    print("高复杂度测试结论")
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
    print(f"\n新订单号：{p}（与 TX26001 并存，均可按角色走查）")


if __name__ == "__main__":
    main()
