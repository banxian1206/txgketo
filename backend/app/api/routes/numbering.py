"""发号引擎接口：规则查询、图号解析、图号组装试算。"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_session
from app.models.numbering import NumberRule
from app.models.platform import User
from app.services.numbering import (
    NumberingError,
    compose_mech_drawing_no,
    drawing_level,
    parent_drawing_no,
    parse_drawing_no,
)

router = APIRouter(prefix="/numbering", tags=["发号引擎"])


class RuleOut(BaseModel):
    object_type: str
    name: str
    template: str
    scope: str
    remark: str | None = None


@router.get("/rules", response_model=list[RuleOut])
def list_rules(session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    rows = session.scalars(select(NumberRule).order_by(NumberRule.id)).all()
    return [
        RuleOut(
            object_type=r.object_type,
            name=r.name,
            template=r.template,
            scope=r.scope,
            remark=r.remark,
        )
        for r in rows
    ]


@router.get("/drawing/parse")
def parse(drawing_no: str, _: User = Depends(get_current_user)) -> dict:
    try:
        parsed = parse_drawing_no(drawing_no)
    except NumberingError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "drawing_no": drawing_no,
        "parsed": parsed,
        "level": drawing_level(drawing_no),
        "parent": parent_drawing_no(drawing_no),
    }


@router.get("/drawing/compose")
def compose(
    project_no: str,
    equip_no: str,
    l1: str,
    l2: str,
    l3: str,
    l4: str,
    _: User = Depends(get_current_user),
) -> dict:
    try:
        no = compose_mech_drawing_no(project_no, equip_no, [l1, l2, l3, l4])
    except NumberingError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"drawing_no": no, "level": drawing_level(no), "parent": parent_drawing_no(no)}
