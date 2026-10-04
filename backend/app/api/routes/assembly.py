"""装配与齐套 API（《00 方案》§3.3 S6 · 《02 数据模型》§7）。

**齐套率只展示**（用户确认）：装配随时能开工，不设 100% 门槛。
权限：查看 `mfg:view`，操作 `mfg:edit`。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, require_permission
from app.core.db import get_session
from app.models.assembly import ASSY_KINDS, AssemblyRecord
from app.models.platform import User
from app.services import audit
from app.services import kitting as kt

router = APIRouter(prefix="/assembly", tags=["装配与齐套"])


# --------------------------------------------------------------------------
# 齐套率（只展示，不做门槛）
# --------------------------------------------------------------------------


@router.get("/kitting")
def get_kitting(
    project_no: str = Query(...),
    equip_no: str = Query(...),
    session: Session = Depends(get_session),
    _: User = Depends(require_permission("mfg:view")),
):
    """一台设备的齐套率 + 明细（到了多少、还差什么）。**不设门槛**。"""
    return kt.compute(session, project_no, equip_no)


@router.get("/kitting/overview")
def kitting_overview(
    project_no: str = Query(...),
    session: Session = Depends(get_session),
    _: User = Depends(require_permission("mfg:view")),
):
    """一个项目下每台设备的齐套率。"""
    return kt.overview(session, project_no)


# ★ G5（09 卷 §3）：多视角齐套率 —— 客户口径 2026-09-28
#   “其他人基本上都是按照项目去看齐套情况的…是还没有买，还是在途，还是验收已入库，
#    还是说已经做成了成品（即组装件）？其实只有采购和仓库这两个人，他们看采购单。”
@router.get("/kitting/funnel")
def kitting_funnel(
    project_no: str = Query(...),
    session: Session = Depends(get_session),
    _: User = Depends(require_permission("mfg:view")),
):
    """**项目视角（主）**：整个项目要的东西，现分布在
    未买 / 在途 / 验收已入库 / 已领料 / **已做成成品（组装件）** 哪一格。"""
    return kt.funnel(session, project_no)


@router.get("/kitting/projects")
def kitting_projects(
    session: Session = Depends(get_session),
    _: User = Depends(require_permission("mfg:view")),
):
    """**跨项目汇总**：同时多个项目在跑时，按项目看齐套分布（采购/管理层用）。

    单据视角（按采购单看物件）在采购工作台 —— 那里也**保留项目筛选**。
    """
    return kt.projects_funnel(session)


# --------------------------------------------------------------------------
# 装配记录 / 厂内调试
# --------------------------------------------------------------------------


class StartIn(BaseModel):
    project_no: str
    equip_no: str
    sub_assembly: str = Field(default="整机装配", description="整机装配 / 组件预装")
    photos: list = Field(default_factory=list)
    remark: str | None = None


@router.post("/records", status_code=status.HTTP_201_CREATED)
def start_assembly(
    body: StartIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("mfg:edit")),
):
    """开始装配（整机 / 组件预装）：**不看齐套率**，开工时把当时齐套率快照留档。"""
    if body.sub_assembly not in ASSY_KINDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "装配形态只能是 整机装配 / 组件预装")
    rec, reused = kt.start_assembly(
        session,
        project_no=body.project_no,
        equip_no=body.equip_no,
        sub_assembly=body.sub_assembly,
        actor_id=current.id,
        photos=body.photos,
        remark=body.remark,
    )
    audit.log(
        session,
        user=current,
        action="start_assembly",
        object_type="assembly_record",
        object_ref=str(rec.id),
        summary=(
            f"开始装配：{body.project_no} / {body.equip_no}（{body.sub_assembly}），"
            f"开工齐套率 {float(rec.kitting_rate) * 100:.0f}%"
        ),
        ip=client_ip(request),
    )
    session.commit()
    return {**kt.record_dict(rec), "reused": reused}


@router.get("/records")
def list_records(
    project_no: str | None = None,
    equip_no: str | None = None,
    status_: str | None = Query(default=None, alias="status"),
    limit: int = 200,
    session: Session = Depends(get_session),
    _: User = Depends(require_permission("mfg:view")),
):
    stmt = select(AssemblyRecord).order_by(AssemblyRecord.id.desc())
    if project_no:
        stmt = stmt.where(AssemblyRecord.project_no == project_no)
    if equip_no:
        stmt = stmt.where(AssemblyRecord.equip_no == equip_no)
    if status_:
        stmt = stmt.where(AssemblyRecord.status == status_)
    return [kt.record_dict(r) for r in session.scalars(stmt.limit(min(limit, 500))).all()]


class FinishIn(BaseModel):
    photos: list = Field(default_factory=list)
    remark: str | None = None
    # ★ §2.1：未装清单（还剩哪些零件没装上）→ 发运清单 = 1 组装体 + N 个未装零件
    unassembled: list = Field(default_factory=list)


@router.post("/records/{rec_id}/finish")
def finish_assembly(
    rec_id: int,
    body: FinishIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("mfg:edit")),
):
    rec = session.get(AssemblyRecord, rec_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "装配记录不存在")
    kt.finish_assembly(session, rec, photos=body.photos, remark=body.remark, unassembled=body.unassembled)
    audit.log(
        session, user=current, action="finish_assembly", object_type="assembly_record",
        object_ref=str(rec.id), summary=f"装配完成：{rec.project_no} / {rec.equip_no}（{rec.sub_assembly}）",
        ip=client_ip(request),
    )
    session.commit()
    return kt.record_dict(rec)


class DebugIn(BaseModel):
    result: str = Field(default="合格", description="合格 / 有问题")
    note: str | None = None
    photos: list = Field(default_factory=list)


@router.post("/records/{rec_id}/debug")
def debug(
    rec_id: int,
    body: DebugIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("mfg:edit")),
):
    """厂内调试记录（单机调试 / 联调）。"""
    rec = session.get(AssemblyRecord, rec_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "装配记录不存在")
    kt.debug(
        session, rec, actor_id=current.id, result=body.result, note=body.note, photos=body.photos
    )
    audit.log(
        session, user=current, action="debug_assembly", object_type="assembly_record",
        object_ref=str(rec.id),
        summary=f"厂内调试：{rec.project_no} / {rec.equip_no} —— {body.result}"
        + (f"（{body.note}）" if body.note else ""),
        ip=client_ip(request),
    )
    session.commit()
    return kt.record_dict(rec)


@router.get("/workbench")
def workbench(
    project_no: str | None = None,
    session: Session = Depends(get_session),
    _: User = Depends(require_permission("mfg:view")),
):
    """装配台：各设备齐套率 + 装配/调试待办。"""
    records = session.scalars(
        select(AssemblyRecord).order_by(AssemblyRecord.id.desc()).limit(200)
    ).all()
    if project_no:
        records = [r for r in records if r.project_no == project_no]
    overview = kt.overview(session, project_no) if project_no else []
    return {
        "counts": {
            "assembling": len([r for r in records if r.status == "装配中"]),
            "to_debug": len([r for r in records if r.status == "已装配"]),
            "debug_done": len([r for r in records if r.status == "调试完成"]),
        },
        "overview": overview,
        "records": [kt.record_dict(r) for r in records],
    }
