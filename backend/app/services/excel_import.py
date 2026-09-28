"""Excel / CSV 历史采购导入（AGENTS §8.3 第 1 条，客户已确认要做）。

**为什么不用 openpyxl**：`AGENTS §3` 要求"不得擅自新增依赖"。而 `.xlsx` 本质是一个 ZIP 包
（`xl/sharedStrings.xml` + `xl/worksheets/sheet1.xml`），用标准库 `zipfile` + `xml.etree` 就能读。
本模块因此 **零新依赖**、纯内网可用；代价是只支持**常规表格**（不做公式求值、不做多 sheet 合并、
不做样式/合并单元格）—— 对一个"历史采购台账"够用，且失败会**明确报哪一行哪一列**。

支持列（表头中英文都认，顺序不限）：
    物料/物料号/item · 供应商/supplier · 单价/price · 数量/qty · 日期/date · 含税/tax_incl
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from datetime import UTC, date, datetime, timedelta
from xml.etree import ElementTree as ET

_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

from sqlalchemy import select

# 表头别名 → 规范字段名
HEADER_ALIASES: dict[str, str] = {
    "物料": "item_no", "物料号": "item_no", "料号": "item_no", "图号": "item_no",
    "item": "item_no", "item_no": "item_no", "part": "part_no", "part_no": "part_no",
    "供应商": "supplier_name", "厂商": "supplier_name", "supplier": "supplier_name",
    "supplier_name": "supplier_name",
    "单价": "price", "价格": "price", "含税单价": "price", "price": "price",
    "数量": "qty", "qty": "qty", "quantity": "qty",
    "日期": "ordered_on", "成交日期": "ordered_on", "下单日期": "ordered_on",
    "date": "ordered_on", "ordered_on": "ordered_on",
    "含税": "tax_incl", "tax_incl": "tax_incl",
    "项目": "project_no", "项目号": "project_no", "project_no": "project_no",
}

REQUIRED = ("item_no", "supplier_name", "price")


class ImportError_(Exception):
    """导入数据有问题（带行号的友好提示）。"""


def _norm_header(s: str) -> str:
    return re.sub(r"[\s　]+", "", (s or "").strip()).lower()


def _col_index(ref: str) -> int:
    """`B12` → 1（0 基列号）。"""
    letters = re.match(r"([A-Z]+)", ref or "")
    if not letters:
        return 0
    n = 0
    for ch in letters.group(1):
        n = n * 26 + (ord(ch) - ord("A") + 1)
    return n - 1


def _shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    out = []
    for si in root.findall(f"{_NS}si"):
        # 富文本会被拆成多个 <r><t>，拼起来
        out.append("".join(t.text or "" for t in si.iter(f"{_NS}t")))
    return out


def _first_sheet(zf: zipfile.ZipFile) -> str:
    names = sorted(n for n in zf.namelist() if n.startswith("xl/worksheets/") and n.endswith(".xml"))
    if not names:
        raise ImportError_("这个 xlsx 里没有工作表（是不是加密/损坏了？）")
    return names[0]


def read_xlsx(data: bytes) -> list[list[str]]:
    """把第一个工作表读成二维字符串表（零依赖）。"""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise ImportError_("不是有效的 xlsx 文件（如果是从 WPS/Excel 另存的，请存成 .xlsx 或 .csv）") from e
    shared = _shared_strings(zf)
    root = ET.fromstring(zf.read(_first_sheet(zf)))
    rows: list[list[str]] = []
    for row in root.iter(f"{_NS}row"):
        cells: dict[int, str] = {}
        for c in row.findall(f"{_NS}c"):
            idx = _col_index(c.get("r") or "")
            t = c.get("t")
            if t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(f"{_NS}t"))
            else:
                v = c.find(f"{_NS}v")
                val = v.text if v is not None and v.text is not None else ""
                if t == "s" and val != "":
                    try:
                        val = shared[int(val)]
                    except (ValueError, IndexError):
                        val = ""
            cells[idx] = (val or "").strip()
        if cells:
            width = max(cells) + 1
            rows.append([cells.get(i, "") for i in range(width)])
    return rows


def read_csv(data: bytes) -> list[list[str]]:
    for enc in ("utf-8-sig", "gb18030", "utf-8"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:  # pragma: no cover
        raise ImportError_("CSV 编码识别失败（请存成 UTF-8 或 GBK）")
    return [[(c or "").strip() for c in row] for row in csv.reader(io.StringIO(text))]


def _to_date(raw: str, *, header: str = "") -> date | None:
    """日期：优先按文本解析；纯数字且是日期列 → 当 Excel 序列号（1900 系统）。"""
    s = (raw or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    if re.fullmatch(r"\d+(\.\d+)?", s) and ("日" in header or "date" in header.lower()):
        n = float(s)  # Excel：1900-01-01 是 1（含那著名的 1900 闰年 bug）
        return date(1899, 12, 30) + timedelta(days=int(n))
    raise ImportError_(f"日期看不懂：{raw!r}（建议写成 2026-03-15）")


def _to_bool(raw: str, default: bool = True) -> bool:
    s = (raw or "").strip().lower()
    if not s:
        return default
    return s in ("1", "true", "是", "含税", "y", "yes", "含")


def parse_table(data: bytes, filename: str) -> tuple[list[dict], list[str]]:
    """把上传的表解析成规范行。:returns (rows, warnings)"""
    name = (filename or "").lower()
    if name.endswith(".xlsx") or name.endswith(".xlsm"):
        grid = read_xlsx(data)
    elif name.endswith(".csv") or name.endswith(".txt"):
        grid = read_csv(data)
    elif name.endswith(".xls"):
        raise ImportError_("老版 .xls 读不了 —— 请在 Excel 里「另存为」.xlsx 或 .csv 再传")
    else:
        # 按内容猜：ZIP 头 → xlsx，否则当 CSV
        grid = read_xlsx(data) if data[:2] == b"PK" else read_csv(data)

    grid = [r for r in grid if any((c or "").strip() for c in r)]
    if not grid:
        raise ImportError_("表是空的")

    # 找表头行：第一行里能认出至少 2 个已知列
    header_at, mapping = 0, {}
    for i, row in enumerate(grid[:5]):
        m = {}
        for j, cell in enumerate(row):
            key = HEADER_ALIASES.get(_norm_header(cell))
            if key and key not in m:
                m[key] = j
        if len(m) >= 2:
            header_at, mapping = i, m
            break
    if len(mapping) < 2:
        raise ImportError_(
            "认不出表头 —— 第一行请写：物料 / 供应商 / 单价 / 数量 / 日期（顺序不限，中英文都行）"
        )
    missing = [k for k in REQUIRED if k not in mapping]
    if missing:
        zh = {"item_no": "物料", "supplier_name": "供应商", "price": "单价"}
        raise ImportError_("缺少必需的列：" + "、".join(zh.get(k, k) for k in missing))

    header_raw = grid[header_at]
    rows: list[dict] = []
    warnings: list[str] = []
    for n, row in enumerate(grid[header_at + 1 :], start=header_at + 2):
        def get(field: str) -> str:
            j = mapping.get(field)
            return row[j].strip() if j is not None and j < len(row) else ""

        item = get("item_no") or get("part_no")
        sup = get("supplier_name")
        price_raw = get("price")
        if not item and not sup and not price_raw:
            continue  # 空行
        if not item:
            warnings.append(f"第 {n} 行：没有物料号，跳过")
            continue
        if not sup:
            warnings.append(f"第 {n} 行：没有供应商，跳过")
            continue
        try:
            price = float(str(price_raw).replace(",", "").replace("￥", "").replace("¥", "") or 0)
        except ValueError:
            warnings.append(f"第 {n} 行：单价不是数字（{price_raw!r}），跳过")
            continue
        if price <= 0:
            warnings.append(f"第 {n} 行：单价 ≤ 0，跳过")
            continue
        qty_raw = get("qty")
        try:
            qty = float(str(qty_raw).replace(",", "") or 0) or None
        except ValueError:
            qty = None
            warnings.append(f"第 {n} 行：数量不是数字（{qty_raw!r}），按空处理")
        try:
            ordered = _to_date(get("ordered_on"), header=header_raw[mapping["ordered_on"]] if "ordered_on" in mapping else "")
        except ImportError_ as e:
            warnings.append(f"第 {n} 行：{e}（按空日期处理）")
            ordered = None
        rows.append(
            {
                "row": n,
                "item_no": item,
                "supplier_name": sup,
                "price": price,
                "qty": qty,
                "ordered_on": ordered,
                "tax_incl": _to_bool(get("tax_incl")),
                "project_no": get("project_no") or None,
            }
        )
    if not rows:
        raise ImportError_("一行有效数据都没有（检查一下物料/供应商/单价是不是空的）")
    return rows, warnings


def import_history(session, rows: list[dict], *, actor_id: int | None = None) -> dict:
    """写进价格库（`supplier_quote`，历史成交）。

    - 物料/供应商不存在 → **自动建**（历史台账里常有我们库里还没有的），并按行报告
    - 幂等：同一（物料, 供应商, 日期, 单价）已存在则跳过，重复导入不会翻倍
    """
    from app.models.library import Item
    from app.models.purchasing import Supplier, SupplierQuote
    from app.services.numbering import next_number
    from datetime import date as _date

    created_item, created_supplier, imported, skipped = [], [], 0, 0
    for r in rows:
        item = session.get(Item, r["item_no"])
        if item is None:
            item = Item(
                item_no=r["item_no"],
                display_name=r["item_no"],
                source_type="标准件",
                unit="件",
            )
            session.add(item)
            session.flush()
            created_item.append(r["item_no"])

        sup_name = r["supplier_name"].strip()
        sup = session.scalar(select(Supplier).where(Supplier.name == sup_name))
        if sup is None:
            # 供应商 code 必填且唯一 → 走发号引擎（铁律 1：编号只能由发号引擎生成）
            sup = Supplier(code=next_number(session, "SUPPLIER", scope_key=""), name=sup_name)
            session.add(sup)
            session.flush()
            created_supplier.append(sup_name)

        when = r["ordered_on"] or _date.today()
        dup = session.scalar(
            select(SupplierQuote).where(
                SupplierQuote.item_no == r["item_no"],
                SupplierQuote.supplier_id == sup.id,
                SupplierQuote.price == r["price"],
                SupplierQuote.quote_date == when,
                SupplierQuote.source == "历史导入",
            )
        )
        if dup is not None:
            skipped += 1
            continue

        session.add(
            SupplierQuote(
                item_no=r["item_no"],
                supplier_id=sup.id,
                project_no=r["project_no"],
                price=r["price"],
                tax_incl=r["tax_incl"],
                qty=r["qty"],
                price_type="成交",          # 历史台账 = 真成交过的价（价格参考里最有价值的一档）
                quote_date=when,
                source="历史导入",
                remark=f"Excel 导入第 {r['row']} 行" if r.get("row") else "Excel 导入",
                recorded_by=actor_id,
            )
        )
        imported += 1
    session.flush()
    return {
        "imported": imported,
        "skipped_duplicate": skipped,
        "created_items": sorted(set(created_item)),
        "created_suppliers": sorted(set(created_supplier)),
    }

