"""发号引擎（依据《01 编码规则 · 解读与系统落地设计》）。

铁律（来自贵司编码规则）：
1. **单编号贯穿**：项目编号在"新建商机"时发号，此号即订单号/合同号/项目号，一生不变。
2. **机械图纸** = `{项目号}-{设备号}-{一级}-{二级}-{三级}-{零件}`，固定 4 组层次码（两位一组，从 01 起，未用补 00）。
3. **电气图纸** = `{项目号}-{设备号|线体号}[-90]-{图序3位}`；`90` 为单机固定电气组件。
4. 一切序号从 `01` 起；`00` 表示该层为空。
5. **层次码隐含 BOM 结构**：父级 = 把最后一个非 `00` 位置置 `00`。
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from datetime import date
from enum import StrEnum

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.numbering import NumberRule, NumberSeq


class ObjectType(StrEnum):
    PROJECT = "PROJECT"  # 项目编号（= 商机号 = 订单号 = 合同号）
    EQUIPMENT = "EQUIPMENT"  # 设备号 01A
    DRAWING_MECH = "DRAWING_MECH"  # 机械图纸（4 组层次码）
    DRAWING_ELEC_MACHINE = "DRAWING_ELEC_MACHINE"  # 电气图纸（单机）
    DRAWING_ELEC_LINE = "DRAWING_ELEC_LINE"  # 电气图纸（线体）
    SERVICE_ORDER = "SERVICE_ORDER"  # 售后工单


# 默认规则（seed 时写入数据库；改规则只改数据，不改代码）
DEFAULT_RULES: list[dict] = [
    {
        "object_type": ObjectType.PROJECT,
        "name": "项目编号（商机号=订单号=合同号）",
        "template": "TX{YY}{seq:03}",
        "scope": "global_year",
        "remark": "建商机时发号，一生不变",
    },
    {
        "object_type": ObjectType.EQUIPMENT,
        "name": "设备号",
        "template": "{seq:02}{letter}",
        "scope": "project",
        "remark": "01A；同型第二台 01B",
    },
    {
        "object_type": ObjectType.DRAWING_MECH,
        "name": "机械图纸（4 组层次码）",
        "template": "{project}-{equip}-{l1}-{l2}-{l3}-{l4}",
        "scope": "none",
        "remark": "组合式编号，不取序列号",
    },
    {
        "object_type": ObjectType.DRAWING_ELEC_MACHINE,
        "name": "电气图纸（单机）",
        "template": "{project}-{equip}-90-{seq:03}",
        "scope": "project_equip",
        "remark": "90=单机固定电气组件",
    },
    {
        "object_type": ObjectType.DRAWING_ELEC_LINE,
        "name": "电气图纸（线体）",
        "template": "{project}-{line}-{seq:03}",
        "scope": "project_line",
        "remark": "100=整段皮带线",
    },
    {
        "object_type": ObjectType.SERVICE_ORDER,
        "name": "售后工单",
        "template": "SV{YY}{seq:03}",
        "scope": "global_year",
        "remark": "",
    },
]

TOKEN_RE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)(?::(\d+))?\}")

# 图号正则
PROJECT_NO_RE = re.compile(r"^TX\d{5}$")
MECH_DRAWING_RE = re.compile(r"^(TX\d{5})-([A-Za-z0-9]+)-(\d{2})-(\d{2})-(\d{2})-(\d{2})$")
STD_MECH_DRAWING_RE = re.compile(r"^(0[A-Z]{3}\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$")
ELEC_MACHINE_RE = re.compile(r"^(TX\d{5})-([A-Za-z0-9]+)-90-(\d{3})$")
ELEC_LINE_RE = re.compile(r"^(TX\d{5})-([A-Za-z0-9]+)-(\d{3})$")

LEVEL_COUNT = 4
EMPTY = "00"


class NumberingError(Exception):
    """编号规则错误（模板缺参、规则不存在、格式非法）。"""


# --------------------------------------------------------------------------
# 模板渲染与取号
# --------------------------------------------------------------------------


def render_template(template: str, values: Mapping[str, object]) -> str:
    """把 `{seq:03}` / `{project}` / `{YY}` 填成实际值（占位符大小写不敏感）。"""
    lower = {k.lower(): v for k, v in values.items()}

    def _sub(m: re.Match[str]) -> str:
        name, width = m.group(1), m.group(2)
        key = name.lower()
        if key not in lower or lower[key] is None:
            raise NumberingError(f"编号模板缺少参数：{{{name}}}")
        text = str(lower[key])
        return text.zfill(int(width)) if width else text

    return TOKEN_RE.sub(_sub, template)


def _take_seq(session: Session, rule: NumberRule, scope_key: str) -> int:
    """行锁取号：保证不重号、不跳号。"""
    stmt = (
        select(NumberSeq)
        .where(NumberSeq.rule_id == rule.id, NumberSeq.scope_key == scope_key)
        .with_for_update()
    )
    row = session.scalar(stmt)
    if row is None:
        try:
            with session.begin_nested():
                session.add(
                    NumberSeq(rule_id=rule.id, scope_key=scope_key, next_value=rule.start_value)
                )
        except IntegrityError:
            pass  # 并发下已被别的会话插入，下面重新加锁读取
        row = session.scalar(stmt)
    if row is None:  # pragma: no cover - 理论不可达
        raise NumberingError("取号失败：序列行缺失")
    value = row.next_value
    row.next_value = value + rule.step
    session.flush()
    return value


def get_rule(session: Session, object_type: str) -> NumberRule:
    rule = session.scalar(select(NumberRule).where(NumberRule.object_type == object_type))
    if rule is None:
        raise NumberingError(f"编号规则未配置：{object_type}")
    return rule


def next_number(
    session: Session, object_type: str, scope_key: str | None = None, **parts: object
) -> str:
    """按规则发号。

    - 组合式模板（无 `{seq}`）：只做拼装与校验，不消耗序列
    - 序列式模板（含 `{seq}`）：从 number_seq 行锁取号
    """
    rule = get_rule(session, object_type)
    values: dict[str, object] = {k.lower(): v for k, v in parts.items()}
    values.setdefault("yy", f"{date.today().year % 100:02d}")

    tokens = {m.group(1).lower() for m in TOKEN_RE.finditer(rule.template)}
    if "seq" in tokens:
        values["seq"] = _take_seq(session, rule, scope_key or "")

    missing = sorted(t for t in tokens if values.get(t) is None)
    if missing:
        raise NumberingError(f"编号模板 {rule.template} 缺少参数：{missing}")
    return render_template(rule.template, values)


def year_scope_key() -> str:
    """按年取号时的 scope_key（项目编号 TX{YY}{NNN}）。"""
    return str(date.today().year)


def peek_number(session: Session, object_type: str, scope_key: str | None = None, **parts: object) -> str:
    """试算下一个编号（不消耗序列），用于界面预览。"""
    rule = get_rule(session, object_type)
    values: dict[str, object] = {k.lower(): v for k, v in parts.items()}
    values.setdefault("yy", f"{date.today().year % 100:02d}")
    tokens = {m.group(1).lower() for m in TOKEN_RE.finditer(rule.template)}
    if "seq" in tokens:
        key = scope_key or ""
        row = session.scalar(
            select(NumberSeq).where(
                NumberSeq.rule_id == rule.id, NumberSeq.scope_key == key
            )
        )
        values["seq"] = row.next_value if row else rule.start_value
    missing = sorted(t for t in tokens if values.get(t) is None)
    if missing:
        raise NumberingError(f"编号模板 {rule.template} 缺少参数：{missing}")
    return render_template(rule.template, values)


# --------------------------------------------------------------------------
# 设备号：01A（同型第二台 01B）
# --------------------------------------------------------------------------

EQUIP_NO_RE = re.compile(r"^(\d{2})([A-Z])$")


def make_equip_no(seq: int, letter: str = "A") -> str:
    if not 1 <= seq <= 99:
        raise NumberingError("设备序号必须在 01~99")
    if not re.fullmatch(r"[A-Z]", letter):
        raise NumberingError("设备实例字母必须是 A~Z")
    return f"{seq:02d}{letter}"


def parse_equip_no(equip_no: str) -> tuple[int, str]:
    m = EQUIP_NO_RE.match(equip_no)
    if not m:
        raise NumberingError(f"设备号格式非法：{equip_no}（应为 01A 形式）")
    return int(m.group(1)), m.group(2)


def next_letter(used: Iterable[str]) -> str:
    """同型设备的下一台：A → B → C …"""
    letters = {x.upper() for x in used if x}
    for code in range(ord("A"), ord("Z") + 1):
        candidate = chr(code)
        if candidate not in letters:
            return candidate
    raise NumberingError("同型设备超过 26 台，需要另起序号")


# --------------------------------------------------------------------------
# 机械图纸：4 组层次码
# --------------------------------------------------------------------------


def validate_levels(levels: Iterable[str]) -> list[str]:
    out = [str(x) for x in levels]
    if len(out) != LEVEL_COUNT:
        raise NumberingError(f"机械图纸层次码必须是 {LEVEL_COUNT} 组，实得 {len(out)} 组")
    for i, code in enumerate(out, start=1):
        if not re.fullmatch(r"\d{2}", code):
            raise NumberingError(f"第 {i} 组层次码必须是两位数字：{code}")
        if code != EMPTY and int(code) == 0:
            raise NumberingError(f"第 {i} 组层次码非法：{code}（未用请填 00；序号一律从 01 起）")
    return out


def compose_mech_drawing_no(project_no: str, equip_no: str, levels: Iterable[str]) -> str:
    codes = validate_levels(levels)
    if not PROJECT_NO_RE.match(project_no):
        raise NumberingError(f"项目编号格式非法：{project_no}")
    return "-".join([project_no, equip_no, *codes])


def parse_drawing_no(drawing_no: str) -> dict:
    """解析图号 → {scheme, project_no, equip_no, levels|seq}。"""
    m = MECH_DRAWING_RE.match(drawing_no)
    if m:
        return {
            "scheme": "MECH_LEVEL",
            "project_no": m.group(1),
            "equip_no": m.group(2),
            "levels": list(m.groups()[2:]),
        }
    m = STD_MECH_DRAWING_RE.match(drawing_no)
    if m:
        return {
            "scheme": "STD_LEVEL",
            "std_code": m.group(1),
            "equip_no": None,
            "levels": list(m.groups()[1:]),
        }
    m = ELEC_MACHINE_RE.match(drawing_no)
    if m:
        return {
            "scheme": "ELEC_MACHINE",
            "project_no": m.group(1),
            "equip_no": m.group(2),
            "seq": m.group(3),
        }
    m = ELEC_LINE_RE.match(drawing_no)
    if m:
        return {
            "scheme": "ELEC_LINE",
            "project_no": m.group(1),
            "line_no": m.group(2),
            "seq": m.group(3),
        }
    raise NumberingError(f"无法识别的图号：{drawing_no}")


def _last_nonzero_index(levels: list[str]) -> int:
    for i in range(len(levels) - 1, -1, -1):
        if levels[i] != EMPTY:
            return i
    return -1


def drawing_level(drawing_no: str) -> int:
    """层级：0=总装，1..3=一/二/三级组件，4=零件。"""
    parsed = parse_drawing_no(drawing_no)
    if "levels" not in parsed:
        return -1
    idx = _last_nonzero_index(parsed["levels"])
    return idx + 1


def is_part_drawing(drawing_no: str) -> bool:
    return drawing_level(drawing_no) == LEVEL_COUNT


def parent_drawing_no(drawing_no: str) -> str | None:
    """父级图号 = 把最后一个非 00 位置置 00；总装图（全 00）返回 None。"""
    parsed = parse_drawing_no(drawing_no)
    if "levels" not in parsed:
        return None
    levels = list(parsed["levels"])
    idx = _last_nonzero_index(levels)
    if idx < 0:
        return None
    levels[idx] = EMPTY
    head = parsed.get("project_no") or parsed.get("std_code")
    equip = parsed.get("equip_no") or ""
    return "-".join([head, equip, *levels]) if equip else "-".join([head, *levels])


def next_level_code(used: Iterable[str]) -> str:
    """同级下一个可用层次码：01 → 02 …（从 01 起）"""
    numbers = {int(x) for x in used if str(x).isdigit() and int(x) > 0}
    for n in range(1, 100):
        if n not in numbers:
            return f"{n:02d}"
    raise NumberingError("同级条目超过 99 个，需要拆分层级")
