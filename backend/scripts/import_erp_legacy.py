"""把公司 ERP 导出的**供应商 / 标准库 / 采购历史价**搬进本系统（`docs/16-ERP历史数据导入方案.md`）。

口径（客户 2026-10-06 拍板）：
  · 只搬**数据**，不搬 ERP 的**编码规则** —— 标准库全部用本系统发号引擎重编
    （`{类别码}-{品类码}-{0001}`），ERP 原编号只存进 `item.legacy_code`（内部字段，不对界面/搜索露出），
    用于**重复导入幂等**与交叉核对。
  · 品类树：ERP 二级→本系统「类别」、三级→本系统「品类」（见 `services/erp_legacy_map.py`）。
  · `TX…` 开头的是项目图号，**不导入**。
  · 采购历史价写 `supplier_quote`（`price_type=成交`），带日期/数量，供采购台「价格参考」。

用法：
    python -m scripts.import_erp_legacy                       # 预演（默认，不写库）
    python -m scripts.import_erp_legacy --yes                 # 真写
    python -m scripts.import_erp_legacy --yes --only suppliers,library
    python -m scripts.import_erp_legacy --limit 300           # 每个文件只读前 N 行（冒烟用）
    python -m scripts.import_erp_legacy --dir /path/to/shuju   # 数据目录（默认 docs/shuju）

依赖：读老版 `.xls` 需要一个**只在开发机临时装**的 `xlrd`（不进 `requirements*.txt`）：
    pip install xlrd          # 或在任意 venv 里装了、用那个 python 跑本脚本
`.xlsx` / `.csv` 走 `services/excel_import.py` 的零依赖读取器，不用装东西。
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.models.library import Item, StdCategory, StdClass  # noqa: E402
from app.models.purchasing import Supplier, SupplierQuote  # noqa: E402
from app.services import audit, excel_import  # noqa: E402
from app.services.erp_legacy_map import CATEGORY_MAP, class_of, supplier_kind  # noqa: E402
from app.services.numbering import next_number  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE = "ERP导入"

# 供应商分类/字段名（ERP 表头）
S_NAME, S_KIND, S_LEVEL = "供应商名称", "供应商分类", "供应商级别"
S_CONTACT, S_MOBILE, S_OFFICE = "主联系人", "手机", "办公电话"
S_ADDR, S_PAY, S_INTRO = "供应商地址", "付款方式", "供应商简介"
S_BUYER, S_ADDED, S_CODE = "采购人员", "添加时间", "供应商编号"

# 标准库字段名
L_CODE, L_NAME, L_MODEL, L_CAT = "产品编号", "产品名称", "产品型号", "产品分类"
L_BRAND, L_UNIT, L_BASEUNIT = "品牌", "单位", "基本单位"

# 采购单字段名
P_NO, P_DATE, P_SUP = "采购编号", "采购日期", "供应商名称"
D_ITEM, D_NAME, D_UNIT, D_QTY = "编号", "产品名称", "单位", "数量"
D_TAX_FINAL, D_TAX, D_FINAL, D_TAX_LIST = "含税折后单价", "优惠后单价", "折后单价", "含税单价"
D_LIST = "单价"
D_PO_NO, D_MAT_NO, D_EQUIP = "订单编号", "材料编号", "设备名称"

ITEM_NO_MAX = 255  # item.spec_text
MAX_REPORT_SAMPLES = 15


# --------------------------------------------------------------------------- 读表


def _load_xlrd():
    try:
        import xlrd  # type: ignore
    except ImportError:  # pragma: no cover - 只影响老 .xls
        raise SystemExit(
            "读老版 .xls 需要 xlrd：`pip install xlrd`（仅开发机临时用，不进 requirements）。\n"
            "或把 ERP 导出另存为 .xlsx / .csv 再跑。"
        )
    return xlrd


def iter_rows(path: Path):
    """逐行产出 (表头名→列号, 行值列表)。支持 .xls(需 xlrd) / .xlsx / .csv。"""
    suffix = path.suffix.lower()
    if suffix == ".xls":
        xlrd = _load_xlrd()
        wb = xlrd.open_workbook(str(path), on_demand=True)
        sh = wb.sheet_by_index(0)
        hdr = [str(sh.cell_value(0, c)).strip() for c in range(sh.ncols)]
        idx = {h: i for i, h in enumerate(hdr)}
        try:
            for r in range(1, sh.nrows):
                yield idx, sh.row_values(r)
        finally:
            wb.release_resources()
        return

    data = path.read_bytes()
    if suffix in (".xlsx", ".xlsm"):
        grid = excel_import.read_xlsx(data)
    elif suffix in (".csv", ".txt"):
        grid = excel_import.read_csv(data)
    else:
        raise SystemExit(f"不认识的格式：{path.name}（支持 .xls / .xlsx / .csv）")
    grid = [r for r in grid if any((c or "").strip() for c in r)]
    if not grid:
        return
    hdr = [(c or "").strip() for c in grid[0]]
    idx = {h: i for i, h in enumerate(hdr)}
    for row in grid[1:]:
        yield idx, row


def cell(row: list, idx: dict[str, int], name: str, default=""):
    i = idx.get(name)
    if i is None or i >= len(row):
        return default
    v = row[i]
    return default if v is None else v


def to_str(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        return str(int(v)) if v == int(v) else str(v)
    return str(v).strip()


def to_num(v) -> float:
    s = to_str(v).replace(",", "").replace("￥", "").replace("¥", "").strip()
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def trunc(s: str, n: int) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def to_date(v) -> date | None:
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        if v > 1000:  # Excel 1900 序列号
            return date(1899, 12, 30) + timedelta(days=int(v))
        return None
    s = to_str(v)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


# --------------------------------------------------------------------------- 供应商


def phase_suppliers(session: Session, *, dry: bool, out: list[str]) -> None:
    path = FILES["suppliers"]
    existing = {s.name: s for s in session.scalars(select(Supplier))}
    seen: dict[str, dict] = {}
    dup_codes: dict[str, list[str]] = defaultdict(list)
    for idx, row in iter_rows(path):
        name = to_str(cell(row, idx, S_NAME))
        if not name:
            continue
        code = to_str(cell(row, idx, S_CODE))
        if name in seen:
            if code:
                dup_codes[name].append(code)
            continue
        seen[name] = {
            "kind": supplier_kind(to_str(cell(row, idx, S_KIND))),
            "contact": to_str(cell(row, idx, S_CONTACT)) or None,
            "phone": to_str(cell(row, idx, S_MOBILE)) or to_str(cell(row, idx, S_OFFICE)) or None,
            "address": to_str(cell(row, idx, S_ADDR)) or None,
            "pay": to_str(cell(row, idx, S_PAY)) or None,
            "level": to_str(cell(row, idx, S_LEVEL)),
            "buyer": to_str(cell(row, idx, S_BUYER)),
            "added": to_str(cell(row, idx, S_ADDED)),
            "intro": to_str(cell(row, idx, S_INTRO)),
            "erp_code": code,
        }

    to_create = [n for n in seen if n not in existing]
    out.append(f"【供应商】文件 {path.name}：读到 {len(seen)} 家，已存在 {len(seen) - len(to_create)}，将新建 {len(to_create)}")
    if dup_codes:
        out.append(f"        重名合并 {len(dup_codes)} 家（例：{list(dup_codes)[0]}）")
    if dry:
        return

    for name in to_create:
        d = seen[name]
        remark_bits = [f"ERP级别:{d['level']}" if d["level"] else "", f"采购员:{d['buyer']}" if d["buyer"] else "",
                       f"添加:{d['added']}" if d["added"] else ""]
        if d["intro"]:
            remark_bits.append(d["intro"])
        if dup_codes.get(name):
            remark_bits.append("ERP另有编号:" + ",".join(dup_codes[name]))
        session.add(
            Supplier(
                code=next_number(session, "SUPPLIER", scope_key=""),
                name=name,
                kind=d["kind"],
                contact_name=d["contact"],
                phone=d["phone"],
                address=d["address"],
                payment_terms=d["pay"],
                remark=" · ".join(b for b in remark_bits if b) or None,
                is_active=True,
            )
        )
    session.flush()
    audit.log(
        session, user=None, action="ERP导入", object_type="supplier",
        summary=f"ERP 供应商导入：新建 {len(to_create)} 家",
        detail={"created": len(to_create), "existing": len(seen) - len(to_create), "source_file": path.name},
    )


# --------------------------------------------------------------------------- 标准库


def _ensure_taxonomy(session: Session, needed: dict[str, tuple[str, str, str]]) -> None:
    """needed: 品类码 -> (类别码, 类别名, 品类名)。缺谁补谁（不覆盖已有）。"""
    cats = {c.code for c in session.scalars(select(StdCategory))}
    cls = {k.code for k in session.scalars(select(StdClass))}
    cat_names = {code: name for code, name in CATEGORY_MAP.values()}
    cat_seq = 100
    for cat in sorted({v[0] for v in needed.values()}):
        if cat not in cats:
            name = next((n for c, n in cat_names.items() if c == cat), cat)
            session.add(StdCategory(code=cat, name=name, seq=cat_seq))
            cats.add(cat)
            cat_seq += 1
    session.flush()
    cls_seq: dict[str, int] = defaultdict(lambda: 100)
    for code, (cat, _cat_name, cls_name) in needed.items():
        if code not in cls:
            session.add(StdClass(code=code, name=cls_name, category_code=cat, spec_template=None, seq=cls_seq[cat]))
            cls.add(code)
            cls_seq[cat] += 1
    session.flush()


def phase_library(session: Session, *, dry: bool, out: list[str], limit: int | None) -> set[str]:
    """标准库：返回「本轮涉及（已存在或将新建）的 ERP 原编号」集合，供价格阶段映射。"""
    files = sorted(FILES["library"])
    existing = {i.legacy_code: i for i in session.scalars(select(Item).where(Item.legacy_code.isnot(None)))}
    plan: dict[str, dict] = {}  # legacy_code -> 字段
    skip_tx = 0
    skip_class: list[str] = []
    for path in files:
        n = 0
        for idx, row in iter_rows(path):
            n += 1
            if limit and n > limit:
                break
            code = to_str(cell(row, idx, L_CODE))
            if not code or code in plan:
                continue
            if code.upper().startswith("TX"):
                skip_tx += 1
                continue
            mapped = class_of(to_str(cell(row, idx, L_CAT)))
            if mapped is None:
                skip_class.append(code)
                continue
            cat, cls, cls_name = mapped
            unit = to_str(cell(row, idx, L_UNIT)) or to_str(cell(row, idx, L_BASEUNIT)) or "件"
            plan[code] = {
                "cat": cat, "cls": cls, "cls_name": cls_name,
                "name": trunc(to_str(cell(row, idx, L_NAME)), 200) or code,
                "model": trunc(to_str(cell(row, idx, L_MODEL)), ITEM_NO_MAX) or None,
                "brand": trunc(to_str(cell(row, idx, L_BRAND)), 64) or None,
                "unit": trunc(unit, 16) or "件",
            }

    new_codes = [c for c in plan if c not in existing]
    out.append(f"【标准库】{len(files)} 个文件：唯一物料 {len(plan)}，已存在 {len(plan) - len(new_codes)}，将新建 {len(new_codes)}")
    out.append(f"        （剔除 TX 项目图号 {skip_tx} 条；品类映射不到跳过 {len(skip_class)} 条"
               + (f"，例：{skip_class[:5]}" if skip_class else "") + "）")
    known = set(plan) | set(existing)
    if dry:
        return known

    needed: dict[str, tuple[str, str, str]] = {d["cls"]: (d["cat"], "", d["cls_name"]) for d in plan.values()}
    _ensure_taxonomy(session, needed)

    created = 0
    for code in new_codes:
        d = plan[code]
        item_no = next_number(session, "STD_ITEM", scope_key=d["cls"], cat=d["cat"], cls=d["cls"])
        session.add(
            Item(
                item_no=item_no, display_name=d["name"], source_type="标准件", project_no=None,
                std_class_code=d["cls"], spec=None, spec_text=d["model"], unit=d["unit"],
                brand=d["brand"], mfr_model=None, is_active=True, legacy_code=code,
            )
        )
        created += 1
        if created % 2000 == 0:
            session.flush()
            out.append(f"        …已建 {created}/{len(new_codes)}")
    session.flush()
    audit.log(
        session, user=None, action="ERP导入", object_type="item",
        summary=f"ERP 标准库导入：新建 {created} 条（剔除 TX {skip_tx}）",
        detail={"created": created, "skipped_tx": skip_tx, "unmapped": len(skip_class), "source_files": [p.name for p in files]},
    )
    return known


# --------------------------------------------------------------------------- 采购历史价


def _money(v: float) -> float:
    """金额归一：`supplier_quote.price` 是 Numeric(14,2)，入库会四舍五入到 2 位；

    幂等键必须用**归一到 2 位后**的值比较，否则 61.947 与库里的 61.95 对不上 → 重复导入。
    """
    return float(Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _pick_price(row: list, idx: dict[str, int]) -> tuple[float, bool]:
    """取价格：优先含税折后价 → 优惠后价(含税) → 含税单价 → 折后价(不含税) → 单价(不含税)。"""
    for name, tax in ((D_TAX_FINAL, True), (D_TAX, True), (D_TAX_LIST, True), (D_FINAL, False), (D_LIST, False)):
        v = to_num(cell(row, idx, name))
        if v > 0:
            return _money(v), tax
    return 0.0, True


def phase_prices(session: Session, *, dry: bool, out: list[str], known_legacy: set[str], limit: int | None) -> None:
    files = sorted(FILES["prices"])
    legacy_to_item = dict(session.execute(select(Item.legacy_code, Item.item_no).where(Item.legacy_code.isnot(None))).all())
    # 标准库阶段若没跑（`--only prices`），已入库的物料也算数
    known_legacy = set(known_legacy) | set(legacy_to_item)
    sup_by_name = {s.name: s.id for s in session.scalars(select(Supplier))}

    # (legacy_code, supplier_name, price, date_iso, tax_incl) -> {qty, count, sample}
    agg: dict[tuple, dict] = {}
    skip_item: set[str] = set()
    skip_sup: list[str] = []
    rows_total = 0
    outliers: dict[str, list[float]] = defaultdict(list)

    for path in files:
        n = 0
        master: dict | None = None
        for idx, row in iter_rows(path):
            key = to_str(cell(row, idx, P_NO))
            if key and key != "【采购明细产品】":
                master = {
                    "no": key,
                    "date": to_date(cell(row, idx, P_DATE)),
                    "sup": to_str(cell(row, idx, P_SUP)),
                }
                continue
            item_code = to_str(cell(row, idx, D_ITEM))
            if not item_code or master is None:
                continue
            n += 1
            if limit and n > limit:
                break
            rows_total += 1
            if item_code not in known_legacy:
                skip_item.add(item_code)
                continue
            price, tax_incl = _pick_price(row, idx)
            if price <= 0:
                continue
            sup_name = master["sup"]
            if sup_name not in sup_by_name and not dry:
                skip_sup.append(sup_name)
                continue
            if dry and sup_name not in sup_by_name:
                # 预演：供应商还没建，但仍按名字统计
                pass
            when = master["date"] or date.today()
            k = (item_code, sup_name, price, when.isoformat(), tax_incl)
            a = agg.setdefault(k, {"qty": 0.0, "count": 0, "unit": to_str(cell(row, idx, D_UNIT)),
                                   "po": master["no"], "equip": to_str(cell(row, idx, D_EQUIP)),
                                   "mat": to_str(cell(row, idx, D_MAT_NO))})
            a["qty"] += to_num(cell(row, idx, D_QTY))
            a["count"] += 1
            if item_code in legacy_to_item or dry:
                outliers[item_code].append(price)

    out.append(f"【采购历史价】{len(files)} 个文件：明细 {rows_total} 行 → 去重后 {len(agg)} 条价格记录")
    out.append(f"        跳过：物料不在标准库 {len(skip_item)} 种" + (f"（例：{sorted(skip_item)[:5]}）" if skip_item else ""))
    if skip_sup:
        out.append(f"        跳过：供应商找不到 {len(set(skip_sup))} 家")
    # 离群（≥10 倍价差）
    spread = [(max(v) / max(min(v), 0.0001), k, min(v), max(v), len(v)) for k, v in outliers.items() if len(v) >= 5 and min(v) > 0 and max(v) / min(v) >= 10]
    spread.sort(reverse=True)
    out.append(f"        价格离群（≥10 倍，保留不删）{len(spread)} 种，前几：{[f'{k}({lo}~{hi})' for _, k, lo, hi, _ in spread[:5]]}")
    if dry:
        return

    existing = set()
    if agg:
        q = select(SupplierQuote.item_no, SupplierQuote.supplier_id, SupplierQuote.price, SupplierQuote.quote_date).where(
            SupplierQuote.source == SOURCE
        )
        for it, sid, pr, qd in session.execute(q):
            existing.add((it, sid, _money(float(pr)), qd.isoformat() if qd else None))

    created = 0
    for (legacy, sup_name, price, when_iso, tax_incl), a in agg.items():
        item_no = legacy_to_item.get(legacy)
        sid = sup_by_name.get(sup_name)
        if item_no is None or sid is None:
            skip_item.add(legacy)
            continue
        if (item_no, sid, price, when_iso) in existing:
            continue
        session.add(
            SupplierQuote(
                item_no=item_no, supplier_id=sid, project_no=None, price=price, tax_incl=tax_incl,
                qty=a["qty"] or None, currency="CNY", unit=a["unit"] or None, price_type="成交",
                quote_date=date.fromisoformat(when_iso), source=SOURCE,
                remark=f"{a['po']} · {a['equip']} · {a['mat']}".strip(" ·") or None,
            )
        )
        created += 1
        if created % 5000 == 0:
            session.flush()
            out.append(f"        …已写 {created}/{len(agg)}")
    session.flush()
    audit.log(
        session, user=None, action="ERP导入", object_type="supplier_quote",
        summary=f"ERP 采购历史价导入：新建 {created} 条",
        detail={"created": created, "deduped": len(agg), "detail_rows": rows_total,
                "skipped_items": len(skip_item), "source_files": [p.name for p in files]},
    )


# --------------------------------------------------------------------------- 入口


FILES: dict[str, list[Path]] = {}


def collect_files(root: Path) -> None:
    if not root.exists():
        raise SystemExit(f"数据目录不存在：{root}")
    FILES["suppliers"] = root / "供应商.xls"
    FILES["library"] = sorted((root / "标准库").glob("*.xls"))
    FILES["prices"] = sorted((root / "采购单").glob("*.xls"))
    for key in ("suppliers", "library", "prices"):
        if not FILES[key]:
            raise SystemExit(f"没找到 {key} 的源文件（目录：{root}）")


def main() -> None:
    ap = argparse.ArgumentParser(description="ERP 历史数据导入（供应商 / 标准库 / 采购历史价）")
    ap.add_argument("--dir", default=str(REPO_ROOT / "docs" / "shuju"), help="数据目录（默认 docs/shuju）")
    ap.add_argument("--yes", action="store_true", help="真的写库（不加则只预演）")
    ap.add_argument("--only", default="suppliers,library,prices", help="只跑某几段，逗号分隔")
    ap.add_argument("--limit", type=int, default=None, help="每个文件只读前 N 行（冒烟）")
    ap.add_argument("--report", default=None, help="报告文件路径（默认 docs/shuju/import_report_<日期>.txt）")
    args = ap.parse_args()

    collect_files(Path(args.dir))
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    dry = not args.yes
    out: list[str] = [f"ERP 历史数据导入 —— {'预演（不写库）' if dry else '★ 真写'}，目录 {args.dir}"]

    session = SessionLocal()
    try:
        if dry:
            # 预演全程只读：不提交，任何意外改动最后 rollback
            if "suppliers" in only:
                phase_suppliers(session, dry=True, out=out)
            known = set()
            if "library" in only:
                known = phase_library(session, dry=True, out=out, limit=args.limit)
            if "prices" in only:
                phase_prices(session, dry=True, out=out, known_legacy=known, limit=args.limit)
            session.rollback()
        else:
            if "suppliers" in only:
                phase_suppliers(session, dry=False, out=out)
                session.commit()
            known = set()
            if "library" in only:
                known = phase_library(session, dry=False, out=out, limit=args.limit)
                session.commit()
            if "prices" in only:
                phase_prices(session, dry=False, out=out, known_legacy=known, limit=args.limit)
                session.commit()
    finally:
        session.close()

    text = "\n".join(out)
    print(text)
    report = Path(args.report) if args.report else (Path(args.dir) / f"import_report_{date.today().isoformat()}.txt")
    report.write_text(text + "\n", encoding="utf-8")
    print(f"\n报告已写入 {report}")


if __name__ == "__main__":
    main()
