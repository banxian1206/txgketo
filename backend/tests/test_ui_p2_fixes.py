# -*- coding: utf-8 -*-
"""UI 真实场景测试（2026-09-30）P2 批次护栏：可发现性 / 一致性 / 少误导。

这些都不是“功能没做”，而是“做了但人看不见 / 看错”—— 只有静态钉子最省钱。
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BE = ROOT / "backend" / "app"
FE = ROOT / "frontend" / "src"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _flatten(p: Path) -> str:
    import re

    return re.sub(r"\s+", " ", _read(p))


# ── P2-2 角色下拉要能按中文名搜 ──────────────────────────────────────────
def test_role_selects_search_by_label():
    s = _read(FE / "features" / "admin" / "Page.tsx")
    assert s.count('optionFilterProp="label"') >= 2, "编辑用户 + 列表筛选两处角色下拉都要按 label 搜"


# ── P2-3 新建物料弹窗不许出现 undefined ─────────────────────────────────
def test_library_categories_include_category_code():
    s = _read(BE / "api" / "routes" / "library.py")
    j = s.index('@router.get("/categories")')
    body = s[j : s.index("@router.get", j + 10)]
    assert '"category_code": k.category_code' in body, "标准库品类要带父类别码（否则弹窗显示 undefined-LC-0001）"
    # 弹窗里拼编码时用的是 activeClass.category_code —— 后端给了才不会渲染成 undefined
    lib = _read(FE / "features" / "admin" / "LibraryPage.tsx")
    assert "${activeClass?.category_code}-${activeClass?.code}" in lib


# ── P2-4 评审明细要写人话（别只甩数据库 id） ────────────────────────────
def test_review_items_are_enriched_with_material_detail():
    s = _read(BE / "api" / "routes" / "reviews.py")
    assert "item_detail" in s and "挂在 " in s, "BOM 行要富化出“什么料 × 多少 · 挂在哪个件下”"
    fe = _read(FE / "components" / "ReviewDetailModal.tsx")
    assert "i.item_detail ?? i.item_ref" in fe


# ── P2-6 没权限就别发那个请求（403 噪音） ───────────────────────────────
def test_project_detail_gates_kitting_by_permission():
    s = _flatten(FE / "features" / "project" / "DetailPage.tsx")
    assert "if (hasPerm('mfg:view')) {" in s and "kittingOverview(projectNo)" in s


# ── P2-7 站内消息跳转要带来源（两处入口） ───────────────────────────────
def test_notification_links_carry_from():
    drawer = _read(FE / "components" / "NotificationsDrawer.tsx")
    assert "useGoFrom" in drawer and "go(n.link)" in drawer, "消息跳转要带来源（PC）"
    # 移动端：有移动页就映射，没有就不跳（R4-01，见 docs/11 §8）
    assert "MOBILE_LINK" in drawer and "n.link.startsWith('/m')" in drawer and "电脑端处理" in drawer
    # ★ 2026-10-05：「我的工作台」聚合页**已取消**（客户拍板：与部门台内容重叠、且不按岗位分层），
    #   它的消息区随之删除。所以现在只有顶栏铃铛一个 PC 消息入口 —— 断言它带来源即可；
    #   同时钉住「聚合页不许再长回来」（否则这条会变成永远的真）。
    assert "go(n.link)" in drawer, "PC 消息跳转要带来源（顶栏铃铛是唯一的 PC 消息入口）"
    wb = _read(FE / "features" / "workbench" / "Page.tsx")
    assert "HomeRedirect" in wb and "NotificationsDrawer" not in wb, (
        "我的工作台应退化为三个落地页的宿主（消息区已删，改用顶栏铃铛）"
    )


# ── P2-8 没拍照就不能勾「已发」 ─────────────────────────────────────────
def test_ship_item_checkbox_disabled_without_photo():
    s = _flatten(FE / "features" / "shipping" / "Page.tsx")
    assert "disabled={!it.shipped && !shipPhotos.length}" in s
    assert "先拍这个件的发货照片" in s


# ── P2-9 长周期件：空库要给出路 ─────────────────────────────────────────
def test_std_item_picker_guides_when_library_empty():
    s = _read(FE / "components" / "InitiationEditors.tsx")
    assert "基础数据 → 标准库" in s, "搜不到时要告诉人去哪建码"


# ── P2-10 报修/备件不许手打项目号、物料号 ───────────────────────────────
def test_service_forms_use_pickers():
    mob = _read(FE / "features" / "service" / "MobilePage.tsx")
    assert 'name="project_no" label="项目"' in mob and "<Select" in mob, "手机端报修项目要下拉"
    pc = _read(FE / "features" / "service" / "Page.tsx")
    assert "<ItemSelect />" in pc, "备件建账的物料要能搜"


# ── F4（2026-10-04 走查报告核实）：设备台数不许拿齐套条数顶替 ──────────────
def test_project_detail_returns_permission_free_equipment_count():
    """详情要单独给设备台数：齐套数据按 mfg:view 收口，拿它当台数会让销售看到「设备 0」。

    走查报告 F4 的现象（详情头卡「设备 0」而实际 2 台）在**无 mfg:view 的角色**上成立，
    根因是 `nums.equipments = kitting.length` + 齐套请求按权限被跳过（P2-6 之后更明显）。
    """
    be = _read(ROOT / "backend" / "app" / "api" / "routes" / "project.py")
    assert '"equipment_count": int(equip_count or 0)' in be, "详情接口要返回与权限无关的设备台数"
    fe = _read(ROOT / "frontend" / "src" / "features" / "project" / "DetailPage.tsx")
    assert "equipments: detail?.equipment_count ?? 0" in fe, "头卡要用设备台数"
    assert "equipments: kitting.length" not in fe, "不许再拿齐套条数顶替（销售/商务会看到 0）"


# ── N24-UI（走查 2026-10-04 P2）：部分领料必须还能「继续备料」──────────────
def test_partial_issue_can_continue_picking():
    """领料单备不满 → 状态「部分领料」；补货后必须能从界面**再备差额**。

    后端 `POST /warehouse/issues/{id}/pick` 本来就允许「待备料 / 部分领料」两态
    （见 routes/warehouse.py「补货后可再 pick 补差额」，probe_n24_n25 已覆盖）。
    但走查实测：PC `warehouse/Page.tsx` 与手机 `warehouse/IssuesPage.tsx` 都只在
    「待备料」渲染「备料」按钮 —— 部分领料只剩「车间领走」→ 单据永久卡死、车间拿不到料，
    与 AGENTS §8.1 N24「补货后可在部分领料状态再备」的承诺矛盾。
    """
    import re

    for rel in ("features/warehouse/Page.tsx", "features/warehouse/IssuesPage.tsx"):
        # 先去掉注释再判：注释里也会写「部分领料」，否则护栏会被自己的注释蒙混过关（已实测漏报）
        raw = _read(FE / rel)
        raw = re.sub(r"/\*.*?\*/", " ", raw, flags=re.S)
        raw = re.sub(r"//[^\n]*", " ", raw)
        s = re.sub(r"\s+", " ", raw)
        # 每一处「部分领料」条件里，附近必须出现 pick 动作（而不是只有 hand-over）
        ok = any(re.search(r"'pick'", s[i : i + 240]) for i in [m.start() for m in re.finditer("部分领料", s)])
        assert ok, (
            f"{rel}：「部分领料」没有配「继续备料」(pick) 入口 —— 补货后无法再备，单据会永久卡在部分领料"
        )


# ── P3（走查 2026-10-04）：设计面「挂在哪个下面」不许把总装图列两遍 ──────────
def test_design_parent_options_dont_duplicate_root():
    """`parentOptions` 先手动列了总装图，又把 `rows`（design tree，**含总装图**）整体 map 一遍
    → 两个同 value 选项 → React「Encountered two children with the same key」（实测 key =
    总装图号，构建结构时告警刷屏）。修法：rows 分支排除 `root.drawing_no`。
    """
    s = _flatten(FE / "features" / "design" / "Page.tsx")
    seg = s[s.index("const parentOptions"):]
    seg = seg[: seg.index("const submitPurchase")]
    assert "r.drawing_no === root.drawing_no" in seg or "r.drawing_no === root?.drawing_no" in seg, (
        "parentOptions 必须把总装图从 rows 分支里排掉，否则总装图被列两遍 → duplicate key 告警"
    )


# ── P3（走查 2026-10-04）：验收「本次到货数量」不许用 0.001 兜底 ─────────────
def test_mobile_accept_no_tiny_qty_floor():
    """剩余为 0 时，修前 `setQty(Math.max(0.001, qty - received))` 预填 0.001 并放行，
    提交得到费解的「本批到货 0.001 超过未到数量 0」。现在：剩余为 0 → 留 null + 明说
    「已全部到货」+ 提交按钮置灰。
    """
    s = _flatten(FE / "features" / "acceptance" / "MobilePage.tsx")
    assert "Math.max(0.001" not in s, "剩余为 0 时不许用 0.001 兜底预填"
    assert "已经全部到货" in s, "全部到货要有明确文案"
    assert "fullyReceived" in s, "提交按钮要能按「已全部到货」置灰"
