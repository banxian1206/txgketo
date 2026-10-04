"""验收 API（《00 方案》§3.3 S10 · 《02 数据模型》§10）。

调试完成 → 申请客户验收 → 上传验收资料包 → 客户签字确认 → ★ 自动进入质保期。
权限：写 `acceptance:edit`（项目经理 / 现场 / 交付），读登录即可。
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user, require_permission
from app.core.config import settings
from app.core.db import get_session
from app.models.acceptance import DOC_TYPES, Acceptance, AcceptanceDocument
from app.models.platform import User
from app.services import acceptance as acc_svc
from app.services import audit
from app.services.files import guess_media_type, save_upload

router = APIRouter(prefix="/acceptance", tags=["验收"])


class ApplyIn(BaseModel):
    project_no: str
    remark: str | None = None


@router.post("/apply", status_code=status.HTTP_201_CREATED)
def apply_acceptance(
    body: ApplyIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("acceptance:edit")),
):
    """调试完成 → 申请客户验收。"""
    try:
        row = acc_svc.apply_acceptance(
            session, project_no=body.project_no, actor_id=current.id, remark=body.remark
        )
    except acc_svc.AcceptanceError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="acceptance_apply", object_type="acceptance", object_ref=str(row.id),
        summary=f"申请客户验收：{body.project_no}", ip=client_ip(request),
    )
    session.commit()
    return acc_svc.acceptance_dict(session, row)


@router.get("")
def list_acceptances(
    project_no: str | None = None,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    stmt = select(Acceptance).order_by(Acceptance.id.desc())
    if project_no:
        stmt = stmt.where(Acceptance.project_no == project_no)
    return [acc_svc.acceptance_dict(session, a) for a in session.scalars(stmt.limit(300)).all()]


class DocTypeIn(BaseModel):
    doc_type: str = Field(default="其他")


@router.post("/{acc_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(
    acc_id: int,
    request: Request,
    doc_type: str = Form(default="其他"),
    remark: str | None = Form(default=None),
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("acceptance:edit")),
):
    """上传验收资料包（可多文件；PDF / 扫描件 / 照片都行）。"""
    acc = session.get(Acceptance, acc_id)
    if acc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "验收单不存在")
    if doc_type not in DOC_TYPES:
        doc_type = "其他"
    folder = Path(settings.upload_dir) / acc.project_no / "acceptance" / str(acc.id)
    out = []
    for f in files[:30]:
        stored, name = await save_upload(f, folder)
        row = AcceptanceDocument(
            acceptance_id=acc.id, doc_type=doc_type, filename=name,
            stored_path=stored, uploaded_by=current.id, remark=remark,
        )
        session.add(row)
        out.append(row)
    audit.log(
        session, user=current, action="acceptance_doc", object_type="acceptance", object_ref=str(acc.id),
        summary=f"验收资料包 {acc.project_no}：上传 {len(out)} 个（{doc_type}）", ip=client_ip(request),
    )
    session.commit()
    return [acc_svc.document_dict(d) for d in out]


@router.get("/documents/{doc_id}")
def download_document(
    doc_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    d = session.get(AcceptanceDocument, doc_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "资料不存在")
    path = Path(d.stored_path)
    if not path.exists():
        raise HTTPException(status.HTTP_410_GONE, "文件已不存在")
    return FileResponse(path, media_type=guess_media_type(d.filename), filename=d.filename)


@router.post("/documents/{doc_id}/sign")
def sign_document(
    doc_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("acceptance:edit")),
):
    """标记某个资料已签（客户签字件回传后勾上）。"""
    d = session.get(AcceptanceDocument, doc_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "资料不存在")
    d.is_signed = True
    from datetime import UTC, datetime

    d.signed_at = datetime.now(UTC)
    audit.log(
        session, user=current, action="acceptance_sign", object_type="acceptance_document",
        object_ref=str(doc_id), summary=f"资料已签：{d.filename}", ip=client_ip(request),
    )
    session.commit()
    return acc_svc.document_dict(d)


class ConfirmIn(BaseModel):
    result: str = Field(..., description="通过 / 不通过")
    signed_by: str | None = None
    accepted_at: date | None = None
    remark: str | None = None


@router.post("/{acc_id}/confirm")
def confirm(
    acc_id: int,
    body: ConfirmIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("acceptance:edit")),
):
    """客户确认验收（通过 → 自动进入质保期）。"""
    acc = session.get(Acceptance, acc_id)
    if acc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "验收单不存在")
    if body.result not in ("通过", "不通过"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "结论只能是 通过 / 不通过")
    try:
        acc_svc.confirm(
            session, acc, actor_id=current.id, result=body.result,
            signed_by=body.signed_by, accepted_at=body.accepted_at, remark=body.remark,
        )
    except acc_svc.AcceptanceError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    audit.log(
        session, user=current, action="acceptance_confirm", object_type="acceptance", object_ref=str(acc.id),
        summary=f"客户验收 {acc.project_no}：{body.result}"
        + (f"，质保 {acc.warranty_start} ~ {acc.warranty_end}" if body.result == "通过" else ""),
        ip=client_ip(request),
    )
    session.commit()
    return acc_svc.acceptance_dict(session, acc)


@router.get("/workbench")
def workbench(
    project_no: str | None = Query(default=None),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    # ★ F11（2026-10-04 走查核实）：签字类动作是法律性数据，列表必须能按项目收口
    #   （修前跨项目混排，PM 台点错行的风险是真的）。
    stmt = select(Acceptance).order_by(Acceptance.id.desc())
    if project_no:
        stmt = stmt.where(Acceptance.project_no == project_no)
    rows = session.scalars(stmt.limit(200)).all()
    watch = acc_svc.warranty_watch(session)
    if project_no:
        watch = [w for w in watch if w.get("project_no") == project_no]
    return {
        "counts": {
            "pending": len([a for a in rows if a.status == "待验收"]),
            "passed": len([a for a in rows if a.status == "已通过"]),
            "rejected": len([a for a in rows if a.status == "未通过"]),
        },
        "acceptances": [acc_svc.acceptance_dict(session, a) for a in rows],
        "warranty_watch": watch,
        "project_no": project_no,
    }
