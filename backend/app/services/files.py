"""文件存取小工具（上传 / 下载共用）。"""

from __future__ import annotations

import time
from pathlib import Path

from fastapi import UploadFile

MEDIA_TYPES = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "bmp": "image/bmp",
    "svg": "image/svg+xml",
    "heic": "image/heic",
    "dwg": "application/acad",
    "dxf": "image/vnd.dxf",
    "step": "application/step",
    "stp": "application/step",
    "igs": "application/iges",
    "stl": "model/stl",
    "zip": "application/zip",
    "rar": "application/vnd.rar",
    "7z": "application/x-7z-compressed",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
    "csv": "text/csv",
    "xml": "application/xml",
    "st": "text/plain",
}


def guess_media_type(filename: str | None) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if filename and "." in filename else ""
    return MEDIA_TYPES.get(ext, "application/octet-stream")


def is_image(filename: str | None) -> bool:
    return guess_media_type(filename).startswith("image/")


async def save_upload(file: UploadFile, folder: Path) -> tuple[str, str]:
    """存上传文件 →（stored_path, 原始文件名）。文件名加纳秒前缀防覆盖。"""
    safe = Path(file.filename or "file").name
    folder.mkdir(parents=True, exist_ok=True)
    stored = folder / f"{time.time_ns()}_{safe}"
    stored.write_bytes(await file.read())
    return str(stored), safe
