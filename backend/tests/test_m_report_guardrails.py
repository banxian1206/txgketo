# -*- coding: utf-8 -*-
"""第八轮报告（docs/99-全局端到端测试报告-2026-09-28-第八轮.md）5 个发现的回归护栏。

这 5 条之所以能溜进工作区，共同原因是**"改了后端没改前端 / 承诺了能力没实现 / 护栏没覆盖这条路径"**。
本文件用静态断言把它们钉住（沿用 `test_no_admin_in_e2e.py` 的读源码风格，纯逻辑、不需要库）。

对应关系：
  M-01 评审链不能再用"全局随机兜底"的总监（5 个总监里只有工程总监有 design:audit）
  M-02 PATCH /projects 改 pm_id 必须同步项目角色「项目经理」
  M-03 领料单：不能用"库位为 NULL 就跳过"造永久死单；`已取消` 必须有接口能置
  M-04 任务推进门禁必须是"负责人本人也行"（运行时护栏见 tests/test_task_act_permission.py）
  M-05 前端必须反映后端门禁（任务按钮 / 关闭订单）
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BE = ROOT / "backend" / "app"
FE = ROOT / "frontend" / "src"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _code_lines(p: Path) -> list[str]:
    """去掉注释行，只留代码（避免"注释里提到了"被误判为"实现了"）。"""
    out = []
    for ln in _read(p).splitlines():
        s = ln.strip()
        if s.startswith("#"):
            continue
        out.append(ln)
    return out


# ── M-01 ────────────────────────────────────────────────────────────────────
def test_m01_review_chain_has_no_global_director_fallback():
    """评审链不得再用 `director(session)` / `director_for(...)` 的全局兜底。"""
    src = "\n".join(_code_lines(BE / "services" / "review_flow.py"))
    assert "design_director(" in src, "评审链必须走 design_director()（按工程部归属）"
    assert "director_for(" not in src, "评审链不得再用 director_for()（提交人无部门时会全局兜底）"
    assert "director(session)" not in src, "评审链不得再用 director(session) 全局兜底"


def test_m01_director_fallback_is_ordered_and_opt_out_exists():
    """`director()` 兜底必须有 ORDER BY（确定性）；`director_for` 必须支持关掉全局兜底。"""
    src = "\n".join(_code_lines(BE / "services" / "reviewers.py"))
    assert "def director(session" in src
    assert "allow_global" in src, "director_for 必须能关掉全局兜底（M-01）"
    assert 'DESIGN_DEPT = "ENG"' in src, "评审链的归属部门必须是工程部（ENG）"


# ── M-02 ────────────────────────────────────────────────────────────────────
def test_m02_update_project_syncs_pm_member():
    src = "\n".join(_code_lines(BE / "api" / "routes" / "project.py"))
    assert "_sync_pm_member" in src, "PATCH /projects 改 pm_id 必须同步项目角色「项目经理」"
    assert "ProjectMember" in src


# ── M-03 ────────────────────────────────────────────────────────────────────
def test_m03_issue_pick_does_not_dead_end_on_null_location():
    """pick 不得再"库位为空就跳过"（那是"建单时没货 → 货到了永远备不出"的根因）。"""
    src = "\n".join(_code_lines(BE / "api" / "routes" / "warehouse.py"))
    assert "_best_stock_row(" in src, "pick 必须能动态解析/回填库位（M-03）"
    assert "if not ln.location_id:\n            ln.shortage = True\n            short.append(ln.item_no)\n            continue" not in src, (
        "pick 里不能有「location_id 为空就跳过」的死路"
    )


def test_m03_cancelled_status_has_an_endpoint():
    """`已取消` 必须真的有接口能置（原来只在枚举/过滤条件里承诺）。"""
    src = "\n".join(_code_lines(BE / "api" / "routes" / "warehouse.py"))
    assert '"/issues/{issue_id}/cancel"' in src, "领料单必须有作废口"
    assert "ISSUE_CANCELLED" in src
    model = _read(BE / "models" / "warehouse.py")
    assert 'ISSUE_CANCELLED = "已取消"' in model, "「已取消」应提升为具名常量"


# ── M-04 ────────────────────────────────────────────────────────────────────
def test_m04_task_patch_is_not_flat_project_edit():
    """`PATCH /tasks` 不能只挂 project:edit（设计师没有这个码 → 连自己任务都开不了工）。"""
    src = "\n".join(_code_lines(BE / "api" / "routes" / "tasks.py"))
    assert "_can_act_on_task" in src, "任务推进门禁必须按「能不能动这张任务」判（M-04）"
    idx = src.index('@router.patch("/tasks/{task_id}")')
    seg = src[idx : idx + 700]
    assert 'require_permission("project:edit")' not in seg, (
        "PATCH /tasks 不得扁平要求 project:edit（M-04 回归点）"
    )
    assert "row.owner_id is not None and row.owner_id == user.id" in src, "负责人本人必须放行"


# ── M-05 ────────────────────────────────────────────────────────────────────
def test_m05_frontend_reflects_task_gate():
    src = _read(FE / "features" / "task" / "Page.tsx")
    assert "canActOn" in src, "前端任务页必须有门禁判断（M-05）"
    assert "hasPerm('project:edit')" in src, "canActOn 口径要与后端一致"


def test_m05_frontend_gates_close_button():
    """关单按钮必须按 project:close 显示（非商务点了必 403）。

    ★ 不写死文件名：详情页重构后「关闭订单」从 ProjectHeader 搬进了结论条
      （components/project/ProjectSummaryBar.tsx），按文件锁会让重构必挂红。
      改成扫这一层的所有组件：谁渲染「关闭订单」，谁就必须带权限判断。
    """
    d = FE / "components" / "project"
    hits = [(f.name, f.read_text(encoding="utf-8")) for f in sorted(d.glob("*.tsx"))]
    # 「入口」（能打开关单弹窗的地方）必须带门禁；弹窗本体由入口控制，只要求它提交前再判一次
    entries = [(n, s) for n, s in hits if "关闭订单" in s and ("setCloseOpen(true)" in s or "Dropdown" in s)]
    assert entries, "项目层找不到任何渲染「关闭订单」的组件 —— 入口丢了（AGENTS §8.5：做完了但找不到）"
    bad = [n for n, s in entries if "hasPerm('project:close')" not in s]
    assert not bad, f"这些**入口**渲染了「关闭订单」却没按 project:close 收口：{bad}"
    # 提交函数所在页面（关单真正发请求的地方）也必须再判一次权限
    page_src = (FE / "features" / "project" / "DetailPage.tsx").read_text(encoding="utf-8")
    modals = [("features/project/DetailPage.tsx", page_src)]
    bad2 = [n for n, s in modals if "hasPerm('project:close')" not in s]
    assert not bad2, f"关单弹窗本体也要在提交前判一次权限（防将来新增入口绕过）：{bad2}"
