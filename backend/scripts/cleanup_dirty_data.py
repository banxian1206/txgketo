#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""**定点清理三类脏数据**（2026-09-30《UI 真实场景测试报告》的遗留）。

与 `scripts/reset_business_data.py`（整库复位、会连主数据一起清）**目的不同**：
这里**只动三类脏数据**，项目/单据/账号都留着，可重复跑（幂等）。

## 三类脏数据（都是本轮 UI 走查实测出来的）

1. **付款计划异常** —— 比例合计 ≠ 100%、或同一项目出现同名节点
   （实测 TX26001 曾出现 8 条节点、合计 170%、两组「发货款」）。
   ★ **不直接改钱**：台账只能走**付款计划变更单**（客户 2026-09-30 拍板，要商务总监审批）。
   `--fix-payment` 只会**生成一张变更单草案**（待审，不落台账），批准与否由总监在界面上决定。

2. **重复领料单** —— 同项目同设备、行集合完全相同、且都还没结
   （实测连点两次「生成领料单」造出 MI26001 + MI26002；P1-7 已修根因）。
   保留最早一张，其余置「已取消」（**不删**，留痕）。

3. **假库位** —— 形如 `warehouse='深圳仓'`（界面示例文案）或 `code='待定'` / `name='未指派库位'`
   （实测手机端不填库位就凭空造出来的）。有库存/占用的先把库存迁到一张**真实库位**再停用；
   迁不动的（找不到目标库位）**只报告不动手**。

## 跑法

```bash
.venv/bin/python -m scripts.cleanup_dirty_data                 # 预演（默认，不改任何东西）
.venv/bin/python -m scripts.cleanup_dirty_data --yes           # 真清理（写 audit_log）
.venv/bin/python -m scripts.cleanup_dirty_data --yes --fix-payment   # 连付款计划也生成变更单草案
.venv/bin/python -m scripts.cleanup_dirty_data --yes --to-location "常规件区 A-01-01"
```

★ 本项目风格：**默认预演、显式 `--yes` 才写**（第十轮报告 R-2 的教训）。
"""

from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.models.platform import User  # noqa: E402
from app.models.project import PaymentTerm, Project  # noqa: E402
from app.models.warehouse import (  # noqa: E402
    ISSUE_CANCELLED,
    MaterialIssue,
    MaterialIssueLine,
    StockItem,
    StockMove,
    WarehouseLocation,
)
from app.services import audit  # noqa: E402

FAKE_WAREHOUSES = {"深圳仓"}
FAKE_CODES = {"待定"}
FAKE_NAMES = {"未指派库位"}


def _payment_anomalies(s: Session) -> list[dict]:
    """付款计划异常：比例合计≠100% 或同项目同名节点。"""
    out: list[dict] = []
    projects = {p.project_no: p for p in s.scalars(select(Project)).all()}
    for pno, p in projects.items():
        terms = list(
            s.scalars(
                select(PaymentTerm).where(PaymentTerm.project_no == pno).order_by(PaymentTerm.seq)
            ).all()
        )
        if not terms:
            continue
        pcts = [float(t.percent) for t in terms if t.percent is not None]
        pct_sum = round(sum(pcts), 2)
        names: dict[str, int] = {}
        for t in terms:
            names[t.node_name] = names.get(t.node_name, 0) + 1
        dup = [n for n, c in names.items() if c > 1]
        problems = []
        if pcts and abs(pct_sum - 100) > 0.5:
            problems.append(f"比例合计 {pct_sum}%")
        if dup:
            problems.append(f"同名节点 {'、'.join(dup)}")
        if problems:
            out.append(
                {
                    "project_no": pno,
                    "count": len(terms),
                    "problems": problems,
                    "contract": float(p.amount or 0),
                    "terms": terms,
                }
            )
    return out


def _duplicate_issue_sheets(s: Session) -> list[tuple[MaterialIssue, MaterialIssue]]:
    """重复领料单：(保留的, 要作废的)。同项目+同设备、行物料集合+数量完全相同、还没结。"""
    rows = list(
        s.scalars(
            select(MaterialIssue)
            .where(MaterialIssue.status.not_in((ISSUE_CANCELLED, "已领走")))
            .order_by(MaterialIssue.id)
        ).all()
    )
    lines: dict[int, tuple] = {}
    for ln in s.scalars(select(MaterialIssueLine)).all():
        lines.setdefault(ln.issue_id, ())
        lines[ln.issue_id] = lines[ln.issue_id] + ((ln.item_no, float(ln.qty_required or 0)),)
    keep: dict[tuple, MaterialIssue] = {}
    out: list[tuple[MaterialIssue, MaterialIssue]] = []
    for r in rows:
        key = (r.project_no, r.equip_no, tuple(sorted(lines.get(r.id, ()))))
        if key in keep:
            out.append((keep[key], r))
        else:
            keep[key] = r
    return out


def _fake_locations(s: Session) -> list[WarehouseLocation]:
    """假库位（**只看还启用的** —— 已停用的就是上次清理过的，别再报一遍）。"""
    return [
        loc
        for loc in s.scalars(select(WarehouseLocation)).all()
        if loc.is_active
        and (loc.warehouse in FAKE_WAREHOUSES or loc.code in FAKE_CODES or (loc.name or "") in FAKE_NAMES)
    ]


def _pick_real_location(s: Session, spec: str | None) -> WarehouseLocation | None:
    locs = [x for x in s.scalars(select(WarehouseLocation)).all() if x not in _fake_locations(s)]
    if spec:
        wh, _, code = spec.partition(" ")
        for x in locs:
            if x.warehouse == wh.strip() and x.code == (code.strip() or wh.strip()):
                return x
        return None
    return locs[0] if locs else None


def main() -> int:
    ap = argparse.ArgumentParser(description="定点清理三类脏数据（默认预演）")
    ap.add_argument("--yes", action="store_true", help="真的写库（默认只预演）")
    ap.add_argument("--fix-payment", action="store_true", help="为付款计划异常生成变更单草案（待审）")
    ap.add_argument("--to-location", default=None, help='假库位的库存迁到哪（如 "常规件区 A-01-01"）')
    args = ap.parse_args()

    with SessionLocal() as s:
        admin = s.scalars(select(User).where(User.is_superuser.is_(True)).order_by(User.id)).first()
        print("== 1) 付款计划异常（只能走变更单改，脚本不会直接改钱）==")
        anomalies = _payment_anomalies(s)
        if not anomalies:
            print("   ✅ 没有比例不合/同名节点的付款计划")
        for a in anomalies:
            print(
                f"   ⚠ {a['project_no']}：{a['count']} 条节点 · {'；'.join(a['problems'])} · "
                f"合同 ¥{a['contract']:,.0f}"
            )
            if args.fix_payment and args.yes:
                paid = [t for t in a["terms"] if float(t.received_amount or 0) > 0]
                unpaid = [t for t in a["terms"] if float(t.received_amount or 0) <= 0]
                # 规则：已收节点不动；未收节点按标准模板重排（30/40/20/10 去掉已收那块）
                tmpl = [("发货款", 40, "发货"), ("验收款", 20, "验收"), ("质保金", 10, "质保")]
                paid_pct = sum(float(t.percent or 0) for t in paid)
                rest = max(0.0, 100 - paid_pct)
                terms, used = [], 0.0
                for name, pct, trig in tmpl:
                    p = min(pct, max(0.0, rest - used))
                    if p <= 0:
                        continue
                    terms.append(
                        {"node_name": name, "percent": p, "trigger_node": trig,
                         "amount": a["contract"] * p / 100 if a["contract"] else None}
                    )
                    used += p
                if not terms:
                    print("      （未收比例已满 100%，无需生成变更单）")
                else:
                    from app.services import payment_change as pc_svc

                    c = pc_svc.submit(
                        s,
                        project_no=a["project_no"],
                        reason=f"历史付款节点异常自动纠正草案（{'；'.join(a['problems'])}）",
                        terms=terms,
                        actor=admin,
                    )
                    print(f"      → 已生成变更单草案 {c.change_no}（待商务总监审；由总监在界面上批准）")
        print("\n== 2) 重复领料单（保留最早一张，其余置「已取消」）==")
        dups = _duplicate_issue_sheets(s)
        if not dups:
            print("   ✅ 没有内容重复的未结领料单")
        for keep, dup in dups:
            print(f"   ⚠ {dup.issue_no} 与 {keep.issue_no} 内容相同（{dup.project_no}/{dup.equip_no}）→ 作废 {dup.issue_no}")
            if args.yes:
                dup.status = ISSUE_CANCELLED
                dup.remark = (f"{dup.remark or ''} 清理：与 {keep.issue_no} 重复（脚本 cleanup_dirty_data）")[:255]
                audit.log(
                    s, user=admin, action="cleanup", object_type="material_issue", object_ref=dup.issue_no,
                    summary=f"清理重复领料单：{dup.issue_no} 作废（与 {keep.issue_no} 内容相同）",
                )
                s.flush()

        print("\n== 3) 假库位（示例地名 / 未指派）==")
        fakes = _fake_locations(s)
        if not fakes:
            print("   ✅ 没有假库位")
        for loc in fakes:
            stocks = list(s.scalars(select(StockItem).where(StockItem.location_id == loc.id)).all())
            busy = [x for x in stocks if float(x.qty_on_hand or 0) > 0 or float(x.qty_locked or 0) > 0]
            target = _pick_real_location(s, args.to_location)
            print(
                f"   ⚠ #{loc.id} {loc.warehouse}/{loc.code}（{loc.name or '—'}）"
                f"库存行 {len(stocks)}（有量的 {len(busy)}）"
            )
            if not args.yes:
                continue
            if busy and target is None:
                print("      ⏭ 有库存但找不到可迁入的真实库位 —— 只报告，不动手（用 --to-location 指定）")
                continue
            # 0 在库/0 占用的行直接删掉：它们不承载任何账，留着只会让「深圳仓 待定」继续出现在库存页
            empty = [x for x in stocks if not (float(x.qty_on_hand or 0) > 0 or float(x.qty_locked or 0) > 0)]
            for x in empty:
                s.delete(x)
            if empty:
                print(f"      → 删除 {len(empty)} 条 0 在库/0 占用的库存行（历史在 stock_move 里）")
            for x in busy:
                moved = StockItem(
                    item_no=x.item_no, location_id=target.id,
                    qty_on_hand=x.qty_on_hand, qty_locked=x.qty_locked, batch_no=x.batch_no,
                )
                s.add(moved)
                s.add(
                    StockMove(
                        item_no=x.item_no, move_type="移库", qty=x.qty_on_hand,
                        from_location_id=loc.id, to_location_id=target.id,
                        ref_type="manual", ref_no="cleanup", operator_id=admin.id if admin else None,
                        moved_at=datetime.now(UTC),
                    )
                )
                x.qty_on_hand, x.qty_locked = 0, 0
                print(f"      → {x.item_no} 迁到 {target.warehouse} {target.code}")
            loc.is_active = False
            audit.log(
                s, user=admin, action="cleanup", object_type="warehouse_location",
                object_ref=f"{loc.warehouse}/{loc.code}",
                summary=f"清理假库位：{loc.warehouse}/{loc.code} 停用（库存已迁出）",
            )
            s.flush()

        if args.yes:
            s.commit()
            print("\n✅ 已清理（改动都写进了 audit_log）")
        else:
            s.rollback()
            print("\n（预演结束，什么都没改。确认无误后加 --yes 再跑）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
