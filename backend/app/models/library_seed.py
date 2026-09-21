"""标准库种子数据：类别 / 品类 / 规格模板。

规格模板决定「这个品类的物料必须填哪些字段」——采购就是照这些字段买。
加品类只改这里，不改代码。
"""

CATEGORIES: list[dict] = [
    {"code": "YL", "name": "原材料", "seq": 1},
    {"code": "BZ", "name": "外购标准件", "seq": 2},
    {"code": "DQ", "name": "电气件", "seq": 3},
    {"code": "QD", "name": "气动件", "seq": 4},
    {"code": "JJ", "name": "紧固件", "seq": 5},
    {"code": "ZC", "name": "轴承", "seq": 6},
    {"code": "QT", "name": "其他外购", "seq": 9},
]


def _f(code: str, name: str, ftype: str, unit: str | None = None, required: bool = True,
       options: list[str] | None = None, group: str | None = None) -> dict:
    d: dict = {"code": code, "name": name, "type": ftype, "required": required}
    if unit:
        d["unit"] = unit
    if options:
        d["options"] = options
    if group:
        d["group"] = group
    return d


# 材质常用值（来自客户编码规则第 8 页的常用原材料标准名称）
MATERIALS = [
    "Q235",
    "304",
    "201",
    "6061",
    "45#",
    "黄铜H59",
    "黄铜H61",
    "紫铜T1",
    "紫铜T3",
    "亚克力",
    "POM",
    "尼龙",
    "电木",
    "优力胶",
]

CLASSES: list[dict] = [
    # ---------------- 原材料 ----------------
    {
        "code": "FT",
        "name": "方通",
        "category_code": "YL",
        "seq": 1,
        "spec_template": [
            _f("material", "材质", "enum", options=MATERIALS),
            _f("w", "截面长", "number", "mm", group="截面"),
            _f("h", "截面宽", "number", "mm", group="截面"),
            _f("t", "壁厚", "number", "mm"),
            _f("len", "定尺长", "number", "mm"),
        ],
    },
    {
        "code": "BT",
        "name": "扁通",
        "category_code": "YL",
        "seq": 2,
        "spec_template": [
            _f("material", "材质", "enum", options=MATERIALS),
            _f("w", "宽", "number", "mm", group="截面"),
            _f("h", "高", "number", "mm", group="截面"),
            _f("t", "壁厚", "number", "mm"),
            _f("len", "定尺长", "number", "mm"),
        ],
    },
    {
        "code": "CG",
        "name": "槽钢",
        "category_code": "YL",
        "seq": 3,
        "spec_template": [
            _f("material", "材质", "enum", options=MATERIALS),
            _f("model", "规格型号", "text"),
            _f("len", "定尺长", "number", "mm"),
        ],
    },
    {
        "code": "BC",
        "name": "板材",
        "category_code": "YL",
        "seq": 4,
        "spec_template": [
            _f("material", "材质", "enum", options=MATERIALS),
            _f("t", "厚度", "number", "mm"),
            _f("size", "尺寸（宽×长）", "text"),
        ],
    },
    {
        "code": "YG",
        "name": "圆钢/光圆",
        "category_code": "YL",
        "seq": 5,
        "spec_template": [
            _f("material", "材质", "enum", options=MATERIALS),
            _f("d", "直径", "number", "mm"),
            _f("len", "长度", "number", "mm"),
        ],
    },
    {
        "code": "LC",
        "name": "铝型材",
        "category_code": "YL",
        "seq": 6,
        "spec_template": [
            _f("material", "材质", "enum", options=["6061", "6063", "欧标", "氧化"]),
            _f("series", "系列", "text"),
            _f("len", "定尺长", "number", "mm"),
        ],
    },
    # ---------------- 外购标准件 ----------------
    {
        "code": "DG",
        "name": "直线导轨",
        "category_code": "BZ",
        "seq": 11,
        "spec_template": [
            _f("brand", "品牌", "text"),
            _f("model", "厂家型号", "text"),
            _f("w", "宽度", "number", "mm"),
            _f("len", "长度", "number", "mm"),
        ],
    },
    {
        "code": "SG",
        "name": "滚珠丝杆",
        "category_code": "BZ",
        "seq": 12,
        "spec_template": [
            _f("brand", "品牌", "text"),
            _f("model", "厂家型号", "text"),
            _f("d", "直径", "number", "mm"),
            _f("pitch", "导程", "number", "mm"),
            _f("len", "长度", "number", "mm"),
        ],
    },
    {
        "code": "DJ",
        "name": "电机",
        "category_code": "BZ",
        "seq": 13,
        "spec_template": [
            _f("brand", "品牌", "text"),
            _f("model", "厂家型号", "text"),
            _f("power", "功率", "text"),
            _f("voltage", "电压", "text"),
        ],
    },
    {
        "code": "JSJ",
        "name": "减速机",
        "category_code": "BZ",
        "seq": 14,
        "spec_template": [
            _f("brand", "品牌", "text"),
            _f("model", "厂家型号", "text"),
            _f("ratio", "减速比", "text"),
        ],
    },
    {
        "code": "JQR",
        "name": "工业机器人",
        "category_code": "BZ",
        "seq": 15,
        "spec_template": [
            _f("brand", "品牌", "text"),
            _f("model", "厂家型号", "text"),
            _f("payload", "负载", "text"),
            _f("arm", "臂展", "text"),
        ],
    },
    # ---------------- 电气件 ----------------
    {
        "code": "PLC",
        "name": "PLC",
        "category_code": "DQ",
        "seq": 21,
        "spec_template": [
            _f("brand", "品牌", "text"),
            _f("series", "系列", "text"),
            _f("model", "厂家型号", "text"),
            _f("io", "IO 点数", "text"),
        ],
    },
    {
        "code": "SF",
        "name": "伺服",
        "category_code": "DQ",
        "seq": 22,
        "spec_template": [
            _f("brand", "品牌", "text"),
            _f("model", "厂家型号", "text"),
            _f("power", "功率", "text"),
        ],
    },
    {
        "code": "CAM",
        "name": "视觉相机",
        "category_code": "DQ",
        "seq": 23,
        "spec_template": [
            _f("brand", "品牌", "text"),
            _f("model", "厂家型号", "text"),
            _f("res", "分辨率", "text"),
        ],
    },
    # ---------------- 气动件 ----------------
    {
        "code": "QG",
        "name": "气缸",
        "category_code": "QD",
        "seq": 31,
        "spec_template": [
            _f("brand", "品牌", "text"),
            _f("model", "厂家型号", "text"),
            _f("bore", "缸径", "number", "mm"),
            _f("stroke", "行程", "number", "mm"),
        ],
    },
    # ---------------- 紧固件 / 轴承 ----------------
    {
        "code": "LS",
        "name": "螺丝",
        "category_code": "JJ",
        "seq": 41,
        "spec_template": [
            _f("material", "材质/强度", "text"),
            _f("spec", "规格", "text"),
            _f("head", "头型", "enum", options=["内六角", "外六角", "沉头", "十字", "自攻"]),
        ],
    },
    {
        "code": "ZCT",
        "name": "轴承",
        "category_code": "ZC",
        "seq": 51,
        "spec_template": [
            _f("brand", "品牌", "text"),
            _f("model", "型号", "text"),
        ],
    },
]

# 任务编号规则
TASK_RULE: dict = {
    "object_type": "TASK",
    "name": "任务",
    "template": "TK{YY}{seq:03}",
    "scope": "project",
    "remark": "按项目取流水",
}

# 采购单编号规则（合并下单时一张单一个号）
PO_RULE: dict = {
    "object_type": "PURCHASE_ORDER",
    "name": "采购单",
    "template": "PO{YY}{seq:03}",
    "scope": "global_year",
    "remark": "合并下单共用同一个采购单号",
}

# 领料单编号规则
ISSUE_RULE: dict = {
    "object_type": "ISSUE",
    "name": "领料单",
    "template": "MI{YY}{seq:03}",
    "scope": "project",
    "remark": "",
}

# 供应商编号规则
SUPPLIER_RULE: dict = {
    "object_type": "SUPPLIER",
    "name": "供应商",
    "template": "S{seq:04}",
    "scope": "global",
    "remark": "",
}

# 到货单编号规则
RECEIPT_RULE: dict = {
    "object_type": "RECEIPT",
    "name": "到货单",
    "template": "GR{YY}{seq:03}",
    "scope": "project",
    "remark": "",
}

# 评审单编号规则（05 卷 §8.1）：一个任务一张单，多轮提交共用
REVIEW_TICKET_RULE: dict = {
    "object_type": "REVIEW_TICKET",
    "name": "评审单",
    "template": "RV{YY}{seq:03}",
    "scope": "project",
    "remark": "一个任务一张单，多轮提交共用",
}

# 设计发布（冻结）批次编号规则（05 卷 §8.1）
DESIGN_RELEASE_RULE: dict = {
    "object_type": "DESIGN_RELEASE",
    "name": "设计发布",
    "template": "RL{YY}{seq:03}",
    "scope": "project",
    "remark": "一次审核通过 = 一个冻结批次",
}

# 标准库物料的编号规则（01 卷 §5：{类别码}-{品类码}-{流水4位}）
STD_ITEM_RULE: dict = {
    "object_type": "STD_ITEM",
    "name": "标准库物料",
    "template": "{cat}-{cls}-{seq:04}",
    "scope": "std_class",
    "remark": "按品类取流水；编码不含规格，规格另存",
}
