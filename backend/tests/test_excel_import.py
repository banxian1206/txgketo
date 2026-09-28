# -*- coding: utf-8 -*-
"""Excel/CSV 历史采购导入 护栏（AGENTS §8.3 第 1 条，2026-09-28）。

**零新依赖**：`.xlsx` 用标准库 `zipfile`+`xml.etree` 读（不是 openpyxl）——
AGENTS §3 要求"不得擅自新增依赖"，而 xlsx 本质就是个 zip 包。
"""
from __future__ import annotations

import io
import zipfile
from datetime import date

import pytest

from app.services.excel_import import ImportError_, _to_bool, _to_date, parse_table, read_xlsx


def make_xlsx(rows: list[list]) -> bytes:
    """造一个最小 xlsx（sharedStrings 放文本、数字直放）。"""
    ss: list[str] = []
    idx: dict[str, int] = {}

    def sref(v):
        if v not in idx:
            idx[v] = len(ss)
            ss.append(v)
        return idx[v]

    body = []
    for ri, row in enumerate(rows, start=1):
        cells = []
        for ci, v in enumerate(row):
            col = chr(ord("A") + ci)
            if isinstance(v, (int, float)):
                cells.append(f'<c r="{col}{ri}"><v>{v}</v></c>')
            else:
                cells.append(f'<c r="{col}{ri}" t="s"><v>{sref(str(v))}</v></c>')
        body.append(f'<row r="{ri}">{"".join(cells)}</row>')
    sheet = (
        '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/'
        f'spreadsheetml/2006/main"><sheetData>{"".join(body)}</sheetData></worksheet>'
    )
    shared = (
        '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/'
        f'spreadsheetml/2006/main" count="{len(ss)}" uniqueCount="{len(ss)}">'
        + "".join(f"<si><t>{x}</t></si>" for x in ss)
        + "</sst>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/worksheets/sheet1.xml", sheet)
        z.writestr("xl/sharedStrings.xml", shared)
    return buf.getvalue()


# ── 零依赖读 xlsx ───────────────────────────────────────────────────────────
def test_reads_xlsx_without_openpyxl():
    grid = read_xlsx(make_xlsx([["物料", "供应商", "单价"], ["A-1", "甲公司", 12.5]]))
    assert grid[0][:3] == ["物料", "供应商", "单价"]
    assert grid[1][:3] == ["A-1", "甲公司", "12.5"]


def test_bad_zip_gives_friendly_error():
    with pytest.raises(ImportError_, match="不是有效的 xlsx"):
        read_xlsx(b"not a zip at all")


# ── 表头识别（中英 + 顺序无关）──────────────────────────────────────────────
def test_header_aliases_and_any_order():
    csv = "供应商,数量,物料,单价\n甲,3,IT-1,9.5\n".encode()
    rows, warn = parse_table(csv, "h.csv")
    assert rows[0]["item_no"] == "IT-1" and rows[0]["supplier_name"] == "甲"
    assert rows[0]["price"] == 9.5 and rows[0]["qty"] == 3.0
    assert warn == []


def test_english_headers_work():
    csv = b"item,supplier,price\nIT-9,SupA,5\n"
    rows, _ = parse_table(csv, "h.csv")
    assert rows[0]["item_no"] == "IT-9" and rows[0]["supplier_name"] == "SupA"


def test_missing_required_column_is_explicit():
    with pytest.raises(ImportError_, match="缺少必需的列"):
        parse_table("物料,数量\nA-1,2\n".encode(), "h.csv")


def test_unrecognizable_header_is_explicit():
    with pytest.raises(ImportError_, match="认不出表头"):
        parse_table("列一,列二\n1,2\n".encode(), "h.csv")


def test_old_xls_is_rejected_with_advice():
    with pytest.raises(ImportError_, match="另存为"):
        parse_table(b"\xd0\xcf\x11\xe0", "老台账.xls")


# ── 值清洗 ──────────────────────────────────────────────────────────────────
def test_price_strips_currency_and_thousands():
    rows, _ = parse_table("物料,供应商,单价\nA-1,甲,\"￥1,280.00\"\n".encode(), "h.csv")
    assert rows[0]["price"] == 1280.0


def test_bad_rows_are_reported_not_fatal():
    csv = "物料,供应商,单价,数量\nA-1,甲,10,1\n,乙,5,1\nA-2,丙,abc,1\nA-3,丁,-3,1\n".encode()
    rows, warn = parse_table(csv, "h.csv")
    assert [r["item_no"] for r in rows] == ["A-1"]  # 只有第 1 行合格
    assert len(warn) == 3 and all("第" in w for w in warn)


def test_empty_file_raises():
    with pytest.raises(ImportError_, match="空"):
        parse_table(b"\n\n", "h.csv")


def test_gbk_csv_supported():
    rows, _ = parse_table("物料,供应商,单价\n甲件,甲公司,8\n".encode("gb18030"), "h.csv")
    assert rows[0]["item_no"] == "甲件"


# ── 日期 ────────────────────────────────────────────────────────────────────
def test_date_formats():
    assert _to_date("2025-03-15") == date(2025, 3, 15)
    assert _to_date("2025/03/15") == date(2025, 3, 15)
    assert _to_date("20250315") == date(2025, 3, 15)
    assert _to_date("") is None


def test_date_excel_serial_only_when_column_is_a_date():
    """★ 纯数字只在「日期」列才当 Excel 序列号；否则当作看不懂 → 报错（调用方只在日期列调它）。"""
    assert _to_date("45000", header="成交日期") == date(1899, 12, 30) + __import__("datetime").timedelta(days=45000)
    with pytest.raises(ImportError_, match="日期看不懂"):
        _to_date("45000", header="数量")


def test_tax_flag():
    assert _to_bool("是") and _to_bool("含税") and _to_bool("1")
    assert not _to_bool("否")
    assert _to_bool("", default=True) and not _to_bool("", default=False)
