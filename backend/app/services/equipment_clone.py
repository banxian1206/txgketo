"""同型设备设计复制（确认1 · 2026-09-22 产品决策）。

背景：立项时"同型第二台"只会生成一个设备档案（01B），不会自动继承 01A 的图纸/BOM。
本模块在**设计发布时**把已发布的设计复制给同型兄弟设备，使 01B 同样可采购/制造/装配/发运。

规则：
- 同型判定：同项目、同 `seq_no`、不同 `letter`（01A / 01B / 01C…）。
- 触发：`_publish_round` 发布后 + 建设备时（若母机已有设计）。
- 复制内容：图纸（新图号，结构/图号层次一致）+ 图纸版本与附件文件 + BOM 行（含设计/材料，
  状态直接为"已冻结"）+ PLC 程序与版本文件；随后按已冻结 BOM 生成 01B 自己的采购需求。
- **幂等**：按"图号 / 父件+子件 / 程序名"去重；重复发布不会重复复制、重复进池。
- 说明：本版不做"母机改版自动同步到同型"（ECN 传播留待后续）。
"""

from __future__ import annotations

import shutil
import time
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.engineering import BOM_ROW_FROZEN, BomItem, Drawing, DrawingVersion
from app.models.initiation import SOURCE_DESIGN_RELEASE, PurchaseRequest
from app.models.library import Item
from app.models.program import EquipmentProgram, EquipmentProgramVersion
from app.models.project import Equipment, Project
from app.models.task import Task
from app.services import bom_demand
from app.services.numbering import compose_mech_drawing_no, drawing_level


def clone_same_type_design(
    session: Session,
    project_no: str,
    base_equip_no: str,
    release_id: int | None,
    actor_id: int | None,
) -> list[str]:
    """把 base_equip_no 的设计复制到同型兄弟设备；返回被复制的设备号。"""
    base = session.scalar(
        select(Equipment).where(
            Equipment.project_no == project_no, Equipment.equip_no == base_equip_no
        )
    )
    if base is None or base.seq_no is None:
        return []
    siblings = [
        e
        for e in session.scalars(
            select(Equipment).where(
                Equipment.project_no == project_no, Equipment.seq_no == base.seq_no
            )
        ).all()
        if e.equip_no != base_equip_no
    ]
    cloned: list[str] = []
    for sib in siblings:
        _clone_one(session, project_no, base_equip_no, sib.equip_no, release_id, actor_id)
        cloned.append(sib.equip_no)
    return cloned


# ---------------------------------------------------------------------------
# 内部实现
# ---------------------------------------------------------------------------
def _clone_one(
    session: Session,
    project_no: str,
    base_equip_no: str,
    target_equip_no: str,
    release_id: int | None,
    actor_id: int | None,
) -> None:
    now = datetime.now(UTC)
    base_drawings = list(
        session.scalars(
            select(Drawing).where(
                Drawing.project_no == project_no, Drawing.equip_no == base_equip_no
            )
        ).all()
    )
    if not base_drawings:
        return  # 母机还没设计，无需复制

    base_drawings.sort(key=lambda d: drawing_level(d.drawing_no))

    # 1) 图纸（新图号）+ 建立 旧图号 → 新图号 映射
    mapping: dict[str, str] = {}
    for d in base_drawings:
        new_no = compose_mech_drawing_no(project_no, target_equip_no, [d.l1, d.l2, d.l3, d.l4])
        mapping[d.drawing_no] = new_no
        row = session.get(Drawing, new_no)
        if row is None:
            row = Drawing(
                drawing_no=new_no,
                project_no=project_no,
                equip_no=target_equip_no,
                l1=d.l1, l2=d.l2, l3=d.l3, l4=d.l4,
                title=d.title, kind=d.kind, qty=d.qty, unit=d.unit,
                source_type=d.source_type, current_version=d.current_version,
                status="已发布", owner_id=d.owner_id, is_part=d.is_part, remark=d.remark,
            )
            session.add(row)
        else:
            row.title, row.kind, row.qty, row.unit = d.title, d.kind, d.qty, d.unit
            row.source_type = d.source_type
            row.status = "已发布"
            row.is_part = d.is_part
        # 图号即物料号：同步生成/校正物料行（否则外协/定制件不会产生采购需求）
        item = session.get(Item, new_no)
        if item is None:
            session.add(
                Item(
                    item_no=new_no,
                    display_name=f"{d.title}（{new_no}）",
                    source_type=d.source_type,
                    project_no=project_no,
                    spec=None,
                    spec_text=None,
                    unit=d.unit,
                )
            )
        else:
            item.display_name = f"{d.title}（{new_no}）"
            item.source_type = d.source_type
            item.unit = d.unit
        session.flush()
    for d in base_drawings:
        row = session.get(Drawing, mapping[d.drawing_no])
        row.parent_drawing_no = mapping.get(d.parent_drawing_no) if d.parent_drawing_no else None
    session.flush()

    # 2) 图纸版本 + 附件文件（复制一份到同型图号名下，下载才取得到）
    for d in base_drawings:
        src = _current_drawing_version(session, d.drawing_no)
        if src is None:
            continue
        new_no = mapping[d.drawing_no]
        dst = _current_drawing_version(session, new_no)
        if dst is None:
            dst = DrawingVersion(drawing_no=new_no, version=src.version, is_current=True)
            session.add(dst)
            session.flush()
        if not dst.file_path and src.file_path:
            dst.file_path, dst.filename = _copy_file(
                src.file_path, project_no, "drawings", new_no, src.filename
            )
        dst.change_reason = src.change_reason or dst.change_reason
        dst.submitted_by = src.submitted_by
        dst.submitted_at = src.submitted_at
        dst.reviewed_by = actor_id
        dst.reviewed_at = now
        dst.published_by = actor_id
        dst.published_at = now
        dst.is_current = True
    session.flush()

    # 3) BOM 行（设计 + 材料），直接冻结
    base_nos = set(mapping.keys())
    bom_rows = list(
        session.scalars(
            select(BomItem).where(
                BomItem.project_no == project_no,
                BomItem.parent_ref.in_(base_nos),
                BomItem.superseded_by_id.is_(None),
            )
        ).all()
    )
    for b in bom_rows:
        new_parent = mapping.get(b.parent_ref)
        if new_parent is None:
            continue
        exists = session.scalar(
            select(BomItem.id).where(
                BomItem.project_no == project_no,
                BomItem.parent_ref == new_parent,
                BomItem.child_item_no == b.child_item_no,
                BomItem.bom_source == b.bom_source,
                BomItem.superseded_by_id.is_(None),
            ).limit(1)
        )
        if exists:
            continue
        session.add(
            BomItem(
                project_no=project_no,
                parent_ref=new_parent,
                child_item_no=b.child_item_no,
                bom_source=b.bom_source,
                qty=b.qty,
                unit=b.unit,
                pos_no=b.pos_no,
                remark=b.remark,
                status=BOM_ROW_FROZEN,
                frozen_release_id=release_id,
                owner_id=b.owner_id or actor_id,
            )
        )
    session.flush()

    # 4) PLC 程序 + 版本文件
    for p in session.scalars(
        select(EquipmentProgram).where(
            EquipmentProgram.project_no == project_no, EquipmentProgram.equip_no == base_equip_no
        )
    ).all():
        name = p.name.replace(base_equip_no, target_equip_no)
        newp = session.scalar(
            select(EquipmentProgram).where(
                EquipmentProgram.project_no == project_no,
                EquipmentProgram.equip_no == target_equip_no,
                EquipmentProgram.name == name,
            ).limit(1)
        )
        if newp is None:
            newp = EquipmentProgram(
                project_no=project_no, equip_no=target_equip_no, name=name,
                owner_id=p.owner_id, current_version=p.current_version, status="已发布", remark=p.remark,
            )
            session.add(newp)
            session.flush()
        srcv = _current_program_version(session, p.id)
        if srcv is None:
            continue
        dstv = _current_program_version(session, newp.id)
        if dstv is None:
            dstv = EquipmentProgramVersion(program_id=newp.id, version=srcv.version, is_current=True)
            session.add(dstv)
            session.flush()
        if not dstv.file_path and srcv.file_path:
            dstv.file_path, dstv.filename = _copy_file(
                srcv.file_path, project_no, "programs", str(newp.id), srcv.filename
            )
        dstv.submitted_by = srcv.submitted_by
        dstv.submitted_at = srcv.submitted_at
        dstv.reviewed_by = actor_id
        dstv.reviewed_at = now
        dstv.published_by = actor_id
        dstv.published_at = now
        dstv.is_current = True
    session.flush()

    # 5) 同型设备的设计任务视为完成（设计是复制来的，不用再走一遍）
    for t in session.scalars(
        select(Task).where(
            Task.project_no == project_no,
            Task.equip_no == target_equip_no,
            Task.task_type == "设计",
        )
    ).all():
        if t.status != "已完成":
            t.status = "已完成"
            t.done_at = now
    session.flush()

    # 6) 同型设备自己的采购需求（按已冻结 BOM 展开；幂等，不重复进池）
    _create_equipment_demands(
        session, project_no, target_equip_no, f"同型复制 {base_equip_no}→{target_equip_no}"
    )


def _create_equipment_demands(
    session: Session, project_no: str, equip_no: str, remark: str
) -> list[PurchaseRequest]:
    project = session.get(Project, project_no)
    plan, _stats = bom_demand.plan_equipment_purchase(session, project_no, equip_no)
    created: list[PurchaseRequest] = []
    for line, qty in plan:
        row = PurchaseRequest(
            project_no=project_no,
            equip_no=equip_no,
            attribution="项目",
            part_no=line.part_no,
            item_no=line.item_no,
            qty=qty,
            unit=line.unit,
            source=SOURCE_DESIGN_RELEASE,
            status="待采购",
            need_date=project.period_end if project else None,
            is_long_lead=False,
            remark=remark,
        )
        session.add(row)
        session.flush()
        created.append(row)
    return created


def _current_drawing_version(session: Session, drawing_no: str) -> DrawingVersion | None:
    return session.scalar(
        select(DrawingVersion).where(
            DrawingVersion.drawing_no == drawing_no, DrawingVersion.is_current.is_(True)
        )
    )


def _current_program_version(session: Session, program_id: int) -> EquipmentProgramVersion | None:
    return session.scalar(
        select(EquipmentProgramVersion).where(
            EquipmentProgramVersion.program_id == program_id,
            EquipmentProgramVersion.is_current.is_(True),
        )
    )


def _copy_file(
    src_path: str | None, project_no: str, kind_dir: str, ref_no: str, filename: str | None
) -> tuple[str | None, str | None]:
    """把源附件复制一份到目标（同型图号/程序）名下。"""
    if not src_path:
        return None, filename
    src = Path(src_path)
    name = filename or src.name
    if not src.exists():
        return None, name
    dest_dir = Path(settings.upload_dir) / project_no / kind_dir / str(ref_no)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{time.time_ns()}_{name}"
    shutil.copy2(src, dest)
    return str(dest), name
