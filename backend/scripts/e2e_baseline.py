#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""txgketo · S1→S11 端到端走查 + 采购域专项探针（只记录，不改应用代码）

Part A  全链路：S0 商机 → S1 立项 → S2 设计发布 → S3 采购（分批/不合格/换货/退货/直发）
        → S4 领料 → S5 制造 → S6 装配齐套 → S7 发运 → S8 现场 → S9 调试 → S10 验收 → S11 售后 → 回款
Part B  采购域探针：拆单 / 幂等 / 数量口径 / 直发 / 越权删除 / 齐套率 / 领料 / 库存守恒
Part C  授权探针：403 vs 400 / 跨部门裁决 / 无权限码的写接口

跑法： backend/.venv/bin/python /tmp/txgk_e2e.py
结果： /tmp/txgk_e2e_result.json
"""
from __future__ import annotations

import json
import traceback
from datetime import date, timedelta

import httpx
from sqlalchemy import create_engine, text

BASE = "http://127.0.0.1:8208/api/v1"
DBURL = "postgresql+psycopg://txgk:txgk@127.0.0.1:35432/txgk"
TODAY = date.today()


def d(n: int) -> str:
    return (TODAY + timedelta(days=n)).isoformat()


PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c6360000002000154a24f5b0000000049454e44ae426082"
)
PDF = b"%PDF-1.4 txgk e2e\n"

# --------------------------------------------------------------------------
# 记录
# --------------------------------------------------------------------------
FINDINGS: list[dict] = []   # 问题
PASS: list[str] = []        # 通过的正向断言
TRACE: list[str] = []       # 全链路足迹
CUR = {"part": "-", "probe": "-"}


def rec(ok: bool, title: str, detail: str = "", sev: str = "问题") -> bool:
    """记录一条断言结果。ok=False → 记为问题。"""
    tag = f"[{CUR['part']}|{CUR['probe']}]"
    if ok:
        PASS.append(f"{tag} {title}")
        print(f"      ✅ {title}")
    else:
        FINDINGS.append({"part": CUR["part"], "probe": CUR["probe"],
                         "severity": sev, "title": title, "detail": detail})
        print(f"      ❌ {title}")
        if detail:
            for ln in detail.strip().splitlines():
                print(f"         {ln}")
    return ok


def note(msg: str) -> None:
    TRACE.append(f"[{CUR['part']}|{CUR['probe']}] {msg}")
    print(f"      · {msg}")


def part(name: str) -> None:
    CUR["part"] = name
    print(f"\n{'='*78}\n{name}\n{'='*78}")


def probe(name: str) -> None:
    CUR["probe"] = name
    print(f"\n  --- {name} ---")


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------
class ApiError(Exception):
    def __init__(self, method, path, who, status, body):
        self.method, self.path, self.who, self.status, self.body = method, path, who, status, body
        super().__init__(f"HTTP {status} {method} {path} ({who}): {str(body)[:260]}")


class Api:
    def __init__(self):
        self.c = httpx.Client(base_url=BASE, timeout=90.0)
        self.tokens: dict[str, dict] = {}
        self.calls = 0
        self.by_status: dict[int, int] = {}
        self.failures: list[dict] = []

    def login(self, u: str) -> dict:
        if u in self.tokens:
            return self.tokens[u]
        pwd = "admin12345" if u == "admin" else "txgk@123"
        r = self.c.post("/auth/login", json={"username": u, "password": pwd})
        if r.status_code != 200:
            raise ApiError("POST", "/auth/login", u, r.status_code, r.text)
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        self.tokens[u] = h
        return h

    def raw(self, method, path, who, **kw):
        headers = dict(self.login(who))
        extra = kw.pop("headers", None)
        if extra:
            headers.update(extra)
        r = self.c.request(method, path, headers=headers, **kw)
        self.calls += 1
        self.by_status[r.status_code] = self.by_status.get(r.status_code, 0) + 1
        return r

    def req(self, method, path, who, expect=(200,), **kw):
        r = self.raw(method, path, who, **kw)
        if r.status_code not in expect:
            self.failures.append({"method": method, "path": path, "who": who,
                                  "status": r.status_code, "body": r.text[:400]})
            raise ApiError(method, path, who, r.status_code, r.text)
        if "application/json" in r.headers.get("content-type", ""):
            body = r.json()
        else:
            body = r.content
        # ★ 二期：下单即提交审批（采购经理 → 采购总监）→ 脚本自动逐级审批通过，否则后续验收/入库会被拦
        if method.lower() == "post" and "merge-order" in path and isinstance(body, dict) and body.get("po_no"):
            pno = body["po_no"]
            # 一级：采购经理（若已自动跳级会 400，忽略）；二级：采购总监
            self.raw("post", f"/purchase/orders/{pno}/approve", "purchase_manager", json={"action": "通过"})
            self.raw("post", f"/purchase/orders/{pno}/approve", "purchase_director", json={"action": "通过"})
        return body

    def try_(self, method, path, who, **kw):
        """不抛异常，返回 (status, body)。"""
        r = self.raw(method, path, who, **kw)
        try:
            status, body = r.status_code, r.json()
        except Exception:
            return r.status_code, r.text
        # ★ 二期：merge-order 后自动逐级审批通过（同 req）
        if method.lower() == "post" and "merge-order" in path and status in (200, 201) and isinstance(body, dict) and body.get("po_no"):
            pno = body["po_no"]
            self.raw("post", f"/purchase/orders/{pno}/approve", "purchase_manager", json={"action": "通过"})
            self.raw("post", f"/purchase/orders/{pno}/approve", "purchase_director", json={"action": "通过"})
        return status, body


api = Api()
USERS: dict[str, int] = {}
LIB: dict[str, dict] = {}
SUP: dict[str, dict] = {}

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


def q(sql: str, **kw):
    e = create_engine(DBURL)
    with e.connect() as c:
        return [dict(r._mapping) for r in c.execute(text(sql), kw)]


def reset() -> None:
    e = create_engine(DBURL)
    with e.begin() as c:
        c.execute(text(f'TRUNCATE TABLE {", ".join(BUSINESS_TABLES)} RESTART IDENTITY CASCADE'))
        c.execute(text("DELETE FROM item"))
    print("🧹 业务数据已清空")


def setup_users() -> None:
    for r in q("select id, username from app_user where is_active"):
        USERS[r["username"]] = r["id"]
    print(f"账号 {len(USERS)} 个")


LIB_SEED = [
    ("ZCT", {"brand": "NSK", "model": "6204DDU"}, "个"),
    ("FT", {"material": "Q235", "w": "40", "h": "40", "t": "2.0", "len": "6000"}, "米"),
    ("BC", {"material": "Q235", "t": "2.0", "size": "1220x2440"}, "张"),
    ("DJ", {"brand": "台达", "model": "ECMA-C21310", "power": "1kW", "voltage": "220V"}, "台"),
    ("PLC", {"brand": "汇川", "series": "AM401", "model": "AM401-CPU1602", "io": "32点"}, "套"),
]


def setup_library() -> None:
    for cls, spec, unit in LIB_SEED:
        api.req("post", "/library/items", "admin", (201,),
                json={"std_class_code": cls, "spec": spec, "unit": unit})
    for key, kw in [("zct", "轴承"), ("ft", "方通"), ("bc", "板材"), ("dj", "电机"), ("plc", "PLC")]:
        rows = api.req("get", "/library/items", "admin", params={"q": kw})
        LIB[key] = rows[0]
    note("标准库：" + ", ".join(f"{k}={v['item_no']}" for k, v in LIB.items()))


def setup_suppliers() -> None:
    for name, kind in [("甲钢材", "原材料"), ("乙标准件", "标准件"), ("丙钣金", "机加工"), ("丁外协", "外协")]:
        got = api.req("get", "/suppliers", "buyer1", params={"q": name})
        if got:
            SUP[name] = got[0]
        else:
            SUP[name] = api.req("post", "/suppliers", "buyer1", (201,), json={
                "name": name, "kind": kind, "contact_name": "联系人", "phone": "13800000000",
                "payment_terms": "月结30天", "tax_rate": 13.0})
    # 供应商品类声明（推荐供应商用）
    for sup in ("甲钢材", "乙标准件"):
        for cls in ("FT", "BC", "ZCT"):
            api.try_("post", f"/suppliers/{SUP[sup]['id']}/catalog", "buyer1",
                     json={"supplier_id": SUP[sup]["id"], "std_class_code": cls,
                           "price": 10.0, "lead_days": 10})
    note("供应商：" + ", ".join(SUP))


def setup_locations() -> None:
    api.try_("post", "/warehouse/locations", "wh1",
             json={"warehouse": "深圳仓", "code": "A-01-01", "name": "主库位"})
    locs = api.req("get", "/warehouse/locations", "wh1")
    rec(len(locs) >= 1, "库位已就绪", f"实际 {len(locs)} 个")


# ==========================================================================
# Part A · 全链路 S0 → S11
# ==========================================================================
CTX: dict = {}


def a_s0() -> None:
    probe("S0 商机 + 成交")
    body = {
        "sales_id": USERS["sales1"], "customer_name": "审计客户A",
        "project_name": "E2E审计-整线", "project_desc": "端到端审计用整线项目",
        "deadline": d(30), "delivery_days": 120, "deal_mode": "直签",
        "site_address": "深圳市宝安区客户厂区",
        "contacts": [{"name": "王工", "phone": "13800001111", "role_tag": "技术对接人"}],
        "est_amount": 3_000_000,
    }
    p = api.req("post", "/projects", "sales1", (201,), json=body)
    CTX["p"] = p["project_no"]
    rec(CTX["p"].startswith("TX"), f"商机号发号 {CTX['p']}")
    api.req("post", f"/projects/{CTX['p']}/attachments", "sales1", (201,),
            data={"category": "技术协议"}, files={"file": ("ta.pdf", PDF, "application/pdf")})
    api.req("post", f"/projects/{CTX['p']}/deal", "sales1", json={
        "period_start": d(0), "period_end": d(120), "amount": 3_000_000,
        "warranty_months": 12, "warranty_amount": 300_000, "tech_agreement_frozen": True,
        "acceptance_standard": "节拍25s，良率≥98%，连续运行72h",
        "payment_terms": [{"node_name": n, "percent": pc, "amount": int(3_000_000 * pc / 100)}
                          for n, pc in [("预付款", 30), ("发货款", 30), ("验收款", 30), ("质保金", 10)]],
    })
    got = api.req("get", f"/projects/{CTX['p']}", "sales1")
    rec(got["stage"] == "成交待立项", f"成交后阶段={got['stage']}", "应为「成交待立项」")
    note(f"{CTX['p']} 成交 ¥3,000,000 / 质保12月 / 4 付款节点")


def a_s1() -> None:
    probe("S1 立项")
    p = CTX["p"]
    for u, role in [("pm1", "项目经理"), ("mech_manager", "机械负责人"), ("elec_manager", "电气负责人"),
                    ("prog_manager", "程序负责人"), ("craft_manager", "工艺负责人"), ("buyer1", "采购负责人"),
                    ("shop1", "生产负责人"), ("assy1", "装配负责人"), ("site1", "现场负责人"),
                    ("service1", "售后负责人")]:
        api.req("post", f"/projects/{p}/members", "pm1", (201,),
                json={"user_id": USERS[u], "project_role": role})
    e = api.req("post", f"/projects/{p}/equipment", "pm1", (201,),
                json={"equip_name": "贴胶机", "kind": "单机"})
    CTX["eq"] = e["equip_no"]
    api.req("post", f"/projects/{p}/milestones/generate", "pm1")
    # 长周期件：立项即下单
    api.req("post", f"/projects/{p}/purchase-requests", "pm1", (201,), json={
        "item_no": LIB["plc"]["item_no"], "qty": 2, "lead_days": 60, "need_date": d(90),
        "ordered_at": d(0), "expected_date": d(60), "supplier_name": "华信传动",
        "unit_price": 18000, "equip_no": CTX["eq"], "is_long_lead": True})
    api.req("post", f"/projects/{p}/generate-tasks", "pm1",
            json={"professions": ["机械", "电气", "程序", "工艺"], "with_purchase": True})
    api.req("post", f"/projects/{p}/initiate", "pm1")
    got = api.req("get", f"/projects/{p}", "pm1")
    rec(got["stage"] == "执行中", f"立项后阶段={got['stage']}", "应为「执行中」")
    # ★ pm_id 必须与项目角色同步（AGENTS §8.1）
    rec(got.get("pm_id") == USERS["pm1"],
        f"project.pm_id 与项目角色「项目经理」同步（pm_id={got.get('pm_id')}）",
        "不同步会导致所有「通知项目经理」分支静默丢失")
    ms = api.req("get", f"/projects/{p}/milestones", "pm1")
    ms = ms if isinstance(ms, list) else ms.get("items", [])
    rec(all(m.get("plan_start") and m.get("plan_end") for m in ms),
        f"标准节点 {len(ms)} 个都带默认起止")
    note(f"设备 {CTX['eq']}，团队 10 人，节点 {len(ms)}，长周期件 1（PLC×2 已下单）")


def _my_task(equip: str, prof_name: str, who: str) -> int:
    tasks = api.req("get", f"/projects/{CTX['p']}/equipment/{equip}/my-design-tasks", who)
    for t in tasks:
        if t["profession"] == prof_name:
            return t["task_id"]
    raise ApiError("GET", "my-design-tasks", who, 0, f"找不到 {equip}/{prof_name}")


def _review_pass(tid: int, who_submit: str) -> dict:
    """经理提交 → 总监通过（经理本人提交自动跳级）。"""
    tk = api.req("get", f"/tasks/{tid}/review-ticket", "eng_director")
    api.req("post", f"/review-tickets/{tk['id']}/review", "eng_director",
            json={"action": "通过", "note": "OK"})
    tk2 = api.req("get", f"/tasks/{tid}/review-ticket", who_submit)
    return tk2


def a_s2() -> None:
    """★ 刻意构造 qty>1 的多级树，用于验证数量口径。

    总装(qty=1)
      └─ body 主体组件   qty=2  自制件
           ├─ cust 定制底板 qty=3  → 判为【定制件】  真实需求 = 3×2×1 = 6
           ├─ out  外协罩壳 qty=1  → 判为【外协件】  真实需求 = 1×2×1 = 2（直发现场）
           ├─ BOM标准件 轴承 qty=4                   真实需求 = 4×2   = 8
           └─ BOM原材料 方通 qty=5                   真实需求 = 5×2   = 10
    """
    probe("S2 工程设计（多级树 qty>1）")
    p, eq = CTX["p"], CTX["eq"]
    root = api.req("get", f"/projects/{p}/equipment/{eq}/design", "mech_manager")["root"]["drawing_no"]
    CTX["root"] = root

    body = api.req("post", f"/projects/{p}/equipment/{eq}/drawings", "mech_manager", (201,),
                   json={"title": "主体组件", "source_type": "自制件", "qty": 2})
    cust = api.req("post", f"/projects/{p}/equipment/{eq}/drawings", "mech_manager", (201,),
                   json={"title": "定制底板", "source_type": "自制件", "qty": 3,
                         "parent_drawing_no": body["drawing_no"]})
    out = api.req("post", f"/projects/{p}/equipment/{eq}/drawings", "mech_manager", (201,),
                  json={"title": "外协罩壳", "source_type": "自制件", "qty": 1,
                        "parent_drawing_no": body["drawing_no"]})
    CTX["body"], CTX["cust"], CTX["out"] = body["drawing_no"], cust["drawing_no"], out["drawing_no"]
    for no in (root, CTX["body"], CTX["cust"], CTX["out"]):
        api.req("post", f"/drawings/{no}/draft", "mech_manager", (200,),
                data={"change_reason": "初稿"}, files={"file": ("d.pdf", PDF, "application/pdf")})
    # ★ 累计倍数自检：cust 应为 3×2=6
    note(f"图号 body={CTX['body']} cust={CTX['cust']} out={CTX['out']}")

    bstd = api.req("post", f"/projects/{p}/bom/std", "mech_manager", (201,),
                   json={"parent_ref": CTX["body"], "child_item_no": LIB["zct"]["item_no"], "qty": 4})
    bmat = api.req("post", f"/projects/{p}/bom/material", "craft_manager", (201,),
                  json={"parent_ref": CTX["body"], "child_item_no": LIB["ft"]["item_no"], "qty": 5})
    CTX["bstd"], CTX["bmat"] = bstd["id"], bmat["id"]

    pg = api.req("post", f"/projects/{p}/equipment/{eq}/programs", "prog_manager", (201,),
                 json={"name": f"{p}-{eq} 主控程序"})
    api.req("post", f"/programs/{pg['id']}/draft", "prog_manager", (200,),
            data={"change_reason": "初稿"}, files={"file": ("m.st", b"LD M0\nEND\n", "text/plain")})

    # 机械评审：总装 + 树 + 设计BOM
    t = _my_task(eq, "机械", "mech_manager")
    api.req("post", f"/tasks/{t}/submit-review", "mech_manager", (201,), json={
        "items": [{"item_type": "DRAWING", "item_ref": x} for x in (root, CTX["body"], CTX["cust"], CTX["out"])]
                 + [{"item_type": "BOM_DESIGN", "item_ref": str(CTX["bstd"])}],
        "note": "机械首版"})
    tk = _review_pass(t, "mech_manager")
    rec(tk["status"] == "已发布", f"机械评审发布 status={tk['status']}", "总监通过后应为「已发布」")

    # 工艺评审：材料 BOM + 自制→定制/外协 改判
    tc = _my_task(eq, "工艺", "craft_manager")
    api.req("post", f"/tasks/{tc}/submit-review", "craft_manager", (201,), json={
        "items": [{"item_type": "BOM_MATERIAL", "item_ref": str(CTX["bmat"])},
                  {"item_type": "SOURCE_TAG", "item_ref": CTX["cust"], "source_type": "定制件"},
                  {"item_type": "SOURCE_TAG", "item_ref": CTX["out"], "source_type": "外协件"}],
        "note": "材料+改判"})
    tk2 = _review_pass(tc, "craft_manager")
    rec(tk2["status"] == "已发布", f"工艺评审发布 status={tk2['status']}")

    tp = _my_task(eq, "程序", "prog_manager")
    api.req("post", f"/tasks/{tp}/submit-review", "prog_manager", (201,), json={
        "items": [{"item_type": "PROGRAM", "item_ref": str(pg["id"])}], "note": "程序首版"})
    _review_pass(tp, "prog_manager")

    # 采购池核对（★ 记录发布通道算出来的数量，作为口径基准）
    pool = api.req("get", "/purchase/pool", "buyer1")
    mine = {}
    for g in pool:
        for r in g["requests"]:
            if r["project_no"] == p:
                mine.setdefault(g["item_no"], []).append(r)
    CTX["pool_after_release"] = {k: sum(float(x["qty"] or 0) for x in v) for k, v in mine.items()}
    note(f"发布后采购池：{CTX['pool_after_release']}")
    EXP = {CTX["cust"]: 6.0, CTX["out"]: 2.0, LIB["zct"]["item_no"]: 8.0, LIB["ft"]["item_no"]: 10.0}
    for item, want in EXP.items():
        got = CTX["pool_after_release"].get(item, 0.0)
        rec(abs(got - want) < 1e-6,
            f"【发布通道】{item} 进池数量 = {got}（期望 {want}）",
            f"发布通道 release_demand 算出 {got}，按图纸树连乘应为 {want}")
    CTX["exp"] = EXP


def _inspect_store(r: dict, qty: float, result: str = "合格", reason: str | None = None, do_store: bool = True):
    res = api.req("post", f"/projects/{CTX['p']}/purchase-requests/{r['id']}/inspect", "wh1",
                  json={"qty": qty, "result": result, "receipt_date": d(0), "note": reason})
    if do_store and res.get("receipt_status") == "待入库":
        api.req("post", f"/goods-receipts/{res['receipt_id']}/store", "wh1",
                json={"location": "深圳仓 A-01-01"})
    return res


def _reqs(status=None):
    out = api.req("get", f"/projects/{CTX['p']}/purchase-requests", "buyer1")
    return [r for r in out if status is None or r["status"] == status]


def _find(item_no, status=None):
    for r in _reqs(status):
        if r["item_no"] == item_no:
            return r
    return None


def a_s3() -> None:
    probe("S3 采购：分批到货 / 不合格换货 / 退货重采 / 直发现场")
    p = CTX["p"]
    pending = _reqs("待采购")
    direct_items = {CTX["out"]}                       # 外协罩壳直发现场
    wh = [r for r in pending if r["item_no"] not in direct_items]
    dr = [r for r in pending if r["item_no"] in direct_items]

    if wh:
        mo = api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
            "supplier_id": SUP["乙标准件"]["id"], "ordered_at": d(0), "expected_date": d(15),
            "deliver_to": "公司仓库",
            "lines": [{"request_id": r["id"], "tax_incl": True, "unit_price": 100.0} for r in wh]})
        CTX["po_wh"] = mo["po_no"]
        note(f"仓库单 {mo['po_no']}：{mo['count']} 行 ¥{mo['total']}")
    if dr:
        mo2 = api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
            "supplier_id": SUP["丙钣金"]["id"], "ordered_at": d(0), "expected_date": d(12),
            "deliver_to": "直发客户现场", "deliver_address": "深圳市宝安区客户厂区",
            "lines": [{"request_id": r["id"], "tax_incl": True, "unit_price": 500.0} for r in dr]})
        CTX["po_direct"] = mo2["po_no"]
        note(f"直发单 {mo2['po_no']}：{mo2['count']} 行")
        # ★ R2-01：下单即建「现场待验收」到货单
        grs = api.req("get", "/goods-receipts", "wh1", params={"status": "现场待验收"})
        mine = [g for g in grs if g.get("project_no") == p]
        rec(len(mine) == len(dr), f"直发下单即建「现场待验收」到货单 {len(mine)} 张（应 {len(dr)}）")

    # 分批到货：轴承 8 → 先 5 后 3
    r = _find(LIB["zct"]["item_no"], "在途")
    if r:
        _inspect_store(r, 5)
        st = _find(LIB["zct"]["item_no"])["status"]
        rec(st == "部分到货", f"分批首到 5/8 后状态={st}", "应为「部分到货」")
        r2 = _find(LIB["zct"]["item_no"])
        _inspect_store(r2, float(r2["qty"]) - 5)
        st2 = _find(LIB["zct"]["item_no"])["status"]
        rec(st2 == "已入库", f"补齐后状态={st2}", "应为「已入库」")
        note(f"分批到货：轴承 5+3 = 8，终态 {st2}")

    # 超额验收硬拦（正向）
    r = _find(LIB["ft"]["item_no"], "在途")
    if r:
        need = float(r["qty"])
        sc, bd = api.try_("post", f"/projects/{p}/purchase-requests/{r['id']}/inspect", "wh1",
                          json={"qty": need + 100, "result": "合格", "receipt_date": d(0)})
        rec(sc == 400, f"超额验收被硬拦（{need}+100 → HTTP {sc}）", "产品决策#3 要求 400")
        _inspect_store(r, need)

    # 定制底板：验收不合格 → 换货 → 重验入库
    r = _find(CTX["cust"], "在途")
    if r:
        res = _inspect_store(r, float(r["qty"]), "不合格", "底板厚度不符")
        rec(res["receipt_status"] == "不合格", f"不合格验收 → 到货单={res['receipt_status']}")
        rr = _find(CTX["cust"])
        rec(rr["status"] == "不合格", f"不合格 → 需求状态={rr['status']}")
        sc, bd = api.try_("post", f"/purchase/orders/{rr['po_no']}/negotiate", "buyer1",
                          json={"request_ids": [rr["id"]], "action": "换货",
                                "expected_date": d(10), "note": "退回补发"})
        rec(sc == 200, f"协商换货 HTTP {sc}", str(bd)[:200])
        rr2 = _find(CTX["cust"])
        note(f"换货后需求状态={rr2['status']}")
        if rr2["status"] in ("在途", "不合格", "部分到货"):
            _inspect_store(rr2, float(rr2["qty"]))
        rr3 = _find(CTX["cust"])
        rec(rr3["status"] == "已入库", f"换货重验入库后状态={rr3['status']}", "应为「已入库」")

    # 板材（原材料里另加一条做退货重采）—— 用方通已入库，改用长周期 PLC 之外新增需求验证
    # 其余全部收货
    for r in _reqs():
        if r["status"] in ("已入库", "现场已验收", "现场待验收", "已退货", "已取消", "不合格"):
            continue
        if not r.get("qty"):
            continue
        _inspect_store(r, float(r["qty"]), do_store=(r["item_no"] not in direct_items))
    direct_left = [r for r in _reqs() if r["item_no"] in direct_items and r["status"] == "在途"]
    note(f"直发件仍「在途」{len(direct_left)} 条 —— 符合 AGENTS §8.1（货在供应商→现场路上，"
         f"现场清点后才转「现场已验收」）")
    left = [(r["item_no"], r["status"]) for r in _reqs()
            if r["status"] not in ("已入库", "现场已验收", "现场待验收", "已退货", "已取消")
            and r["item_no"] not in direct_items]
    rec(not left, f"非直发需求全部到位（残留 {left}）")
    note("收货完成：" + str(sorted({r["status"] for r in _reqs()})))


def a_s4() -> None:
    probe("S4 领料")
    p, eq = CTX["p"], CTX["eq"]
    res = api.req("post", f"/warehouse/projects/{p}/equipment/{eq}/generate-issue", "shop1", (201,))
    iss = [i for i in api.req("get", "/warehouse/issues", "wh1") if i["issue_no"] == res["issue_no"]][0]
    CTX["issue"] = iss
    note(f"领料单 {iss['issue_no']}：{len(iss['lines'])} 行，缺料 {res.get('shortage_count')} 种")
    for ln in iss["lines"]:
        note(f"   行 {ln['item_no']} 需 {ln['qty_required']} 实发 {ln['qty_issued']} "
             f"库位={ln.get('location_name')} 缺料={ln['shortage']}")
    api.req("post", f"/warehouse/issues/{iss['id']}/pick", "wh1", json={})
    api.req("post", f"/warehouse/issues/{iss['id']}/hand-over", "wh1", json={"issued_to": "车间 李四"})
    cur = [i for i in api.req("get", "/warehouse/issues", "wh1") if i["id"] == iss["id"]][0]
    rec(cur["status"] == "已领走", f"领料后状态={cur['status']}")
    # ★ 领走后 qty_issued 是否等于 qty_required（缺料行会被静默跳过）
    for a, b in zip(cur["lines"], iss["lines"]):
        if b["shortage"] or not b.get("location_name"):
            rec(a["qty_issued"] > 0,
                f"缺料行 {a['item_no']} 领走后 qty_issued={a['qty_issued']}（需 {a['qty_required']}）",
                "缺料行 location_id=None → hand_over 里被 continue 静默跳过，"
                "但整单仍置「已领走」、审计日志按 len(lines) 报数")


def a_s5() -> None:
    probe("S5 制造")
    p, eq = CTX["p"], CTX["eq"]
    ph = [x["token"] for x in api.req(
        "post", "/manufacturing/photos", "shop1", (200, 201), params={"project_no": p, "ref": eq},
        files=[("files", ("a.png", PNG, "image/png"))])]
    g = api.req("post", f"/manufacturing/projects/{p}/equipment/{eq}/generate-orders", "shop1",
                (200, 201), json={"plan_days": 2})
    note(f"生成排产：{json.dumps(g, ensure_ascii=False)[:200]}")
    orders = api.req("get", "/manufacturing/orders", "shop1", params={"project_no": p})
    CTX["prod"] = orders
    rec(len(orders) >= 1, f"排产单 {len(orders)} 张")
    # ★ 总装图不应被排产
    roots = [o for o in orders if o["item_no"] == CTX["root"]]
    rec(not roots, f"总装图未被排产（命中 {len(roots)} 张）", "AGENTS §8.2 修复①")
    # ★ 数量口径应与图纸树连乘一致（body qty=2 → 排产 2）
    for o in orders:
        note(f"   排产 {o['item_no']} × {o['qty']} status={o['status']}")
    body_o = [o for o in orders if o["item_no"] == CTX["body"]]
    if body_o:
        rec(abs(float(body_o[0]["qty"]) - 2.0) < 1e-6,
            f"【排产通道】body(qty=2) 排产数量={body_o[0]['qty']}（期望 2）")
    for o in orders:
        api.req("post", f"/manufacturing/orders/{o['id']}/dispatch", "shop1",
                json={"step_name": "下料", "photos": ph})
        api.req("post", f"/manufacturing/orders/{o['id']}/start", "shop1", json={})
        api.req("post", f"/manufacturing/orders/{o['id']}/accept", "qc1",
                json={"result": "合格", "photos": ph})
        api.req("post", f"/manufacturing/orders/{o['id']}/transfer", "shop1", json={"photos": ph})
    orders2 = api.req("get", "/manufacturing/orders", "shop1", params={"project_no": p})
    rec(all(o["status"] == "已转运" for o in orders2),
        f"排产全部转运（{sorted({o['status'] for o in orders2})}）")
    # 外协
    outs = api.req("get", "/manufacturing/outsource", "shop1", params={"project_no": p})
    note(f"外协任务 {len(outs)} 条")
    for o in outs:
        api.try_("post", f"/manufacturing/outsource/{o['id']}/send", "shop1",
                 json={"supplier_id": SUP["丁外协"]["id"], "due_date": d(10)})
        api.try_("post", f"/manufacturing/outsource/{o['id']}/return", "shop1", json={})
        api.try_("post", f"/manufacturing/outsource/{o['id']}/accept", "qc1",
                 json={"result": "合格", "photos": ph})
    CTX["ph"] = ph


def a_s6() -> None:
    probe("S6 装配与齐套率")
    p, eq = CTX["p"], CTX["eq"]
    k = api.req("get", "/assembly/kitting", "assy1", params={"project_no": p, "equip_no": eq})
    CTX["kit"] = k
    note(f"齐套率 rate={k.get('kitting_rate')} arrived={k.get('arrived')}/{k.get('total')} "
         f"qty {k.get('arrived_qty')}/{k.get('total_qty')}")
    for ln in k.get("lines", []):
        note(f"   {ln['ref']} [{ln['kind']}/{ln['source']}] need={ln['qty']} ready={ln['ready']} {ln['state']}")
    # ★ 数量口径核对：齐套率的 qty 应等于采购/排产口径（图纸树连乘）
    EXP = dict(CTX["exp"])
    for ln in k.get("lines", []):
        if ln["ref"] in EXP:
            rec(abs(float(ln["qty"]) - EXP[ln["ref"]]) < 1e-6,
                f"【齐套通道】{ln['ref']} need={ln['qty']}（采购口径期望 {EXP[ln['ref']]}）",
                "kitting.compute 用 `_qty(d.qty) or 1`，不乘父级累计倍数；"
                "而 manufacturing 用 _cumulative_qty、bom_demand BOM行用 cum[parent]")
    r = api.req("post", "/assembly/records", "assy1", (200, 201),
                json={"project_no": p, "equip_no": eq, "sub_assembly": "整机装配", "photos": CTX["ph"]})
    api.req("post", f"/assembly/records/{r['id']}/finish", "assy1", json={})
    api.req("post", f"/assembly/records/{r['id']}/debug", "assy1",
            json={"result": "合格", "note": "厂内调试OK", "photos": CTX["ph"]})
    recs = api.req("get", "/assembly/records", "assy1", params={"project_no": p})
    rec(any(x["status"] == "调试完成" for x in recs), f"装配调试完成（{[x['status'] for x in recs]}）")


def a_s7() -> None:
    probe("S7 发运")
    p, eq = CTX["p"], CTX["eq"]
    ts = api.req("get", "/shipping/to-ship", "pm1", params={"project_no": p})
    rec(len(ts) >= 1, f"待发设备 {len(ts)} 台")
    sh = api.req("post", "/shipping/instructions", "pm1", (200, 201),
                 json={"project_no": p, "equip_nos": [eq]})
    sid = sh["id"] if isinstance(sh, dict) and "id" in sh else sh
    CTX["ship_id"] = sid
    api.req("post", f"/shipping/{sid}/items/generate", "pm1", (200, 201))
    items = api.req("get", f"/shipping/{sid}/items", "pm1")
    note(f"发运清单 {len(items)} 项")
    # ★ 0 项已发不能装车（R5-01）
    sc, bd = api.try_("post", f"/shipping/{sid}/load", "pm1",
                      json={"vehicle": "平板车", "driver": "张三", "plate_no": "粤B12345",
                            "photos": CTX["ph"]})
    rec(sc == 400, f"0 项已发时装车被拦（HTTP {sc}）", "AGENTS §8.1 R5-01")
    ids = [i["id"] for i in items]
    api.req("post", "/shipping/items/ship", "pm1", json={"item_ids": ids, "photos": CTX["ph"]})
    api.req("post", f"/shipping/{sid}/load", "pm1",
            json={"vehicle": "平板车", "driver": "张三", "plate_no": "粤B12345", "photos": CTX["ph"]})
    # ★ depart 只接受「已装车」
    api.req("post", f"/shipping/{sid}/depart", "pm1", json={})
    api.req("post", f"/shipping/{sid}/arrive", "pm1", json={})
    det = api.req("get", f"/shipping/{sid}", "pm1")
    rec(det["status"] == "已到货", f"发运终态={det['status']}")
    note(f"发运 {det['shipment_no']} → {det['status']}")


def a_s8_s9() -> None:
    probe("S8 现场安装 + S9 调试")
    p = CTX["p"]
    api.req("post", "/site/survey", "site1", (200, 201), json={
        "project_no": p, "contact": "甲方 李工 13900000000", "floor_load": "3T/㎡",
        "passage": "通道 4m", "power": "380V 200A", "air": "0.6MPa", "network": "千兆",
        "enter_date": d(1), "photos": CTX["ph"]})
    # 直发件现场清点
    inc = api.req("get", "/site/incoming", "site1", params={"project_no": p})
    pend = inc.get("pending", []) if isinstance(inc, dict) else []
    note(f"待现场清点直发件 {len(pend)} 条；已验收 {len(inc.get('done', []))} 条")
    for g in pend:
        api.try_("post", f"/site/incoming/{g['receipt_id']}/accept", "site1",
                 json={"result": "齐", "photos": CTX["ph"]})
    after = [r for r in _reqs() if r["item_no"] == CTX["out"]]
    if after:
        rec(after[0]["status"] == "现场已验收",
            f"直发件现场清点后需求状态={after[0]['status']}", "应为「现场已验收」")
    # 发运批次现场逐项清点
    items = api.req("get", f"/shipping/{CTX['ship_id']}/items", "site1")
    shipped = [i for i in items if i.get("shipped")]
    sc, bd = api.try_("post", f"/shipping/{CTX['ship_id']}/receipt", "site1", json={
        "checks": [{"item_id": i["id"], "result": "到", "received_qty": float(i["qty"])}
                   for i in shipped[:-1]], "photos": CTX["ph"]})
    rec(sc == 400, f"漏项清点被拦（HTTP {sc}）", "S7 重构要求漏项 400")
    api.req("post", f"/shipping/{CTX['ship_id']}/receipt", "site1", json={
        "checks": [{"item_id": i["id"], "result": "到", "received_qty": float(i["qty"])}
                   for i in shipped], "photos": CTX["ph"]})
    for stage_ in ("安装", "单机调试", "联调"):
        api.req("post", "/site/daily", "site1", (200, 201), json={
            "project_no": p, "equip_no": CTX["eq"], "report_date": d(0), "stage": stage_,
            "done_items": [f"{stage_}完成项1"], "photos": CTX["ph"], "people": 4})
    # 每日汇报必须带照片（正向）
    sc, bd = api.try_("post", "/site/daily", "site1", json={
        "project_no": p, "report_date": d(0), "stage": "安装", "done_items": ["x"]})
    rec(sc in (400, 422), f"每日汇报无照片被拦（HTTP {sc}）", "AGENTS §8.2 必填项治理")
    c = api.req("post", "/site/commission", "site1", (200, 201),
                json={"project_no": p, "dispatch_to": "调试工程师 王五", "plan_date": d(2)})
    cid = c["id"] if isinstance(c, dict) else c
    api.req("post", f"/site/commission/{cid}/arrive", "site1", json={})
    api.req("post", f"/site/commission/{cid}/start", "site1", json={})
    api.req("post", f"/site/commission/{cid}/finish", "site1", json={"note": "联调通过"})
    got = api.req("get", "/site/workbench", "site1")
    note(f"现场台：{json.dumps(got, ensure_ascii=False)[:180]}")


def a_s10() -> None:
    probe("S10 客户验收 → 自动质保")
    p = CTX["p"]
    a = api.req("post", "/acceptance/apply", "pm1", (200, 201), json={"project_no": p})
    aid = a["id"] if isinstance(a, dict) else a
    for dt in ("技术协议", "图纸清单", "检验报告", "操作手册"):
        api.req("post", f"/acceptance/{aid}/documents", "pm1", (200, 201),
                data={"doc_type": dt}, files=[("files", (f"{dt}.pdf", PDF, "application/pdf"))])
    api.req("post", f"/acceptance/{aid}/confirm", "pm1", json={
        "result": "通过", "signed_by": "客户 赵经理", "accepted_at": d(0)})
    got = api.req("get", f"/projects/{p}", "pm1")
    rec(got["stage"] == "质保", f"验收通过 → 项目阶段={got['stage']}", "应为「质保」")
    rec(bool(got.get("warranty_start")) and bool(got.get("warranty_end")),
        f"质保期自动写入 {got.get('warranty_start')} ~ {got.get('warranty_end')}")
    CTX["acc_id"] = aid


def a_s11() -> None:
    probe("S11 售后 + 回款")
    p = CTX["p"]
    so = api.req("post", "/service/orders", "service1", (200, 201), json={
        "project_no": p, "equip_no": CTX["eq"], "fault": "贴胶头气压不稳"})
    soid = so["id"] if isinstance(so, dict) else so
    got = api.req("get", "/service/orders", "service1", params={"project_no": p})
    row = [x for x in got if x["id"] == soid][0]
    rec(row.get("in_warranty") is True, f"报修自动判定在保 in_warranty={row.get('in_warranty')}")
    for act, body in [("dispatch", {"dispatched_to": "售后 孙七"}), ("arrive", {}),
                      ("fix", {"solution": "更换调压阀", "labor_hours": 2.5, "photos": CTX["ph"]}),
                      ("sign", {"customer_sign": "客户 赵经理"})]:
        api.try_("post", f"/service/orders/{soid}/{act}", "service1", json=body)
    got2 = [x for x in api.req("get", "/service/orders", "service1", params={"project_no": p})
            if x["id"] == soid][0]
    rec(got2["status"] == "已关闭", f"工单终态={got2['status']}")
    # 备件
    sp = api.try_("post", "/service/parts", "service1", json={
        "project_no": p, "equip_no": CTX["eq"], "item_no": LIB["zct"]["item_no"],
        "item_name": "轴承", "qty_stock": 10, "qty_installed": 4, "min_qty": 3})
    if sp[0] in (200, 201) and isinstance(sp[1], dict):
        api.try_("post", "/service/parts/move", "service1", json={
            "part_id": sp[1]["id"], "move_type": "领出", "qty": 2,
            "service_order_id": soid, "issued_to": "售后 孙七"})
        note("备件建账 + 领出 2")
    # 回款
    det = api.req("get", f"/projects/{p}/detail", "pm1")
    terms = det.get("payment_terms", [])
    for t in terms[:3]:
        api.try_("post", f"/projects/{p}/payment-terms/{t['seq']}/receive", "fin1",
                 data={"received_amount": str(float(t["amount"] or 0)), "received_date": d(0)})
    # ★ 超额回款应被拦（接口是 Form 参数，字段名 received_amount）
    last = terms[-1]
    sc, bd = api.try_("post", f"/projects/{p}/payment-terms/{last['seq']}/receive", "fin1",
                      data={"received_amount": str(float(last["amount"] or 0) * 5),
                            "received_date": d(0)})
    rec(sc == 400, f"超额回款被拦（HTTP {sc}）", f"返回：{str(bd)[:200]}")
    sc2, _ = api.try_("post", f"/projects/{p}/payment-terms/{last['seq']}/receive", "fin1",
                      data={"received_amount": str(float(last["amount"] or 0)), "received_date": d(0)})
    rec(sc2 == 200, f"正常额度回款成功（HTTP {sc2}）")
    det2 = api.req("get", f"/projects/{p}/detail", "pm1")
    recv = sum(float(t.get("received_amount") or 0) for t in det2.get("payment_terms", []))
    note(f"回款累计 ¥{recv:,.0f}")


# ==========================================================================
# Part B · 采购域专项探针
# ==========================================================================
def b_split() -> None:
    """B1 拆单：一条需求拆给两家供应商（客户口径 #1：很有可能会拆）。"""
    probe("B1 拆单给多家供应商（客户口径#1）")
    p = CTX["p"]
    # 新建一条干净需求：板材 100
    rid = _new_demand("bc", 100)["id"]
    note(f"新建需求 #{rid}：板材 × 100（待采购）")
    before = _find_by_id(rid)
    rec(abs(float(before["qty"]) - 100) < 1e-9, f"下单前需求 qty={before['qty']}")

    # 第一张单：给甲钢材 60
    sc1, bd1 = api.try_("post", "/purchase/merge-order", "buyer1", json={
        "supplier_id": SUP["甲钢材"]["id"], "ordered_at": d(0), "expected_date": d(15),
        "deliver_to": "公司仓库",
        "lines": [{"request_id": rid, "tax_incl": True, "qty": 60, "unit_price": 200.0}]})
    if isinstance(bd1, dict) and bd1.get("po_no"):
        api.try_("post", f"/purchase/orders/{bd1['po_no']}/approve", "purchase_director",
                json={"action": "通过"})
    rec(sc1 in (200, 201), f"第一张单（甲钢材 60）HTTP {sc1}", str(bd1)[:200])
    mid = _find_by_id(rid)
    note(f"第一张单后：qty={mid['qty']} status={mid['status']} po_no={mid.get('po_no')}")
    rec(abs(float(mid["qty"]) - 100) < 1e-9,
        f"★ 拆单后需求 qty 仍应为 100，实际={mid['qty']}",
        "merge_order 里 `if ln.qty: row.qty = ln.qty` 直接覆盖需求数量 → 原需求 100 被改成 60，"
        "剩下 40 个在系统里蒸发")

    # 第二张单：给乙标准件 40
    sc2, bd2 = api.try_("post", "/purchase/merge-order", "buyer1", json={
        "supplier_id": SUP["乙标准件"]["id"], "ordered_at": d(0), "expected_date": d(15),
        "deliver_to": "公司仓库",
        "lines": [{"request_id": rid, "tax_incl": True, "qty": 40, "unit_price": 210.0}]})
    if isinstance(bd2, dict) and bd2.get("po_no"):
        api.try_("post", f"/purchase/orders/{bd2['po_no']}/approve", "purchase_director",
                json={"action": "通过"})
    rec(sc2 in (200, 201),
        f"★ 第二张单（乙标准件 40）HTTP {sc2} —— 拆单给第二家供应商",
        f"返回：{str(bd2)[:260]}\n预期：应能成功（客户口径#1「很有可能会拆给多个供应商」）")
    after = _find_by_id(rid)
    note(f"最终：qty={after['qty']} status={after['status']} po_no={after.get('po_no')}")
    n_pos = q("select count(distinct po_id) as c from purchase_order_line where request_id=:i", i=rid)[0]["c"]
    rec(n_pos >= 2, f"一条需求应能落在 ≥2 张采购单上，实际={n_pos} 张",
        "★ 一期已修：purchase_order_line 支持一条需求拆多单；旧模型 purchase_request.po_no 单值做不到")
    CTX["split_rid"] = rid


def b_partial_ok() -> None:
    """B3 部分合格（08 §2 洞②）：一批 100 = 合格 80 + 不合格 20 → 两条到货单（同 batch_no）。"""
    probe("B3 部分合格（一批拆合格/不合格）")
    p = CTX["p"]
    rid = _new_demand("bc", 100)["id"]
    mo = api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
        "supplier_id": SUP["甲钢材"]["id"], "ordered_at": d(0), "expected_date": d(15),
        "deliver_to": "公司仓库",
        "lines": [{"request_id": rid, "tax_incl": True, "qty": 100, "unit_price": 200.0}]})
    po = mo.get("po_no")
    api.req("post", f"/projects/{p}/purchase-requests/{rid}/inspect", "wh1", (200,), json={
        "qty": 100, "result": "合格", "qty_ok": 80, "qty_rejected": 20,
        "receipt_date": d(0), "note": "20 张边角弯曲"})
    rs = q("select status, qty, qty_ok, qty_rejected, batch_no from goods_receipt "
           "where request_id=:i order by id", i=rid)
    rec(len(rs) == 2 and len({r["batch_no"] for r in rs}) == 1,
        f"一批 100 → 2 条到货单、同 batch_no：{[(r['status'], float(r['qty'])) for r in rs]}",
        "洞②：整批二选一表达不了 80 合格 + 20 不合格")
    rec({r["status"] for r in rs} == {"待入库", "不合格"},
        f"两条状态应为 待入库 + 不合格，实际={[r['status'] for r in rs]}")
    row = _find_by_id(rid)
    rec(abs(float(row["qty_received"] or 0) - 80) < 1e-6,
        f"需求 qty_received 应=80（只算合格），实际={row['qty_received']}")
    rec(abs(float(row.get("qty_rejected") or 0) - 20) < 1e-6,
        f"需求 qty_rejected 应=20，实际={row.get('qty_rejected')}")

    # PU-06 换货闭环：20 不合格 → 换货 → 补发 20 → 全合格入库 → 已入库 / 累计 100
    api.req("post", f"/purchase/orders/{po}/negotiate", "buyer1", (200, 201), json={
        "request_ids": [rid], "action": "换货", "expected_date": d(10), "note": "原供应商补发"})
    api.req("post", f"/projects/{p}/purchase-requests/{rid}/inspect", "wh1", (200,), json={
        "qty": 20, "result": "合格", "receipt_date": d(1)})
    for g in q("select id from goods_receipt where request_id=:i and status='待入库'", i=rid):
        api.req("post", f"/goods-receipts/{g['id']}/store", "wh1",
                json={"location": "深圳仓 A-01-01"})
    row = _find_by_id(rid)
    rec(row["status"] == "已入库" and abs(float(row["qty_received"] or 0) - 100) < 1e-6,
        f"换货补发+入库后应 qty_received=100/已入库，实际={row['status']}/{row['qty_received']}")


def b_void_order() -> None:
    """B4 作废采购单 → 需求回池可再下单（PU-13）。"""
    probe("B4 作废采购单 → 需求回池")
    rid = _new_demand("bc", 30)["id"]
    mo = api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
        "supplier_id": SUP["甲钢材"]["id"], "ordered_at": d(0), "expected_date": d(10),
        "deliver_to": "公司仓库", "lines": [{"request_id": rid, "tax_incl": True, "qty": 30, "unit_price": 200.0}]})
    po = mo.get("po_no")
    rec(_find_by_id(rid)["status"] == "在途", f"下单后应 在途，实际={_find_by_id(rid)['status']}")
    api.req("post", f"/purchase/orders/{po}/void", "buyer1", (200,), json={"reason": "作废测试"})
    rec(_find_by_id(rid)["status"] == "待采购",
        f"★ 作废后需求应回「待采购」，实际={_find_by_id(rid)['status']}",
        "死单：作废后需求卡在在途，池子里买不了")
    mo2 = api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
        "supplier_id": SUP["乙标准件"]["id"], "ordered_at": d(0), "expected_date": d(10),
        "deliver_to": "公司仓库", "lines": [{"request_id": rid, "tax_incl": True, "qty": 30, "unit_price": 205.0}]})
    rec(bool(mo2.get("po_no")), "作废后能重新下单（回池生效）")


def b_close_return() -> None:
    """B4 整批退货关闭 → 到货单全 已退货 + 需求回池重采（PU-14）。"""
    probe("B4 整批退货关闭 → 需求回池重采")
    rid = _new_demand("bc", 25)["id"]
    mo = api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
        "supplier_id": SUP["甲钢材"]["id"], "ordered_at": d(0), "expected_date": d(10),
        "deliver_to": "公司仓库", "lines": [{"request_id": rid, "tax_incl": True, "qty": 25, "unit_price": 200.0}]})
    po = mo.get("po_no")
    _inspect_store(_find_by_id(rid), 25, do_store=False)  # 造一个「有到货」的执行中单
    api.req("post", f"/purchase/orders/{po}/close-return", "buyer1", (200,), json={"note": "不再合作"})
    rec(_find_by_id(rid)["status"] == "已退货",
        f"原需求应转 已退货，实际={_find_by_id(rid)['status']}")
    retries = [r for r in _reqs("待采购") if r.get("origin_request_id") == rid]
    rec(len(retries) == 1 and abs(float(retries[0]["qty"]) - 25) < 1e-9,
        f"应新建 1 条待采购回池（qty 25），实际={[(r['id'], r['qty']) for r in retries]}")
    gs = q("select status from goods_receipt where request_id=:i", i=rid)
    rec(bool(gs) and all(g["status"] == "已退货" for g in gs),
        f"到货单应全转 已退货，实际={[g['status'] for g in gs]}")


def b_split_line_cancel() -> None:
    """B2b 拆单后按行取消：只影响本单这一行，不动另一张单（行级）。"""
    probe("B2b 拆单后按行取消")
    rid = _new_demand("bc", 100)["id"]
    mo1 = api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
        "supplier_id": SUP["甲钢材"]["id"], "ordered_at": d(0), "expected_date": d(10),
        "deliver_to": "公司仓库", "lines": [{"request_id": rid, "tax_incl": True, "qty": 60, "unit_price": 200.0}]})
    api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
        "supplier_id": SUP["乙标准件"]["id"], "ordered_at": d(0), "expected_date": d(10),
        "deliver_to": "公司仓库", "lines": [{"request_id": rid, "tax_incl": True, "qty": 40, "unit_price": 210.0}]})
    api.req("post", f"/purchase/orders/{mo1.get('po_no')}/cancel", "buyer1", (200,),
            json={"reason": "只取消第一张"})
    row = _find_by_id(rid)
    rec(abs(float(row["qty_ordered"] or 0) - 40) < 1e-6 and row["status"] == "在途",
        f"★ 只取消第一张单后：qty_ordered=40/在途（需求减到 40），实际={row['qty_ordered']}/{row['status']}",
        "行级取消：不能影响第二张单的 40")
    n = q("select count(*) as c from purchase_order_line "
          "where request_id=:i and status <> '已取消'", i=rid)[0]["c"]
    rec(n == 1, f"第二张单的行还在（应剩 1 条未取消行），实际={n}")


def b_approval_chain() -> None:
    """二期 审批链：两级 / 退回必填 / 自审 403 / 留档多轮（08 §5）。"""
    probe("二期 采购审批链")
    rid = _new_demand("bc", 20)["id"]
    # 用 raw 绕过自动审批，拿到「待总监审」的单
    r = api.raw("post", "/purchase/merge-order", "buyer1", json={
        "supplier_id": SUP["甲钢材"]["id"], "ordered_at": d(0), "expected_date": d(10),
        "deliver_to": "公司仓库",
        "lines": [{"request_id": rid, "tax_incl": True, "qty": 20, "unit_price": 100.0}]})
    po = r.json().get("po_no")
    od = api.req("get", f"/purchase/orders/{po}", "buyer1")
    rec(od["order"]["po_status"] == "待经理审", f"提交后应 待经理审，实际={od['order']['po_status']}")

    sc_self, _ = api.try_("post", f"/purchase/orders/{po}/approve", "buyer1", json={"action": "通过"})
    rec(sc_self == 403, f"提交人自己审批应 403，实际={sc_self}")
    sc_nonote, _ = api.try_("post", f"/purchase/orders/{po}/approve", "purchase_manager",
                            json={"action": "退回"})
    rec(sc_nonote == 400, f"退回不填说明应 400，实际={sc_nonote}")
    api.req("post", f"/purchase/orders/{po}/approve", "purchase_manager", (200,),
            json={"action": "退回", "note": "价格再谈谈"})
    od = api.req("get", f"/purchase/orders/{po}", "buyer1")
    rec(od["order"]["po_status"] == "已退回", f"退回后应 已退回，实际={od['order']['po_status']}")
    api.req("post", f"/purchase/orders/{po}/submit", "buyer1", (200,))
    api.req("post", f"/purchase/orders/{po}/approve", "purchase_manager", (200,), json={"action": "通过"})
    od = api.req("get", f"/purchase/orders/{po}", "buyer1")
    rec(od["order"]["po_status"] == "待总监审", f"经理通过后应 待总监审，实际={od['order']['po_status']}")
    api.req("post", f"/purchase/orders/{po}/approve", "purchase_director", (200,), json={"action": "通过"})
    od = api.req("get", f"/purchase/orders/{po}", "buyer1")
    rec(od["order"]["po_status"] == "已批准", f"通过后应 已批准，实际={od['order']['po_status']}")
    ap = api.req("get", f"/purchase/orders/{po}/approvals", "buyer1")
    levels = {x["level"] for x in ap}
    acts = [x["action"] for x in ap]
    rec({1, 2} <= levels and "退回" in acts and "通过" in acts,
        f"审批留档应含一级+二级（多轮），level={sorted(levels)} acts={acts}")


def b_payment() -> None:
    """三期 付款标记 + 供应商往来对账（客户口径 #11/#12/#13）。"""
    probe("三期 付款标记 + 往来对账")
    orders = api.req("get", "/purchase/orders", "buyer1")
    po = next((o for o in orders if o.get("id") and o.get("supplier_id")), None)
    if po is None:
        rec(False, "没有可付款的采购单")
        return
    sc, _ = api.try_("post", "/purchase/orders/mark-paid", "wh1", json={"po_ids": [po["id"]]})
    rec(sc == 403, f"仓管标记付款应 403（无 purchase:payment），实际={sc}")
    sc_nv, _ = api.try_("post", "/purchase/orders/mark-paid", "buyer1", json={"po_ids": [po["id"]]})
    rec(sc_nv == 400, f"★ 付款凭证必填：不带凭证标记应 400，实际={sc_nv}")
    api.req("post", "/purchase/orders/mark-paid", "buyer1", (200,),
            json={"po_ids": [po["id"]], "paid_at": d(0), "note": "月结",
                  "vouchers": ["probe/receipt.png"]})
    st = api.req("get", f"/suppliers/{po['supplier_id']}/statement", "buyer1")
    rec(st["summary"]["paid_count"] >= 1, f"对账已付应 ≥1，实际={st['summary']['paid_count']}")
    paid_nos = {x["po_no"] for x in st["paid"]}
    rec(po["po_no"] in paid_nos, f"该单应出现在已付列表，实际={sorted(paid_nos)[:3]}")


def b_fixes() -> None:
    """修复回归：交期留痕(N1)/总监下单500(N2)/重复付款(N3)/退回标签(N5)/拆单并行(N6)/展示(N7)。"""
    probe("修复回归 N1/N2/N3/N5/N6/N7")
    p = CTX["p"]

    def body(rid, qty, sup, price=10.0):
        return {"supplier_id": SUP[sup]["id"], "ordered_at": d(0), "expected_date": d(10),
                "deliver_to": "公司仓库",
                "lines": [{"request_id": rid, "qty": qty, "unit_price": price, "tax_incl": True}]}

    # N2 总监下单 → 400（原 500）
    rid = _new_demand("bc", 5)["id"]
    sc, bd = api.try_("post", "/purchase/merge-order", "purchase_director", json=body(rid, 5, "甲钢材"))
    rec(sc == 400, f"N2 总监下单应 400（不再 500），实际={sc}", str(bd)[:100])

    # N6 未审批即可拆两刀（raw 绕过自动审批）
    rid2 = _new_demand("bc", 100)["id"]
    r1 = api.raw("post", "/purchase/merge-order", "buyer1", json=body(rid2, 60, "甲钢材"))
    r2 = api.raw("post", "/purchase/merge-order", "buyer1", json=body(rid2, 40, "乙标准件"))
    rec(r1.status_code in (200, 201) and r2.status_code in (200, 201),
        f"N6 未审批即可拆两刀：{r1.status_code}/{r2.status_code}",
        "拆多家不该等第一次审批")
    pno_list = [r.json().get("po_no") for r in (r1, r2) if r.status_code in (200, 201)]

    # N7 未审批单不得显示为「在途」；N5 退回后需求=已退回
    rid3 = _new_demand("bc", 7)["id"]
    r3 = api.raw("post", "/purchase/merge-order", "buyer1", json=body(rid3, 7, "甲钢材"))
    pno3 = r3.json().get("po_no")
    ol = api.req("get", "/purchase/orders", "buyer1")
    row = next((x for x in ol if x["po_no"] == pno3), {})
    rec(row.get("status") == "待经理审",
        f"N7 待审单展示应=待经理审（原「在途」），实际={row.get('status')}")
    api.req("post", f"/purchase/orders/{pno3}/approve", "purchase_manager", (200,),
            json={"action": "退回", "note": "价格再谈"})
    st = next(x for x in api.req("get", f"/projects/{p}/purchase-requests", "buyer1") if x["id"] == rid3)
    rec(st["status"] == "已退回",
        f"N5 退回后需求应=已退回（原「审批中」），实际={st['status']}")

    # N1 交期留痕：下单→审批→验收→入库 → actual_arrive_date/delay_days 有值
    rid4 = _new_demand("bc", 3)["id"]
    mo = api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json=body(rid4, 3, "甲钢材"))
    _inspect_store(_find_by_id(rid4), 3, do_store=True)
    po_row = q("select actual_arrive_date, delay_days from purchase_order where po_no=:p", p=mo["po_no"])[0]
    rec(po_row["actual_arrive_date"] is not None,
        f"★ N1 已入库后 actual_arrive_date 应有值（原 NULL），实际={po_row['actual_arrive_date']}")
    rec(po_row["delay_days"] is not None,
        f"★ N1 delay_days 应有值，实际={po_row['delay_days']}")

    # N3 重复标记付款 → 跳过、不覆盖付款日
    po_id = q("select id from purchase_order where po_no=:p", p=mo["po_no"])[0]["id"]
    api.req("post", "/purchase/orders/mark-paid", "buyer1", (200,),
            json={"po_ids": [po_id], "paid_at": d(-1), "vouchers": ["probe/a.png"]})
    paid1 = q("select paid_at from purchase_order where id=:i", i=po_id)[0]["paid_at"]
    res = api.req("post", "/purchase/orders/mark-paid", "buyer1", (200,),
                  json={"po_ids": [po_id], "paid_at": d(0), "vouchers": ["probe/b.png"]})
    paid2 = q("select paid_at from purchase_order where id=:i", i=po_id)[0]["paid_at"]
    rec(paid1 == paid2 and res.get("skipped", 0) >= 1,
        f"N3 重复标记应跳过、付款日不变（{paid1}=={paid2}，skipped={res.get('skipped')}）")

    # 清理 N6 留下的两张待审单
    for pno in pno_list:
        api.raw("post", f"/purchase/orders/{pno}/void", "buyer1", json={"reason": "探针清理"})


def _new_demand(item_key: str, qty: float, who: str = "buyer1") -> dict:
    """建一条干净的「待采购」需求（手工申请通道，免审核直入池）。"""
    r = api.req("post", "/purchase/manual-request", who, (201,), json={
        "attribution": "项目", "project_no": CTX["p"], "equip_no": CTX["eq"],
        "item_no": LIB[item_key]["item_no"], "qty": qty, "need_date": d(40)})
    return _find_by_id(r["id"])


def _find_by_id(rid: int) -> dict:
    for r in api.req("get", f"/projects/{CTX['p']}/purchase-requests", "buyer1"):
        if r["id"] == rid:
            return r
    raise AssertionError(f"需求 #{rid} 不见了")


def b_idempotent_after_release() -> None:
    """B2 发布后立刻手动补跑：应 0 新增（幂等）；同时验证 qty>1 定制件的数量口径。"""
    probe("B2 发布后手动补跑幂等 + 定制件数量口径")
    p, eq = CTX["p"], CTX["eq"]
    before = {r["id"]: float(r["qty"] or 0) for r in _reqs()}
    sc, bd = api.try_("post", f"/projects/{p}/equipment/{eq}/generate-purchase", "mech_manager",
                      json={})
    note(f"generate-purchase HTTP {sc}：{json.dumps(bd, ensure_ascii=False)[:300] if isinstance(bd, dict) else bd}")
    after = {r["id"]: float(r["qty"] or 0) for r in _reqs()}
    new_ids = set(after) - set(before)
    rec(not new_ids,
        f"★ 发布进池后立刻手动补跑，应 0 新增（幂等）；实际新增 {len(new_ids)} 条",
        "AGENTS §8.1 承诺「幂等，重复点不会重复进池」")
    for nid in new_ids:
        row = [r for r in _reqs() if r["id"] == nid][0]
        exp = CTX["exp"].get(row["item_no"])
        rec(False, f"新增需求 #{nid}：{row['item_no']} × {row['qty']}"
                   f"（真实需求 {exp}，发布通道已进池 {CTX['pool_after_release'].get(row['item_no'])}）",
            "equipment_demand 图纸分支 `d.qty * cum[d.drawing_no]`，而 cum 已含 d.qty → **数量平方**；"
            f"定制底板 qty=3 挂在 qty=2 组件下：真实 6，平方后 3×6=18")


def b_pending_window() -> None:
    """B3 「验收合格未入库」窗口期重复进池。"""
    probe("B3 待入库窗口期幂等")
    p, eq = CTX["p"], CTX["eq"]
    # 新建一条需求 → 下单 → 验收合格但【不入库】
    rid = _new_demand("dj", 10)["id"]
    api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
        "supplier_id": SUP["乙标准件"]["id"], "ordered_at": d(0), "expected_date": d(10),
        "deliver_to": "公司仓库", "lines": [{"request_id": rid, "tax_incl": True, "unit_price": 900.0}]})
    res = _inspect_store(_find_by_id(rid), 10, do_store=False)   # ★ 验收合格但不入库
    row = _find_by_id(rid)
    note(f"验收合格未入库：到货单={res['receipt_status']} 需求={row['status']} "
         f"qty_received={row.get('qty_received')}")
    rec(row["status"] == "待入库", f"状态应为「待入库」，实际={row['status']}")

    before = {x["id"] for x in _reqs()}
    # 手动补跑（设备面）—— 电机不在该设备 BOM 里，所以改用直接观察 open_qty 口径：
    # 用「同物料再建一条 BOM 需求」的方式验证。这里改为查采购池是否把该在跑量算作已覆盖。
    pool = api.req("get", "/purchase/pool", "buyer1")
    grp = [g for g in pool if g["item_no"] == LIB["dj"]["item_no"]]
    note(f"采购池电机分组：{json.dumps(grp, ensure_ascii=False)[:300]}")
    # 直接验证 _open_qty 的口径：查数据库 qty_received
    dbrow = q("select id, qty, qty_received, status from purchase_request where id=:i", i=rid)
    if dbrow:
        qr = float(dbrow[0]["qty_received"] or 0)
        # ★ 已修（批次1.2）：净需求不再看 qty_received，改用「可用库存 + 已领到车间 +
        #   已承诺/已计划(整条 qty) + 直发已到现场」四项抵扣。qty_received 含 pending 只是展示口径。
        #   重复进池的权威验证在 probe_bom_math.py 的 ISO-B（应 0 新增）。
        note(f"qty_received={qr}（含 pending，仅展示）；净需求抵扣已不看它 → 不再两头不覆盖")
    CTX["pending_rid"] = rid
    CTX["pending_receipt"] = res["receipt_id"]


def b_pending_repool() -> None:
    """B3-b 用真实 BOM 物料复现「待入库窗口重复进池」。"""
    probe("B3-b 待入库窗口 → 真实重复进池复现")
    p, eq = CTX["p"], CTX["eq"]
    # 把方通（BOM 原材料，需求 10）造出「待入库」状态：先补一条需求→下单→验收不入库
    ft = LIB["ft"]["item_no"]
    cur = [r for r in _reqs() if r["item_no"] == ft]
    note(f"方通现有需求：{[(r['id'], r['qty'], r['status']) for r in cur]}")
    # 全部入库后再造一个待入库窗口
    r2 = _new_demand("ft", 10)
    api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
        "supplier_id": SUP["甲钢材"]["id"], "ordered_at": d(0), "expected_date": d(10),
        "deliver_to": "公司仓库", "lines": [{"request_id": r2["id"], "tax_incl": True, "unit_price": 80.0}]})
    _inspect_store(_find_by_id(r2["id"]), 10, do_store=False)     # ★ 停在待入库
    # 先把之前已入库的方通清掉干扰：查库存
    stk = q("select coalesce(sum(qty_on_hand),0) as s from stock_item where item_no=:i", i=ft)
    note(f"方通库存={stk[0]['s']}（含此前已入库的 10）")
    before = {x["id"] for x in _reqs()}
    sc, bd = api.try_("post", f"/projects/{p}/equipment/{eq}/generate-purchase", "mech_manager", json={})
    after = {x["id"] for x in _reqs()}
    new = after - before
    ft_new = [x for x in _reqs() if x["id"] in new and x["item_no"] == ft]
    rec(not ft_new,
        f"★ 方通处于「待入库」窗口时手动补跑，应 0 新增；实际新增 {[(x['id'], x['qty']) for x in ft_new]}",
        "BOM 真实需求 10；库存 10（此前已入库）+ 待入库 10。"
        "但 _open_qty 用 qty−qty_received 把待入库那条算成 remaining=0，"
        "若库存被其他设备占用/或本次需求口径不同，就会出现重复进池")
    note(f"generate-purchase 返回：{json.dumps(bd, ensure_ascii=False)[:300] if isinstance(bd, dict) else bd}")


def b_direct_repool() -> None:
    """B4 直发件完成后（现场已验收）重复进池。"""
    probe("B4 直发件完成后重复进池")
    p, eq = CTX["p"], CTX["eq"]
    out_no = CTX["out"]
    rows = [r for r in _reqs() if r["item_no"] == out_no]
    note(f"直发件 {out_no} 需求：{[(r['id'], r['qty'], r['status']) for r in rows]}")
    done = [r for r in rows if r["status"] == "现场已验收"]
    if not done:
        note("⚠ 没有「现场已验收」的直发需求，跳过本探针（S8 清点可能未生效）")
        return
    stk = q("select coalesce(sum(qty_on_hand),0) as s from stock_item where item_no=:i", i=out_no)
    rec(float(stk[0]["s"]) == 0.0, f"直发件从不进库存（库存={stk[0]['s']}）", "预期为 0")
    before = {x["id"] for x in _reqs()}
    sc, bd = api.try_("post", f"/projects/{p}/equipment/{eq}/generate-purchase", "mech_manager", json={})
    after = {x["id"] for x in _reqs()}
    new = [x for x in _reqs() if x["id"] in (after - before)]
    rec(not new,
        f"★ 直发件已「现场已验收」后手动补跑，应 0 新增；实际新增 {[(x['item_no'], x['qty']) for x in new]}",
        "OPEN_STATUS = (待采购,在途,已下单,待入库,部分到货,不合格) —— **不含「现场待验收」「现场已验收」**；"
        "而直发件从不进 StockItem → 库存抵扣也是 0 → cover=0 → 每点一次就多一条重复需求（永久重复进池）")


def b_delete_authz() -> None:
    """B5 DELETE /purchase-requests/{id} 越权 + 无审计 + 硬删。"""
    probe("B5 删除采购需求的授权与留痕")
    p = CTX["p"]
    rid = _new_demand("zct", 5)["id"]
    # ★ 只数非 login 的审计（登录也写审计，会误判）
    AUD = "select count(*) as c from audit_log where action <> 'login'"
    audit_before = q(AUD)[0]["c"]
    # 用一个与采购完全无关的账号（现场）删
    sc, bd = api.try_("delete", f"/projects/{p}/purchase-requests/{rid}", "site1")
    rec(sc in (401, 403),
        f"★ 现场账号(site1) 删除采购需求 → HTTP {sc}（应 403）",
        f"返回：{str(bd)[:200]}\n该接口只 Depends(get_current_user)，无 require_permission、"
        "无状态守卫、无 audit.log，且是 session.delete 硬删除")
    gone = q("select count(*) as c from purchase_request where id=:i", i=rid)[0]["c"]
    rec(gone == 1, f"需求是否被真删（残留 {gone} 行，1=未删/0=已删）",
        "若为 0：任何登录用户都能静默删掉采购需求 → BOM 还在、池子里没了 → 漏采")
    audit_after = q(AUD)[0]["c"]
    # ★ 已修（批次2.2）：现场账号被 403 拦住 → 不该有删除动作，也不该有审计；
    #   换「授权用户删一条待采购需求」验证写入确实落审计。
    rid2 = _new_demand("zct", 5)["id"]
    a_before = q(AUD)[0]["c"]
    sc2, bd2 = api.try_("delete", f"/projects/{p}/purchase-requests/{rid2}", "buyer1")
    rec(sc2 == 200, f"采购员删「待采购」需求 → HTTP {sc2}（应 200）", f"返回：{str(bd2)[:200]}")
    a_after = q(AUD)[0]["c"]
    rec(a_after > a_before, f"授权删除落审计日志（{a_before} → {a_after}）", "铁律 5：所有写操作落 audit_log")
    # 对照：delete_program 是有守卫+审计的
    note("对照 programs.delete_program：有「只有草稿能删」守卫 + audit.log（只缺权限码）")


def b_kitting_inflate() -> None:
    """B6 齐套率虚高：库存 1 个也算到位 / 跨项目串 / 不乘累计倍数。"""
    probe("B6 齐套率到位判定")
    p, eq = CTX["p"], CTX["eq"]
    k = api.req("get", "/assembly/kitting", "assy1", params={"project_no": p, "equip_no": eq})
    bad = [ln for ln in k.get("lines", [])
           if ln["ready"] and "部分入库" in str(ln.get("state", ""))]
    rec(not bad,
        f"★「部分入库」却被判 ready 的行：{[(x['ref'], x['qty'], x['state']) for x in bad]}",
        "kitting._ready_purchased 里 `if stock > 0: return True, '部分入库（有 N）'` —— "
        "需 100 有 1 也算到位；而同文件 BOM 行分支用的是 `have + taken >= need`（正确），两套标准并存")
    # 跨项目：查 _ready_purchased 的三个查询是否带 project 过滤（静态已确认，这里做行为验证）
    note("静态确认：kitting._ready_purchased 的 PurchaseRequest/GoodsReceipt 查询只按 item_no，"
         "无 project_no 过滤 → 标准件全公司共用 item_no，别的项目到货会被算成本项目到位")


def b_issue_draft_bom() -> None:
    """B7 领料是否按「未冻结草稿 BOM」和「已被替代的行」。"""
    probe("B7 领料单的 BOM 过滤")
    p, eq = CTX["p"], CTX["eq"]
    # 新建一条草稿 BOM 行（不提交评审）
    b = api.req("post", f"/projects/{p}/bom/std", "mech_manager", (201,),
                json={"parent_ref": CTX["body"], "child_item_no": LIB["bc"]["item_no"], "qty": 7})
    bid = b["id"]
    st = q("select status from bom_item where id=:i", i=bid)[0]["status"]
    note(f"新建草稿 BOM 行 #{bid}（板材×7），status={st}")
    res = api.req("post", f"/warehouse/projects/{p}/equipment/{eq}/generate-issue", "shop1", (201,))
    iss = [i for i in api.req("get", "/warehouse/issues", "wh1") if i["issue_no"] == res["issue_no"]][0]
    hit = [ln for ln in iss["lines"] if ln["item_no"] == LIB["bc"]["item_no"]]
    rec(not hit,
        f"★ 草稿 BOM 行（status={st}）是否被领料单采纳：{[(x['item_no'], x['qty_required']) for x in hit]}",
        "warehouse.generate_issue 的 bom_rows 查询**没有 status==已冻结 过滤**，"
        "而 bom_demand.equipment_demand 有 `if b.status != BOM_ROW_FROZEN: continue` → "
        "设计还没发布，仓库就能按草稿领料（违反 05 卷 §4）")
    # superseded_by_id 过滤
    sup = q("select count(*) as c from bom_item where superseded_by_id is not null")[0]["c"]
    note(f"库中被替代的 BOM 行 {sup} 条；generate_issue 查询无 superseded_by_id.is_(None) 过滤"
         f"（bom_demand 有）→ 改版后旧行仍会领料")
    CTX["draft_bom_id"] = bid


def b_stock_conservation() -> None:
    """B8 库存守恒：超锁 / 负库存。"""
    probe("B8 库存守恒（备料超锁 / 出库负数）")
    p, eq = CTX["p"], CTX["eq"]
    item = LIB["bc"]["item_no"]
    loc = q("select id from warehouse_location limit 1")[0]["id"]
    st0 = q("select qty_on_hand, qty_locked from stock_item where item_no=:i and location_id=:l",
            i=item, l=loc)
    on_hand = float(st0[0]["qty_on_hand"]) if st0 else 0.0
    note(f"板材库存 on_hand={on_hand}")
    # 造两张各需 (on_hand+50) 的领料单，看能否都备料成功
    big = on_hand + 50
    ids = []
    for k in range(2):
        r = _new_demand("bc", big)
        api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
            "supplier_id": SUP["甲钢材"]["id"], "ordered_at": d(0), "expected_date": d(5),
            "deliver_to": "公司仓库", "lines": [{"request_id": r["id"], "tax_incl": True, "unit_price": 200.0}]})
        _inspect_store(_find_by_id(r["id"]), big)     # 验收入库 → 库存增加
        ids.append(r["id"])
    stk = q("select qty_on_hand, qty_locked from stock_item where item_no=:i and location_id=:l",
            i=item, l=loc)[0]
    note(f"入库后 on_hand={stk['qty_on_hand']} locked={stk['qty_locked']}")
    # 直接手工造两张大额领料单（走 generate-issue 拿不到指定数量），改用 DB 观察 pick 行为
    iss = api.req("get", "/warehouse/issues", "wh1")
    note(f"现有领料单 {len(iss)} 张")
    # 用现成的领料单重复备料不可行（状态守卫），改为检查 _apply_stock 是否有非负保护（静态）
    neg = q("select count(*) as c from stock_item where qty_on_hand < 0")[0]["c"]
    rec(neg == 0, f"当前负库存行数={neg}（本次未触发，静态确认无保护）",
        "warehouse._apply_stock 的 MOVE_OUT 分支 `s.qty_on_hand = qty_on_hand - qty` 无 max(0,…)、"
        "无前置可用量校验；pick_issue 也不校验 available → 两张单各需 8、库存 10 时可锁到 16、出库到负")


def b_price_reference() -> None:
    """B9 价格参考：口径字段是否齐备（重构方案 §5.3 要用）。"""
    probe("B9 价格参考现状（审批辅助的数据基础）")
    item = LIB["zct"]["item_no"]
    sc, bd = api.try_("get", f"/purchase/price-reference/{item}", "buyer1")
    rec(sc == 200, f"价格参考 HTTP {sc}")
    if sc == 200 and isinstance(bd, dict):
        st = bd.get("stats", {})
        note(f"stats={json.dumps(st, ensure_ascii=False)}")
        for k in ("last_price", "avg_price", "min_price", "max_price", "deal_count"):
            rec(k in st, f"stats 含 {k}（={st.get(k)}）")
        has_tax = any("tax_incl" in x for x in (bd.get("deals") or []))
        rec(has_tax, "★ 历史成交明细带 tax_incl（含税口径）字段",
            "supplier_quote 无 tax_incl 字段 → 审批页做「同口径比较」时无法过滤，"
            "含税价与不含税历史价混算会凭空报出 13% 涨幅（重构方案 §3.6）")
        has_qty = any(("qty" in x and x.get("qty")) for x in (bd.get("deals") or []))
        rec(has_qty, "★ 历史成交明细带成交数量 qty",
            "supplier_quote 只有 min_qty（起订量），没有「这笔实际买了多少」→ "
            "审核人看到「8.00 元」无法判断是买 20 个还是 5000 个的价（重构方案 §3.6 / §5.3 数量档位）")
    sc2, _ = api.try_("get", f"/purchase/price-reference/{item}", "wh1")
    rec(sc2 == 403, f"无 purchase:price 的仓管查价格参考 → HTTP {sc2}（应 403）")


# ==========================================================================
# Part C · 授权探针
# ==========================================================================
def c_authz_codes() -> None:
    probe("C1 授权失败的状态码（403 vs 400）")
    p = CTX["p"]
    # 让非总监去裁决改版：先造一张 ECN
    ecn = api.try_("post", "/change-requests", "mech1", json={
        "project_no": p, "equip_no": CTX["eq"], "target_type": "DRAWING",
        "target_ref": CTX["cust"], "target_version": "V1", "reason": "审计探针：底板厚度需加厚"})
    note(f"提改版申请 HTTP {ecn[0]}")
    if ecn[0] in (200, 201) and isinstance(ecn[1], dict):
        crid = ecn[1]["id"]
        # ① 完全无关的账号（仓管）去裁决
        sc, bd = api.try_("post", f"/change-requests/{crid}/decide", "wh1",
                          json={"decision": "批准", "note": "越权探针"})
        rec(sc == 403,
            f"★ 仓管(wh1) 裁决改版 → HTTP {sc}（授权失败应为 403）",
            f"返回：{str(bd)[:200]}\nchange_flow.decide 抛 ChangeFlowError，"
            "路由统一转成 400 → 越权尝试在日志里被记成「请求格式错误」，"
            "且 AGENTS §8.2 的「权限抽查 3 项 403」扫不到这类")
        # ② 另一个部门的总监（仓库总监）去裁决工程部改版
        sc2, bd2 = api.try_("post", f"/change-requests/{crid}/decide", "wh_director",
                            json={"decision": "批准", "note": "跨部门探针"})
        rec(sc2 == 403,
            f"★ 仓库总监(wh_director) 裁决工程部改版 → HTTP {sc2}（应 403：非本部门）",
            f"返回：{str(bd2)[:260]}\nchange_flow.decide 只判 `user.position != 总监`，"
            "**不限部门**；而 review_flow 二级审核用 director_for(submitter) 精确到人且限部门 —— 两套标准")
        cr = [x for x in api.req("get", "/change-requests", "admin", params={"scope": "all"})
              if x["id"] == crid]
        if cr:
            note(f"该 ECN 最终状态={cr[0]['status']}（被谁裁决：decided_by={cr[0].get('decided_by')}）")
            rec(cr[0]["status"] != "已批准" or cr[0].get("decided_by") == USERS["eng_director"],
                "★ 改版申请未被非工程部门的人批准",
                f"实际 status={cr[0]['status']} decided_by={cr[0].get('decided_by')} "
                f"（eng_director={USERS['eng_director']}, wh_director={USERS['wh_director']}）")
        CTX["cr_id"] = crid


def c_review_authz() -> None:
    probe("C2 评审审核的授权码")
    # 找一张审核中的评审单，用非审核人去过
    tks = api.req("get", "/review-tickets", "admin", params={"scope": "all"})
    pend = [t for t in tks if t["status"] in ("待经理审", "待总监审")]
    note(f"审核中的评审单 {len(pend)} 张")
    if pend:
        t = pend[0]
        sc, bd = api.try_("post", f"/review-tickets/{t['id']}/review", "wh1",
                          json={"action": "通过", "note": "越权探针"})
        rec(sc == 403, f"★ 仓管审工程评审单 → HTTP {sc}（应 403）",
            f"返回：{str(bd)[:200]}\nreview_flow 抛 ReviewFlowError → 路由转 400")


def c_write_no_perm() -> None:
    probe("C3 只校验登录的写接口")
    p = CTX["p"]
    # DELETE /suppliers/catalog/{id}
    cat = api.req("get", "/suppliers", "buyer1")
    sc, bd = api.try_("delete", "/suppliers/catalog/999999", "site1")
    rec(sc in (401, 403),
        f"★ 现场账号删供应商品类 → HTTP {sc}（应 403）",
        f"返回：{str(bd)[:160]}\nsuppliers.remove_catalog 只 Depends(get_current_user)，"
        "无权限码、无 audit.log")
    # PATCH /programs/{id}
    pgs = api.try_("get", f"/projects/{p}/equipment/{CTX['eq']}/programs", "prog_manager")
    if pgs[0] == 200 and pgs[1]:
        pid = pgs[1][0]["id"]
        sc2, bd2 = api.try_("patch", f"/programs/{pid}", "site1", json={"remark": "越权探针"})
        rec(sc2 in (401, 403),
            f"★ 现场账号改 PLC 程序 → HTTP {sc2}（应 403，需 design:edit）",
            f"返回：{str(bd2)[:160]}")
        sc3, bd3 = api.try_("delete", f"/programs/{pid}", "site1")
        rec(sc3 in (400, 401, 403),
            f"★ 现场账号删 PLC 程序 → HTTP {sc3}（应 403；400=被「只有草稿能删」守卫挡住，也算拦住）",
            f"返回：{str(bd3)[:160]}\ndelete_program 有状态守卫+audit ✓，但缺权限码")


def c_money_scrub() -> None:
    probe("C4 金额分档")
    orders = api.req("get", "/purchase/orders", "wh1")
    amts = [o.get("total_amount") for o in orders]
    rec(all(a is None for a in amts),
        f"无 purchase:price 的仓管看采购单金额={amts[:5]}（应全 None）")
    orders2 = api.req("get", "/purchase/orders", "buyer1")
    amts2 = [o.get("total_amount") for o in orders2]
    rec(any(a is not None for a in amts2), f"采购员能看到金额={amts2[:3]}")
    # ★ 单头聚合口径检查：供应商是否唯一
    multi = [o for o in orders2 if o.get("supplier_name") and "家供应商" in str(o["supplier_name"])]
    rec(not multi, f"★ 出现「N 家供应商」的采购单 {len(multi)} 张（一张单不该有两个供应商）",
        "_order_summary 用 `len(suppliers)<=1 else None` + 显示「N 家供应商」把数据不一致合法化；"
        "建 purchase_order 单头表后由 FK 天然保证")
    # 采购单主键形态
    keys = [o.get("key") for o in orders2]
    synth = [k for k in keys if isinstance(k, str) and k.startswith("R") and k[1:].isdigit()]
    rec(not synth, f"★ 合成主键 R{{id}} 的采购单 {len(synth)} 个（{synth[:5]}）",
        "_order_rows 里 `key.startswith('R')` 分支：没有实体却当实体用，API 主键是 po_no 或 R+行id")


def c_longlead_no_perm() -> None:
    probe("C5 长周期件登记（= 立即下单 + 发号 + 置在途）的权限")
    p = CTX["p"]
    before = q("select count(*) as c from purchase_request")[0]["c"]
    body = {"item_no": LIB["plc"]["item_no"], "qty": 3, "lead_days": 30,
            "need_date": d(90), "ordered_at": d(0), "supplier_name": "越权探针供应商",
            "unit_price": 18000, "equip_no": CTX["eq"], "is_long_lead": True}
    sc, bd = api.try_("post", f"/projects/{p}/purchase-requests", "site1", json=body)
    after = q("select count(*) as c from purchase_request")[0]["c"]
    rec(sc in (401, 403),
        f"★ 现场账号(site1) 登记长周期件 → HTTP {sc}（应 403，需 purchase:edit）",
        f"返回：{str(bd)[:220]}\n需求行数 {before} → {after}。"
        "initiation.add_purchase_request 只 Depends(get_current_user)；"
        "它会 next_number 发一个真采购单号、status 直接置「在途」——"
        "等于任何登录用户都能凭空下一张采购单")
    if after > before:
        row = q("select id, item_no, qty, status, po_no, unit_price from purchase_request "
                "order by id desc limit 1")[0]
        rec(False, f"★ 越权写入已落库：#{row['id']} {row['item_no']} × {row['qty']} "
                   f"status={row['status']} po_no={row['po_no']} ¥{row['unit_price']}",
            "该接口无 require_permission，与 AGENTS §8.2「采购下单类→purchase:edit」的口径不符")


# ==========================================================================
# 汇总
# ==========================================================================
def main() -> None:
    print("=" * 78)
    print("txgketo · S1→S11 端到端 + 采购域专项探针")
    print("=" * 78)
    reset()
    setup_users()
    part("准备")
    setup_library()
    setup_suppliers()
    setup_locations()

    part("Part A · 全链路 S0 → S11")
    for fn in (a_s0, a_s1, a_s2, a_s3, a_s4, a_s5, a_s6, a_s7, a_s8_s9, a_s10, a_s11):
        try:
            fn()
        except ApiError as exc:
            rec(False, f"{fn.__name__} 中断", str(exc), sev="失败")
            traceback.print_exc()
        except Exception as exc:  # noqa: BLE001
            rec(False, f"{fn.__name__} 异常", f"{type(exc).__name__}: {exc}", sev="失败")
            traceback.print_exc()

    part("Part B · 采购域专项探针")
    for fn in (b_split, b_partial_ok, b_split_line_cancel, b_void_order, b_close_return, b_approval_chain, b_payment, b_fixes, b_idempotent_after_release, b_pending_window, b_pending_repool,
               b_direct_repool, b_delete_authz, b_kitting_inflate, b_issue_draft_bom,
               b_stock_conservation, b_price_reference):
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            rec(False, f"{fn.__name__} 异常", f"{type(exc).__name__}: {exc}\n{traceback.format_exc()[-600:]}",
                sev="失败")

    part("Part C · 授权探针")
    for fn in (c_authz_codes, c_review_authz, c_write_no_perm, c_money_scrub, c_longlead_no_perm):
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            rec(False, f"{fn.__name__} 异常", f"{type(exc).__name__}: {exc}", sev="失败")

    result = {
        "generated_at": str(TODAY),
        "project": CTX.get("p"),
        "http": {"calls": api.calls, "by_status": api.by_status, "failures": api.failures},
        "findings": FINDINGS,
        "passed": PASS,
        "trace": TRACE,
    }
    with open("/tmp/txgk_e2e_result.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 78)
    print("汇总")
    print("=" * 78)
    print(f"  项目 {CTX.get('p')}  HTTP {api.calls} 次  状态分布 {dict(sorted(api.by_status.items()))}")
    fails = [f for f in FINDINGS if f["severity"] == "失败"]
    probs = [f for f in FINDINGS if f["severity"] != "失败"]
    print(f"  ❌ 问题 {len(probs)} 项 · 中断 {len(fails)} 项 · ✅ 通过 {len(PASS)} 项")
    print("\n  问题清单：")
    for i, f in enumerate(probs, 1):
        print(f"   {i:2}. [{f['part']}|{f['probe']}] {f['title']}")
    if fails:
        print("\n  中断清单：")
        for f in fails:
            print(f"   - [{f['part']}|{f['probe']}] {f['title']}: {f['detail'][:200]}")
    print("\n  结果已写入 /tmp/txgk_e2e_result.json")


if __name__ == "__main__":
    main()
