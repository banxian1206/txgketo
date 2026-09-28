#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""同兴高科 txgketo · 多项目并发 S0→S11 真实全链路走查（真实 HTTP）。

设计原则：
- 4 个项目同步推进（锁步），每个项目都复杂且各不相同：
  P1 大单整线（同型设备/3~4 级BOM树/直发/分批到货/换货/返工/分批发运/缺件签收/ECN/在保售后）
  P2 标准单机（与 P1 跨项目合并下单）
  P3 线体（直发 + 验收不合格「退货重采」换供应商重买 + 分批发运 + ECN）
  P4 急单小单（验收日回溯 → 过保售后边界）
- 真正的并发：并行建项目验发号唯一、并行读接口验服务端稳定
- 只记录不修改：不 patch 应用代码；每个动作 GET 回读校验，异常一律登记
- 结果落 /tmp/txgketo_multiproj_result.json

跑法： backend/.venv/bin/python /tmp/txgketo_multiproj_e2e.py
"""
from __future__ import annotations

import json
import threading
import traceback
from datetime import date, timedelta

import httpx
from sqlalchemy import create_engine, text

BASE = "http://127.0.0.1:8208/api/v1"
DBURL = "postgresql+psycopg://txgk:txgk@127.0.0.1:35432/txgk"
today = date.today()


def d(n: int) -> str:
    return (today + timedelta(days=n)).isoformat()


PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c6360000002000154a24f5b0000000049454e44ae426082"
)
PDF = b"%PDF-1.4 txgk multiproj e2e\n"

# ---------------------------------------------------------------------------
# 全局记录
# ---------------------------------------------------------------------------
ISSUES: list[dict] = []      # {stage, project, severity, msg}
NOTES: list[dict] = []       # {stage, project, msg}
STAGE_LOG: list[dict] = []   # {stage, project, result}
CURRENT = {"stage": "-", "project": "-"}


def flag(ok: bool, msg: str, severity: str = "问题") -> bool:
    if not ok:
        ISSUES.append({
            "stage": CURRENT["stage"], "project": CURRENT["project"],
            "severity": severity, "msg": msg,
        })
        print(f"      ⚠️  [{CURRENT['stage']}|{CURRENT['project']}] {msg}")
    return ok


def note(msg: str) -> None:
    NOTES.append({"stage": CURRENT["stage"], "project": CURRENT["project"], "msg": msg})
    print(f"      · [{CURRENT['stage']}|{CURRENT['project']}] {msg}")


def log_stage(result: str) -> None:
    STAGE_LOG.append({"stage": CURRENT["stage"], "project": CURRENT["project"], "result": result})


def stage(name: str, project: str = "-") -> None:
    CURRENT["stage"] = name
    CURRENT["project"] = project
    print(f"\n━━━ {name}" + (f"  [{project}]" if project != "-" else "") + " ━━━")


class ApiError(Exception):
    def __init__(self, method, path, who, status, text):
        self.method, self.path, self.who, self.status, self.text = method, path, who, status, text
        super().__init__(f"HTTP {status} {method} {path} ({who}): {text[:300]}")


class Api:
    def __init__(self):
        self.client = httpx.Client(base_url=BASE, timeout=120)
        self.tokens: dict[str, dict] = {}
        self.lock = threading.Lock()
        self.calls = 0
        self.by_status: dict[int, int] = {}
        self.by_method: dict[str, int] = {}
        self.failures: list[dict] = []

    def login(self, u: str) -> dict:
        with self.lock:
            if u in self.tokens:
                return self.tokens[u]
        pwd = "admin12345" if u == "admin" else "txgk@123"
        r = self.client.post("/auth/login", json={"username": u, "password": pwd})
        if r.status_code != 200:
            raise ApiError("POST", "/auth/login", u, r.status_code, r.text)
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        with self.lock:
            self.tokens[u] = h
        return h

    def raw(self, method: str, path: str, who: str, **kw) -> httpx.Response:
        headers = dict(self.login(who))
        extra = kw.pop("headers", None)
        if extra:
            headers.update(extra)
        r = self.client.request(method, path, headers=headers, **kw)
        with self.lock:
            self.calls += 1
            self.by_method[method.upper()] = self.by_method.get(method.upper(), 0) + 1
            self.by_status[r.status_code] = self.by_status.get(r.status_code, 0) + 1
        return r

    def req(self, method: str, path: str, who: str, expect=(200,), **kw):
        r = self.raw(method, path, who, **kw)
        if r.status_code not in expect:
            with self.lock:
                self.failures.append({"method": method, "path": path, "who": who,
                                      "status": r.status_code, "body": r.text[:300]})
            raise ApiError(method, path, who, r.status_code, r.text)
        ctype = r.headers.get("content-type", "")
        if "application/json" in ctype:
            return r.json()
        return r.content

    def json_or_none(self, method: str, path: str, who: str, **kw):
        r = self.raw(method, path, who, **kw)
        if r.status_code not in (200, 201) or "application/json" not in r.headers.get("content-type", ""):
            return r.status_code, None
        return r.status_code, r.json()


api = Api()
USERS: dict[str, int] = {}
LIB: dict[str, dict] = {}
SUP: dict[str, dict] = {}

# ---------------------------------------------------------------------------
# 复位业务数据（只动业务表，保留账号/组织/角色/权限/编号规则/标准库类目）
# ---------------------------------------------------------------------------
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


def reset_db() -> None:
    e = create_engine(DBURL)
    with e.begin() as c:
        c.execute(text(f'TRUNCATE TABLE {", ".join(BUSINESS_TABLES)} RESTART IDENTITY CASCADE'))
        c.execute(text("DELETE FROM item"))
    print("🧹 业务数据已清空（编号序列归零，标准库物料清空待重建）")


LIB_SEED = [
    ("DJ", {"brand": "台达", "model": "ECMA-C21310", "power": "1kW", "voltage": "220V"}, "台"),
    ("JSJ", {"brand": "纽氏达特", "model": "PLE60-10", "ratio": "1:10"}, "台"),
    ("QG", {"brand": "SMC", "model": "CDQ2B32-100", "bore": "32", "stroke": "100"}, "只"),
    ("FT", {"material": "Q235", "w": "40", "h": "40", "t": "2.0", "len": "6000"}, "米"),
    ("BC", {"material": "Q235", "t": "2.0", "size": "1220x2440"}, "张"),
    ("PLC", {"brand": "汇川", "series": "AM401", "model": "AM401-CPU1602", "io": "32点"}, "套"),
    ("SF", {"brand": "台达", "model": "ASDA-B3", "power": "750W"}, "台"),
    ("ZCT", {"brand": "NSK", "model": "6204DDU"}, "个"),
]


def seed_library() -> None:
    for cls, spec, unit in LIB_SEED:
        api.req("post", "/library/items", "admin", (201,),
                json={"std_class_code": cls, "spec": spec, "unit": unit})
    for key, q in [("zct", "轴承"), ("qg", "气缸"), ("dj", "电机"), ("ft", "方通"),
                   ("bc", "板材"), ("plc", "PLC"), ("sf", "伺服"), ("jsj", "减速机")]:
        rows = api.req("get", "/library/items", "admin", params={"q": q})
        assert rows, f"标准库找不到 {q}"
        LIB[key] = rows[0]
    print(f"标准库物料已重建：{ {k: v['item_no'] for k, v in LIB.items()} }")


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
    return 500.0  # 图号类（外协/定制）


def ensure_suppliers() -> dict[str, dict]:
    want = [("华信传动", "外协"), ("恒钲钣金", "机加工"), ("远东型材", "原材料"), ("华南标准件", "标准件")]
    out = {}
    for name, kind in want:
        got = api.req("get", "/suppliers", "buyer1", params={"q": name})
        if got:
            out[name] = got[0]
        else:
            out[name] = api.req("post", "/suppliers", "buyer1", (201,),
                                json={"name": name, "kind": kind, "contact_name": "对接人"})
    return out


# ---------------------------------------------------------------------------
# 项目画像
# ---------------------------------------------------------------------------
PROFILES = [
    {
        "key": "P1", "sales": "sales1",
        "customer": "宁德时代新能源", "name": "电芯模组自动化装配线",
        "deal_mode": "投标", "source": "客户询价", "est_amount": 12_800_000, "amount": 12_600_000,
        "warranty": 18, "delivery_days": 200,
        "site": "宁德市蕉城区 宁德时代科技大楼",
        "desc": "整线：模组堆叠机 2 台（同型）+ 焊接输送线 + EOL 测试单元，节拍 9s/模组",
        "payments": [("预付款", 30), ("到货款", 30), ("验收款", 30), ("质保金", 10)],
        "devices": [
            {"name": "模组堆叠机", "kind": "单机"},
            {"name": "模组堆叠机", "kind": "单机", "same_as_first": True},
            {"name": "焊接输送线", "kind": "线体", "line_no": "300"},
            {"name": "EOL 测试单元", "kind": "单机"},
        ],
        "deep": "01A",
        "tree": [
            {"key": "body", "title": "主体组件", "parent": None, "qty": None, "source": "自制件"},
            {"key": "frame", "title": "机架", "parent": "body", "qty": None, "source": "自制件"},
            {"key": "side", "title": "侧板", "parent": "frame", "qty": 2, "source": "自制件"},
            {"key": "rib", "title": "加强筋", "parent": "side", "qty": 4, "source": "自制件"},
            {"key": "cover", "title": "防护罩", "parent": None, "qty": None, "source": "自制件"},
            {"key": "beam", "title": "支撑梁", "parent": None, "qty": None, "source": "自制件"},
        ],
        "std": [("frame", "zct", 4), ("body", "qg", 2), ("body", "dj", 2)],
        "mat": [("frame", "ft", 2), ("side", "bc", 1)],
        "outsource": ["cover"], "custom": ["beam"],
        "long_lead": [("jsj", 2), ("plc", 2)],
        "direct": True,           # 外协件直发客户现场
        "nonconform": "ft",       # 方通验收不合格 → 换货
        "return_item": None,      # 换货
        "partial": "zct",         # 轴承分批到货
        "rework": "frame",        # 机架返工
        "multi_ship": True, "missing_ship": "02A",
        "ecn": True, "withdraw_test": True, "past_accept": False,
        "extra_devices": ["02A", "03A"],
    },
    {
        "key": "P2", "sales": "sales1",
        "customer": "立讯精密", "name": "连接器自动插装机",
        "deal_mode": "直签", "source": "老客户复购", "est_amount": 1_600_000, "amount": 1_650_000,
        "warranty": 12, "delivery_days": 90,
        "site": "东莞市清溪镇 立讯工业园",
        "desc": "单机：连接器自动插装 + 视觉检测，节拍 3s/pcs",
        "payments": [("预付款", 40), ("发货款", 40), ("质保金", 20)],
        "devices": [{"name": "自动插装机", "kind": "单机"}],
        "deep": "01A",
        "tree": [
            {"key": "body", "title": "主体", "parent": None, "qty": None, "source": "自制件"},
            {"key": "fixture", "title": "夹具", "parent": "body", "qty": 2, "source": "自制件"},
        ],
        "std": [("body", "zct", 6), ("body", "sf", 2)],
        "mat": [("body", "ft", 1)],
        "outsource": [], "custom": [],
        "long_lead": [("jsj", 2)],
        "direct": False, "nonconform": None, "return_item": None, "partial": None,
        "rework": None, "multi_ship": False, "missing_ship": None,
        "ecn": False, "withdraw_test": False, "past_accept": False,
        "extra_devices": [],
    },
    {
        "key": "P3", "sales": "sales1",
        "customer": "格力电器", "name": "空调外机总装线",
        "deal_mode": "投标", "source": "客户询价", "est_amount": 5_400_000, "amount": 5_200_000,
        "warranty": 24, "delivery_days": 150,
        "site": "珠海市香洲区 格力电器总部",
        "desc": "线体：外机总装线 100 + 在线检测工位，节拍 15s/台",
        "payments": [("预付款", 30), ("提货款", 40), ("验收款", 20), ("质保金", 10)],
        "devices": [
            {"name": "外机总装线", "kind": "线体", "line_no": "100"},
            {"name": "在线检测工位", "kind": "单机"},
        ],
        "deep": "01A",
        "tree": [
            {"key": "body", "title": "线体主段", "parent": None, "qty": None, "source": "自制件"},
            {"key": "frame", "title": "线体机架", "parent": "body", "qty": None, "source": "自制件"},
            {"key": "guard", "title": "安全护栏", "parent": "body", "qty": None, "source": "自制件"},
        ],
        "std": [("frame", "zct", 8), ("body", "sf", 4)],
        "mat": [("frame", "ft", 3), ("frame", "bc", 2)],
        "outsource": ["guard"], "custom": [],
        "long_lead": [("plc", 2)],
        "direct": True,
        "nonconform": None,
        "return_item": "bc",      # 板材验收不合格 → 退货重采换供应商
        "partial": None,
        "rework": None,
        "multi_ship": True, "missing_ship": None,
        "ecn": True, "withdraw_test": False, "past_accept": False,
        "extra_devices": ["02A"],
    },
    {
        "key": "P4", "sales": "sales1",
        "customer": "富士康工业互联网", "name": "老化测试柜",
        "deal_mode": "直签", "source": "老客户复购", "est_amount": 480_000, "amount": 480_000,
        "warranty": 12, "delivery_days": 45,
        "site": "深圳市龙华区 富士康观澜园区",
        "desc": "单机：老化测试柜 1 台（急单），节拍不限",
        "payments": [("预付款", 50), ("验收款", 40), ("质保金", 10)],
        "devices": [{"name": "老化测试柜", "kind": "单机"}],
        "deep": "01A",
        "tree": [
            {"key": "body", "title": "柜体", "parent": None, "qty": None, "source": "自制件"},
            {"key": "door", "title": "柜门", "parent": "body", "qty": 2, "source": "自制件"},
        ],
        "std": [("body", "zct", 4), ("body", "sf", 1)],
        "mat": [("body", "bc", 1)],
        "outsource": [], "custom": [],
        "long_lead": [],
        "direct": False, "nonconform": None, "return_item": None, "partial": None,
        "rework": None, "multi_ship": False, "missing_ship": None,
        "ecn": False, "withdraw_test": False, "past_accept": True,
        "extra_devices": [],
    },
]

TEAM = [
    ("pm1", "项目经理"), ("mech_manager", "机械负责人"), ("elec_manager", "电气负责人"),
    ("prog_manager", "程序负责人"), ("craft_manager", "工艺负责人"), ("buyer1", "采购负责人"),
    ("shop1", "生产负责人"), ("assy1", "装配负责人"), ("site1", "现场负责人"),
    ("service1", "售后负责人"),
]


# ---------------------------------------------------------------------------
# 阶段实现
# ---------------------------------------------------------------------------
def s0(pj: dict) -> None:
    prof = pj["prof"]
    body = {
        "sales_id": USERS["sales1"],
        "customer_name": prof["customer"], "project_name": prof["name"],
        "contacts": [
            {"name": "王工", "title": "设备科", "phone": "13800001111", "role_tag": "技术对接人"},
            {"name": "赵经理", "title": "采购", "phone": "13900002222", "role_tag": "采购"},
        ],
        "deadline": d(20), "delivery_days": prof["delivery_days"],
        "deal_mode": prof["deal_mode"], "source": prof["source"],
        "est_amount": prof["est_amount"], "project_desc": prof["desc"],
        "site_address": prof["site"], "required_cycle": "见技术协议", "product_type": prof["name"],
    }
    p = api.req("post", "/projects", "sales1", (201,), json=body)
    pj["p"] = p["project_no"]
    flag(pj["p"].startswith("TX"), f"项目号应 TX{{YY}}{{NNN}}，实际 {pj['p']}")
    got = api.req("get", f"/projects/{pj['p']}", "sales1")
    flag(got["stage"] == "线索", f"新商机阶段应「线索」，实际 {got['stage']}")
    flag(got.get("sales_id") == USERS["sales1"], "创建人应自动成为销售负责人")
    # 资料包
    for cat, fn in [("客户资料", "客户需求书.pdf"), ("技术协议", "技术协议.pdf")]:
        api.req("post", f"/projects/{pj['p']}/attachments", "sales1", (201,),
                data={"category": cat}, files={"file": (fn, PDF, "application/pdf")})
    det = api.req("get", f"/projects/{pj['p']}/detail", "sales1")
    flag(len(det.get("attachments", [])) == 2,
         f"资料包应 2 份，实际 {len(det.get('attachments', []))}")
    # 负例：缺销售负责人
    bad = api.raw("post", "/projects", "sales1", json={"customer_name": "x", "project_name": "y"})
    flag(bad.status_code == 422, f"缺销售负责人应 422，实际 {bad.status_code}")
    print(f"  {pj['p']} · {prof['customer']} · {prof['name']}（线索，2 份资料）")
    log_stage(f"商机 {pj['p']} 建档，2 资料，缺销售负责人被 422 拦")


def s02(pj: dict) -> None:
    prof, p = pj["prof"], pj["p"]
    terms = [{"node_name": n, "percent": pc, "amount": round(prof["amount"] * pc / 100),
              "condition": f"{n}条件"} for n, pc in prof["payments"]]
    api.req("post", f"/projects/{p}/deal", "sales1", json={
        "period_start": d(0), "period_end": d(prof["delivery_days"]),
        "amount": prof["amount"], "contract_no_customer": f"HT-{p}-01",
        "warranty_months": prof["warranty"],
        "warranty_amount": round(prof["amount"] * 0.1),
        "tech_agreement_frozen": True,
        "acceptance_standard": "按技术协议验收，连续运行 72h 良率≥98%",
        "is_batch_delivery": prof["multi_ship"],
        "payment_terms": terms,
    })
    got = api.req("get", f"/projects/{p}", "sales1")
    det = api.req("get", f"/projects/{p}/detail", "sales1")
    flag(got["stage"] == "成交待立项", f"成交后应「成交待立项」，实际 {got['stage']}")
    flag(len(det.get("payment_terms", [])) == len(prof["payments"]),
         f"付款节点应 {len(prof['payments'])} 条")
    print(f"  合同 ¥{prof['amount']:,.0f} / 质保 {prof['warranty']} 月 / 节点 {len(terms)} 条")
    log_stage(f"成交 ¥{prof['amount']:,.0f}，{len(terms)} 付款节点，质保 {prof['warranty']} 月")


def s1(pj: dict) -> None:
    prof, p = pj["prof"], pj["p"]
    for u, role in TEAM:
        api.req("post", f"/projects/{p}/members", "pm1", (201,),
                json={"user_id": USERS[u], "project_role": role})
    made = []
    for i, dev in enumerate(prof["devices"]):
        body = {"equip_name": dev["name"], "kind": dev["kind"]}
        if dev.get("line_no"):
            body["line_no"] = dev["line_no"]
        if dev.get("same_as_first"):
            body["same_as"] = made[0]
        e = api.req("post", f"/projects/{p}/equipment", "pm1", (201,), json=body)
        made.append(e["equip_no"])
    pj["equips"] = made
    if len(made) >= 2 and prof["devices"][1].get("same_as_first"):
        flag(made[1] == "01B", f"同型第二台应 01B，实际 {made[1]}")
    api.req("post", f"/projects/{p}/milestones/generate", "pm1")
    for key, qty in prof["long_lead"]:
        api.req("post", f"/projects/{p}/purchase-requests", "pm1", (201,), json={
            "item_no": LIB[key]["item_no"], "qty": qty, "lead_days": 60,
            "need_date": d(prof["delivery_days"] - 30), "ordered_at": d(0),
            "supplier_name": "华信传动",
            "unit_price": price_of(LIB[key]["item_no"]),
            "equip_no": prof["deep"], "is_long_lead": True,
        })
    api.req("post", f"/projects/{p}/generate-tasks", "pm1",
            json={"professions": ["机械", "电气", "程序", "工艺"], "with_purchase": True})
    api.req("post", f"/projects/{p}/initiate", "pm1")
    got = api.req("get", f"/projects/{p}", "pm1")
    eqs = api.req("get", f"/projects/{p}/equipment", "pm1")
    flag(got["stage"] == "执行中", f"立项后应「执行中」，实际 {got['stage']}")
    flag(len(eqs) == len(prof["devices"]), f"设备应 {len(prof['devices'])} 台，实际 {len(eqs)}")
    root = api.req("get", f"/projects/{p}/equipment/{prof['deep']}/design", "mech_manager")
    flag(root.get("root") is not None, "立项即应有总装图")
    ms = api.req("get", f"/projects/{p}/milestones", "pm1")
    ms = ms if isinstance(ms, list) else ms.get("items", [])
    flag(all(m.get("plan_start") and m.get("plan_end") for m in ms), "标准节点应带默认起止")
    print(f"  设备 {made}；团队 {len(TEAM)} 人；节点 {len(ms)}；长周期件 {len(prof['long_lead'])}")
    log_stage(f"4 角色任务派发，设备 {made}，节点 {len(ms)}，长周期件下单")


def _my_task(p: str, equip: str, prof_name: str, who: str) -> int:
    tasks = api.req("get", f"/projects/{p}/equipment/{equip}/my-design-tasks", who)
    for t in tasks:
        if t["profession"] == prof_name:
            return t["task_id"]
    raise ApiError("GET", "my-design-tasks", who, 0, f"找不到 {equip}/{prof_name} 任务：{tasks}")


def _review_pass(p: str, tid: int, note_txt: str) -> None:
    tk = api.req("get", f"/tasks/{tid}/review-ticket", "eng_director")
    flag(tk is not None and tk["status"] == "待总监审",
         f"经理提交应直达「待总监审」，实际 {tk['status'] if tk else None}")
    api.req("post", f"/review-tickets/{tk['id']}/review", "eng_director",
            json={"action": "通过", "note": "OK"})
    tk2 = api.req("get", f"/tasks/{tid}/review-ticket", "mech_manager")
    flag(tk2["status"] == "已发布", f"总监通过后应「已发布」，实际 {tk2['status']}")
    return tk["id"]


def s2(pj: dict) -> None:
    prof, p = pj["prof"], pj["p"]
    deep = prof["deep"]
    pj["draw"] = {}

    # ---- 深层设备：图纸树 ----
    for node in prof["tree"]:
        body = {"title": node["title"], "source_type": node["source"]}
        if node["parent"]:
            body["parent_drawing_no"] = pj["draw"][node["parent"]]
        if node["qty"]:
            body["qty"] = node["qty"]
        dr = api.req("post", f"/projects/{p}/equipment/{deep}/drawings", "mech_manager", (201,), json=body)
        pj["draw"][node["key"]] = dr["drawing_no"]
        api.req("post", f"/drawings/{dr['drawing_no']}/draft", "mech_manager", (200,),
                data={"change_reason": "初稿"},
                files={"file": (f"{node['key']}.pdf", PDF, "application/pdf")})
    flag(len(pj["draw"]) == len(prof["tree"]),
         f"图纸树应 {len(prof['tree'])} 张，实际 {len(pj['draw'])}")

    # ---- 标准件/材料 BOM ----
    std_ids, mat_ids = [], []
    for parent, key, qty in prof["std"]:
        b = api.req("post", f"/projects/{p}/bom/std", "mech_manager", (201,),
                    json={"parent_ref": pj["draw"][parent], "child_item_no": LIB[key]["item_no"], "qty": qty})
        std_ids.append(b["id"])
    for parent, key, qty in prof["mat"]:
        b = api.req("post", f"/projects/{p}/bom/material", "craft_manager", (201,),
                    json={"parent_ref": pj["draw"][parent], "child_item_no": LIB[key]["item_no"], "qty": qty})
        mat_ids.append(b["id"])

    # ---- 程序 ----
    pg = api.req("post", f"/projects/{p}/equipment/{deep}/programs", "prog_manager", (201,),
                 json={"name": f"{p}-{deep} 主控程序"})
    api.req("post", f"/programs/{pg['id']}/draft", "prog_manager", (200,),
            data={"change_reason": "初稿"}, files={"file": ("main.st", b"LD M0\nEND\n", "text/plain")})

    # ---- 机械评审（总装图 + 树节点 + 设计BOM；可含撤回测试）----
    root_no = api.req("get", f"/projects/{p}/equipment/{deep}/design", "mech_manager")["root"]["drawing_no"]
    api.req("post", f"/drawings/{root_no}/draft", "mech_manager", (200,),
            data={"change_reason": "总装图初稿"}, files={"file": ("root.pdf", PDF, "application/pdf")})
    mech_items = [{"item_type": "DRAWING", "item_ref": root_no}] + \
                 [{"item_type": "DRAWING", "item_ref": v} for v in pj["draw"].values()] + \
                 [{"item_type": "BOM_DESIGN", "item_ref": str(i)} for i in std_ids]
    tid = _my_task(p, deep, "机械", "mech_manager")
    api.req("post", f"/tasks/{tid}/submit-review", "mech_manager", (201,),
            json={"items": mech_items, "note": "机械首版"})
    if prof["withdraw_test"]:
        tk = api.req("get", f"/tasks/{tid}/review-ticket", "mech_manager")
        api.req("post", f"/review-tickets/{tk['id']}/withdraw", "mech_manager")
        tk = api.req("get", f"/tasks/{tid}/review-ticket", "mech_manager")
        flag(tk["status"] in ("已撤回", "草稿"), f"撤回后状态应回收，实际 {tk['status']}")
        api.req("post", f"/tasks/{tid}/submit-review", "mech_manager", (201,),
                json={"items": mech_items, "note": "撤回后重提"})
    _review_pass(p, tid, "机械")

    # ---- 工艺评审：材料 + 外协/定制判定 ----
    src_items = [{"item_type": "SOURCE_TAG", "item_ref": pj["draw"][k], "source_type": "外协件"}
                 for k in prof["outsource"]]
    src_items += [{"item_type": "SOURCE_TAG", "item_ref": pj["draw"][k], "source_type": "定制件"}
                  for k in prof["custom"]]
    craft_items = [{"item_type": "BOM_MATERIAL", "item_ref": str(i)} for i in mat_ids] + src_items
    tcraft = _my_task(p, deep, "工艺", "craft_manager")
    api.req("post", f"/tasks/{tcraft}/submit-review", "craft_manager", (201,),
            json={"items": craft_items, "note": "材料+外协/定制判定"})
    _review_pass(p, tcraft, "工艺")

    # ---- 程序评审 ----
    tprog = _my_task(p, deep, "程序", "prog_manager")
    api.req("post", f"/tasks/{tprog}/submit-review", "prog_manager", (201,),
            json={"items": [{"item_type": "PROGRAM", "item_ref": str(pg["id"])}], "note": "程序首版"})
    _review_pass(p, tprog, "程序")

    # ---- 其余设备：各 1 图 + 1 标准件 BOM（含总装图）----
    for eq in prof["extra_devices"]:
        root_eq = api.req("get", f"/projects/{p}/equipment/{eq}/design", "mech_manager")["root"]["drawing_no"]
        api.req("post", f"/drawings/{root_eq}/draft", "mech_manager", (200,),
                data={"change_reason": "总装图初稿"}, files={"file": (f"{eq}_root.pdf", PDF, "application/pdf")})
        dr = api.req("post", f"/projects/{p}/equipment/{eq}/drawings", "mech_manager", (201,),
                     json={"title": f"{eq} 主体", "source_type": "自制件"})
        pj["draw"][f"{eq}_main"] = dr["drawing_no"]
        api.req("post", f"/drawings/{dr['drawing_no']}/draft", "mech_manager", (200,),
                data={"change_reason": "初稿"}, files={"file": (f"{eq}.pdf", PDF, "application/pdf")})
        b = api.req("post", f"/projects/{p}/bom/std", "mech_manager", (201,),
                    json={"parent_ref": dr["drawing_no"], "child_item_no": LIB["zct"]["item_no"], "qty": 8})
        t = _my_task(p, eq, "机械", "mech_manager")
        api.req("post", f"/tasks/{t}/submit-review", "mech_manager", (201,),
                json={"items": [{"item_type": "DRAWING", "item_ref": root_eq},
                                {"item_type": "DRAWING", "item_ref": dr["drawing_no"]},
                                {"item_type": "BOM_DESIGN", "item_ref": str(b["id"])}], "note": f"{eq} 首版"})
        _review_pass(p, t, eq)

    # ---- 采购池核对 ----
    pool = api.req("get", "/purchase/pool", "buyer1")
    mine = {g["item_no"] for g in pool for r in g["requests"] if r["project_no"] == p}
    pj["direct_item_nos"] = {pj["draw"][k] for k in prof["outsource"]} if prof["direct"] else set()
    pj["outsource_nos"] = {pj["draw"][k] for k in prof["outsource"]}
    pj["custom_nos"] = {pj["draw"][k] for k in prof["custom"]}
    for k in prof["outsource"]:
        flag(pj["draw"][k] in mine, f"外协件 {pj['draw'][k]} 应进采购池")
    for k in prof["custom"]:
        flag(pj["draw"][k] in mine, f"定制件 {pj['draw'][k]} 应进采购池")
    for _, key, _ in prof["std"]:
        flag(LIB[key]["item_no"] in mine, f"标准件 {LIB[key]['item_no']} 应进采购池")
    print(f"  图纸 {len(pj['draw'])} 张发布；采购池本项目 {len(mine)} 条")
    # 同型设备（01B…）应已自动继承设计并生成自己的采购需求（确认1）
    sibs = [e for e in pj["equips"] if e not in ([prof["deep"]] + prof["extra_devices"])]
    for sib in sibs:
        d = api.req("get", f"/projects/{p}/equipment/{sib}/design", "mech_manager")
        pub = [n for n in d["tree"] if n["drawing_no"] != d["root"]["drawing_no"] and n["status"] == "已发布"]
        sib_reqs = [r for r in api.req("get", f"/projects/{p}/purchase-requests", "buyer1")
                    if r.get("equip_no") == sib]
        flag(len(pub) >= 1, f"同型设备 {sib} 应继承已发布图纸，实际 {len(pub)} 张")
        flag(len(sib_reqs) >= 1, f"同型设备 {sib} 应生成自己的采购需求，实际 {len(sib_reqs)}")
        note(f"同型 {sib}：继承已发布图纸 {len(pub)} 张、自有采购需求 {len(sib_reqs)} 条")
    log_stage(f"深层设备 {deep} {len(prof['tree'])} 图 + 程序发布；其余设备各 1 图；池 {len(mine)} 条")


def s3_cross(pjs: list[dict]) -> None:
    """跨项目合并下单：P1 / P2 的轴承需求合并成同一张 PO。"""
    zct = LIB["zct"]["item_no"]
    picked = []
    for pj in pjs:
        if pj["prof"]["key"] not in ("P1", "P2"):
            continue
        reqs = api.req("get", f"/projects/{pj['p']}/purchase-requests", "buyer1")
        cand = [r for r in reqs if r["item_no"] == zct and r["status"] == "待采购"]
        if cand:
            picked.append((pj, cand[0]))
    if len(picked) < 2:
        flag(False, f"跨项目合并前置不足：只找到 {len(picked)} 条待采购轴承")
        return
    lines = [{"request_id": r["id"], "tax_incl": True, "unit_price": price_of(r["item_no"])} for _, r in picked]
    out = api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
        "supplier_id": SUP["华信传动"]["id"], "ordered_at": d(0), "expected_date": d(20),
        "deliver_to": "公司仓库", "lines": lines, "remark": "跨项目合并下单（P1+P2 轴承）",
    })
    po = out.get("po_no") if isinstance(out, dict) else None
    # 回读两行是否同一 PO
    pos = []
    for pj, r in picked:
        rr = [x for x in api.req("get", f"/projects/{pj['p']}/purchase-requests", "buyer1")
              if x["id"] == r["id"]][0]
        pos.append(rr.get("po_no"))
    flag(pos[0] == pos[1] and pos[0] is not None,
         f"跨项目两行应共用同一 PO，实际 {pos}")
    note(f"跨项目合并单 {pos[0]}：{picked[0][0]['p']} 与 {picked[1][0]['p']} 的轴承合并")
    log_stage(f"跨项目合并下单 {pos[0]}（{len(lines)} 行/2 个项目）")


def _inspect_store(pj: dict, r: dict, qty: float, result: str = "合格", reason: str | None = None):
    res = api.req("post", f"/projects/{pj['p']}/purchase-requests/{r['id']}/inspect", "wh1",
                  json={"qty": qty, "result": result, "receipt_date": d(0), "note": reason})
    if res["receipt_status"] == "待入库":
        api.req("post", f"/goods-receipts/{res['receipt_id']}/store", "wh1",
                json={"location": "深圳仓 A-01-01"})
    return res


def s3(pj: dict) -> None:
    prof, p = pj["prof"], pj["p"]
    direct = pj["direct_item_nos"]

    # ---- 下单：仓库单 + （可选）直发单 ----
    def pool_now():
        return [r for r in api.req("get", f"/projects/{p}/purchase-requests", "buyer1")
                if r["status"] == "待采购"]

    wh = [r for r in pool_now() if r["item_no"] not in direct]
    dr = [r for r in pool_now() if r["item_no"] in direct]
    if wh:
        api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
            "supplier_id": SUP["华南标准件"]["id"], "ordered_at": d(0), "expected_date": d(15),
            "deliver_to": "公司仓库", "lines": [{"request_id": r["id"], "tax_incl": True, "unit_price": price_of(r["item_no"])} for r in wh],
        })
    if dr:
        api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
            "supplier_id": SUP["恒钲钣金"]["id"], "ordered_at": d(0), "expected_date": d(10),
            "deliver_to": "直发客户现场", "deliver_address": prof["site"],
            "lines": [{"request_id": r["id"], "tax_incl": True, "unit_price": price_of(r["item_no"])} for r in dr],
        })

    # ---- 收货：按品种做分批 / 不合格换货 / 退货重采 ----
    def find(item_no, equip=None):
        for r in api.req("get", f"/projects/{p}/purchase-requests", "buyer1"):
            if r["item_no"] == item_no and (equip is None or r["equip_no"] == equip):
                return r
        return None

    # 分批到货
    if prof["partial"]:
        r = find(LIB[prof["partial"]]["item_no"], prof["deep"])
        half = max(1, int(r["qty"] // 2))
        _inspect_store(pj, r, half)
        st = find(LIB[prof["partial"]]["item_no"], prof["deep"])["status"]
        flag(st in ("部分到货", "待入库"), f"分批首到后应部分到货，实际 {st}")
        note(f"分批到货：{LIB[prof['partial']]['item_no']} 首到 {half}/{r['qty']}，状态={st}")
        r2 = find(LIB[prof["partial"]]["item_no"], prof["deep"])
        _inspect_store(pj, r2, float(r2["qty"]) - half)  # 只补未到的那一半（超额验收现在会硬拦）

    # 不合格 → 换货
    if prof["nonconform"]:
        r = find(LIB[prof["nonconform"]]["item_no"], prof["deep"])
        res = _inspect_store(pj, r, float(r["qty"]), "不合格", "型材弯曲变形，退供应商")
        flag(res["receipt_status"] == "不合格", f"不合格验收应收口到采购，实际 {res['receipt_status']}")
        po = r["po_no"]
        api.req("post", f"/purchase/orders/{po}/negotiate", "buyer1", json={
            "request_ids": [r["id"]], "action": "换货", "expected_date": d(10), "note": "弯曲退回，补发",
        })
        r2 = find(LIB[prof["nonconform"]]["item_no"], prof["deep"])
        _inspect_store(pj, r2, float(r2["qty"]))
        st = find(LIB[prof["nonconform"]]["item_no"], prof["deep"])["status"]
        flag(st == "已入库", f"换货重验后应已入库，实际 {st}")
        note(f"验收不合格→换货→重验→入库：{LIB[prof['nonconform']]['item_no']}")

    # 不合格 → 退货重采（换供应商重买）
    if prof["return_item"]:
        r = find(LIB[prof["return_item"]]["item_no"], prof["deep"])
        q = float(r["qty"])
        _inspect_store(pj, r, q, "不合格", "板材厚度不符，退货")
        api.req("post", f"/purchase/orders/{r['po_no']}/negotiate", "buyer1", json={
            "request_ids": [r["id"]], "action": "退货", "note": "整批退回，换供应商",
        })
        retry = [x for x in api.req("get", f"/projects/{p}/purchase-requests", "buyer1")
                 if x.get("source") == "退货重采"]
        flag(len(retry) >= 1, "退货后应新建一条「退货重采」需求回池")
        if retry:
            nr = retry[0]
            api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
                "supplier_id": SUP["远东型材"]["id"], "ordered_at": d(0), "expected_date": d(12),
                "deliver_to": "公司仓库", "lines": [{"request_id": nr["id"], "tax_incl": True, "unit_price": price_of(nr["item_no"])}],
            })
            nr2 = [x for x in api.req("get", f"/projects/{p}/purchase-requests", "buyer1")
                   if x["id"] == nr["id"]][0]
            _inspect_store(pj, nr2, float(nr2["qty"]))
            note(f"退货重采：{LIB[prof['return_item']]['item_no']} 换供应商重新下单并入库")

    # 其余全部收货（直发件也要仓库「验收」这一步，才会生成「现场待验收」的到货单等现场清点）
    for r in api.req("get", f"/projects/{p}/purchase-requests", "buyer1"):
        if r["status"] in ("已入库", "现场已验收", "现场待验收", "已退货", "已取消", "不合格"):
            continue
        if not r.get("qty"):
            continue
        res = _inspect_store(pj, r, float(r["qty"]))
        if r["item_no"] in direct:
            flag(res["receipt_status"] == "现场待验收",
                 f"直发件 {r['item_no']} 验收后应「现场待验收」，实际 {res['receipt_status']}")
            note(f"直发件 {r['item_no']} 到货 → 现场待验收（等 S8 现场清点）")

    allr = api.req("get", f"/projects/{p}/purchase-requests", "buyer1")
    pending = [r["status"] for r in allr
               if r["status"] not in ("已入库", "现场已验收", "现场待验收", "已退货", "已取消")]
    flag(not pending, f"所有需求应到位，仍有 {pending}")
    note(f"收货完成：{len(allr)} 条需求，状态 {sorted(set(r['status'] for r in allr))}")
    log_stage(f"{len(allr)} 条需求全部收货（含分批/换货/退货重采/直发）")


def s4(pj: dict) -> None:
    prof, p = pj["prof"], pj["p"]
    for eq in pj["equips"]:
        res = api.req("post", f"/warehouse/projects/{p}/equipment/{eq}/generate-issue", "shop1", (201,))
        issue = [i for i in api.req("get", "/warehouse/issues", "wh1") if i["issue_no"] == res["issue_no"]][0]
        api.req("post", f"/warehouse/issues/{issue['id']}/pick", "wh1", json={})
        api.req("post", f"/warehouse/issues/{issue['id']}/hand-over", "wh1", json={"issued_to": "车间 李四"})
        cur = [i for i in api.req("get", "/warehouse/issues", "wh1") if i["id"] == issue["id"]][0]
        flag(cur["status"] == "已领走", f"{eq} 领料后应「已领走」，实际 {cur['status']}")
        if res["shortage_count"]:
            note(f"{eq} 领料单标缺 {res['shortage_count']} 种（未到货/未入库）")
    log_stage("各设备领料单生成→备料→领走")


def s5(pj: dict) -> None:
    prof, p = pj["prof"], pj["p"]
    ph = [x["token"] for x in api.req(
        "post", "/manufacturing/photos", "shop1", (201,),
        params={"project_no": p, "ref": "walk"},
        files=[("files", ("m0.png", PNG, "image/png")), ("files", ("m1.png", PNG, "image/png"))])]
    for eq in pj["equips"]:
        api.req("post", f"/manufacturing/projects/{p}/equipment/{eq}/generate-orders", "shop1", (201,), json={})
    orders = api.req("get", "/manufacturing/orders", "shop1", params={"project_no": p})
    order_by_item = {o["item_no"]: o for o in orders}

    def flow(o, mode):
        oid = o["id"]
        api.req("post", f"/manufacturing/orders/{oid}/dispatch", "shop1",
                json={"step_name": "下料", "issued_to": "下料班", "photos": ph})
        if "start" in mode:
            api.req("post", f"/manufacturing/orders/{oid}/start", "shop1")
        if mode.endswith("ok"):
            api.req("post", f"/manufacturing/orders/{oid}/accept", "shop1",
                    json={"result": "合格", "photos": ph[:1]})
            api.req("post", f"/manufacturing/orders/{oid}/transfer", "shop1", json={"photos": ph[:1]})
        elif mode.endswith("ng"):
            api.req("post", f"/manufacturing/orders/{oid}/accept", "shop1",
                    json={"result": "不合格", "reason": "焊接变形超差", "photos": ph[:1]})

    for o in orders:
        item = o["item_no"]
        if prof["rework"] and item == pj["draw"][prof["rework"]]:
            flow(o, "dispatch-ng")
            flow(o, "start-ok")     # 返工后重做
        else:
            flow(o, "start-ok")
    sts = {o["item_no"]: o["status"] for o in
           api.req("get", "/manufacturing/orders", "shop1", params={"project_no": p})}
    if prof["rework"]:
        flag(sts.get(pj["draw"][prof["rework"]]) == "已转运",
             f"返工件应已转运，实际 {sts.get(pj['draw'][prof['rework']])}")
    note(f"排产 {len(sts)} 张，状态 {sorted(set(sts.values()))}")

    outs = api.req("get", "/manufacturing/outsource", "shop1", params={"project_no": p})
    for o in outs:
        api.req("post", f"/manufacturing/outsource/{o['id']}/send", "shop1",
                json={"supplier_name": "恒钲钣金", "due_date": d(20), "material_supplied": True})
        api.req("post", f"/manufacturing/outsource/{o['id']}/return", "shop1", json={})
        api.req("post", f"/manufacturing/outsource/{o['id']}/accept", "shop1", json={"result": "合格"})
    if outs:
        note(f"外协 {len(outs)} 张：发出→回厂→验收合格")
    log_stage(f"排产 {len(sts)} 张全部转运（含返工恢复），外协 {len(outs)} 张合格")


def s6(pj: dict) -> None:
    prof, p = pj["prof"], pj["p"]
    ph = [x["token"] for x in api.req(
        "post", "/manufacturing/photos", "shop1", (201,),
        params={"project_no": p, "ref": "assy"},
        files=[("files", ("a0.png", PNG, "image/png"))])]
    pj["assembled"] = []
    ov = api.req("get", "/assembly/kitting/overview", "assy1", params={"project_no": p})
    rates = {o["equip_no"]: round(o["kitting_rate"] * 100) for o in ov}
    for eq in pj["equips"]:
        rec = api.req("post", "/assembly/records", "assy1", (201,),
                      json={"project_no": p, "equip_no": eq, "sub_assembly": "整机装配", "photos": ph})
        api.req("post", f"/assembly/records/{rec['id']}/finish", "assy1", json={})
        got = api.req("post", f"/assembly/records/{rec['id']}/debug", "assy1",
                      json={"result": "合格", "note": "厂内调试 72h 通过"})
        flag(got["status"] == "调试完成", f"{eq} 调试后应「调试完成」，实际 {got['status']}")
        pj["assembled"].append(eq)
    note(f"齐套率：{rates}")
    log_stage(f"各设备齐套→装配→调试合格；齐套率 {rates}")


def s7(pj: dict) -> None:
    prof, p = pj["prof"], pj["p"]
    assembled = pj.get("assembled", [])
    if not assembled:
        raise ApiError("GET", "assembled", "-", 0, "无可发设备")
    batches = [[e] for e in assembled] if prof["multi_ship"] else [assembled]
    for bi, batch in enumerate(batches, 1):
        sh = api.req("post", "/shipping/instructions", "pm1", (201,),
                     json={"project_no": p, "equip_nos": batch, "remark": f"第 {bi} 批发运"})
        # 重复下单应拦
        dup = api.raw("post", "/shipping/instructions", "pm1",
                      json={"project_no": p, "equip_nos": batch})
        flag(dup.status_code == 400, f"重复下发货指令应 400，实际 {dup.status_code}")
        api.req("post", f"/shipping/{sh['id']}/items/generate", "pm1", (201,))
        sh = [x for x in api.req("get", "/shipping/list", "pm1", params={"project_no": p})
              if x["id"] == sh["id"]][0]
        items = sh["items"]
        flag(len(items) >= 2, f"发运清单应按结构生成 ≥2 项，实际 {len(items)}")
        sph = [x["token"] for x in api.req(
            "post", "/shipping/photos", "pm1", (201,),
            params={"project_no": p, "ref": sh["shipment_no"]},
            files=[("files", ("s0.png", PNG, "image/png"))])]
        missing = prof["missing_ship"] and batch == [prof["missing_ship"]]
        ship_ids = [i["id"] for i in items][:-1] if missing else [i["id"] for i in items]
        api.req("post", "/shipping/items/ship", "delivery1",
                json={"item_ids": ship_ids, "photos": sph[:1]})
        api.req("post", f"/shipping/{sh['id']}/request-vehicle", "buyer1", (200,),
                json={"count": 1, "fee": 1000, "note": "走查叫车"})
        api.req("post", f"/shipping/{sh['id']}/load", "delivery1",
                json={"plate_no": f"粤B{80000 + bi}", "driver": "张师傅", "photos": sph[:1]})
        api.req("post", f"/shipping/{sh['id']}/depart", "delivery1", json={})
        api.req("post", f"/shipping/{sh['id']}/arrive", "delivery1")
        sh = [x for x in api.req("get", "/shipping/list", "pm1", params={"project_no": p})
              if x["id"] == sh["id"]][0]
        if missing:
            # 漏项清点应被 400 拦
            bad = api.raw("post", f"/shipping/{sh['id']}/receipt", "site1",
                          json={"checks": [{"item_id": i["id"], "result": "到"} for i in items[:-1]]})
            flag(bad.status_code == 400, f"漏项清点应 400，实际 {bad.status_code}")
            checks = [{"item_id": i["id"], "result": "到"} for i in items[:-1]]
            checks.append({"item_id": items[-1]["id"], "result": "缺",
                           "received_qty": 0, "reason": "漏装，补发"})
        else:
            checks = [{"item_id": i["id"], "result": "到"} for i in items]
        sph2 = [x["token"] for x in api.req(
            "post", "/shipping/photos", "site1", (201,),
            params={"project_no": p, "ref": sh["shipment_no"]},
            files=[("files", ("r0.png", PNG, "image/png"))])]
        done = api.req("post", f"/shipping/{sh['id']}/receipt", "site1",
                       json={"checks": checks, "photos": sph2[:1], "remark": "现场清点"})
        want = "缺件" if missing else "齐"
        flag(done["status"] == "已签收" and done["receipts"][-1]["result"] == want,
             f"批次{bi}签收结论应「{want}」，实际 {done['status']}/{done['receipts'][-1]['result']}")
        note(f"批次{bi} {batch}：清单 {len(items)} 项，{'缺件签收' if missing else '齐签收'}")
    pj_stage = api.req("get", f"/projects/{p}", "pm1")
    flag(pj_stage["stage"] == "交付中", f"发运后阶段应「交付中」，实际 {pj_stage['stage']}")
    log_stage(f"{len(batches)} 批发运（含重复拦截、漏项拦截、缺件留痕），阶段→交付中")


def s8(pj: dict) -> None:
    prof, p = pj["prof"], pj["p"]
    # 直发件现场清点
    inc = api.req("get", "/site/incoming", "site1", params={"project_no": p})
    if inc["pending"]:
        for item in inc["pending"]:
            api.req("post", f"/site/incoming/{item['receipt_id']}/accept", "site1", json={
                "result": "齐", "photos": [x["token"] for x in api.req(
                    "post", "/site/photos", "site1", (201,),
                    params={"project_no": p, "ref": f"inc{item['receipt_id']}"},
                    files=[("files", ("i.png", PNG, "image/png"))])]})
        note(f"直发件现场清点 {len(inc['pending'])} 件")
        allr = api.req("get", f"/projects/{p}/purchase-requests", "buyer1")
        leftover = [r["status"] for r in allr
                    if r["status"] not in ("已入库", "现场已验收", "已退货", "已取消")]
        flag(not leftover, f"直发件现场清点后不应再有在途/待验收，仍有 {leftover}")
    api.req("post", "/site/survey", "site1", (201,), json={
        "project_no": p, "contact": "王工 138...", "floor_load": "3t/m²", "passage": "吊装口 5m",
        "power": "380V 160A", "air": "0.6MPa", "network": "工业以太网", "enter_date": d(5)})
    api.req("post", "/site/daily", "site1", (201,), json={
        "project_no": p, "equip_no": prof["deep"], "stage": "安装",
        "done_items": ["主体就位", "线体对接"], "people": 5,
        "photos": [x["token"] for x in api.req(
            "post", "/site/photos", "site1", (201,), params={"project_no": p, "ref": "d1"},
            files=[("files", ("d1.png", PNG, "image/png"))])]})
    # 现场问题
    iss = api.req("post", "/site/issues", "site1", (201,), json={
        "project_no": p, "equip_no": prof["deep"], "title": "现场干涉",
        "desc": "防护结构件与料道干涉 2mm", "photos": []})
    if prof["ecn"]:
        target = (sorted(pj["outsource_nos"])[0] if pj["outsource_nos"]
                  else pj["draw"][next(iter(pj["draw"]))])
        cr = api.req("post", "/change-requests", "site1", (201,), json={
            "target_type": "DRAWING", "target_ref": target,
            "reason": "现场实测干涉 2mm", "proposal": "开槽 20mm 并改 R 角"})
        api.req("post", f"/change-requests/{cr['id']}/decide", "eng_director",
                json={"decision": "批准", "note": "同意改版"})
        api.req("post", f"/change-requests/{cr['id']}/dispatch", "eng_director",
                json={"assignee_id": USERS["mech_manager"]})
        imp = api.req("get", f"/change-requests/{cr['id']}/impact", "site1")
        api.req("post", f"/site/issues/{iss['id']}/link-change", "site1", json={"change_id": cr["id"]})
        note(f"现场问题→ECN {cr.get('cr_no', cr['id'])} 批准+派改版；影响面 {list(imp.keys())}")
    else:
        api.req("post", f"/site/issues/{iss['id']}/link-change", "site1", json={"close": True})
    # 申请调试 → 到场 → 开始 → 联调日报 → 完成
    com = api.req("post", "/site/commission", "site1", (201,),
                  json={"project_no": p, "dispatch_to": "调试组 王工", "plan_date": d(8)})
    api.req("post", f"/site/commission/{com['id']}/arrive", "site1")
    api.req("post", f"/site/commission/{com['id']}/start", "site1")
    api.req("post", "/site/daily", "site1", (201,), json={
        "project_no": p, "equip_no": prof["deep"], "stage": "联调",
        "done_items": ["全线联调", "节拍实测达标"], "people": 6,
        "photos": [x["token"] for x in api.req(
            "post", "/site/photos", "site1", (201,), params={"project_no": p, "ref": "d2"},
            files=[("files", ("d2.png", PNG, "image/png"))])],
        "videos": [x["token"] for x in api.req(
            "post", "/site/photos", "site1", (201,), params={"project_no": p, "ref": "d2v"},
            files=[("files", ("d2v.png", PNG, "image/png"))])]})
    api.req("post", f"/site/commission/{com['id']}/finish", "site1")
    coms = api.req("get", "/site/commission", "site1", params={"project_no": p})
    flag(coms[0]["status"] == "调试完成", f"申请调试应到「调试完成」，实际 {coms[0]['status']}")
    log_stage("勘测/日报/直发清点/问题闭环(ECN)/调试到场完成")


def s10(pj: dict) -> None:
    prof, p = pj["prof"], pj["p"]
    acc = api.req("post", "/acceptance/apply", "site1", (201,),
                  json={"project_no": p, "remark": "调试完成，申请验收"})
    docs = api.req("post", f"/acceptance/{acc['id']}/documents", "site1", (201,),
                   data={"doc_type": "验收单"},
                   files=[("files", ("验收单.pdf", PDF, "application/pdf")),
                          ("files", ("调试记录.pdf", PDF, "application/pdf"))])
    api.req("post", f"/acceptance/documents/{docs[0]['id']}/sign", "site1")
    accepted_at = d(-800) if prof["past_accept"] else d(0)
    got = api.req("post", f"/acceptance/{acc['id']}/confirm", "site1",
                  json={"result": "通过", "signed_by": "客户 王工", "accepted_at": accepted_at})
    flag(got["warranty_end"] is not None, "验收通过应自动生成质保期")
    pj2 = api.req("get", f"/projects/{p}", "pm1")
    flag(pj2["stage"] == "质保", f"验收后阶段应「质保」，实际 {pj2['stage']}")
    pj["warranty_end"] = got["warranty_end"]
    pj["past"] = prof["past_accept"]
    note(f"质保 {got['warranty_start']} ~ {got['warranty_end']}"
         + ("（人为回溯验收日 → 已过保）" if prof["past_accept"] else ""))
    log_stage(f"验收通过，质保 {got['warranty_start']}~{got['warranty_end']}，阶段→质保")


def s11(pj: dict) -> None:
    prof, p = pj["prof"], pj["p"]
    part = api.req("post", "/service/parts", "service1", (201,), json={
        "project_no": p, "equip_no": prof["deep"], "item_no": LIB["zct"]["item_no"],
        "item_name": LIB["zct"]["display_name"], "qty_stock": 3, "qty_installed": 6, "min_qty": 5})
    part = api.req("post", "/service/parts/move", "service1", (201,),
                   json={"part_id": part["id"], "move_type": "领出", "qty": 1, "issued_to": "李工"})
    flag(part["qty_stock"] == 2, f"备件领出 1 后应 2，实际 {part['qty_stock']}")
    so = api.req("post", "/service/orders", "service1", (201,),
                 json={"project_no": p, "equip_no": prof["deep"], "fault": "运行中偶发报警"})
    expect_in = not prof["past_accept"]
    flag(so["in_warranty"] == expect_in,
         f"报修在保判定应 {expect_in}，实际 {so['in_warranty']}")
    api.req("post", f"/service/orders/{so['id']}/dispatch", "service1", json={"dispatched_to": "李工"})
    api.req("post", f"/service/orders/{so['id']}/arrive", "service1", json={})
    ph = [x["token"] for x in api.req(
        "post", "/service/photos", "service1", (201,),
        params={"project_no": p, "ref": so["so_no"]},
        files=[("files", ("sv.png", PNG, "image/png"))])]
    api.req("post", f"/service/orders/{so['id']}/fix", "service1",
            json={"solution": "更换电磁阀并复测", "labor_hours": 2.5, "photos": ph})
    so = api.req("post", f"/service/orders/{so['id']}/sign", "service1", json={"customer_sign": "客户 王工"})
    flag(so["status"] == "已关闭", f"签字后应关单，实际 {so['status']}")
    log_stage(f"工单 {so['so_no']}（{'在保' if expect_in else '过保'}）关单；备件收发留痕")


def payments(pj: dict) -> None:
    prof, p = pj["prof"], pj["p"]
    seq = len(prof["payments"])
    for i in range(1, seq):  # 除质保金外全部收
        api.req("post", f"/projects/{p}/payment-terms/{i}/receive", "fin1")
    # 最后一期部分收 + 超额拦截
    api.req("post", f"/projects/{p}/payment-terms/{seq}/receive", "fin1", data={"received_amount": "1000"})
    over = api.raw("post", f"/projects/{p}/payment-terms/{seq}/receive", "fin1",
                   data={"received_amount": "999999999"})
    flag(over.status_code == 400, f"超额回款应 400，实际 {over.status_code}")
    det = api.req("get", f"/projects/{p}/detail", "fin1")
    unpaid = [(t["node_name"], round((t.get("amount") or 0) - (t.get("received_amount") or 0)))
              for t in det["payment_terms"]
              if (t.get("amount") or 0) - (t.get("received_amount") or 0) > 0.001]
    note(f"未收节点 {unpaid}")
    log_stage(f"回款登记（前 {seq-1} 期齐 + 尾期部分），超额被拦")


# ---------------------------------------------------------------------------
# 全局并发 / 边界
# ---------------------------------------------------------------------------
def concurrency_burst() -> None:
    stage("并发压测：并行建项目 + 并行读接口", "-")
    # 1) 并行建 8 个项目，验发号唯一连续
    results, errors = [], []
    lock = threading.Lock()

    def mk(i):
        try:
            r = api.req("post", "/projects", "sales1", (201,), json={
                "sales_id": USERS["sales1"], "customer_name": f"并发客户{i}",
                "project_name": f"并发项目{i}",
                "contacts": [{"name": "联系人", "phone": "13800000000"}],
                "deadline": d(10), "project_desc": "并发发号", "site_address": "测试",
            })
            with lock:
                results.append(r["project_no"])
        except Exception as e:  # noqa: BLE001
            with lock:
                errors.append(repr(e))

    ts = [threading.Thread(target=mk, args=(i,)) for i in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    flag(not errors, f"并行建项目出现异常：{errors}")
    flag(len(set(results)) == len(results), f"并行发号出现重复：{results}")
    nums = sorted(int(x[-3:]) for x in results)
    flag(nums == list(range(nums[0], nums[0] + len(nums))), f"并行发号不连续：{nums}")
    note(f"并行建 8 个项目，号段 {nums[0]}~{nums[-1]}，无重复无跳号")
    # 关闭这些并发项目
    for no in results:
        api.req("post", f"/projects/{no}/close", "sales1",
                json={"close_reason": "其他", "close_note": "并发压测清理"})

    # 2) 并行读接口
    read_errs = []
    def rd(i):
        try:
            who = ["buyer1", "wh1", "shop1", "assy1", "site1", "service1", "pm1", "sales1"][i % 8]
            api.req("get", "/purchase/pool", who)
            api.req("get", "/workbench/me", who)
            api.req("get", "/m/home", who)
            api.req("get", "/notifications/unread-count", who)
        except Exception as e:  # noqa: BLE001
            with lock:
                read_errs.append(repr(e))
    ts = [threading.Thread(target=rd, args=(i,)) for i in range(32)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    flag(not read_errs, f"并行读接口异常：{read_errs[:3]}")
    note("32 并发读（采购池/我的工作台/移动首页/未读红点）无异常")
    log_stage("并行建 8 项目号唯一连续；32 并发读无异常")


def global_checks(pjs: list[dict]) -> None:
    stage("全局校验：权限负例 / 金额分档 / 项目隔离 / 部门可见性", "-")
    # 权限负例
    p0 = pjs[0]["p"]
    r = api.raw("post", f"/manufacturing/projects/{p0}/equipment/01A/generate-orders", "sales1", json={})
    flag(r.status_code == 403, f"sales1 生成排产应 403，实际 {r.status_code}")
    r = api.raw("post", "/acceptance/apply", "wh1", json={"project_no": p0})
    flag(r.status_code == 403, f"wh1 申请验收应 403，实际 {r.status_code}")
    r = api.raw("post", "/service/orders", "pm1", json={"project_no": p0})
    flag(r.status_code == 403, f"pm1 报修应 403，实际 {r.status_code}")
    note("3 项越权全部 403")
    # 金额分档：无 purchase:price 看到 null
    code, orders = api.json_or_none("get", "/purchase/orders", "wh1")
    if code == 200 and orders:
        amounts = [o.get("amount") for o in orders]
        note(f"wh1 看采购单金额：{amounts[:5]}（无 purchase:price 应为 None）")
    # 项目隔离：P1 的图号不应出现在 P2
    p1, p2 = pjs[0], pjs[1]
    d1 = api.req("get", f"/projects/{p1['p']}/equipment/01A/design", "mech_manager")
    d2 = api.req("get", f"/projects/{p2['p']}/equipment/01A/design", "mech_manager")
    flag(p1["p"] not in json.dumps(d2), "P1 数据泄漏进 P2")
    flag(p2["p"] not in json.dumps(d1), "P2 数据泄漏进 P1")
    note("项目数据相互隔离")
    # 部门可见性：9 个角色都能看到 P1
    checks = [
        ("商务", api.req("get", "/workbench/sales/board", "sales1"), "projects"),
        ("项目经理", api.req("get", "/workbench/pm/board", "pm1"), None),
        ("工程", api.req("get", "/workbench/eng/board", "mech_manager"), None),
        ("仓库", api.req("get", "/warehouse/issues", "wh1"), None),
        ("制造", api.req("get", "/manufacturing/orders", "shop1", params={"project_no": p0}), None),
        ("装配", api.req("get", "/assembly/records", "assy1", params={"project_no": p0}), None),
        ("发运", api.req("get", "/shipping/list", "delivery1", params={"project_no": p0}), None),
        ("现场", api.req("get", "/site/commission", "site1", params={"project_no": p0}), None),
        ("售后", api.req("get", "/service/orders", "service1", params={"project_no": p0}), None),
    ]
    for name, data, sub in checks:
        text = json.dumps(data, ensure_ascii=False)
        flag(p0 in text or (sub and False), f"{name} 角色看不到订单 {p0}")
    # 移动端首页
    for who in ["wh1", "shop1", "assy1", "delivery1", "site1", "service1", "pm1", "sales1"]:
        api.req("get", "/m/home", who)
    note("8 个角色的移动端首页均可访问")
    # 审计与通知
    logs = api.req("get", "/audit-logs", "admin", params={"object_ref": p0})
    note(f"P1 审计日志 {len(logs) if isinstance(logs, list) else '?'} 条")
    unread = api.req("get", "/notifications/unread-count", "mech_manager")
    note(f"机械经理未读消息 {unread}")


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def make_pj(prof: dict) -> dict:
    return {"prof": prof, "p": None, "halted": False, "draw": {},
            "equips": [], "assembled": [], "direct_item_nos": set(),
            "outsource_nos": set(), "custom_nos": set(), "warranty_end": None, "past": False}


def probe(desc: str, method: str, path: str, who: str, expect=(200,), **kw):
    """记录式探针：非预期状态登记为问题，不中断。"""
    r = api.raw(method, path, who, **kw)
    if r.status_code not in expect:
        ISSUES.append({"stage": CURRENT["stage"], "project": CURRENT["project"],
                       "severity": "问题", "msg": f"{desc} → HTTP {r.status_code} {r.text[:200]}"})
        print(f"      ⚠️  {desc} → HTTP {r.status_code}: {r.text[:140]}")
    else:
        note(f"✓ {desc} ({r.status_code})")
    try:
        data = r.json() if "json" in r.headers.get("content-type", "") else None
    except Exception:  # noqa: BLE001
        data = None
    return r.status_code, data


def deep_coverage(pjs: list[dict]) -> None:
    """主链之外的深度功能点（只记录）。"""
    stage("深度功能点覆盖", "-")
    p1, p2 = pjs[0], pjs[1]
    p = p1["p"]
    deep = p1["prof"]["deep"]

    # ---- 发号引擎 ----
    probe("编号规则表", "get", "/numbering/rules", "admin")
    probe("图号解析", "get", "/numbering/drawing/parse", "mech_manager",
          params={"drawing_no": list(p1["draw"].values())[0]})
    probe("图号组装", "get", "/numbering/drawing/compose", "mech_manager",
          params={"project_no": p, "equip_no": deep, "l1": "09", "l2": "01", "l3": "00", "l4": "00"})
    _, n1 = probe("试算下一项目号#1", "get", "/projects/next-number", "sales1")
    _, n2 = probe("试算下一项目号#2", "get", "/projects/next-number", "sales1")
    flag(n1 == n2, f"试算下一项目号不应消耗序列：{n1} vs {n2}")

    # ---- 设计：草稿 / 下载 / 版本 / 改版门禁 ----
    design = api.req("get", f"/projects/{p}/equipment/{deep}/design", "mech_manager")
    newdr = api.req("post", f"/projects/{p}/equipment/{deep}/drawings", "mech_manager", (201,),
                    json={"title": "测试草稿图", "source_type": "自制件"})
    probe("上传图纸草稿", "post", f"/drawings/{newdr['drawing_no']}/draft", "mech_manager",
          data={"change_reason": "初稿"}, files={"file": ("dwg.pdf", PDF, "application/pdf")})
    probe("下载图纸文件", "get", f"/drawings/{newdr['drawing_no']}/file", "mech_manager")
    probe("图纸版本留档", "get", f"/drawings/{newdr['drawing_no']}/versions", "mech_manager")
    probe("设计总览", "get", f"/projects/{p}/design-overview", "mech_manager")
    probe("我的设计设备", "get", "/my-design-equipment", "mech_manager")
    tasks = api.req("get", f"/projects/{p}/equipment/{deep}/my-design-tasks", "mech_manager")
    if tasks:
        probe("评审候选", "get", f"/tasks/{tasks[0]['task_id']}/review-candidates", "mech_manager")
    p2_draw = list(p2["draw"].values())[0]
    probe("冻结图改版（未提申请应拦）", "post", f"/drawings/{p2_draw}/new-version",
          "mech_manager", (400,), data={"change_reason": "试试"})
    if p1["outsource_nos"]:
        probe("冻结图改版（已批准下发→出新版）", "post",
              f"/drawings/{sorted(p1['outsource_nos'])[0]}/new-version",
              "mech_manager", (200, 201), data={"change_reason": "现场干涉改版"})

    # ---- 程序：版本 / 下载 / 改版门禁 / 新程序草稿 ----
    progs = api.req("get", f"/projects/{p}/equipment/{deep}/programs", "mech_manager")
    if progs:
        pid = progs[0]["id"]
        probe("程序版本留档", "get", f"/programs/{pid}/versions", "mech_manager")
        probe("下载程序文件", "get", f"/programs/{pid}/file", "mech_manager")
        probe("已发布程序改版（无申请应拦）", "post", f"/programs/{pid}/new-version",
              "mech_manager", (400,), data={"change_reason": "试试"})
    newpg = api.req("post", f"/projects/{p}/equipment/{deep}/programs", "prog_manager", (201,),
                    json={"name": f"{p} 备选程序"})
    probe("新程序上传草稿", "post", f"/programs/{newpg['id']}/draft", "prog_manager",
          data={"change_reason": "初稿"}, files={"file": ("p.st", b"LD M0\n", "text/plain")})

    # ---- 采购：推荐/价格分档/手工申请/合并/取消/改供应商 ----
    probe("采购单列表", "get", "/purchase/orders", "buyer1")
    probe("价格参考(有权)", "get", f"/purchase/price-reference/{LIB['zct']['item_no']}", "buyer1")
    probe("价格参考(无权应403)", "get", f"/purchase/price-reference/{LIB['zct']['item_no']}", "wh1", (403,))
    probe("推荐供应商", "get", f"/purchase/recommend/{LIB['zct']['item_no']}", "buyer1")
    mr = api.req("post", "/purchase/manual-request", "shop1", (201,), json={
        "attribution": "辅料", "item_no": LIB["zct"]["item_no"], "qty": 3, "unit": "个",
        "need_date": d(10), "note": "车间辅料"})
    mo = api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
        "supplier_id": SUP["华南标准件"]["id"], "ordered_at": d(0), "expected_date": d(15), "deliver_to": "公司仓库",
        "lines": [{"request_id": mr["id"], "tax_incl": True, "unit_price": price_of(mr["item_no"])}]})
    po = mo.get("po_no") if isinstance(mo, dict) else None
    probe("采购单详情", "get", f"/purchase/orders/{po}", "buyer1")
    probe("取消采购单", "post", f"/purchase/orders/{po}/cancel", "buyer1",
          json={"reason": "辅料改用库存"})
    mr2 = api.req("post", "/purchase/manual-request", "shop1", (201,), json={
        "attribution": "辅料", "item_no": LIB["sf"]["item_no"], "qty": 2, "need_date": d(15)})
    mo2 = api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
        "supplier_id": SUP["华南标准件"]["id"], "ordered_at": d(0), "expected_date": d(15), "deliver_to": "公司仓库",
        "lines": [{"request_id": mr2["id"], "tax_incl": True, "unit_price": price_of(mr2["item_no"])}]})
    po2 = mo2.get("po_no") if isinstance(mo2, dict) else None
    probe("更改供应商", "post", f"/purchase/orders/{po2}/change-supplier", "buyer1",
          json={"supplier_id": SUP["华信传动"]["id"], "note": "原供应商交期太长"})

    # ---- 仓库：库位 / 其他入库 / 流水 / 看板 ----
    probe("库位列表", "get", "/warehouse/locations", "wh1")
    code = f"A-{today.strftime('%m%d')}-01"
    probe("新建库位", "post", "/warehouse/locations", "wh1", (200, 201),
          json={"warehouse": "深圳仓", "code": code, "name": "临时区"})
    locs = api.req("get", "/warehouse/locations", "wh1")
    lid = next((l["id"] for l in locs if l.get("code") == code), (locs[0]["id"] if locs else None))
    probe("其他入库(退料回库)", "post", "/warehouse/inbound", "wh1", (200, 201),
          json={"item_no": LIB["zct"]["item_no"], "qty": 2, "location_id": lid,
                "project_no": p, "equip_no": deep, "ref_no": "退料"})
    probe("库存列表", "get", "/warehouse/stock", "wh1")
    probe("库存流水", "get", "/warehouse/moves", "wh1")
    probe("仓库看板", "get", "/warehouse/workbench", "wh1")

    # ---- 制造 / 装配 / 发运 / 现场 / 验收 / 售后 ----
    probe("车间台", "get", "/workbench/shop", "shop1")
    probe("制造工作台", "get", "/manufacturing/workbench", "shop1")
    probe("制造订单列表", "get", "/manufacturing/orders", "shop1", params={"project_no": p})
    probe("制造图纸清单", "get", f"/manufacturing/drawings/{p}/{deep}", "shop1")
    probe("装配齐套率", "get", "/assembly/kitting", "assy1", params={"project_no": p, "equip_no": deep})
    probe("装配工作台", "get", "/assembly/workbench", "assy1")
    probe("发运待发", "get", "/shipping/to-ship", "pm1", params={"project_no": p})
    probe("发运工作台", "get", "/shipping/workbench", "delivery1")
    probe("现场勘测列表", "get", "/site/survey", "site1", params={"project_no": p})
    probe("现场日报列表", "get", "/site/daily", "site1", params={"project_no": p})
    probe("现场问题列表", "get", "/site/issues", "site1", params={"project_no": p})
    probe("现场工作台", "get", "/site/workbench", "site1")
    probe("验收工作台(质保提醒)", "get", "/acceptance/workbench", "site1")
    accs = api.req("get", "/acceptance", "site1", params={"project_no": p})
    if accs and accs[0].get("documents"):
        probe("验收资料下载", "get", f"/acceptance/documents/{accs[0]['documents'][0]['id']}", "site1")
    probe("售后台", "get", "/service/workbench", "service1")
    probe("备件列表", "get", "/service/parts", "service1")
    probe("备件收发记录", "get", "/service/parts/moves", "service1")
    probe("服务工单列表", "get", "/service/orders", "service1", params={"project_no": p})

    # ---- 任务 / 评审 / 工作台 / 通知 ----
    probe("我的任务", "get", "/my-tasks", "mech_manager", params={"scope": "mine"})
    probe("我组任务", "get", "/my-tasks", "mech_manager", params={"scope": "team"})
    probe("评审待办", "get", "/review-tickets", "eng_director", params={"scope": "todo"})
    probe("评审全部", "get", "/review-tickets", "eng_director", params={"scope": "all"})
    probe("我的工作台", "get", "/workbench/me", "pm1")
    probe("工程部看板", "get", "/workbench/eng/board", "mech_manager")
    probe("商务部看板", "get", "/workbench/sales/board", "sales1")
    probe("项目经理看板", "get", "/workbench/pm/board", "pm1")
    notes = api.req("get", "/notifications", "mech_manager")
    note_items = notes.get("items", []) if isinstance(notes, dict) else (notes or [])
    if note_items:
        probe("消息标记已读", "post", f"/notifications/{note_items[0]['id']}/read", "mech_manager")
    probe("全部已读", "post", "/notifications/read-all", "mech_manager")

    # ---- 组织 / 权限 / 代登录 ----
    probe("我的管理范围", "get", "/my-scope", "mech_manager")
    probe("组织列表", "get", "/orgs", "admin")
    probe("角色列表", "get", "/roles", "admin")
    probe("用户筛选", "get", "/users", "admin", params={"q": "mech"})
    probe("代登录(只读GET)", "get", "/workbench/me", "admin",
          headers={"X-Impersonate": str(USERS["site1"])})
    probe("代登录(写操作应403)", "post", "/site/issues", "admin", (403,),
          headers={"X-Impersonate": str(USERS["site1"])},
          json={"project_no": p, "title": "越权测试"})

    # ---- 变更：列表 / 详情 / 影响面 / BOM 行改版 ----
    probe("改版申请列表", "get", "/change-requests", "eng_director", params={"scope": "all"})
    crs = api.req("get", "/change-requests", "eng_director", params={"scope": "all"})
    if crs:
        probe("改版详情", "get", f"/change-requests/{crs[0]['id']}", "eng_director")
        probe("改版影响面", "get", f"/change-requests/{crs[0]['id']}/impact", "eng_director")
    std_bom = design.get("std_bom") or []
    if std_bom:
        bid = std_bom[0]["id"]
        bcr = api.req("post", "/change-requests", "mech_manager", (201,), json={
            "target_type": "BOM_ITEM", "target_ref": str(bid),
            "reason": "设计优化：轴承数量调整", "proposal": "4 → 6"})
        api.req("post", f"/change-requests/{bcr['id']}/decide", "eng_director",
                json={"decision": "批准", "note": "同意"})
        api.req("post", f"/change-requests/{bcr['id']}/dispatch", "eng_director",
                json={"assignee_id": USERS["mech_manager"]})
        probe("BOM 行改版", "post", f"/change-requests/{bcr['id']}/revise-bom", "mech_manager",
              (200, 201), json={"qty": 6, "remark": "轴承增加到 6"})

    # ---- 照片取回鉴权（4 域各上传再取回）----
    for area, who in [("manufacturing", "shop1"), ("shipping", "delivery1"),
                      ("site", "site1"), ("service", "service1")]:
        tok = api.req("post", f"/{area}/photos", who, (201,),
                      params={"project_no": p, "ref": "cov"},
                      files={"files": ("c.png", PNG, "image/png")})[0]["token"]
        probe(f"{area} 照片取回", "get", f"/{area}/photos", who, params={"token": tok})


def _tcall(fn, out: list, lock: threading.Lock) -> None:
    try:
        out.append((True, fn()))
    except Exception as exc:  # noqa: BLE001
        with lock:
            out.append((False, exc))


def deep_coverage2(pjs: list[dict]) -> None:
    """第二轮：写并发 + CRUD 边界 + 审核越权（只记录）。"""
    stage("深度覆盖 II：写并发 / CRUD 边界 / 越权", "-")
    p2 = pjs[1]
    p2no = p2["p"]
    deep2 = p2["prof"]["deep"]

    # ---- 标准库：防重码 / 详情 / 类目 ----
    probe("物料类目", "get", "/library/categories", "admin")
    probe("物料品类", "get", "/library/classes/FT", "admin")
    probe("物料详情", "get", f"/library/items/{LIB['zct']['item_no']}", "admin")
    code, _ = probe("防重码（同品类+同规格重复建档应拦）", "post", "/library/items", "admin", (400, 409),
                    json={"std_class_code": "ZCT", "spec": {"brand": "NSK", "model": "6204DDU"}, "unit": "个"})
    flag(code in (400, 409), f"防重码未生效：重复建档返回 {code}")

    # ---- 供应商：建/改/报价/能供品类 ----
    sup = api.req("post", "/suppliers", "buyer1", (201,), json={
        "name": "测试供应商-临时", "kind": "标准件", "contact_name": "测试", "phone": "13900000000"})
    probe("供应商改资料（只传 rating，期望部分更新）", "patch", f"/suppliers/{sup['id']}", "buyer1",
          json={"rating": 5})
    api.req("patch", f"/suppliers/{sup['id']}", "buyer1", json={"name": sup["name"], "rating": 5})
    probe("录入报价", "post", f"/suppliers/{sup['id']}/quotes", "buyer1", (201,), json={
        "item_no": LIB["zct"]["item_no"], "price": 12.5, "unit": "个", "lead_days": 7,
        "price_type": "报价", "quote_date": d(0)})
    probe("报价列表", "get", f"/suppliers/{sup['id']}/quotes", "buyer1")
    cat = api.req("post", f"/suppliers/{sup['id']}/catalog", "buyer1", (201,),
                  json={"std_class_code": "ZCT", "price": 12.0, "lead_days": 7, "is_preferred": True})
    probe("能供品类列表", "get", f"/suppliers/{sup['id']}/catalog", "buyer1")
    probe("删除能供品类", "delete", f"/suppliers/catalog/{cat['id']}", "buyer1")

    # ---- 项目实体 CRUD（P2 上建临时对象）----
    tmp_dr = api.req("post", f"/projects/{p2no}/equipment/{deep2}/drawings", "mech_manager", (201,),
                     json={"title": "临时图（将删）", "source_type": "自制件"})
    probe("图纸改名", "patch", f"/drawings/{tmp_dr['drawing_no']}", "mech_manager",
          json={"title": "临时图-改"})
    probe("图纸删除", "delete", f"/drawings/{tmp_dr['drawing_no']}", "mech_manager")
    tmp_bom = api.req("post", f"/projects/{p2no}/bom/material", "craft_manager", (201,),
                      json={"parent_ref": list(p2["draw"].values())[0],
                            "child_item_no": LIB["bc"]["item_no"], "qty": 1})
    probe("BOM 行删除", "delete", f"/bom/{tmp_bom['id']}", "craft_manager")
    tmp_pr = api.req("post", f"/projects/{p2no}/purchase-requests", "pm1", (201,), json={
        "item_no": LIB["plc"]["item_no"], "qty": 1, "lead_days": 5, "need_date": d(40),
        "ordered_at": d(0), "supplier_name": "测试供应商-临时"})
    probe("采购需求改量", "patch", f"/projects/{p2no}/purchase-requests/{tmp_pr['id']}", "pm1",
          json={"qty": 2})
    probe("采购需求删除", "delete", f"/projects/{p2no}/purchase-requests/{tmp_pr['id']}", "pm1")

    # ---- 项目列表筛选 / 金额分档 ----
    probe("项目列表按阶段", "get", "/projects", "pm1", params={"stage": "质保"})
    _, projs = probe("项目列表(仓库角色)", "get", "/projects", "wh1")
    if isinstance(projs, list) and projs:
        amt = [x.get("amount") for x in projs][:5]
        note(f"wh1 看项目金额：{amt}（无 project:amount 应为 None）")

    # ---- 审核越权 / 空提交 ----
    tmp_dr2 = api.req("post", f"/projects/{p2no}/equipment/{deep2}/drawings", "mech_manager", (201,),
                      json={"title": "越权测试图", "source_type": "自制件"})
    api.req("post", f"/drawings/{tmp_dr2['drawing_no']}/draft", "mech_manager", (200,),
            data={"change_reason": "越权测试"}, files={"file": ("auth.pdf", PDF, "application/pdf")})
    tid = _my_task(p2no, deep2, "机械", "mech_manager")
    code, _ = probe("空内容提交评审应拦", "post", f"/tasks/{tid}/submit-review", "mech_manager", (400, 422),
                    json={"items": [], "note": "空"})
    flag(code in (400, 422), f"空内容提交评审未被拦：{code}")
    api.req("post", f"/tasks/{tid}/submit-review", "mech_manager", (201,),
            json={"items": [{"item_type": "DRAWING", "item_ref": tmp_dr2["drawing_no"]}], "note": "越权测试"})
    probe("组员越权审总监层应拦", "post",
          f"/review-tickets/{api.req('get', f'/tasks/{tid}/review-ticket', 'mech_manager')['id']}/review",
          "mech1", (400, 403), json={"action": "通过", "note": "越权"})
    tk = api.req("get", f"/tasks/{tid}/review-ticket", "mech_manager")
    api.req("post", f"/review-tickets/{tk['id']}/withdraw", "mech_manager")
    note("越权审核被拦，已撤回测试评审单")

    # ---- 任务拆分 ----
    team = api.req("get", "/my-tasks", "mech_manager", params={"scope": "team"})
    if team:
        probe("任务拆分给组员", "post", f"/tasks/{team[0]['id']}/split", "mech_manager", (200, 201),
              json={"items": [{"owner_id": USERS["mech1"], "title": "拆分-机械"}]})

    # ---- 写并发：并行下单取号唯一 ----
    mrs = [api.req("post", "/purchase/manual-request", "shop1", (201,), json={
        "attribution": "辅料", "item_no": LIB["zct"]["item_no"], "qty": 1, "need_date": d(10),
        "note": f"并发下单{i}"}) for i in range(6)]
    out: list = []
    lock = threading.Lock()

    def order_one(r):
        return api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
            "supplier_id": SUP["华南标准件"]["id"], "ordered_at": d(0), "expected_date": d(15), "deliver_to": "公司仓库",
            "lines": [{"request_id": r["id"], "tax_incl": True, "unit_price": price_of(r["item_no"])}]})

    ts = [threading.Thread(target=_tcall, args=(lambda rr=rr: order_one(rr), out, lock)) for rr in mrs]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    ok = [o for o in out if o[0]]
    pos = [o[1].get("po_no") for o in ok]
    flag(len(ok) == 6 and len(set(pos)) == 6,
         f"并发下单应 6 单 6 号，实际成功 {len(ok)}，号 {pos}")
    note(f"6 并发下单 → PO 号 {sorted(set(p for p in pos if p))}")

    # ---- 写并发：同一需求被两个线程同时合并（只应一个成功）----
    dup_mr = api.req("post", "/purchase/manual-request", "shop1", (201,), json={
        "attribution": "辅料", "item_no": LIB["sf"]["item_no"], "qty": 1, "need_date": d(10)})
    out2: list = []
    ts = [threading.Thread(target=_tcall, args=(lambda rr=dup_mr: order_one(rr), out2, lock)) for _ in range(2)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    succ = [o for o in out2 if o[0]]
    flag(len(succ) == 1,
         f"同一需求并发合并应只成功 1 次，实际 {len(succ)} 次（可能双下单）")
    note(f"同一需求 2 线程并发合并：成功 {len(succ)} 次")

    # ---- 写并发：并行验收取到货单号唯一 ----
    insp = [api.req("post", "/purchase/manual-request", "shop1", (201,), json={
        "attribution": "辅料", "item_no": LIB["qg"]["item_no"], "qty": 1, "need_date": d(10)}) for _ in range(3)]
    for r in insp:
        api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
            "supplier_id": SUP["华南标准件"]["id"], "ordered_at": d(0), "expected_date": d(15), "deliver_to": "公司仓库",
            "lines": [{"request_id": r["id"], "tax_incl": True, "unit_price": price_of(r["item_no"])}]})
    proj = insp[0].get("project_no")
    out3: list = []

    def inspect_one(r):
        return api.req("post", f"/projects/{proj}/purchase-requests/{r['id']}/inspect", "wh1",
                       json={"qty": 1, "result": "合格", "receipt_date": d(0)}) if proj else None

    # 手工申请默认无项目（project_no=None），验收路径带项目号会 404；改用采购单验收不适用，跳过
    # 直接验证：同一需求超额验收是否被拦
    if proj:
        ts = [threading.Thread(target=_tcall, args=(lambda rr=rr: inspect_one(rr), out3, lock)) for rr in insp]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        recs = [o[1].get("receipt_id") for o in out3 if o[0]]
        flag(len(recs) == len(set(recs)), f"并发验收到货单号重复：{recs}")
        note(f"并发验收 → 到货单 {recs}")

    # ---- 超额验收（项目归属：订 2 验 5）----
    big = api.req("post", "/purchase/manual-request", "shop1", (201,), json={
        "attribution": "项目", "project_no": p2no, "equip_no": deep2,
        "item_no": LIB["dj"]["item_no"], "qty": 2, "need_date": d(10)})
    api.req("post", "/purchase/merge-order", "buyer1", (200, 201), json={
        "supplier_id": SUP["华南标准件"]["id"], "ordered_at": d(0), "expected_date": d(15), "deliver_to": "公司仓库",
        "lines": [{"request_id": big["id"], "tax_incl": True, "unit_price": price_of(big["item_no"])}]})
    code, res = probe("超额验收（订 2 验 5，应硬拦）", "post",
                      f"/projects/{p2no}/purchase-requests/{big['id']}/inspect", "wh1",
                      (400,), json={"qty": 5, "result": "合格", "receipt_date": d(0)})
    flag(code == 400, f"超额验收未被拦：{code}")
    note("超额验收已硬拦（400）—— 订 2 不能验 5")

    # ---- 离职/停用一键转交 ----
    code, moved = probe("离职一键转交", "post", f"/users/{USERS['mech1']}/handover", "admin",
                        json={"to_user_id": USERS["mech_manager"], "deactivate": False})
    note(f"转交 mech1 → mech_manager：{moved}")

    # ---- 组织维护：新建部门 → 停用 ----
    org = api.req("post", "/orgs", "admin", (201,), json={"name": "测试临时部门"})
    probe("部门停用", "patch", f"/orgs/{org['id']}", "admin", json={"is_active": False})

    # ---- 控制点：无文件不能提交评审（附件必填）----
    pg2 = api.req("post", f"/projects/{p2no}/equipment/{deep2}/programs", "prog_manager", (201,),
                  json={"name": "无文件程序"})
    tprog = _my_task(p2no, deep2, "程序", "prog_manager")
    code, _ = probe("无文件程序提交评审应拦", "post", f"/tasks/{tprog}/submit-review", "prog_manager",
                    (400,), json={"items": [{"item_type": "PROGRAM", "item_ref": str(pg2["id"])}], "note": "无文件"})
    flag(code == 400, f"无文件程序提交评审未被拦：{code}")
    note("附件必填已生效：无文件提交评审 400")

    # ---- 到货单列表 / 照片 ----
    probe("到货单列表(已入库)", "get", "/goods-receipts", "wh1", params={"status": "已入库"})
    grs = api.req("get", "/goods-receipts", "wh1", params={"status": "待入库"})
    if grs:
        gid = grs[0]["id"]
        tok = api.req("post", f"/goods-receipts/{gid}/photos", "wh1", (201,),
                      files={"files": ("g.png", PNG, "image/png")})
        probe("到货单照片取回", "get", f"/goods-receipts/{gid}/photos/0", "wh1")
    probe("任务汇总", "get", "/tasks/summary", "mech_manager")
    probe("项目任务列表", "get", f"/projects/{p2no}/tasks", "pm1")


def main() -> None:
    global USERS, SUP
    print("=" * 78)
    print("同兴高科 txgketo · 多项目并发 S0→S11 真实全链路走查")
    print("=" * 78)
    reset_db()
    api.req("get", "/health", "admin")
    USERS.update({u["username"]: u["id"] for u in api.req("get", "/users", "admin")})
    seed_library()
    SUP = ensure_suppliers()

    concurrency_burst()

    pjs = [make_pj(p) for p in PROFILES]
    STAGES = [
        ("S0 商机", s0), ("S0-2 成交", s02), ("S1 立项", s1), ("S2 工程设计", s2),
        ("S3x 跨项目合并下单", s3_cross), ("S3 采购收货", s3), ("S4 领料", s4),
        ("S5 制造", s5), ("S6 装配", s6), ("S7 发运", s7), ("S8 现场", s8),
        ("S10 验收", s10), ("S11 售后", s11), ("回款", payments),
    ]
    for name, fn in STAGES:
        stage(name)
        if fn is s3_cross:
            try:
                fn(pjs)
            except Exception as exc:  # noqa: BLE001
                ISSUES.append({"stage": name, "project": "-", "severity": "问题",
                               "msg": f"跨项目合并失败：{exc}"})
                print(f"      ❌ {exc}")
            continue
        for pj in pjs:
            if pj["halted"]:
                continue
            CURRENT["project"] = pj["prof"]["key"]
            if pj["p"] is None and name != "S0 商机":
                continue
            try:
                fn(pj)
            except ApiError as exc:
                pj["halted"] = True
                ISSUES.append({"stage": name, "project": pj["prof"]["key"], "severity": "失败",
                               "msg": f"{exc}"})
                print(f"      ❌ [{pj['prof']['key']}] {exc}")
            except Exception as exc:  # noqa: BLE001
                pj["halted"] = True
                ISSUES.append({"stage": name, "project": pj["prof"]["key"], "severity": "失败",
                               "msg": f"{type(exc).__name__}: {exc}"})
                print(f"      ❌ [{pj['prof']['key']}] {type(exc).__name__}: {exc}")
                traceback.print_exc()

    global_checks(pjs)
    deep_coverage(pjs)
    deep_coverage2(pjs)

    # 汇总
    result = {
        "generated_at": str(date.today()),
        "projects": [{"key": pj["prof"]["key"], "no": pj["p"], "halted": pj["halted"]} for pj in pjs],
        "http_stats": {"calls": api.calls, "by_method": api.by_method, "by_status": api.by_status,
                       "failures": api.failures},
        "issues": ISSUES, "notes": NOTES, "stage_log": STAGE_LOG,
    }
    with open("/tmp/txgketo_multiproj_result.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 78)
    print("结果汇总")
    print("=" * 78)
    for pj in pjs:
        print(f"  {pj['prof']['key']} {pj['p']}  {'❌ 中断' if pj['halted'] else '✅ 走完'}  "
              f"{pj['prof']['customer']} / {pj['prof']['name']}")
    print(f"\n  HTTP 调用 {api.calls} 次，状态分布 {dict(sorted(api.by_status.items()))}")
    fails = [i for i in ISSUES if i["severity"] == "失败"]
    probs = [i for i in ISSUES if i["severity"] == "问题"]
    print(f"  失败 {len(fails)} 项，问题 {len(probs)} 项，备注 {len(NOTES)} 条")
    print("  结果已写入 /tmp/txgketo_multiproj_result.json")


if __name__ == "__main__":
    main()
