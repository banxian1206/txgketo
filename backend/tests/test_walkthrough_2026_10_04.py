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


# ══ N1：被派的调试工程师本人能记自己的进度（行为级）══════════════════
def test_commission_dispatched_engineer_can_act():
    from types import SimpleNamespace

    from app.api.routes.site import _can_act_on_commission

    def user(name, username, roles=()):
        return SimpleNamespace(name=name, username=username, is_superuser=False,
                               roles=[SimpleNamespace(permissions=[SimpleNamespace(code=c) for c in roles])])

    row = lambda d: SimpleNamespace(dispatch_to=d)
    site1 = user("李现场", "site1", roles=("site:edit",))
    assy1 = user("王装配", "assy1")          # 无 site:edit —— 修前一律 403
    other = user("张三", "zhang3")

    assert _can_act_on_commission(site1, row("调试组 王工"))            # 原有门禁不动
    assert _can_act_on_commission(assy1, row("调试组 王装配"))           # 姓名写在派单里 → 本人可操作
    assert _can_act_on_commission(assy1, row("assy1"))                  # 账号也算
    assert not _can_act_on_commission(other, row("调试组 王装配"))       # 路人仍然不行
    assert not _can_act_on_commission(assy1, row(None))                 # 没派人 → 只有现场/PM 能推进


# ══ F9：现场勘测 / 申请调试不得重复堆积（幂等）════════════════════════
class _FakeResult:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row

    def all(self):
        # team_ids() 会走 scalars(...).all()；测试里没有项目成员 → 空集即可（通知已被 mock）
        return []


class _FakeSession:
    """只够 save_survey / request_commission 用：忽略 select，回一个预设行。"""

    def __init__(self, existing=None):
        self.existing = existing
        self.added: list = []
        self.flushed = 0

    def scalars(self, _stmt):
        return _FakeResult(self.existing)

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        self.flushed += 1


def test_save_survey_is_idempotent_upsert():
    """F9 修前：每 POST 一次就 insert 一条（实测 4 条）。现在：一个项目只一条，重提=原地更新。"""
    from app.services import site as svc

    s1 = _FakeSession(None)
    row, reused = svc.save_survey(s1, project_no="P1", actor_id=1, body={"enter_date": None})
    assert reused is False and len(s1.added) == 1, "首次应新建一条"

    s2 = _FakeSession(row)
    row2, reused2 = svc.save_survey(s2, project_no="P1", actor_id=2, body={"enter_date": None, "contact": "李现场"})
    assert reused2 is True and row2 is row and not s2.added, "再次应复用同一行、不新增"
    assert row.contact == "李现场", "重勘测要覆盖到同一张事实卡上"


def test_request_commission_reuses_open_request():
    """F9 修前：重复点「申请调试」堆 5 条 + 重复通知。现在：有未完成的就复用、不重复通知。"""
    from unittest.mock import patch

    from app.models.site import COMMISSION_WAIT
    from app.services import site as svc

    with patch.object(svc.notify, "notify_role"), patch.object(svc.notify, "notify"):
        s1 = _FakeSession(None)
        row, reused = svc.request_commission(
            s1, project_no="P1", actor_id=1, dispatch_to="王工", plan_date=None, remark=None
        )
        assert reused is False and len(s1.added) == 1 and row.status == COMMISSION_WAIT

        s2 = _FakeSession(row)
        row2, reused2 = svc.request_commission(
            s2, project_no="P1", actor_id=2, dispatch_to="李工", plan_date=None, remark=None
        )
        assert reused2 is True and row2 is row and not s2.added, "有未完成的 → 复用，不再建第二条"
        assert row.dispatch_to == "李工", "复用时可更新派谁去（不静默丢弃改派）"


def test_site_routes_expose_reused_flag():
    """后端要把 reused 回传给前端，UI 才能如实说“已更新”而不是“又建了一条”（F9）。"""
    src = _src(ROOT / "backend" / "app" / "api" / "routes" / "site.py")
    assert src.count('"reused": reused') == 2, "survey / commission 两个接口都要暴露 reused"


def test_site_error_is_globally_handled():
    """域错误类必须注册进 main.py 的 400 处理器（别再靠 route 手工 try）。"""
    src = _src(ROOT / "backend" / "app" / "main.py")
    assert "from app.services.site import SiteError" in src
    assert "@app.exception_handler(SiteError)" in src
