"""只补**最小基础数据**（标准库物料 + 采购品类 + 供应商 + 库位）—— 不建任何项目/单据。

为什么需要它（2026-10-05 客户口径）：
  客户要「把现有项目数据清掉，我自己亲自走一遍」。
  但 `reset_business_data.py` **绕不开地**会连主数据一起清（`item.project_no → project`
  的外键决定 `TRUNCATE project CASCADE` 必然带走整个物料档，见该文件注释）。
  清完是白板 → 客户走到「立项选长周期件 / 采购下单选物料 / 仓库入库选库位」时会没东西可选。
  所以在「清空」与「自己走」之间补这一层：**只补主数据，不碰业务**。

它**不做**的事（有意）：
  · 不建项目/商机/单据 —— 那是客户要自己走的部分
  · 不建账号/组织/角色 —— 那些本来就不被清（见 reset_business_data）

用法：
    python -m scripts.seed_base_data          # 幂等：已存在就跳过
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

BASE = "http://127.0.0.1:8208/api/v1"

# 与 `seed_s0_s1.py::ITEMS` 同一份常用物料（标准库类目码 → 规格 → 单位）
ITEMS = [
    ("DLD", {"brand": "台达", "model": "ECMA-C21310", "power": "1kW", "voltage": "220V"}, "台"),
    ("DLJ", {"brand": "纽氏达特", "model": "PLE60-10", "ratio": "1:10"}, "台"),
    ("QG", {"brand": "SMC", "model": "CDQ2B32-100", "bore": "32", "stroke": "100"}, "只"),
    ("GC", {"material": "Q235", "w": "40", "h": "40", "t": "2.0", "len": "6000"}, "米"),
    ("YLLC", {"material": "Q235", "t": "2.0", "size": "1220x2440"}, "张"),
    ("CPU", {"brand": "汇川", "series": "AM401", "model": "AM401-CPU1602", "io": "32点"}, "套"),
    ("SF", {"brand": "台达", "model": "ASDA-B3", "power": "750W"}, "台"),
    ("ZCT", {"brand": "NSK", "model": "6204DDU"}, "个"),
]

# 供应商（含能供品类，便于「推荐供应商」有东西可推）
SUPPLIERS = [
    ("甲钢材", "钢材/板材/方通", ["GC", "YLLC"], "13800000000"),
    ("乙标准件", "轴承/气缸/电机", ["ZCT", "QG", "DLD"], "13800000001"),
    ("丙钣金", "钣金/机加工/外协", ["YLLC"], "13800000002"),
]

# ⚠ 库位必填 `warehouse`（不是只有 code/name）—— 第一版漏了它，脚本报“✅”但库里是 0
LOCATIONS = [("深圳仓", "A-03-12", "成品区 3 排 12 位"), ("深圳仓", "B-01-01", "原材料区 1 排 1 位")]


def main() -> None:
    with httpx.Client(timeout=30) as c:
        r = c.post(f"{BASE}/auth/login", json={"username": "admin", "password": "txgk@123"})
        r.raise_for_status()
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}

        print("📦 标准库物料：")
        for cls, spec, unit in ITEMS:
            r = c.post(f"{BASE}/library/items", headers=h,
                       json={"std_class_code": cls, "spec": spec, "unit": unit})
            code = (r.json() or {}).get("item_no", "")
            print(f"   {'✅ 新建' if r.status_code == 201 else '⏭ 已存在'} {code} {cls}")

        print("🏭 供应商：")
        existing = {s["name"]: s["id"] for s in (c.get(f"{BASE}/suppliers", headers=h).json() or [])}
        for name, _cat, cats, phone in SUPPLIERS:
            if name in existing:
                sid = existing[name]
                print(f"   ⏭ 已存在 {name}")
            else:
                r = c.post(f"{BASE}/suppliers", headers=h, json={
                    "name": name, "contact_name": name, "phone": phone, "remark": _cat})
                sid = r.json().get("id")
                print(f"   ✅ 新建 {name}")
            # 能供品类走**单独接口**（SupplierIn 里没有 categories 字段 —— 第一版传了它，静默丢失）
            for cls in cats:
                c.post(f"{BASE}/suppliers/{sid}/catalog", headers=h, json={"std_class_code": cls})

        print("📍 库位：")
        have_loc = {(x.get("warehouse"), x.get("code"))
                    for x in (c.get(f"{BASE}/warehouse/locations", headers=h).json() or [])}
        for wh, code, desc in LOCATIONS:
            if (wh, code) in have_loc:
                print(f"   ⏭ 已存在 {wh} {code}")
                continue
            r = c.post(f"{BASE}/warehouse/locations", headers=h, json={"warehouse": wh, "code": code, "name": desc})
            print(f"   {'✅ 新建' if r.status_code == 201 else '❌ ' + r.text[:80]} {wh} {code} {desc}")

        print("\n✅ 主数据就绪（**没有任何项目/单据**，可以从「新建商机」开始自己走）")


if __name__ == "__main__":
    main()
