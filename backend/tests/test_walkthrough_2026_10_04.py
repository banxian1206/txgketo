# -*- coding: utf-8 -*-
"""2026-10-04 走查核实的修复护栏（F1/F7/N2/F11）。

来源报告：docs/99-走查报告核实-2026-10-04.md
  F1  422 的 detail 是**对象数组**，被原样丢给 React 渲染 → 整站白屏（100% 复现）
  F7  responseType:'blob' 的接口出错时 error.response.data 是 Blob → errMsg 读不到 .detail，
      屏幕上甩的是 axios 原文「Request failed with status code 404」而不是后端人话
  N2  重复「开始装配」新建第二条整机装配记录，把已装配设备打回「装配中」→
      发运台判"未装配完成"→ **能发的货发不出去**（且系统没有删除装配记录的口）
  F11 PM 台「验收与质保」没有项目筛选，签字类动作（法律性数据）跨项目混排

风格与本目录其它护栏一致：按代码结构断言（钉住"修法"，不是钉文件名）。
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FE = ROOT / "frontend" / "src"


def _src(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _py_fn(rel: str, name: str) -> str:
    """从 Python 文件里按函数名取源码段（到下一个顶级 def 为止）。"""
    src = _src(ROOT / "backend" / rel)
    i = src.index(f"def {name}(")
    j = src.find("\ndef ", i + 1)
    return src[i: j if j > 0 else len(src)]


# ══ F1/F7：错误文案唯一出口只会产出字符串 ════════════════════════
def test_errmsg_never_returns_raw_detail():
    """修前 `return data?.detail ?? e.message ?? '操作失败'` —— 422 的 detail 是对象数组，
    原样返回 → message.error(数组) → React 崩溃整站白屏。现在必须先归一成字符串。"""
    src = _src(FE / "api" / "http.ts")
    body = src[src.index("function errMsg("): src.index("function errMsg(") + 2200]
    assert "?.response?.data?.detail ??" not in body, (
        "errMsg 不得再把 data.detail 原样作为返回出口（422 = 对象数组 → 白屏，F1）"
    )
    assert "typeof detail === 'string'" in body, "先判字符串，其余走数组/对象分支"


def test_errmsg_handles_422_array_and_blob():
    """422 数组要拼成人话（指出哪个字段没过）；Blob 错误体要在拦截器里回读成 JSON（F7）。"""
    src = _src(FE / "api" / "http.ts")
    assert "Array.isArray(detail)" in src, "422 的 detail 是数组，必须显式处理"
    assert "d.loc" in src, "422 要指出是哪个字段没过校验"
    assert "data instanceof Blob" in src, "responseType:'blob' 出错时 data 是 Blob（F7 根因）"
    assert "JSON.parse(await data.text())" in src, "Blob 错误体要回读成 JSON，后端人话才能上屏"


# ══ N2/F8：装配重复开工的两条硬规则 ══════════════════════════════
def test_start_assembly_rejects_reopen_on_assembled_equipment():
    """已装配完成的设备**不得**再开整机装配；已有「装配中」的记录要复用（同 P1-7 幂等套路）。"""
    body = _py_fn("app/services/kitting.py", "start_assembly")
    assert "ASSY_WHOLE" in body, "整机装配要有专门的重复开工判定"
    assert "AssemblyError" in body, "重开装配必须抛域错误（main.py 全局 400），不是默默建第二条"
    assert "== ASSY_ING" in body, "已有装配中的记录要复用，不再建第二条（F8）"


def test_assembly_error_is_globally_handled():
    """域错误类必须注册进 main.py 的 400 处理器（同一个坑踩过三次，别再靠 route 手工 try）。"""
    src = _src(ROOT / "backend" / "app" / "main.py")
    assert "from app.services.kitting import AssemblyError" in src
    i = src.index("async def _domain_error")
    seg = src[max(0, i - 1200): i]
    assert "@app.exception_handler(AssemblyError)" in seg


def test_shipping_reads_only_whole_machine_assembly():
    """设备「是否装配完成」只看整机装配记录 —— 组件预装不得改写整机状态（N2 的机制）。"""
    src = _src(ROOT / "backend" / "app" / "services" / "shipping.py")
    seg = src[src.index("def to_ship("):][:2600]
    assert "AssemblyRecord.sub_assembly == ASSY_WHOLE" in seg, (
        "to_ship 的装配状态映射必须过滤 sub_assembly，"
        "否则一条后补的组件预装就把已装配设备打回不可发"
    )
    seg2 = src[src.index("def _assembled_record("):][:900]
    assert "AssemblyRecord.sub_assembly == ASSY_WHOLE" in seg2


# ══ F11：验收列表必须能按项目收口 ════════════════════════════════
def test_acceptance_workbench_supports_project_filter():
    """签字类动作 = 法律性数据，列表跨项目混排会误操作（F11：实测 .ant-select 数 = 0）。"""
    body = _py_fn("app/api/routes/acceptance.py", "workbench")
    assert 'project_no: str | None = Query' in body, "接口要接受项目筛选参数"
    assert "Acceptance.project_no == project_no" in body
    assert "w.get" in body and "project_no" in body, "质保到期提醒同样按项目过滤"


def test_acceptance_page_has_project_filter_in_url():
    """前端：筛选控件存在且筛选进 URL（刷新/返回不丢，同 docs/12 P3 约定）。"""
    src = _src(FE / "features" / "acceptance" / "Page.tsx")
    assert "useUrlState({ project" in src, "项目筛选进 ?project="
    assert "acceptanceWorkbench(filterNo" in src, "筛选值要真的传给后端（不是摆设）"
