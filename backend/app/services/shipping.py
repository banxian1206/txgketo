"""发运域服务（《00 方案》§3.1⑤ · 《02 数据模型》§8）。

★ 发货指令：项目经理勾选**本次要发的设备**（例：待发 10 台，本次只发 01A、02A）
→ 打包（拆不拆解看车的大小，由打包师傅定，**不拆成两个流程**）→ 装车（拍照）
→ 分批发往现场 → 现场到货验收（与发货指令 / 装箱清单对账，防"对不齐"）。
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.assembly import AssemblyRecord
from app.models.library import Item
from app.models.project import Equipment, Project
from app.services import project_stage
from app.models.shipment import (
    SHIP_ARRIVED,
    SHIP_INSTRUCTED,
    SHIP_LOADED,
    SHIP_SHIPPING,
    SHIP_SIGNED,
    SHIP_TRANSIT,
    VEHICLE_PENDING,
    VEHICLE_READY,
    Shipment,
    ShipmentItem,
    ShipmentLine,
    SiteReceipt,
)
from app.services import notify
from app.services import kitting as kt
from app.services.numbering import ObjectType, next_number, year_scope_key

SHIP_OPEN = (SHIP_INSTRUCTED, SHIP_SHIPPING, SHIP_LOADED, SHIP_TRANSIT, SHIP_ARRIVED)
READY_ASSY = ("已装配", "调试中", "调试完成")


class ShippingError(Exception):
    """发运业务规则错误。"""


def _now() -> datetime:
    return datetime.now(UTC)


def project_team_ids(session: Session, project_no: str) -> set[int]:
    from app.models.initiation import ProjectMember

    return {
        uid
        for uid in session.scalars(
            select(ProjectMember.user_id).where(ProjectMember.project_no == project_no)
        ).all()
        if uid
    }


def to_ship(session: Session, project_no: str) -> list[dict]:
    """待发设备：装配完成（含调试）且还没在"在跑"的发运批次里。"""
    equips = session.scalars(
        select(Equipment).where(Equipment.project_no == project_no).order_by(Equipment.equip_no)
    ).all()
    # 已经在开放批次里的设备
    open_ship_lines = session.execute(
        select(ShipmentLine.equip_no, Shipment.status)
        .join(Shipment, Shipment.id == ShipmentLine.shipment_id)
        .where(Shipment.project_no == project_no, Shipment.status.in_(SHIP_OPEN))
    ).all()
    shipped = {e for e, _ in open_ship_lines}
    # 每台设备最新装配状态
    assy: dict[str, str] = {}
    for r in session.scalars(
        select(AssemblyRecord)
        .where(AssemblyRecord.project_no == project_no)
        .order_by(AssemblyRecord.id)
    ).all():
        assy[r.equip_no] = r.status
    rates = {o["equip_no"]: o["kitting_rate"] for o in kt.overview(session, project_no)}
    return [
        {
            "equip_no": e.equip_no,
            "equip_name": e.equip_name,
            "assembly_status": assy.get(e.equip_no),
            "kitting_rate": rates.get(e.equip_no, 0.0),
            "ready": assy.get(e.equip_no) in READY_ASSY,
            "in_open_shipment": e.equip_no in shipped,
        }
        for e in equips
    ]


def create_shipment(
    session: Session,
    *,
    project_no: str,
    equip_nos: list[str],
    actor_id: int,
    plan_ship_date: date | None = None,
    remark: str | None = None,
) -> Shipment:
    if not equip_nos:
        raise ShippingError("至少勾选一台要发的设备")
    equips = {
        e.equip_no: e
        for e in session.scalars(select(Equipment).where(Equipment.project_no == project_no)).all()
    }
    missing = [n for n in equip_nos if n not in equips]
    if missing:
        raise ShippingError(f"设备不存在：{'、'.join(missing)}")
    shipped = {x["equip_no"] for x in to_ship(session, project_no) if x["in_open_shipment"]}
    dup = [n for n in equip_nos if n in shipped]
    if dup:
        raise ShippingError(f"这些设备已经在一个未完成的发运批次里：{'、'.join(dup)}")
    sh = Shipment(
        shipment_no=next_number(session, ObjectType.SHIPMENT, scope_key=year_scope_key()),
        project_no=project_no,
        instruct_by=actor_id,
        instruct_at=_now(),
        plan_ship_date=plan_ship_date,
        status=SHIP_INSTRUCTED,
        remark=remark,
    )
    session.add(sh)
    session.flush()
    for n in equip_nos:
        session.add(
            ShipmentLine(shipment_id=sh.id, equip_no=n, equip_name=equips[n].equip_name, qty=1)
        )
    notify.notify_role(
        session,
        "DELIVERY",
        type_="ship",
        title=f"新发货指令：{project_no}（{sh.shipment_no}）本次发 {'、'.join(equip_nos)}",
        body="请安排打包（视车的大小决定是否拆解）→ 装车 → 发运。",
        link="/shipping",
        biz_type="shipment",
        biz_id=sh.id,
        actor_id=actor_id,
    )
    return sh


def generate_items(
    session: Session,
    sh: Shipment,
) -> list[dict]:
    """按本次发运设备的**已发布结构**生成发运清单候选（组件→子组件→零件 + 标准件/原材料）。

    数量 = 结构连乘。生成的是"应发清单"，逐项勾「已发」+ 拍照。
    """
    from app.models.engineering import BOM_MATERIAL, BomItem, Drawing
    from app.services.bom_math import bom_line_demand, cumulative_qty, drawing_demand

    equip_nos = [
        l.equip_no
        for l in session.scalars(select(ShipmentLine).where(ShipmentLine.shipment_id == sh.id)).all()
    ]
    out: list[dict] = []
    for eq in equip_nos:
        drawings = session.scalars(
            select(Drawing).where(Drawing.project_no == sh.project_no, Drawing.equip_no == eq)
        ).all()
        published = [d for d in drawings if d.status == "已发布"]
        tree = {d.drawing_no: d for d in drawings}
        cum = cumulative_qty(drawings)
        bom_rows = session.scalars(
            select(BomItem).where(
                BomItem.project_no == sh.project_no,
                BomItem.parent_ref.in_({d.drawing_no for d in published}),
                BomItem.status == "已冻结",
            )
        ).all()
        # 组件/零件（图纸树）
        for d in published:
            children = any(x.parent_drawing_no == d.drawing_no for x in published)
            out.append({
                "equip_no": eq,
                "ref": d.drawing_no,
                "parent_ref": d.parent_drawing_no,
                "name": d.title,
                "kind": "组件" if children else "零件",
                "source": "结构",
                "qty": drawing_demand(d, cum),
                "unit": d.unit,
                "level": sum(1 for lv in (d.l1, d.l2, d.l3, d.l4) if lv != "00"),
            })
        # 标准件 / 原材料（挂父件下）
        for b in bom_rows:
            it = session.get(Item, b.child_item_no)
            out.append({
                "equip_no": eq,
                "ref": b.child_item_no,
                "parent_ref": b.parent_ref,
                "name": it.display_name if it else b.child_item_no,
                "kind": "原材料" if b.bom_source == BOM_MATERIAL else "标准件",
                "source": "结构",
                "qty": bom_line_demand(b, cum),
                "unit": None,
                "level": 9,
            })
    return out


def _shipped_count(session: Session, sh: Shipment) -> int:
    """本批已勾「已发」的项数（装车/发运共用的门禁）。"""
    return int(
        session.scalar(
            select(func.count()).select_from(ShipmentItem).where(
                ShipmentItem.shipment_id == sh.id, ShipmentItem.shipped.is_(True)
            )
        )
        or 0
    )


def sync_items(
    session: Session,
    sh: Shipment,
    items: list[dict],
    *,
    actor_id: int | None = None,
) -> list[ShipmentItem]:
    """把候选清单保存为发运清单行（保留已勾选/已拍照的行，只补新的）。"""
    if sh.status not in (SHIP_INSTRUCTED, SHIP_SHIPPING):
        raise ShippingError(f"当前状态「{sh.status}」，不能生成发运清单")
    if not items:
        raise ShippingError("清单不能为空")
    existing = {
        (r.equip_no, r.ref): r
        for r in session.scalars(select(ShipmentItem).where(ShipmentItem.shipment_id == sh.id)).all()
    }
    rows: list[ShipmentItem] = []
    for it in items:
        key = (it.get("equip_no"), it["ref"])
        row = existing.get(key)
        if row is None:
            row = ShipmentItem(
                shipment_id=sh.id, equip_no=it.get("equip_no"), ref=it["ref"],
                parent_ref=it.get("parent_ref"), name=it.get("name"), kind=it.get("kind", "零件"),
                qty=it.get("qty") or 1, unit=it.get("unit"), source=it.get("source", "结构"),
            )
            session.add(row)
            rows.append(row)
    session.flush()
    if sh.status == SHIP_INSTRUCTED:
        sh.status = SHIP_SHIPPING
    return rows


def mark_shipped(
    session: Session,
    sh: Shipment,
    *,
    actor_id: int,
    item_ids: list[int],
    photos: list | None = None,
) -> int:
    """勾选「已发」：大组件勾上 = 子树全部标记已发；可拍照。

    ★ R5-01：装车后（已装车）发运前仍要能补勾 —— 否则 0 项已发的死端只是往后挪了一格。
      但**车一旦发走（在途）清单就锁死**：那是现场清点和对账的唯一依据。
    """
    if sh.status not in (SHIP_INSTRUCTED, SHIP_SHIPPING, SHIP_LOADED):
        raise ShippingError(f"当前状态「{sh.status}」，不能再勾选发货（已发运的批次清单已锁死）")
    items = session.scalars(select(ShipmentItem).where(ShipmentItem.shipment_id == sh.id)).all()
    by_id = {i.id: i for i in items}
    # 勾组件 → 子树全部勾上
    children_map: dict[str | None, list[ShipmentItem]] = {}
    for i in items:
        children_map.setdefault(i.parent_ref, []).append(i)
    to_mark: list[ShipmentItem] = []
    stack = [by_id[i] for i in item_ids if i in by_id]
    while stack:
        cur = stack.pop()
        if cur.shipped:
            continue
        cur.shipped = True
        cur.shipped_at = _now()
        cur.shipped_by = actor_id
        if photos:
            cur.photos = list(cur.photos or []) + list(photos)
        to_mark.append(cur)
        stack.extend(children_map.get(cur.ref, []))
    n = len(to_mark)
    if any(i.status in (SHIP_INSTRUCTED,) for i in [sh]):
        sh.status = SHIP_SHIPPING
    return n


def add_manual_item(
    session: Session,
    sh: Shipment,
    *,
    actor_id: int,
    equip_no: str | None,
    name: str,
    qty: float,
    remark: str | None = None,
) -> ShipmentItem:
    """结构外补充项：说明书 / 备件 / 工具等（同 R5-01：发运前可补，发运后锁死）。"""
    if sh.status not in (SHIP_INSTRUCTED, SHIP_SHIPPING, SHIP_LOADED):
        raise ShippingError(f"当前状态「{sh.status}」，不能再补清单（已发运的批次清单已锁死）")
    row = ShipmentItem(
        shipment_id=sh.id,
        equip_no=equip_no or (sh.lines[0].equip_no if sh.lines else None),
        ref=f"补-{name}"[:48],
        name=name,
        kind="补充",
        qty=qty or 1,
        source="补充",
    )
    session.add(row)
    session.flush()
    return row


def request_vehicle(
    session: Session,
    sh: Shipment,
    *,
    count: int | None,
    fee: float | None,
    note: str | None,
    operator_id: int | None,
) -> Shipment:
    """★ §2.2（09 卷）：**采购叫车** —— 一条指令、两个部门。

    客户口径：“采购就去采购车辆回来”（按 PM 定的**发货日**，当天把车叫回来）；
    “**装货的人就知道当天需要装几车货**” → `count` 必填。
    车辆服务**不进价格库**（地方/车型/时间不同价格必不同），只记**本次**费用。
    """
    if sh.status in (SHIP_TRANSIT, SHIP_ARRIVED, SHIP_SIGNED):
        raise ShippingError(f"这批已经「{sh.status}」了，不能再改车辆安排")
    if not count or int(count) < 1:
        raise ShippingError("要填几辆车 —— 装货的人要知道当天装几车")
    sh.vehicle_status = VEHICLE_READY
    sh.vehicle_count = int(count)
    sh.vehicle_fee = fee
    sh.vehicle_note = (note or "").strip() or None
    sh.vehicle_by = operator_id
    sh.vehicle_at = _now()
    # 叫车了 → 同时通知发运“可以装车了”（两个部门靠同一条指令协同）
    notify.notify_role(
        session,
        "DELIVERY",
        type_=notify.TYPE_TASK,
        title=f"车辆已就绪，可以装车：{sh.shipment_no}（{sh.vehicle_count} 车）",
        body=(f"计划发货日 {sh.plan_ship_date}；" if sh.plan_ship_date else "")
        + (f"承运/备注：{sh.vehicle_note}" if sh.vehicle_note else ""),
        link=f"/shipping",
        biz_type="shipment",
        biz_id=sh.id,
        actor_id=operator_id,
    )
    return sh


def load(
    session: Session,
    sh: Shipment,
    *,
    vehicle: str | None,
    driver: str | None,
    plate_no: str | None,
    photos: list | None,
    remark: str | None = None,
) -> Shipment:
    if sh.status not in (SHIP_INSTRUCTED, SHIP_SHIPPING, SHIP_LOADED):
        raise ShippingError(f"当前状态「{sh.status}」，不能装车")
    # ★ §2.2（09 卷）：**采购要先叫车** —— 一条指令指挥两个部门。
    #   客户：“PM 发出指令需要叫车服务，采购就去采购车辆回来，发运就开始装车并进行交付。”
    if sh.vehicle_status != VEHICLE_READY:
        raise ShippingError(
            "采购还没叫车 —— 先由采购按「计划发货日」把车订好（登记几车 + 本次运费），才能装车"
        )
    if not photos:
        raise ShippingError("装车要拍照")
    # ★ R5-01（客户口径）：0 项已发**不能装车** —— 一件都没发，车上装的是什么？
    #   只软提示会让批次一路装到「已装车」后无法发运（发运被 R3-02 硬拦）→ 死端前移堵住
    if not _shipped_count(session, sh):
        raise ShippingError(
            "本批一项都没勾「已发」，不能装车 —— 先到「发运清单」勾选实际发出的件（可分批）并拍照，再装车"
        )
    sh.vehicle = vehicle or sh.vehicle
    sh.driver = driver or sh.driver
    sh.plate_no = plate_no or sh.plate_no
    sh.photos = list(sh.photos or []) + list(photos)
    sh.status = SHIP_LOADED
    if remark:
        sh.remark = remark
    return sh


def depart(
    session: Session,
    sh: Shipment,
    *,
    depart_at: date | None = None,
    photos: list | None = None,
    remark: str | None = None,
    actor_id: int | None = None,
) -> Shipment:
    # ★ D3（客户口径 2026-09-24）：按 00 卷 S7 原序——逐项勾「已发」→ 装车 → 发运，
    #   所以发运只接受「已装车」；「发货中」只是清单确认中（sync_items 自动转），不是可绕过装车的快捷路径
    if sh.status != SHIP_LOADED:
        raise ShippingError(
            f"当前状态「{sh.status}」，不能发运 —— 按流程需先「装车」（拍装车照）再发运"
            if sh.status in (SHIP_INSTRUCTED, SHIP_SHIPPING)
            else f"当前状态「{sh.status}」，不能发运"
        )
    # ★ 发运门禁（客户口径 R3-02 方案A）：0 项已发不能发运（否则到货后无法清点，成死批次）
    shipped_count = _shipped_count(session, sh)
    if not shipped_count:
        raise ShippingError(
            "本批一项都没勾「已发」—— 勾「已发」的就是实际发出的：先勾选实际发出的件（可分批，只勾这一批发走的），再发运"
        )
    sh.status = SHIP_TRANSIT
    sh.depart_at = _now()
    # ★ §2.2：计划发货日是**计划**，不被实际发运日覆盖（原来会覆盖，把计划毁掉）；只在空时回填
    if depart_at and not sh.plan_ship_date:
        sh.plan_ship_date = depart_at
    if photos:
        sh.photos = list(sh.photos or []) + list(photos)
    if remark:
        sh.remark = remark
    # ★ 发运 → 通知现场（客户口径）：现场按同一份清单逐项核对到/缺/损
    notify.notify_role(
        session,
        "SITE",
        type_="ship",
        title=f"已发运：{sh.project_no}（{sh.shipment_no}）共 {shipped_count or 0} 项",
        body="货已发出，请按发运清单逐项清点「到 / 缺 / 损」。",
        link="/m/site",
        biz_type="shipment",
        biz_id=sh.id,
        actor_id=actor_id,
    )
    # 发运即进入「交付中」阶段（执行中 → 交付中）
    project = session.get(Project, sh.project_no)
    if project is not None and project.stage not in (project_stage.DELIVERING, project_stage.WARRANTY, project_stage.CLOSED):
        try:
            project_stage.assert_transition(project.stage, project_stage.DELIVERING)
            project.stage = project_stage.DELIVERING
        except project_stage.StageError:
            pass
    return sh


def arrive(session: Session, sh: Shipment) -> Shipment:
    if sh.status != SHIP_TRANSIT:
        raise ShippingError(f"当前状态「{sh.status}」，不能登记到货")
    sh.status = SHIP_ARRIVED
    sh.arrive_at = _now()
    return sh


def site_receipt(
    session: Session,
    sh: Shipment,
    *,
    actor_id: int,
    checks: list[dict],
    photos: list | None,
    remark: str | None = None,
) -> SiteReceipt:
    """现场清点：按发运清单逐行勾「到 / 缺 / 损」，全部清点完才能提交。

    结论自动判定：全部「到」= 齐；有「缺」= 缺件；有「损」= 破损。
    """
    if sh.status not in (SHIP_TRANSIT, SHIP_ARRIVED):
        raise ShippingError(f"当前状态「{sh.status}」，不能做现场清点")
    if not photos:
        raise ShippingError("现场清点要拍照")
    items = session.scalars(
        select(ShipmentItem).where(ShipmentItem.shipment_id == sh.id)
    ).all()
    if not items:
        raise ShippingError("这批没有发运清单（先回系统生成/勾选发运项）")
    # ★ 发货与收货一致（客户口径）：现场只核对本批「已勾发」的项（未发的留在后续批次，不属于本次交付）
    shipped = [i for i in items if i.shipped]
    if not shipped:
        raise ShippingError("本批一项都没勾「已发」—— 发货和收货要一致：先勾选实际发出的件，再发运/清点")
    shipped_ids = {i.id for i in shipped}
    checked_ids = {c.get("item_id") for c in checks}
    unchecked = [i for i in shipped if i.id not in checked_ids]
    if unchecked:
        raise ShippingError(f"还有 {len(unchecked)} 项没清点：{unchecked[0].ref} 等")
    extra = [cid for cid in checked_ids if cid not in shipped_ids]
    if extra:
        raise ShippingError("清点范围只能包含本批已勾「已发」的项（未发的件不在本次交付内）")
    shortage: list[dict] = []
    damaged: list[dict] = []
    by_id = {i.id: i for i in shipped}
    for ck in checks:
        row = by_id.get(ck.get("item_id"))
        if row is None:
            continue
        result = ck.get("result")
        if result not in ("到", "缺", "损"):
            raise ShippingError("清点结果只能是 到 / 缺 / 损")
        row.check_result = result
        row.check_qty = float(ck.get("received_qty")) if ck.get("received_qty") is not None else None
        row.check_note = ck.get("reason")
        row.check_by = actor_id
        row.check_at = _now()
        if result in ("缺", "损"):
            shortage.append({
                "item_id": row.id, "equip_no": row.equip_no, "item": row.ref,
                "name": row.name, "qty": float(row.qty or 0),
                "received_qty": ck.get("received_qty"), "result": result,
                "reason": ck.get("reason") or "",
            })
            if result == "缺":
                damaged.append({"item": row.ref, "result": "缺"})
    result_overall = "齐"
    if any(s["result"] == "缺" for s in shortage):
        result_overall = "缺件"
    elif any(s["result"] == "损" for s in shortage):
        result_overall = "破损"
    row_sr = SiteReceipt(
        shipment_id=sh.id,
        project_no=sh.project_no,
        received_by=actor_id,
        received_at=_now(),
        result=result_overall,
        shortage_detail=shortage or [],
        photos=list(photos or []),
        remark=remark,
    )
    session.add(row_sr)
    sh.status = SHIP_SIGNED
    sh.signed_at = _now()
    if result_overall != "齐":
        notify.notify(
            session,
            project_team_ids(session, sh.project_no),
            type_="ship",
            title=f"现场清点{result_overall}：{sh.project_no}（{sh.shipment_no}）",
            body=f"缺/损 {len(shortage)} 项；备注：{remark or '—'}",
            link="/shipping",
            biz_type="shipment",
            biz_id=sh.id,
            actor_id=actor_id,
        )
    return row_sr


def shipment_dict(session: Session, sh: Shipment) -> dict:
    lines = session.scalars(
        select(ShipmentLine).where(ShipmentLine.shipment_id == sh.id).order_by(ShipmentLine.id)
    ).all()
    packing = session.scalars(
        select(ShipmentItem).where(ShipmentItem.shipment_id == sh.id).order_by(ShipmentItem.id)
    ).all()
    receipts = session.scalars(
        select(SiteReceipt).where(SiteReceipt.shipment_id == sh.id).order_by(SiteReceipt.id)
    ).all()
    return {
        "id": sh.id,
        "shipment_no": sh.shipment_no,
        "project_no": sh.project_no,
        "status": sh.status,
        "plan_ship_date": sh.plan_ship_date,
        # ★ §2.2 叫车（采购做的）
        "vehicle_status": sh.vehicle_status,
        "vehicle_count": sh.vehicle_count,
        "vehicle_fee": float(sh.vehicle_fee) if sh.vehicle_fee is not None else None,
        "vehicle_note": sh.vehicle_note,
        "vehicle_by": sh.vehicle_by,
        "vehicle_at": sh.vehicle_at,
        "vehicle": sh.vehicle,
        "driver": sh.driver,
        "plate_no": sh.plate_no,
        "instruct_at": sh.instruct_at,
        "depart_at": sh.depart_at,
        "arrive_at": sh.arrive_at,
        "signed_at": sh.signed_at,
        "photos": sh.photos or [],
        "remark": sh.remark,
        "lines": [
            {"id": l.id, "equip_no": l.equip_no, "equip_name": l.equip_name, "qty": float(l.qty or 0), "remark": l.remark}
            for l in lines
        ],
        "items": [
            {
                "id": p.id,
                "equip_no": p.equip_no,
                "ref": p.ref,
                "parent_ref": p.parent_ref,
                "name": p.name,
                "kind": p.kind,
                "source": p.source,
                "qty": float(p.qty or 0),
                "unit": p.unit,
                "shipped": p.shipped,
                "shipped_at": p.shipped_at,
                "photos": p.photos or [],
                "place_photos": p.place_photos or [],
                "check_result": p.check_result,
                "check_qty": float(p.check_qty) if p.check_qty is not None else None,
                "check_note": p.check_note,
                "remark": p.remark,
            }
            for p in packing
        ],
        "receipts": [
            {
                "id": r.id,
                "result": r.result,
                "shortage_detail": r.shortage_detail or [],
                "photos": r.photos or [],
                "received_at": r.received_at,
                "remark": r.remark,
            }
            for r in receipts
        ],
    }
