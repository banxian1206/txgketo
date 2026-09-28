#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""隔离探针：每个「重复进池」机制用独立项目单独证明（避免互相污染）。

三个场景，各自一个干净项目、各自一种物料：
  ISO-A 直发件「现场已验收」后手动补跑      → 物料：定制件图号（项目专属）
  ISO-B 标准件「验收合格未入库」窗口手动补跑 → 物料：轴承 ZC-ZCT-0001
  ISO-C 标准件「已入库 + 已领走出库」后补跑  → 物料：板材 YL-BC-0001

期望：三种情况下手动补跑都应 **0 新增**（AGENTS §8.1 承诺幂等）。
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import httpx
from sqlalchemy import create_engine, text

BASE = "http://127.0.0.1:8208/api/v1"
DBURL = "postgresql+psycopg://txgk:txgk@127.0.0.1:35432/txgk"
TODAY = date.today()
PDF = b"%PDF-1.4 iso\n"
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c6360000002000154a24f5b0000000049454e44ae426082")


def d(n): return (TODAY + timedelta(days=n)).isoformat()


RESULTS = []
C = httpx.Client(base_url=BASE, timeout=90.0)
TOK: dict[str, dict] = {}


def login(u):
    if u in TOK: return TOK[u]
    pwd = "admin12345" if u == "admin" else "txgk@123"
    r = C.post("/auth/login", json={"username": u, "password": pwd})
    r.raise_for_status()
    TOK[u] = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return TOK[u]


def call(method, path, who, expect=(200,), **kw):
    r = C.request(method, path, headers=dict(login(who)), **kw)
    if r.status_code not in expect:
        raise RuntimeError(f"HTTP {r.status_code} {method} {path} ({who}): {r.text[:300]}")
    return r.json() if "application/json" in r.headers.get("content-type", "") else r.content


def q(sql, **kw):
    e = create_engine(DBURL)
    with e.connect() as c:
        return [dict(x._mapping) for x in c.execute(text(sql), kw)]


def verdict(name, ok, detail):
    RESULTS.append({"name": name, "ok": ok, "detail": detail})
    print(f"  {'✅' if ok else '❌'} {name}\n     {detail}")


# --------------------------------------------------------------------------
def build_project(tag: str, mat_key: str, mat_item: str, bom_qty: float,
                  parent_qty: float = 1.0, custom_qty: float | None = None) -> dict:
    """建一个最小可发布项目：总装 → 组件(qty=parent_qty) → [定制件] + BOM行(标准件/原材料)。"""
    uid = q("select id from app_user where username='sales1'")[0]["id"]
    p = call("post", "/projects", "sales1", (201,), json={
        "sales_id": uid, "customer_name": f"隔离客户{tag}", "project_name": f"ISO-{tag}",
        "project_desc": "隔离探针", "deadline": d(30), "delivery_days": 90,
        "site_address": "深圳", "contacts": [{"name": "王工", "phone": "13800001111"}]})["project_no"]
    call("post", f"/projects/{p}/deal", "sales1", json={
        "period_start": d(0), "period_end": d(90), "amount": 100000,
        "warranty_months": 12, "payment_terms": [{"node_name": "预付款", "percent": 100}]})
    for u, role in [("pm1", "项目经理"), ("mech_manager", "机械负责人"),
                    ("craft_manager", "工艺负责人"), ("buyer1", "采购负责人")]:
        uu = q("select id from app_user where username=:u", u=u)[0]["id"]
        call("post", f"/projects/{p}/members", "pm1", (201,),
             json={"user_id": uu, "project_role": role})
    eq = call("post", f"/projects/{p}/equipment", "pm1", (201,),
              json={"equip_name": "隔离设备", "kind": "单机"})["equip_no"]
    call("post", f"/projects/{p}/milestones/generate", "pm1")
    call("post", f"/projects/{p}/generate-tasks", "pm1",
         json={"professions": ["机械", "工艺"], "with_purchase": False})
    call("post", f"/projects/{p}/initiate", "pm1")

    root = call("get", f"/projects/{p}/equipment/{eq}/design", "mech_manager")["root"]["drawing_no"]
    body = call("post", f"/projects/{p}/equipment/{eq}/drawings", "mech_manager", (201,),
                json={"title": "组件", "source_type": "自制件", "qty": parent_qty})["drawing_no"]
    call("post", f"/drawings/{root}/draft", "mech_manager", (200,),
         data={"change_reason": "初稿"}, files={"file": ("r.pdf", PDF, "application/pdf")})
    call("post", f"/drawings/{body}/draft", "mech_manager", (200,),
         data={"change_reason": "初稿"}, files={"file": ("b.pdf", PDF, "application/pdf")})

    custom_no = None
    if custom_qty is not None:
        custom_no = call("post", f"/projects/{p}/equipment/{eq}/drawings", "mech_manager", (201,),
                         json={"title": "定制件", "source_type": "自制件", "qty": custom_qty,
                               "parent_drawing_no": body})["drawing_no"]
        call("post", f"/drawings/{custom_no}/draft", "mech_manager", (200,),
             data={"change_reason": "初稿"}, files={"file": ("c.pdf", PDF, "application/pdf")})

    bom_id = None
    if mat_item:
        b = call("post", f"/projects/{p}/bom/std", "mech_manager", (201,),
                 json={"parent_ref": body, "child_item_no": mat_item, "qty": bom_qty})
        bom_id = b["id"]

    # 机械评审（含总装图强制随批）
    tasks = call("get", f"/projects/{p}/equipment/{eq}/my-design-tasks", "mech_manager")
    tid = [t for t in tasks if t["profession"] == "机械"][0]["task_id"]
    items = [{"item_type": "DRAWING", "item_ref": root}, {"item_type": "DRAWING", "item_ref": body}]
    if custom_no:
        items.append({"item_type": "DRAWING", "item_ref": custom_no})
    if bom_id:
        items.append({"item_type": "BOM_DESIGN", "item_ref": str(bom_id)})
    call("post", f"/tasks/{tid}/submit-review", "mech_manager", (201,),
         json={"items": items, "note": "机械首版"})
    tk = call("get", f"/tasks/{tid}/review-ticket", "eng_director")
    call("post", f"/review-tickets/{tk['id']}/review", "eng_director",
         json={"action": "通过", "note": "OK"})

    # 工艺评审：材料 BOM + 定制件改判
    if custom_no:
        tc = call("get", f"/projects/{p}/equipment/{eq}/my-design-tasks", "craft_manager")
        tcid = [t for t in tc if t["profession"] == "工艺"][0]["task_id"]
        call("post", f"/tasks/{tcid}/submit-review", "craft_manager", (201,), json={
            "items": [{"item_type": "SOURCE_TAG", "item_ref": custom_no, "source_type": "定制件"}],
            "note": "改判定制件"})
        tk2 = call("get", f"/tasks/{tcid}/review-ticket", "eng_director")
        call("post", f"/review-tickets/{tk2['id']}/review", "eng_director",
             json={"action": "通过", "note": "OK"})

    return {"p": p, "eq": eq, "root": root, "body": body, "custom": custom_no, "bom_id": bom_id}


def pool_of(p: str) -> dict:
    out = {}
    for r in q("select id, item_no, qty, status from purchase_request where project_no=:p", p=p):
        out.setdefault(r["item_no"], []).append(r)
    return out


def gen_purchase(p: str, eq: str) -> dict:
    r = C.post(f"{BASE}/projects/{p}/equipment/{eq}/generate-purchase",
               headers=dict(login("mech_manager")), json={})
    return r.json() if r.status_code in (200, 201) else {"error": r.status_code, "body": r.text[:300]}


def approve_po(po_no: str) -> str:
    """★ 重构后下单即提交审批：把单推到「已批准」（激活后需求才转在途、才能验收）。

    审批链按岗位找：组员提交 → 经理审 → 总监审；经理空缺会自动跳级给总监。
    """
    for _ in range(4):
        po = [o for o in call("get", "/purchase/orders", "buyer1") if o.get("po_no") == po_no]
        if not po:
            raise RuntimeError(f"采购单 {po_no} 不在列表里")
        st = po[0].get("po_status") or po[0]["status"]   # ★ po_status 是真单头状态；status 是派生展示口径
        if st in ("已批准", "执行中", "已完成"):
            return st
        if st == "待经理审":
            call("post", f"/purchase/orders/{po_no}/approve", "purchase_manager", (200,),
                 json={"action": "通过", "note": "探针自动通过"})
        elif st == "待总监审":
            call("post", f"/purchase/orders/{po_no}/approve", "purchase_director", (200,),
                 json={"action": "通过", "note": "探针自动通过"})
        else:
            raise RuntimeError(f"{po_no} 状态 {st}，无法推进审批")
    po = [o for o in call("get", "/purchase/orders", "buyer1") if o.get("po_no") == po_no]
    return po[0].get("po_status") or po[0]["status"] if po else "?"


def order_and_receive(p: str, item_no: str, *, deliver_to="公司仓库", store=True, qty=None):
    """把该物料所有待采购需求下单 → 审批通过 → 验收（可选入库）。"""
    rows = [r for r in q("select id, qty from purchase_request "
                         "where project_no=:p and item_no=:i and status in ('待采购','部分下单')",
                         p=p, i=item_no)]
    if not rows:
        return []
    mo = call("post", "/purchase/merge-order", "buyer1", (200, 201), json={
        "supplier_id": q("select id from supplier limit 1")[0]["id"],
        "ordered_at": d(0), "expected_date": d(10), "deliver_to": deliver_to,
        "deliver_address": "深圳客户现场" if deliver_to == "直发客户现场" else None,
        "lines": [{"request_id": r["id"], "tax_incl": True, "unit_price": 100.0} for r in rows]})
    st = approve_po(mo["po_no"])
    print(f"     [下单 {mo['po_no']} → 审批后 {st}]")
    if st not in ("已批准", "执行中", "已完成"):
        raise RuntimeError(f"{mo['po_no']} 审批未通过（{st}），无法验收")
    out = []
    for r in rows:
        qq = float(qty if qty is not None else r["qty"])
        res = call("post", f"/projects/{p}/purchase-requests/{r['id']}/inspect", "wh1",
                   json={"qty": qq, "result": "合格", "receipt_date": d(0)})
        if store and res.get("receipt_status") == "待入库":
            call("post", f"/goods-receipts/{res['receipt_id']}/store", "wh1",
                 json={"location": "深圳仓 A-01-01"})
        out.append(res)
    return out


BUSINESS_TABLES = [
    "acceptance_document", "acceptance", "spare_part_move", "spare_part", "service_order",
    "site_incoming", "site_commission", "site_issue", "site_daily", "site_survey", "site_receipt",
    "shipment_item", "shipment_line", "shipment", "kitting_snapshot", "assembly_record",
    "prod_acceptance", "prod_task", "prod_order", "outsource_task", "material_issue_line",
    "material_issue", "stock_move", "stock_item", "warehouse_location", "goods_receipt",
    "purchase_request", "supplier_quote", "supplier_catalog", "supplier", "task",
    "review_ticket_item", "review_action", "review_ticket", "design_release", "change_request",
    "equipment_program_version", "equipment_program", "drawing_version", "drawing", "bom_item",
    "milestone", "project_member", "equipment", "payment_term", "contact", "customer",
    "project", "notification", "audit_log", "number_seq", "attachment",
]

LIB_SEED = [("ZCT", {"brand": "NSK", "model": "6204DDU"}, "个"),
            ("BC", {"material": "Q235", "t": "2.0", "size": "1220x2440"}, "张"),
            ("FT", {"material": "Q235", "w": "40", "h": "40", "t": "2.0", "len": "6000"}, "米")]


def main():
    print("=" * 78)
    print("隔离探针：重复进池的三个机制（★ 先复位，避免全局库存污染）")
    print("=" * 78)
    e = create_engine(DBURL)
    with e.begin() as c:
        c.execute(text(f'TRUNCATE TABLE {", ".join(BUSINESS_TABLES)} RESTART IDENTITY CASCADE'))
        c.execute(text("DELETE FROM item"))
    print("🧹 业务数据已清空（含全局库存）")
    for cls, spec, unit in LIB_SEED:
        call("post", "/library/items", "craft1", (201,),   # craft1=工艺(std:edit)，不需要超管
             json={"std_class_code": cls, "spec": spec, "unit": unit})
    for nm, kd in [("甲钢材", "原材料"), ("乙标准件", "标准件")]:
        call("post", "/suppliers", "buyer1", (201,), json={
            "name": nm, "kind": kd, "contact_name": "c", "phone": "13800000000",
            "payment_terms": "月结30天", "tax_rate": 13.0})
    print("标准库 + 供应商已重建")
    # 库位
    C.post(f"{BASE}/warehouse/locations", headers=dict(login("wh1")),
           json={"warehouse": "深圳仓", "code": "A-01-01", "name": "主库位"})

    # ---------------- ISO-A 直发件「现场已验收」 ----------------
    print("\n--- ISO-A 直发件完成后（现场已验收）手动补跑 ---")
    a = build_project("A", "custom", None, 0, parent_qty=2.0, custom_qty=3.0)
    item_a = a["custom"]
    base = pool_of(a["p"])
    print(f"  项目 {a['p']} 设备 {a['eq']}；定制件 {item_a}（qty=3，父组件 qty=2 → 真实需求 6）")
    print(f"  发布后进池：{[(k, [(r['id'], r['qty'], r['status']) for r in v]) for k, v in base.items()]}")
    rel_qty = sum(float(r["qty"]) for r in base.get(item_a, []))
    verdict("A1 发布通道数量正确（应为 3×2=6）", abs(rel_qty - 6.0) < 1e-6,
            f"发布通道进池 {rel_qty}，期望 6.0")
    order_and_receive(a["p"], item_a, deliver_to="直发客户现场", store=False)
    inc = call("get", "/site/incoming", "site1", params={"project_no": a["p"]})
    ph = [x["token"] for x in call("post", "/site/photos", "site1", (200, 201),
                                   params={"project_no": a["p"]},
                                   files=[("files", ("s.png", PNG, "image/png"))])]
    for g in inc.get("pending", []):
        call("post", f"/site/incoming/{g['receipt_id']}/accept", "site1",
             json={"result": "齐", "photos": ph})
    st = q("select status, qty_received from purchase_request where project_no=:p and item_no=:i",
           p=a["p"], i=item_a)
    print(f"  现场清点后需求状态：{st}")
    stk = q("select coalesce(sum(qty_on_hand),0) s from stock_item where item_no=:i", i=item_a)[0]["s"]
    verdict("A2 直发件从不进库存", float(stk) == 0.0, f"库存={stk}")
    res = gen_purchase(a["p"], a["eq"])
    after = pool_of(a["p"])
    new_a = [r for r in after.get(item_a, []) if r["id"] not in {x["id"] for x in base.get(item_a, [])}]
    verdict("A3 ★ 直发件已「现场已验收」后手动补跑应 0 新增", not new_a,
            f"generate-purchase={json.dumps(res, ensure_ascii=False)[:200]}\n"
            f"     新增：{[(r['id'], r['qty']) for r in new_a]}\n"
            f"     原因：OPEN_STATUS 不含「现场待验收/现场已验收」，且直发件从不进 StockItem → cover=0")

    # ---------------- ISO-B 待入库窗口 ----------------
    print("\n--- ISO-B 标准件「验收合格未入库」窗口手动补跑 ---")
    zct = q("select item_no from item where item_no like 'ZC-ZCT%' limit 1")[0]["item_no"]
    b = build_project("B", "zct", zct, 4.0, parent_qty=2.0)
    base = pool_of(b["p"])
    print(f"  项目 {b['p']}；轴承 {zct} BOM qty=4，父组件 qty=2 → 真实需求 8")
    print(f"  发布后进池：{[(k, [(r['id'], r['qty'], r['status']) for r in v]) for k, v in base.items()]}")
    rel_qty = sum(float(r["qty"]) for r in base.get(zct, []))
    verdict("B1 发布通道数量正确（应为 4×2=8）", abs(rel_qty - 8.0) < 1e-6,
            f"发布通道进池 {rel_qty}，期望 8.0")
    order_and_receive(b["p"], zct, store=False)          # ★ 验收合格但不入库
    st = q("select status, qty, qty_received from purchase_request where project_no=:p and item_no=:i",
           p=b["p"], i=zct)
    print(f"  验收合格未入库：{st}")
    stk = q("select coalesce(sum(qty_on_hand),0) s from stock_item where item_no=:i", i=zct)[0]["s"]
    print(f"  轴承全局库存={stk}")
    res = gen_purchase(b["p"], b["eq"])
    after = pool_of(b["p"])
    new_b = [r for r in after.get(zct, []) if r["id"] not in {x["id"] for x in base.get(zct, [])}]
    verdict("B2 ★ 待入库窗口手动补跑应 0 新增", not new_b,
            f"generate-purchase={json.dumps(res, ensure_ascii=False)[:200]}\n"
            f"     新增：{[(r['id'], r['qty']) for r in new_b]}\n"
            f"     机制：qty_received 含 pending(待入库) → _open_qty 的 remaining=qty−qty_received=0；"
            f"而货还没入库 → stock 也不含 → 两头都不覆盖")

    # ---------------- ISO-C 已入库 + 已领走出库 ----------------
    print("\n--- ISO-C 标准件「已入库 + 已领走出库」后手动补跑 ---")
    bc = q("select item_no from item where item_no like 'YL-BC%' limit 1")[0]["item_no"]
    c = build_project("C", "bc", bc, 5.0, parent_qty=2.0)
    base = pool_of(c["p"])
    print(f"  项目 {c['p']}；板材 {bc} BOM qty=5，父组件 qty=2 → 真实需求 10")
    rel_qty = sum(float(r["qty"]) for r in base.get(bc, []))
    verdict("C1 发布通道数量正确（应为 5×2=10）", abs(rel_qty - 10.0) < 1e-6,
            f"发布通道进池 {rel_qty}，期望 10.0")
    stk0 = q("select coalesce(sum(qty_on_hand),0) s from stock_item where item_no=:i", i=bc)[0]["s"]
    print(f"  下单前板材全局库存={stk0}（干净环境应为 0）")
    order_and_receive(c["p"], bc, store=True)            # 验收入库
    stk1 = q("select coalesce(sum(qty_on_hand),0) s from stock_item where item_no=:i", i=bc)[0]["s"]
    print(f"  入库后板材全局库存={stk1}")
    # 领料领走
    iss = call("post", f"/warehouse/projects/{c['p']}/equipment/{c['eq']}/generate-issue",
               "shop1", (201,))
    row = [i for i in call("get", "/warehouse/issues", "wh1") if i["issue_no"] == iss["issue_no"]][0]
    print(f"  领料单 {row['issue_no']}：{[(l['item_no'], l['qty_required'], l['shortage']) for l in row['lines']]}")
    call("post", f"/warehouse/issues/{row['id']}/pick", "wh1", json={})
    call("post", f"/warehouse/issues/{row['id']}/hand-over", "wh1", json={"issued_to": "车间 李四"})
    stk2 = q("select coalesce(sum(qty_on_hand),0) s from stock_item where item_no=:i", i=bc)[0]["s"]
    print(f"  领走出库后板材全局库存={stk2}")
    # ★ 领料数量口径
    ln = [l for l in row["lines"] if l["item_no"] == bc]
    if ln:
        verdict("C2 领料数量应等于采购口径（5×2=10）", abs(float(ln[0]["qty_required"]) - 10.0) < 1e-6,
                f"领料单要求 {ln[0]['qty_required']}，采购口径 10 —— generate_issue 只乘直接父件一层"
                f"（原材料 5 × 组件 2 = 10 此例恰好对；三级树就会少）")
    res = gen_purchase(c["p"], c["eq"])
    after = pool_of(c["p"])
    new_c = [r for r in after.get(bc, []) if r["id"] not in {x["id"] for x in base.get(bc, [])}]
    verdict("C3 ★ 已入库+已领走后手动补跑应 0 新增", not new_c,
            f"generate-purchase={json.dumps(res, ensure_ascii=False)[:200]}\n"
            f"     新增：{[(r['id'], r['qty']) for r in new_c]}\n"
            f"     机制：需求已「已入库」∉ OPEN_STATUS（正确，它确实完成了）；"
            f"但库存已被领料出库扣掉 → cover=0 → 系统认为「从来没买过」→ 重新进池")

    # ---------------- 汇总 ----------------
    print("\n" + "=" * 78)
    bad = [r for r in RESULTS if not r["ok"]]
    print(f"隔离探针：{len(RESULTS)} 项，❌ {len(bad)} 项未通过")
    for r in RESULTS:
        print(f"  {'✅' if r['ok'] else '❌'} {r['name']}")
    with open("/tmp/txgk_iso_result.json", "w", encoding="utf-8") as f:
        json.dump(RESULTS, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
