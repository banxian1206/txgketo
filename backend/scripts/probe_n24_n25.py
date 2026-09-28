#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""N24/N25 回归护栏（全局测试报告 2026-09-28）。

N24 部分备料：库存 < 需求时 `pick` 不再整单 400 —— 有多少备多少；补货后可再备 → 最终「已领走」。
             三量分离：qty_required / qty_picked（已备）/ qty_issued（已领）。
N25 验收不可重复：已通过验收的项目禁止再 apply；已确认的单禁止再 confirm（原会覆盖质保起算日）。

跑法： backend/.venv/bin/python scripts/probe_n24_n25.py
前提：已跑过 scripts/e2e_baseline.py（提供项目/设备/标准库数据）
"""
from __future__ import annotations

import sys
from datetime import date, timedelta

import httpx
from sqlalchemy import create_engine, text

BASE = "http://127.0.0.1:8208/api/v1"
DB = "postgresql+psycopg://txgk:txgk@127.0.0.1:35432/txgk"
T = date.today()
RES: list[tuple[str, bool, str]] = []
C = httpx.Client(base_url=BASE, timeout=60.0)
TOK: dict[str, dict] = {}


def login(u: str) -> dict:
    if u in TOK:
        return TOK[u]
    r = C.post("/auth/login", json={"username": u, "password": "txgk@123"})
    r.raise_for_status()
    TOK[u] = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return TOK[u]


def q(sql: str, **kw):
    e = create_engine(DB)
    with e.connect() as c:
        return [dict(x._mapping) for x in c.execute(text(sql), kw)]


def ex(sql: str, **kw):
    e = create_engine(DB)
    with e.begin() as c:
        c.execute(text(sql), kw)


def chk(name: str, ok: bool, detail: str = "") -> None:
    RES.append((name, bool(ok), detail))
    print(f"  {'✅' if ok else '❌'} {name}\n       {detail}")


def issues() -> list[dict]:
    return C.get("/warehouse/issues", headers=dict(login("wh1"))).json()


def main() -> None:
    proj = q("select project_no from project order by project_no limit 1")[0]["project_no"]
    eq = q("select equip_no from equipment where project_no=:p limit 1", p=proj)[0]["equip_no"]
    it = q("select item_no from item where item_no like 'YL-FT%' limit 1")[0]["item_no"]
    loc = q("select id from warehouse_location limit 1")
    if not loc:
        C.post("/warehouse/locations", headers=dict(login("wh1")),
               json={"warehouse": "深圳仓", "code": "A-01-01", "name": "主库位"})
        loc = q("select id from warehouse_location limit 1")
    loc_id = loc[0]["id"]

    # ── 确保该设备有一条【已冻结的材料 BOM】用方通 ──
    body = q("select drawing_no from drawing where project_no=:p and equip_no=:e "
             "and parent_drawing_no is not null limit 1", p=proj, e=eq)
    if not body:
        print("ERROR: 没有已发布组件，先跑 e2e_baseline"); sys.exit(2)
    body_no = body[0]["drawing_no"]
    bom = q("select id from bom_item where project_no=:p and parent_ref=:b and child_item_no=:i "
            "and bom_source='MATERIAL' limit 1", p=proj, b=body_no, i=it)
    if not bom:
        r = C.post(f"/projects/{proj}/bom/material", headers=dict(login("craft1")),
                   json={"parent_ref": body_no, "child_item_no": it, "qty": 10})
        if r.status_code != 201:
            print(f"ERROR: 建材料BOM失败 {r.status_code} {r.text[:120]}"); sys.exit(2)
        bom_id = r.json()["id"]
    else:
        bom_id = bom[0]["id"]
    ex("update bom_item set status='已冻结' where id=:i", i=bom_id)

    print("\n═══ N24 部分备料（库存不足 → 备一部分 → 补货 → 领完）═══")
    ex("delete from stock_item where item_no=:i", i=it)
    ex("insert into stock_item(item_no,location_id,qty_on_hand,qty_locked) values (:i,:l,1,0)",
       i=it, l=loc_id)
    r = C.post(f"/warehouse/projects/{proj}/equipment/{eq}/generate-issue", headers=dict(login("shop1")))
    if r.status_code != 201:
        chk("生成领料单", False, f"HTTP {r.status_code} {r.text[:120]}"); return
    iid = [x for x in issues() if x["issue_no"] == r.json()["issue_no"]][0]["id"]

    sc = C.post(f"/warehouse/issues/{iid}/pick", headers=dict(login("wh1")), json={}).status_code
    row = [x for x in issues() if x["id"] == iid][0]
    line = next((x for x in row["lines"] if x["item_no"] == it), None)
    chk("★ 库存不足时 pick 不再整单 400（部分备料）", sc == 200, f"HTTP {sc}")
    chk("★ 状态 = 部分领料", row["status"] == "部分领料", f"实际 {row['status']}")
    chk("★ 该行已备料量 > 0 且 < 需求（备到可用量）",
        line is not None and 0 < float(line["qty_picked"] or 0) < float(line["qty_required"]),
        f"qty_picked={line and line['qty_picked']} / qty_required={line and line['qty_required']}")

    sc2 = C.post(f"/warehouse/issues/{iid}/hand-over", headers=dict(login("wh1")),
                 json={"issued_to": "车间 回归"}).status_code
    st = q("select coalesce(sum(qty_on_hand),0) oh, coalesce(sum(qty_locked),0) lk "
           "from stock_item where item_no=:i", i=it)[0]
    chk("★ 领走只领【已备到】的量（库存不为负、不超领）",
        sc2 == 200 and float(st["oh"]) >= 0 and float(st["lk"]) >= 0,
        f"HTTP {sc2} 库存={st['oh']}/{st['lk']}")

    # 补货后再备 → 应能继续备（关键：不是死单）
    ex("update stock_item set qty_on_hand=50 where item_no=:i", i=it)
    sc3 = C.post(f"/warehouse/issues/{iid}/pick", headers=dict(login("wh1")), json={}).status_code
    row3 = [x for x in issues() if x["id"] == iid][0]
    l3 = next((x for x in row3["lines"] if x["item_no"] == it), None)
    chk("★ 补货后可再备料（部分领料状态允许再 pick）", sc3 == 200,
        f"HTTP {sc3} 已备={l3 and l3['qty_picked']}")
    sc4 = C.post(f"/warehouse/issues/{iid}/hand-over", headers=dict(login("wh1")),
                 json={"issued_to": "车间 回归"}).status_code
    l4 = next((x for x in [y for y in issues() if y["id"] == iid][0]["lines"] if x["item_no"] == it), None)
    chk("★ 该行最终领完（已领 ≥ 需求）",
        l4 is not None and float(l4["qty_issued"]) + 1e-6 >= float(l4["qty_required"]),
        f"已领={l4 and l4['qty_issued']} / 需求={l4 and l4['qty_required']} HTTP {sc4}")
    neg = q("select count(*) c from stock_item where qty_on_hand<0")[0]["c"]
    over = q("select count(*) c from stock_item where qty_locked>qty_on_hand")[0]["c"]
    chk("★ 全程无负库存 / 无超锁", neg == 0 and over == 0, f"负库存={neg} 超锁={over}")

    print("\n═══ M-03 零库存建单 → 补货 → 备得出 + 作废口（第八轮 §3 M-03）═══")
    # 第八轮发现：建单时库存=0 的行库位为 NULL，pick/hand-over 直接跳过 → 货到了也永远备不出（永久死单）
    ex("delete from material_issue_line where issue_id in (select id from material_issue where project_no=:p)", p=proj)
    ex("delete from material_issue where project_no=:p", p=proj)
    ex("delete from stock_item where item_no=:i", i=it)          # ★ 零库存建单
    r0 = C.post(f"/warehouse/projects/{proj}/equipment/{eq}/generate-issue", headers=dict(login("shop1")))
    mid = r0.json()["id"]
    ln0 = q("select location_id from material_issue_line where issue_id=:i and item_no=:t", i=mid, t=it)[0]
    chk("零库存建单 → 库位快照为 NULL（预期，靠 pick 时动态回填）", ln0["location_id"] is None, f"location_id={ln0['location_id']}")
    C.post("/warehouse/inbound", headers=dict(login("wh1")),
           json={"item_no": it, "qty": 50, "location_id": loc_id, "note": "M-03 护栏"})
    rp = C.post(f"/warehouse/issues/{mid}/pick", headers=dict(login("wh1")), json={})
    ln1 = q("select location_id,qty_picked from material_issue_line where issue_id=:i and item_no=:t", i=mid, t=it)[0]
    chk("★ 补货后 pick 能备出（原来 400「永远备不出来」）", rp.status_code == 200,
        f"HTTP {rp.status_code} 库位→{ln1['location_id']} 备={ln1['qty_picked']}")
    chk("★ 动态回填了库位（NULL → 真有货的库位）", ln1["location_id"] is not None, f"location_id={ln1['location_id']}")
    rh = C.post(f"/warehouse/issues/{mid}/hand-over", headers=dict(login("wh1")), json={"issued_to": "车间 M03"})
    chk("★ hand-over 也能领走（原来 400）", rh.status_code == 200, f"HTTP {rh.status_code}")
    # 作废口：ISSUE_STATUS 里承诺的「已取消」原来没接口能置
    lk0 = float(q("select coalesce(sum(qty_locked),0) l from stock_item")[0]["l"])
    rca = C.post(f"/warehouse/issues/{mid}/cancel", headers=dict(login("wh1")), json={"remark": "M-03 作废"})
    lk1 = float(q("select coalesce(sum(qty_locked),0) l from stock_item")[0]["l"])
    st1 = q("select status from material_issue where id=:i", i=mid)[0]["status"]
    chk("★ 作废口存在（已取消）且释放占用", rca.status_code == 200 and st1 == "已取消" and lk1 <= lk0,
        f"HTTP {rca.status_code} 状态={st1} 占用 {lk0}→{lk1}")
    chk("★ 重复作废幂等拒绝",
        C.post(f"/warehouse/issues/{mid}/cancel", headers=dict(login("wh1")), json={}).status_code == 400, "400")
    chk("★ 作废后不能再备料",
        C.post(f"/warehouse/issues/{mid}/pick", headers=dict(login("wh1")), json={}).status_code == 400, "400")

    print("\n═══ N25 验收不可重复（原会覆盖质保起算日）═══")
    acc = q("select project_no from acceptance where status='已通过' order by id limit 1")
    if not acc:
        chk("存在已通过验收的项目", False, "先跑 e2e_baseline（S10 会走完验收）"); return
    p2 = acc[0]["project_no"]
    before = q("select warranty_start,warranty_end from project where project_no=:p", p=p2)[0]
    aid = q("select id from acceptance where project_no=:p and status='已通过' limit 1", p=p2)[0]["id"]
    r1 = C.post("/acceptance/apply", headers=dict(login("pm1")), json={"project_no": p2})
    chk("★ 已通过验收的项目再 apply → 400（不再生成第 2/N 张单）", r1.status_code == 400,
        f"HTTP {r1.status_code} {str(r1.text)[:90]}")
    r2 = C.post(f"/acceptance/{aid}/confirm", headers=dict(login("pm1")),
                json={"result": "通过", "signed_by": "客户B", "accepted_at": "2027-11-11"})
    chk("★ 已确认的单再 confirm → 400（不是 500）", r2.status_code == 400,
        f"HTTP {r2.status_code} {str(r2.text)[:90]}")
    after = q("select warranty_start,warranty_end from project where project_no=:p", p=p2)[0]
    chk("★★ 质保起算日未被覆盖", str(before["warranty_start"]) == str(after["warranty_start"]),
        f"{before['warranty_start']} → {after['warranty_start']}")

    bad = [x for x in RES if not x[1]]
    print(f"\n{'='*70}\nN24/N25 护栏：{len(RES)} 项 · ✅ {len(RES)-len(bad)} · ❌ {len(bad)}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
