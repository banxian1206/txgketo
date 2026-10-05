"""经营驾驶舱（00 卷 §2.1 对总经理的承诺）—— 护栏。

三条意图：
① **金额按权限**（不是 403）：GM/FIN 看得到，其他角色金额字段为 None；
② **成本毛利不许假装有**（三期未建表 → `available: False` + 原因），否则等于编数据；
③ **口径复用**：齐套率必须来自 `services.kitting.compute()`，不许在驾驶舱另算一套
   （本项目栽过"同一个数五个通道五种答案"，见 AGENTS §8.5-4）。
"""

from __future__ import annotations

import inspect

import pytest
from sqlalchemy import select

from app.api.routes import dashboard
from app.models.platform import User
from app.models.project import Project
from app.services import kitting as kitting_svc


@pytest.fixture()
def session():
    from app.core.db import SessionLocal

    s = SessionLocal()
    yield s
    s.close()


def _user(session, username):
    u = session.scalar(select(User).where(User.username == username))
    if u is None:
        pytest.skip(f"没有 {username}（先跑 scripts.seed）")
    return u


def test_dashboard_is_read_only():
    src = inspect.getsource(dashboard)
    for bad in ("@router.post", "@router.put", "@router.patch", "@router.delete"):
        assert bad not in src, f"驾驶舱里出现了写操作：{bad}"


def test_cost_block_is_honest_not_faked(session):
    """成本毛利在三期（未建表）→ 必须如实说明，不许返回 0 冒充。"""
    d = dashboard.gm_dashboard(session=session, current=_user(session, "gm"))
    assert d["cost"]["available"] is False
    assert d["cost"]["reason"], "不可用时必须给原因（否则用户以为成本是 0）"


def test_amounts_visible_for_gm_and_fin_only(session):
    """金额分档：GM/FIN 有 project:amount → 看得到；普通角色 → None（不是 403）。"""
    d_gm = dashboard.gm_dashboard(session=session, current=_user(session, "gm"))
    d_fin = dashboard.gm_dashboard(session=session, current=_user(session, "fin1"))
    d_other = dashboard.gm_dashboard(session=session, current=_user(session, "wh1"))
    assert d_gm["orders"]["total_amount"] is not None
    assert d_fin["orders"]["total_amount"] is not None
    assert d_other["orders"]["total_amount"] is None
    # 结构不许因为裁剪而缺块（页面还要渲染）
    assert len(d_other["orders"]["by_stage"]) == len(d_gm["orders"]["by_stage"])


def test_kitting_rate_reuses_service_口径(session):
    """★ 驾驶舱里的齐套率必须与 `services.kitting.compute()` 一致（防又开一套口径）。"""
    from app.models.project import Equipment

    eq = session.query(Equipment).first()
    if eq is None:
        pytest.skip("库里没有设备（先跑 scripts.e2e_baseline）")
    d = dashboard.gm_dashboard(session=session, current=_user(session, "gm"))
    truth = float(kitting_svc.compute(session, eq.project_no, eq.equip_no).get("kitting_rate") or 0)
    hit = [
        r
        for r in d["risks"]
        for it in r["items"]
        if r["project_no"] == eq.project_no and "齐套" in it
    ]
    if truth < 0.7:
        assert hit, f"齐套 {truth:.0%} <70% 却没进风险列表（口径不一致）"
    else:
        assert not hit, "齐套 ≥70% 却出现在风险里"


def test_active_stages_exclude_closed_and_archived(session):
    """已关闭/已归档不算"在手订单"（否则总经理看到的在手数是虚的）。"""
    d = dashboard.gm_dashboard(session=session, current=_user(session, "gm"))
    stages = {x["stage"] for x in d["orders"]["by_stage"]}
    assert "已关闭" not in stages and "已归档" not in stages
    # 与库里的实际数量对账（有效的阶段）
    expect = session.query(Project).filter(Project.stage.in_(stages)).count()
    assert d["orders"]["total_count"] == expect
