"""发号引擎纯逻辑测试（不需要数据库）。"""

import pytest

from app.services.numbering import (
    NumberingError,
    compose_mech_drawing_no,
    drawing_level,
    is_part_drawing,
    make_equip_no,
    next_letter,
    next_level_code,
    parent_drawing_no,
    parse_drawing_no,
    parse_equip_no,
    render_template,
    validate_levels,
)


class TestRenderTemplate:
    def test_seq_padding(self):
        assert render_template("TX{YY}{seq:03}", {"yy": "26", "seq": 1}) == "TX26001"

    def test_seq_no_padding(self):
        assert render_template("SV{YY}{seq}", {"yy": "26", "seq": 12}) == "SV2612"

    def test_compose_drawing(self):
        got = render_template(
            "{project}-{equip}-{l1}-{l2}-{l3}-{l4}",
            {"project": "TX23026", "equip": "01A", "l1": "02", "l2": "01", "l3": "00", "l4": "00"},
        )
        assert got == "TX23026-01A-02-01-00-00"

    def test_missing_param_raises(self):
        with pytest.raises(NumberingError):
            render_template("{project}-{equip}", {"project": "TX23026"})


class TestEquipmentNo:
    def test_make(self):
        assert make_equip_no(1) == "01A"
        assert make_equip_no(1, "B") == "01B"
        assert make_equip_no(12, "C") == "12C"

    def test_parse(self):
        assert parse_equip_no("01A") == (1, "A")
        assert parse_equip_no("12C") == (12, "C")

    def test_parse_invalid(self):
        with pytest.raises(NumberingError):
            parse_equip_no("1A")

    def test_next_letter(self):
        assert next_letter(["A"]) == "B"
        assert next_letter(["A", "B"]) == "C"
        assert next_letter([]) == "A"


class TestLevelCodes:
    def test_validate_ok(self):
        assert validate_levels(["00", "00", "00", "00"]) == ["00", "00", "00", "00"]
        assert validate_levels(["01", "00", "00", "00"]) == ["01", "00", "00", "00"]

    def test_reject_zero_like(self):
        # 序号一律从 01 起，不允许 0 这种写法
        with pytest.raises(NumberingError):
            validate_levels(["0", "00", "00", "00"])

    def test_reject_wrong_count(self):
        with pytest.raises(NumberingError):
            validate_levels(["01", "00", "00"])

    def test_next_level_code(self):
        assert next_level_code([]) == "01"
        assert next_level_code(["01"]) == "02"
        assert next_level_code(["01", "03"]) == "02"


class TestMechanicalDrawing:
    def test_compose(self):
        assert (
            compose_mech_drawing_no("TX23026", "01A", ["01", "00", "00", "00"])
            == "TX23026-01A-01-00-00-00"
        )
        assert (
            compose_mech_drawing_no("TX23026", "01A", ["02", "01", "00", "00"])
            == "TX23026-01A-02-01-00-00"
        )

    def test_parse_and_level(self):
        no = "TX23026-01A-02-01-00-00"
        parsed = parse_drawing_no(no)
        assert parsed["project_no"] == "TX23026"
        assert parsed["equip_no"] == "01A"
        assert parsed["levels"] == ["02", "01", "00", "00"]
        assert drawing_level(no) == 2  # 二级组件（最后一个非 00 在第 2 位）

    def test_level_of_assembly_and_part(self):
        assert drawing_level("TX23026-01A-00-00-00-00") == 0  # 总装
        assert drawing_level("TX23026-01A-01-00-00-00") == 1  # 一级组件
        assert drawing_level("TX23026-01A-00-00-00-01") == 4  # 总装下的零件
        assert is_part_drawing("TX23026-01A-00-00-00-01")
        assert not is_part_drawing("TX23026-01A-01-00-00-00")

    def test_parent_chain(self):
        # 零件（挂总装）→ 总装
        assert parent_drawing_no("TX23026-01A-00-00-00-01") == "TX23026-01A-00-00-00-00"
        # 二级组件 → 一级组件
        assert parent_drawing_no("TX23026-01A-02-01-00-00") == "TX23026-01A-02-00-00-00"
        # 一级组件 → 总装
        assert parent_drawing_no("TX23026-01A-02-00-00-00") == "TX23026-01A-00-00-00-00"
        # 总装没有父级
        assert parent_drawing_no("TX23026-01A-00-00-00-00") is None

    def test_std_drawing(self):
        no = "0FZJ0001-02-02-02-01"
        parsed = parse_drawing_no(no)
        assert parsed["scheme"] == "STD_LEVEL"
        assert parsed["std_code"] == "0FZJ0001"
        assert drawing_level(no) == 4
        assert parent_drawing_no(no) == "0FZJ0001-02-02-02-00"


class TestElectricalDrawing:
    def test_electrical_machine(self):
        no = "TX23026-01A-90-000"
        parsed = parse_drawing_no(no)
        assert parsed["scheme"] == "ELEC_MACHINE"
        assert parsed["equip_no"] == "01A"
        assert parsed["seq"] == "000"

    def test_electrical_line(self):
        no = "TX23026-100-000"
        parsed = parse_drawing_no(no)
        assert parsed["scheme"] == "ELEC_LINE"
        assert parsed["line_no"] == "100"

    def test_unknown_raises(self):
        with pytest.raises(NumberingError):
            parse_drawing_no("NOT-A-NUMBER")
