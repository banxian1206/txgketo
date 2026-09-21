from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.orm import Session
from fastapi import Depends

from app.core.config import settings
from app.core.db import get_session

router = APIRouter(tags=["health"])


@router.get("/health")
def health(session: Session = Depends(get_session)) -> dict:
    session.execute(text("select 1"))
    return {"status": "ok", "app": settings.app_name, "db": "ok"}
