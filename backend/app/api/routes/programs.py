"""PLC 程序接口（P4，05 卷 §8.1）。

程序 = 程序专业的产出物：建程序 → 上传草稿版本 → 在「我的提交（评审单）」里勾选提交
→ 组长 → 总监 → 发布（= 冻结）。程序不触发采购（PLC 硬件在电气 BOM 里）。
"""

from __future__ import annotations

import time
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user
from app.core.config import settings
from app.core.db import get_session
from app.models.change import CR_DISPATCHED, TARGET_PROGRAM
from app.models.platform import User
from app.models.program import EquipmentProgram, EquipmentProgramVersion
from app.models.task import Task
from app.services import audit, change_flow
from app.services.review_flow import current_program_version_row

router = APIRouter(tags=["程序版本"])


def _names(session: Session) -> dict[int, str]:
    return {u.id: u.name for u in session.scalars(select(User)).all()}


def _version_dict(v: EquipmentProgramVersion, names: dict[int, str]) -> dict:
    return {
        "id": v.id,
        "program_id": v.program_id,
        "version": v.version,
        "filename": v.filename,
        "change_reason": v.change_reason,
        "submitted_by": names.get(v.submitted_by) if v.submitted_by else None,
        "submitted_at": v.submitted_at,
        "reviewed_by": names.get(v.reviewed_by) if v.reviewed_by else None,
        "reviewed_at": v.reviewed_at,
        "published_by": names.get(v.published_by) if v.published_by else None,
        "published_at": v.published_at,
        "review_note": v.review_note,
        "is_current": v.is_current,
    }


def _program_dict(p: EquipmentProgram, ver: EquipmentProgramVersion | None, names: dict[int, str]) -> dict:
    return {
        "id": p.id,
        "project_no": p.project_no,
        "equip_no": p.equip_no,
        "name": p.name,
        "owner_id": p.owner_id,
        "owner_name": names.get(p.owner_id) if p.owner_id else None,
        "current_version": p.current_version,
        "status": p.status,
        "remark": p.remark,
        "current_filename": ver.filename if ver else None,
    }


def _get_program(session: Session, program_id: int) -> EquipmentProgram:
    row = session.get(EquipmentProgram, program_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "程序不存在")
    return row


class ProgramIn(BaseModel):
    name: str
    remark: str | None = None


class ProgramPatch(BaseModel):
    name: str | None = None
    remark: str | None = None


@router.get("/projects/{project_no}/equipment/{equip_no}/programs")
def list_programs(
    project_no: str,
    equip_no: str,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    rows = session.scalars(
        select(EquipmentProgram)
        .where(EquipmentProgram.project_no == project_no, EquipmentProgram.equip_no == equip_no)
        .order_by(EquipmentProgram.id)
    ).all()
    names = _names(session)
    active = change_flow.active_map(session, project_no, equip_no)
    cr_task_ids = {c.change_task_id for c in active.values() if c.change_task_id}
    cr_tasks = (
        {t.id: t for t in session.scalars(select(Task).where(Task.id.in_(cr_task_ids))).all()}
        if cr_task_ids
        else {}
    )
    out = []
    for p in rows:
        d = _program_dict(p, current_program_version_row(session, p.id), names)
        cr = active.get((TARGET_PROGRAM, str(p.id)))
        d["change_request"] = (
            {
                "id": cr.id,
                "cr_no": cr.cr_no,
                "status": cr.status,
                "change_task_owner_id": (
                    cr_tasks[cr.change_task_id].owner_id if cr.change_task_id in cr_tasks else None
                ),
            }
            if cr
            else None
        )
        out.append(d)
    return out


@router.post("/projects/{project_no}/equipment/{equip_no}/programs", status_code=status.HTTP_201_CREATED)
def create_program(
    project_no: str,
    equip_no: str,
    body: ProgramIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    if not body.name.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "程序名称不能为空")
    row = EquipmentProgram(
        project_no=project_no,
        equip_no=equip_no,
        name=body.name.strip(),
        owner_id=current.id,
        remark=body.remark,
    )
    session.add(row)
    session.flush()
    session.add(EquipmentProgramVersion(program_id=row.id, version=row.current_version, is_current=True))
    audit.log(
        session,
        user=current,
        action="create",
        object_type="equipment_program",
        object_ref=f"{project_no}/{equip_no}/{row.name}",
        summary=f"新建程序 {equip_no} · {row.name}",
        ip=client_ip(request),
    )
    session.commit()
    return _program_dict(row, current_program_version_row(session, row.id), _names(session))


@router.patch("/programs/{program_id}")
def update_program(
    program_id: int,
    body: ProgramPatch,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    row = _get_program(session, program_id)
    if row.status != "草稿":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"只有草稿能改（当前：{row.status}）")
    if body.name is not None:
        row.name = body.name.strip() or row.name
    if body.remark is not None:
        row.remark = body.remark
    audit.log(
        session,
        user=current,
        action="update",
        object_type="equipment_program",
        object_ref=str(program_id),
        summary=f"编辑程序 {row.name}",
        ip=client_ip(request),
    )
    session.commit()
    return _program_dict(row, current_program_version_row(session, row.id), _names(session))


@router.post("/programs/{program_id}/draft")
async def upload_program_draft(
    program_id: int,
    file: UploadFile | None = File(default=None),
    change_reason: str = Form(""),
    request: Request = None,  # type: ignore[assignment]
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """上传/更新程序草稿文件（不改审核状态；提交评审后才发布）。"""
    row = _get_program(session, program_id)
    if row.status != "草稿":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"只有草稿能上传（当前：{row.status}）—— 已发布的先「改版」，审核中的先撤回",
        )
    ver = current_program_version_row(session, program_id)
    if ver is None:
        ver = EquipmentProgramVersion(program_id=program_id, version=row.current_version, is_current=True)
        session.add(ver)
        session.flush()
    if file is not None:
        safe = Path(file.filename or "program").name
        target_dir = Path(settings.upload_dir) / row.project_no / "programs" / str(program_id)
        target_dir.mkdir(parents=True, exist_ok=True)
        stored = target_dir / f"{int(time.time())}_{safe}"
        stored.write_bytes(await file.read())
        ver.file_path = str(stored)
        ver.filename = safe
    ver.change_reason = change_reason or ver.change_reason
    audit.log(
        session,
        user=current,
        action="draft",
        object_type="equipment_program",
        object_ref=str(program_id),
        summary=f"上传程序草稿 {row.name}（{ver.version}）"
        + (f"，附件《{ver.filename}》" if ver.filename else ""),
        ip=client_ip(request) if request else None,
    )
    session.commit()
    return _program_dict(row, ver, _names(session))


@router.post("/programs/{program_id}/new-version")
def new_program_version(
    program_id: int,
    change_reason: str = Form(""),
    request: Request = None,  # type: ignore[assignment]
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """改版：V1 → V2，回到草稿走评审单（05 卷 §7：必须先提改版申请、总监批准并下发）。"""
    row = _get_program(session, program_id)
    if row.status not in ("已发布", "已作废"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "只有已发布的程序需要改版")
    cr = change_flow.approved_for(session, TARGET_PROGRAM, str(program_id))
    if cr is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "冻结程序改版必须先提「改版申请」并等总监批准、下发任务",
        )
    if cr.status != CR_DISPATCHED:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"改版申请 {cr.cr_no} 已批准，等总监下发改版任务后再出新版"
        )
    task = session.get(Task, cr.change_task_id) if cr.change_task_id else None
    if not current.is_superuser and (task is None or task.owner_id != current.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "只有这条改版任务的负责人能出新版")
    n = int(row.current_version.lstrip("V") or "1") + 1
    prev = current_program_version_row(session, program_id)
    if prev is not None:
        prev.is_current = False
    session.add(
        EquipmentProgramVersion(
            program_id=program_id, version=f"V{n}", change_reason=change_reason, is_current=True
        )
    )
    row.current_version = f"V{n}"
    row.status = "草稿"
    audit.log(
        session,
        user=current,
        action="new_version",
        object_type="equipment_program",
        object_ref=str(program_id),
        summary=f"程序改版 {row.name}：V{n - 1} → V{n}"
        + (f"，原因：{change_reason}" if change_reason else ""),
        ip=client_ip(request) if request else None,
    )
    session.commit()
    return _program_dict(row, current_program_version_row(session, program_id), _names(session))


@router.get("/programs/{program_id}/versions")
def list_program_versions(
    program_id: int, session: Session = Depends(get_session), _: User = Depends(get_current_user)
):
    _get_program(session, program_id)
    rows = session.scalars(
        select(EquipmentProgramVersion)
        .where(EquipmentProgramVersion.program_id == program_id)
        .order_by(EquipmentProgramVersion.id.desc())
    ).all()
    names = _names(session)
    return [_version_dict(v, names) for v in rows]


@router.delete("/programs/{program_id}")
def delete_program(
    program_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    row = _get_program(session, program_id)
    if row.status != "草稿":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"只有草稿能删（当前：{row.status}）")
    session.delete(row)
    audit.log(
        session,
        user=current,
        action="delete",
        object_type="equipment_program",
        object_ref=str(program_id),
        summary=f"删除程序 {row.name}",
        ip=client_ip(request),
    )
    session.commit()
    return {"ok": True}
