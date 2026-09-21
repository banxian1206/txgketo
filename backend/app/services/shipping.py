"""发运域服务（《00 方案》§3.1⑤ · 《02 数据模型》§8）。

★ 发货指令：项目经理勾选**本次要发的设备**（例：待发 10 台，本次只发 01A、02A）
→ 打包（拆不拆解看车的大小，由打包师傅定，**不拆成两个流程**）→ 装车（拍照）
→ 分批发往现场 → 现场到货验收（与发货指令 / 装箱清单对账，防"对不齐"）。
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.assembly import AssemblyRecord
from app.models.project import Equipment
from app.models.shipment import (
    SHIP_ARRIVED,
    SHIP_INSTRUCTED,
    SHIP_LOADED,
    SHIP_PACKING,
    SHIP_SIGNED,
    SHIP_TRANSIT,
    PackingItem,
    Shipment,
    ShipmentLine,
    SiteReceipt,
)
from app.services import notify
from app.services import kitting as kt
from app.services.numbering import ObjectType, next_number, year_scope_key

SHIP_OPEN = (SHIP_INSTRUCTED, SHIP_PACKING, SHIP_LOADED, SHIP_TRANSIT, SHIP_ARRIVED)
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


def add_packing(
    session: Session,
    sh: Shipment,
    items: list[dict],
    *,
    actor_id: int | None = None,
) -> list[PackingItem]:
    if sh.status not in (SHIP_INSTRUCTED, SHIP_PACKING):
        raise ShippingError(f"当前状态「{sh.status}」，不能再改装箱清单")
    if not items:
        raise ShippingError("装箱清单不能为空")
    rows: list[PackingItem] = []
    for it in items:
        if not it.get("part_item_no"):
            continue
        row = PackingItem(
            shipment_id=sh.id,
            equip_no=it.get("equip_no"),
            part_item_no=it["part_item_no"],
            part_name=it.get("part_name"),
            qty=it.get("qty") or 1,
            package_no=it.get("package_no"),
            weight=it.get("weight"),
            size=it.get("size"),
            disassembled=bool(it.get("disassembled")),
            photos=it.get("photos") or [],
            remark=it.get("remark"),
        )
        session.add(row)
        rows.append(row)
    sh.status = SHIP_PACKING
    session.flush()
    return rows


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
    if sh.status not in (SHIP_INSTRUCTED, SHIP_PACKING, SHIP_LOADED):
        raise ShippingError(f"当前状态「{sh.status}」，不能装车")
    if not photos:
        raise ShippingError("装车要拍照")
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
) -> Shipment:
    if sh.status not in (SHIP_LOADED, SHIP_PACKING):
        raise ShippingError(f"当前状态「{sh.status}」，不能发运（先装车）")
    sh.status = SHIP_TRANSIT
    sh.depart_at = _now()
    if depart_at:
        sh.plan_ship_date = depart_at
    if photos:
        sh.photos = list(sh.photos or []) + list(photos)
    if remark:
        sh.remark = remark
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
    result: str,
    shortage_detail: list | None,
    photos: list | None,
    remark: str | None = None,
) -> SiteReceipt:
    if sh.status not in (SHIP_ARRIVED, SHIP_TRANSIT):
        raise ShippingError(f"当前状态「{sh.status}」，不能做现场到货验收")
    if not photos:
        raise ShippingError("到货验收要拍照")
    row = SiteReceipt(
        shipment_id=sh.id,
        project_no=sh.project_no,
        received_by=actor_id,
        received_at=_now(),
        result=result,
        shortage_detail=shortage_detail or [],
        photos=list(photos or []),
        remark=remark,
    )
    session.add(row)
    sh.status = SHIP_SIGNED
    sh.signed_at = _now()
    if result != "齐":
        notify.notify(
            session,
            project_team_ids(session, sh.project_no),
            type_="ship",
            title=f"现场到货{result}：{sh.project_no}（{sh.shipment_no}）",
            body=f"验收结论：{result}。备注：{remark or '—'}",
            link="/shipping",
            biz_type="shipment",
            biz_id=sh.id,
            actor_id=actor_id,
        )
    return row


def shipment_dict(session: Session, sh: Shipment) -> dict:
    lines = session.scalars(
        select(ShipmentLine).where(ShipmentLine.shipment_id == sh.id).order_by(ShipmentLine.id)
    ).all()
    packing = session.scalars(
        select(PackingItem).where(PackingItem.shipment_id == sh.id).order_by(PackingItem.id)
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
        "packing": [
            {
                "id": p.id,
                "equip_no": p.equip_no,
                "part_item_no": p.part_item_no,
                "part_name": p.part_name,
                "qty": float(p.qty or 0),
                "package_no": p.package_no,
                "weight": float(p.weight) if p.weight is not None else None,
                "size": p.size,
                "disassembled": p.disassembled,
                "photos": p.photos or [],
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
