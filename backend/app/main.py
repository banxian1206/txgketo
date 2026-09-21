"""同兴高科项目管理系统 · 后端入口。"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    auth,
    changes,
    engineering,
    health,
    initiation,
    library,
    mobile,
    numbering,
    platform,
    programs,
    project,
    reviews,
    suppliers,
    tasks,
    warehouse,
)
from app.core.config import settings

app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (
    health,
    auth,
    platform,
    project,
    numbering,
    initiation,
    library,
    tasks,
    engineering,
    reviews,
    programs,
    changes,
    mobile,
    suppliers,
    warehouse,
):
    app.include_router(r.router, prefix=settings.api_prefix)

# 采购工作台 / 到货验收（跨项目，不带 project_no 前缀）
app.include_router(initiation.purchase_router, prefix=settings.api_prefix)


@app.on_event("startup")
def _prepare_upload_dir() -> None:
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
