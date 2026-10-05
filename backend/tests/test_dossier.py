"""对象档案 / 全局检索（docs/13 §5 的 1/4/5/6 号接口）—— 护栏。

立这组测试的三个理由：
① **口径不能漂**：设备档案里的齐套率必须直接来自 `services.kitting.compute()`
   （写这接口时我就犯过错：`compute()` 返回 dict，我按对象取属性 → 页面显示恒为 0%，
   **一个假的 0% 比不显示更坏**）。所以这里对着真数据断言 rate 与 compute 一致。
② **金额按权限裁剪**：件档案里带单价/金额，无 `purchase:price` 的账号必须拿到 None
   （不是 403 —— 还能看档案，只是看不到钱）。
③ **只读**：这三个接口一个写操作都没有（AI 助手/档案页都不许改数据）。
"""

from __future__ import annotations

import inspect

import pytest

from app.api.routes import dossier
from app.services import kitting as kitting_svc


# ── 静态：只读 + 金额按权限 ──────────────────────────────────────────────


def test_dossier_endpoints_are_read_only():
    """档案/检索接口必须全是 GET（不留写口子）。"""
    src = inspect.getsource(dossier)
    for bad in ("@router.post", "@router.put", "@router.patch", "@router.delete"):
        assert bad not in src, f"档案接口里出现了写操作：{bad}"


def test_money_is_scrubbed_without_permission():
    """`_maybe_scrub`：有金额权限 → 原样；没有 → 金额字段变 None（不是 403）。"""
    payload = {"unit_price": 12.5, "nested": [{"amount": 99, "qty": 3}]}

    class U:
        def __init__(self, codes):
            self.is_superuser = False
            self._codes = set(codes)

    # 直接打桩 has_permission（同一个模块里引用的那个名字）
    orig = dossier.has_permission
    try:
        dossier.has_permission = lambda u, code: code in u._codes
        got = dossier._maybe_scrub(payload, U({"purchase:price"}))
        assert got["unit_price"] == 12.5 and got["nested"][0]["amount"] == 99

        got2 = dossier._maybe_scrub(payload, U(set()))
        assert got2["unit_price"] is None
        assert got2["nested"][0]["amount"] is None
        # 数量这类非金额字段**不许**被一起抹掉（否则页面会缺信息）
        assert got2["nested"][0]["qty"] == 3
    finally:
        dossier.has_permission = orig


# ── 真数据：口径一致 ────────────────────────────────────────────────────


@pytest.fixture()
def session():
    from app.core.db import SessionLocal

    s = SessionLocal()
    yield s
    s.close()


def _buyer(session):
    from sqlalchemy import select

    from app.models.platform import User

    u = session.scalar(select(User).where(User.username == "buyer1"))
    if u is None:
        pytest.skip("没有 buyer1（先跑 scripts.seed）")
    return u


def test_equipment_dossier_kitting_matches_service(session):
    """★ 设备档案的齐套率必须与 `services.kitting.compute()` **逐字一致**（防口径漂移）。"""
    from app.models.project import Equipment

    eq = session.query(Equipment).first()
    if eq is None:
        pytest.skip("库里没有设备（先跑 scripts.e2e_baseline）")

    u = _buyer(session)
    got = dossier.equipment_dossier(eq.project_no, eq.equip_no, session=session, current=u)
    truth = kitting_svc.compute(session, eq.project_no, eq.equip_no)

    assert got["kitting"] is not None, "齐套算不出来时不该静默返回 None（那是假数据）"
    assert got["kitting"]["rate"] == float(truth["kitting_rate"] or 0)
    assert got["kitting"]["total"] == int(truth["total"] or 0)
    assert got["kitting"]["arrived"] == int(truth["arrived"] or 0)
    # 反过来：只要 total>0，rate 就不该是"恒 0"的假值（写接口时踩过）
    if truth["total"]:
        assert got["kitting"]["rate"] > 0 or truth["arrived"] == 0


def test_equipment_dossier_unknown_equip_404(session):
    from fastapi import HTTPException

    u = _buyer(session)
    with pytest.raises(HTTPException) as ei:
        dossier.equipment_dossier("TX99999", "99Z", session=session, current=u)
    assert ei.value.status_code == 404


def test_item_dossier_unknown_404(session):
    from fastapi import HTTPException

    u = _buyer(session)
    with pytest.raises(HTTPException) as ei:
        dossier.item_dossier("NOT-A-REAL-ITEM", session=session, current=u)
    assert ei.value.status_code == 404


def test_item_dossier_api_and_material_are_the_same_page(session):
    """铁律 2（图号 = 物料号）：图号和物料号都走同一个档案端点，不许要求两个参数。"""
    sig = inspect.signature(dossier.item_dossier)
    assert list(sig.parameters) == ["item_no", "session", "current"]


def test_search_finds_project_by_no_and_name(session):
    """检索：粘编号、粘名称都要能命中（编号即入口）。"""
    from app.models.project import Project

    p = session.query(Project).first()
    if p is None:
        pytest.skip("库里没有项目（先跑 scripts.e2e_baseline）")
    u = _buyer(session)

    r = dossier.global_search(q=p.project_no, limit=12, session=session, current=u)
    assert r["count"] >= 1
    assert any(i["code"] == p.project_no for i in r["items"])

    r2 = dossier.global_search(q=p.project_name[:4], limit=12, session=session, current=u)
    assert r2["count"] >= 1
    # 命中项必须带落点路由（否则"检索"只是摆设）
    assert all(i["route"] for i in r2["items"])


def test_search_unknown_code_gives_route_hint_not_fake_hit(session):
    """查不到的编号：给「去哪个台找」的提示，**不假装有**（route 指向列表页、不带具体单号）。"""
    u = _buyer(session)
    r = dossier.global_search(q="PO99999", limit=12, session=session, current=u)
    if r["count"]:
        assert "没有找到" in r["items"][0]["title"]
        assert r["items"][0]["code"] == "PO99999"


def test_timeline_is_audit_backed_and_ordered(session):
    """活动流取 audit_log 且按时间倒序（铁律 5：写操作都留痕）。"""
    from app.models.project import Project

    p = session.query(Project).first()
    if p is None:
        pytest.skip("库里没有项目")
    u = _buyer(session)
    t = dossier.timeline(ref=p.project_no, limit=50, session=session, current=u)
    assert t["ref"] == p.project_no
    times = [x["at"] for x in t["items"] if x["at"]]
    assert times == sorted(times, reverse=True)
    assert all(x["action"] for x in t["items"])
