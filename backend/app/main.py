"""同兴高科项目管理系统 · 后端入口。"""

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import (
    acceptance,
    assembly,
    auth,
    changes,
    engineering,
    health,
    initiation,
    library,
    manufacturing,
    mobile,
    numbering,
    notifications,
    platform,
    programs,
    project,
    reviews,
    service,
    shipping,
    site,
    suppliers,
    tasks,
    warehouse,
    workbench,
)
from app.core.config import settings
from app.core.errors import ForbiddenOperation
from app.services.acceptance import AcceptanceError
from app.services.change_flow import ChangeFlowError
from app.services.manufacturing import ManufacturingError
from app.services.numbering import NumberingError
from app.services.project_stage import StageError
from app.services.purchase_order import PurchaseOrderError
from app.services.review_flow import ReviewFlowError
from app.services.reviewers import ReviewerError
from app.services.shipping import ShippingError
from app.services.site import SiteError

app = FastAPI(title=settings.app_name, version="0.1.0")

# ★ 业务域错误 → 400（统一处理，别再让路由逐个 try/except）
#   踩过的坑：merge_order(N2)、acceptance.confirm(N25)、site.add_issue(G3) 都因为
#   路由没接住域异常 → **500 空响应**。下面这些处理器一次性盖住整类。


@app.exception_handler(ForbiddenOperation)
async def _forbidden_operation(request: Request, exc: ForbiddenOperation):
    """服务层识别的越权 → 403（与业务规则的 400 区分；AZ-04）。"""
    return JSONResponse(status_code=403, content={"detail": str(exc)})


@app.exception_handler(SiteError)
@app.exception_handler(AcceptanceError)
@app.exception_handler(PurchaseOrderError)
@app.exception_handler(ChangeFlowError)
@app.exception_handler(ReviewFlowError)
@app.exception_handler(ReviewerError)
@app.exception_handler(StageError)
@app.exception_handler(ShippingError)
@app.exception_handler(ManufacturingError)
@app.exception_handler(NumberingError)
async def _domain_error(request: Request, exc: Exception):
    """业务规则错误 → 400（前端能直接展示 `detail`）。

    ★ 全量覆盖 10 个域错误类（2026-09-28 G1）：逐个 route 去 try/except 已经漏过三次
    （N2 merge_order / N25 confirm / G3 add_issue），**不再靠人工记得捕**。
    """
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.middleware("http")
async def _block_impersonated_writes(request, call_next):
    """「以某人身份查看」只能看（06 卷 §4）：带 X-Impersonate 头的写操作一律 403。"""
    if request.headers.get("x-impersonate") and request.method not in ("GET", "HEAD", "OPTIONS"):
        return JSONResponse(status_code=403, content={"detail": "以他人身份查看时只能看，不能操作"})
    return await call_next(request)

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
    acceptance,
    assembly,
    platform,
    project,
    numbering,
    initiation,
    library,
    manufacturing,
    tasks,
    engineering,
    reviews,
    shipping,
    site,
    programs,
    changes,
    mobile,
    notifications,
    workbench,
    service,
    suppliers,
    warehouse,
):
    app.include_router(r.router, prefix=settings.api_prefix)

# 采购工作台 / 到货验收（跨项目，不带 project_no 前缀）
app.include_router(initiation.purchase_router, prefix=settings.api_prefix)


@app.on_event("startup")
def _prepare_upload_dir() -> None:
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
