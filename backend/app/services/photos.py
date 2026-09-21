"""拍照上传 / 取回（S5 制造、S7 发运、S8 现场… 共用）。

照片以 **token**（相对 upload_dir 的路径）存进 JSONB 列表，取回时带鉴权。
"""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from app.core.config import settings
from app.services.files import guess_media_type, save_upload


def _base() -> Path:
    return Path(settings.upload_dir).resolve()


async def save_photos(files: list[UploadFile], *, project_no: str, area: str, ref: str | None) -> list[dict]:
    """存一批照片 → [{token, filename}]。area 如 manufacturing / shipping / site。"""
    folder = _base() / project_no / area / (ref or "misc")
    out: list[dict] = []
    for f in files[:20]:
        stored, name = await save_upload(f, folder)
        rel = str(Path(stored).resolve().relative_to(_base()))
        out.append({"token": rel, "filename": name})
    return out


def resolve_photo(token: str) -> Path:
    """把 token 还原成磁盘路径（挡掉越权路径）。"""
    base = _base()
    path = (base / token).resolve()
    if not str(path).startswith(str(base)) or not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "照片不存在")
    return path


def media_type_of(path: Path) -> str:
    return guess_media_type(path.name)
