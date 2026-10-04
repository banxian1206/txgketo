"""工程设计接口：图纸树 / 版本审核发布 / 设计 BOM / 材料 BOM（S3）。"""

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
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_user, require_permission
from app.core.config import settings
from app.core.db import get_session
from app.models.change import CR_DISPATCHED, TARGET_BOM_ITEM, TARGET_DRAWING
from app.models.engineering import (
    BOM_DESIGN,
    BOM_MATERIAL,
    BomItem,
    Drawing,
    DrawingVersion,
)
from app.models.library import SOURCE_STANDARD, Item
from app.models.platform import User
from app.models.project import Equipment, Project
from app.models.task import Task
from app.services import audit, change_flow
from app.services.files import guess_media_type
from app.services.numbering import (
    EMPTY,
    compose_mech_drawing_no,
    drawing_level,
    next_level_code,
    parse_drawing_no,
)

router = APIRouter(tags=["工程设计"])

SOURCE_KINDS = ("自制件", "外协件", "外购件")


def split_components_parts(
    rows: list[tuple[str, str | None]], root_no: str | None = None
) -> tuple[set[str], set[str]]:
    """把图纸树切成（组件图号集, 零件图号集）—— 全站唯一口径。

    · 零件 = **没有子图**的图纸；组件 = 有子图的图纸
    · 设备总装图（root_no）是设备本身，**不算零件也不算组件**
    · ★ 与“这张图有没有挂标准件”**无关**（2026-09-30 UI 真实场景测试 P1-8：
      过去把挂了标准件的自制件踢出叶子 → 它不计入零件数、也不再被“必须配原材料”检查到，
      实测“有 1 个自制件还没挂原材料（工艺部）”的提醒会在挂上标准件后凭空消失）

    rows: [(drawing_no, parent_drawing_no), ...]
    """
    children: dict[str, int] = {}
    for _no, parent in rows:
        if parent:
            children[parent] = children.get(parent, 0) + 1
    comps = {no for no, _p in rows if no != root_no and children.get(no, 0) > 0}
    parts = {no for no, _p in rows if no != root_no and children.get(no, 0) == 0}
    return comps, parts


def _get_project(session: Session, project_no: str) -> Project:
    p = session.get(Project, project_no)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")
    return p


def _names(session: Session) -> dict[int, str]:
    return {u.id: u.name for u in session.scalars(select(User)).all()}


def _drawing_dict(d: Drawing, names: dict[int, str]) -> dict:
    return {
        "drawing_no": d.drawing_no,
        "project_no": d.project_no,
        "equip_no": d.equip_no,
        "levels": [d.l1, d.l2, d.l3, d.l4],
        "level": drawing_level(d.drawing_no),
        "parent_drawing_no": d.parent_drawing_no,
        "title": d.title,
        "kind": d.kind,
        "qty": float(d.qty) if d.qty is not None else 1,
        "unit": d.unit,
        "source_type": d.source_type,
        "current_version": d.current_version,
        "status": d.status,
        "owner_id": d.owner_id,
        "owner_name": names.get(d.owner_id) if d.owner_id else None,
        "is_part": d.is_part,
        "remark": d.remark,
    }


def _bom_dict(b: BomItem, item: Item | None) -> dict:
    return {
        "id": b.id,
        "parent_ref": b.parent_ref,
        "child_item_no": b.child_item_no,
        "bom_source": b.bom_source,
        "qty": float(b.qty) if b.qty is not None else 1,
        "unit": b.unit or (item.unit if item else None),
        "pos_no": b.pos_no,
        "display_name": item.display_name if item else b.child_item_no,
        "spec_text": item.spec_text if item else None,
        "brand": item.brand if item else None,
        "remark": b.remark,
        # 冻结线（05 卷 §8.2）：草稿 / 审核中 / 已冻结
        "status": b.status,
        "owner_id": b.owner_id,
        "frozen_release_id": b.frozen_release_id,
    }


# ============================================================================
# 图纸树（= 设计 BOM 骨架）
# ============================================================================


@router.get("/projects/{project_no}/equipment/{equip_no}/design")
def get_design_tree(
    project_no: str,
    equip_no: str,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """设备的设计工作面：图纸树 + 挂着的标准件 + 材料 BOM + 完整度。"""
    _get_project(session, project_no)
    drawings = session.scalars(
        select(Drawing).where(Drawing.project_no == project_no, Drawing.equip_no == equip_no)
    ).all()
    names = _names(session)
    # ★ 走查 2026-10-04：BOM 行必须按**本设备**收口。原来只按 `project_no` 取整个项目的 BOM，
    #   同型第二台（01B）出现后，01A/01B 的设计面会互相看到对方的标准件/材料（计数翻倍、列表重复）。
    #   用本设备图纸集合过滤（并保留 `parent_ref == 设备号` 的历史写法兜底）。
    equip_refs = {d.drawing_no for d in drawings} | {equip_no}
    bom_rows = session.scalars(
        select(BomItem).where(BomItem.project_no == project_no, BomItem.parent_ref.in_(equip_refs))
    ).all()
    items = {i.item_no: i for i in session.scalars(select(Item)).all()}

    # 按图号排序即是树的顺序（层次码天然有序）
    tree = [_drawing_dict(d, names) for d in sorted(drawings, key=lambda x: x.drawing_no)]

    # 在办的改版申请（05 卷 §7）：挂到具体图纸上，前端据此显示「已批准可改版 / 改版中」
    active = change_flow.active_map(session, project_no, equip_no)
    cr_task_ids = {c.change_task_id for c in active.values() if c.change_task_id}
    cr_tasks = (
        {t.id: t for t in session.scalars(select(Task).where(Task.id.in_(cr_task_ids))).all()}
        if cr_task_ids
        else {}
    )
    for d in tree:
        cr = active.get((TARGET_DRAWING, d["drawing_no"]))
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

    std_bom = [_bom_dict(b, items.get(b.child_item_no)) for b in bom_rows if b.bom_source == BOM_DESIGN]
    mat_bom = [_bom_dict(b, items.get(b.child_item_no)) for b in bom_rows if b.bom_source == BOM_MATERIAL]
    # BOM 行的在办改版申请（05 卷 §7）：冻结行才能提改版
    for b in std_bom + mat_bom:
        cr = active.get((TARGET_BOM_ITEM, str(b["id"])))
        b["change_request"] = (
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

    # ---- 完整度检查 ----
    in_tree = {d["drawing_no"] for d in tree}
    root_no = compose_mech_drawing_no(project_no, equip_no, [EMPTY] * 4)

    # 孤儿：父级既不是总装图，也不在树里（BOM 断链）
    orphans = [
        d["drawing_no"]
        for d in tree
        if d["parent_drawing_no"] and d["parent_drawing_no"] != root_no and d["parent_drawing_no"] not in in_tree
    ]

    # 叶子 = 零件（不再按层级码判断 —— 零件可以挂在任意层级）
    #
    # ★ 2026-09-30 UI 真实场景测试 P1-8：原来叶子还额外要求“没有标准件行”：
    #   一个自制件（如机架框架）只要挂了标准件（螺丝/导轨），它就被踢出 `leaves`：
    #     · 不再计入零件数（实测：设备头显示“零件 1（自制1/外协0）”，其实是 3 个零件）
     #     · **不再被“自制件必须配原材料”检查到**（实测：挂上标准件后，那条
     #       “有 1 个自制件还没挂原材料（工艺部）”的提醒直接消失了）—— 工艺漏配材料从此隐形。
    #   正确口径：叶子只看“有没有子图”；总装图是设备本身，不算零件/组件。
    children_of: dict[str, int] = {}
    for d in tree:
        if d["parent_drawing_no"]:
            children_of[d["parent_drawing_no"]] = children_of.get(d["parent_drawing_no"], 0) + 1
    std_count_of: dict[str, int] = {}
    for b in std_bom:
        std_count_of[b["parent_ref"]] = std_count_of.get(b["parent_ref"], 0) + 1
    # 组件/零件的判定走全站唯一口径（不看有没有挂标准件 —— P1-8）
    classify_parts = split_components_parts(
        [(d["drawing_no"], d["parent_drawing_no"]) for d in tree], root_no
    )

    non_root = [d for d in tree if d["drawing_no"] != root_no]
    part_nos = classify_parts[1]
    leaves = [d for d in non_root if d["drawing_no"] in part_nos]
    components = [d for d in non_root if d["drawing_no"] in classify_parts[0]]
    # 空壳：既没有子件、也没有标准件的“组件”（比如只有一张总装图，下面什么都没有）
    empty_shells = [
        d["drawing_no"]
        for d in tree
        if d["drawing_no"] == root_no
        and children_of.get(root_no, 0) == 0
        and std_count_of.get(root_no, 0) == 0
    ]

    # 自制件必须有材料 BOM（工艺部的活）
    parts_without_material = [
        p["drawing_no"]
        for p in leaves
        if p["source_type"] == "自制件"
        and not any(b["parent_ref"] == p["drawing_no"] for b in mat_bom)
    ]
    unpublished = [d["drawing_no"] for d in tree if d["status"] != "已发布"]

    design_done = bool(tree) and not orphans and not empty_shells and not unpublished
    material_done = bool(leaves) and not parts_without_material
    if not tree:
        state = "未开始"
    elif design_done and material_done:
        state = "BOM完整"
    elif design_done:
        state = "设计BOM已提交"
    else:
        state = "设计中"

    equip = session.scalar(
        select(Equipment).where(Equipment.project_no == project_no, Equipment.equip_no == equip_no)
    )
    root_exists = any(d["drawing_no"] == root_no for d in tree)
    return {
        "project_no": project_no,
        "equip_no": equip_no,
        # 设备总装图永远是树根（还没建时 exists=false，新增第一个子件会自动建出来）
        "root": {
            "drawing_no": root_no,
            "title": f"{equip.equip_name if equip else equip_no}总装图",
            "equip_no": equip_no,
            "exists": root_exists,
        },
        "tree": tree,
        "std_bom": std_bom,
        "material_bom": mat_bom,
        "state": state,
        "issues": {
            "orphans": orphans,
            "empty_shells": empty_shells,
            "unpublished": unpublished,
            "parts_without_material": parts_without_material,
        },
        "counts": {
            "drawings": len(tree),
            # 组件 = 有子图的非总装图；零件 = 没子图的非总装图
            "components": len(components),
            "parts": len(leaves),
            "self_made": len([p for p in leaves if p["source_type"] == "自制件"]),
            "outsource": len([p for p in leaves if p["source_type"] == "外协件"]),
            "std_items": len(std_bom),
            "materials": len(mat_bom),
        },
    }


class DrawingIn(BaseModel):
    parent_drawing_no: str | None = Field(
        default=None, description="挂到哪个父级下；留空表示挂到设备总装（00-00-00-00）"
    )
    title: str = Field(..., description="图纸/零件名称")
    qty: float = Field(default=1, gt=0)
    unit: str = "件"
    source_type: str = Field(
        default="自制件", description="类型：自制件 / 外协件 / 外购件（标准件不走这里，从标准库选）"
    )
    kind: str = "机械"


@router.post("/projects/{project_no}/equipment/{equip_no}/drawings", status_code=status.HTTP_201_CREATED)
def add_drawing(
    project_no: str,
    equip_no: str,
    body: DrawingIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("design:edit")),
):
    """新增组件/零件：**图号按父级 + 同级下一序号自动生成**（不让人手填）。"""
    _get_project(session, project_no)
    equip = session.scalar(
        select(Equipment).where(Equipment.project_no == project_no, Equipment.equip_no == equip_no)
    )
    if equip is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"项目下没有设备 {equip_no}")
    if body.source_type not in SOURCE_KINDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"来源类型只能是：{'/'.join(SOURCE_KINDS)}")

    existing = session.scalars(
        select(Drawing).where(Drawing.project_no == project_no, Drawing.equip_no == equip_no)
    ).all()
    used = {d.drawing_no for d in existing}

    # 父级：留空 → 设备总装 00-00-00-00；否则用给定图号
    parent_no = body.parent_drawing_no or compose_mech_drawing_no(project_no, equip_no, [EMPTY] * 4)
    if body.parent_drawing_no and body.parent_drawing_no not in used:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"父级图号不存在：{body.parent_drawing_no}")

    parent_levels = list(parse_drawing_no(parent_no)["levels"]) if body.parent_drawing_no else [EMPTY] * 4
    # 新节点放在父级的下一层
    depth = sum(1 for x in parent_levels if x != EMPTY)  # 父级已用层数
    if depth >= 4:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "父级已经是零件层，下面不能再挂")
    siblings = [d for d in existing if d.parent_drawing_no == parent_no]
    code = next_level_code([d.__getattribute__(f"l{depth + 1}") for d in siblings])
    levels = list(parent_levels)
    levels[depth] = code

    # 树根：设备总装图（00-00-00-00），第一次出图时自动建
    root_no = compose_mech_drawing_no(project_no, equip_no, [EMPTY] * 4)
    if root_no not in used:
        session.add(
            Drawing(
                drawing_no=root_no,
                project_no=project_no,
                equip_no=equip_no,
                l1=EMPTY,
                l2=EMPTY,
                l3=EMPTY,
                l4=EMPTY,
                parent_drawing_no=None,
                title=f"{equip.equip_name}总装图",
                kind="机械",
                qty=1,
                unit="台",
                source_type="自制件",
                current_version="V1",
                status="草稿",
                owner_id=current.id,
                is_part=False,
            )
        )
        session.flush()

    drawing_no = compose_mech_drawing_no(project_no, equip_no, levels)
    if drawing_no in used:  # pragma: no cover
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"图号已存在：{drawing_no}")

    row = Drawing(
        drawing_no=drawing_no,
        project_no=project_no,
        equip_no=equip_no,
        l1=levels[0],
        l2=levels[1],
        l3=levels[2],
        l4=levels[3],
        parent_drawing_no=parent_no,
        title=body.title,
        kind=body.kind,
        qty=body.qty,
        unit=body.unit,
        source_type=body.source_type,
        current_version="V1",
        status="草稿",
        owner_id=current.id,
        is_part=depth + 1 >= 4,
    )
    session.add(row)
    # 图号即物料号（01 卷）：同步生成物料行，供采购/库存/BOM 引用
    if session.get(Item, drawing_no) is None:
        session.add(
            Item(
                item_no=drawing_no,
                display_name=f"{body.title}（{drawing_no}）",
                source_type=body.source_type,
                project_no=project_no,
                spec=None,
                spec_text=None,
                unit=body.unit,
            )
        )
    session.flush()
    audit.log(
        session,
        user=current,
        action="create",
        object_type="drawing",
        object_ref=drawing_no,
        summary=f"新增图纸 {drawing_no}（{body.title}）"
        f"{'，挂在 ' + parent_no if body.parent_drawing_no else '，挂在设备总装下'}"
        f"· 数量 {body.qty} · {body.source_type}",
        ip=client_ip(request),
    )
    session.commit()
    return _drawing_dict(row, _names(session))


class DrawingPatch(BaseModel):
    title: str | None = None
    qty: float | None = None
    unit: str | None = None
    source_type: str | None = None
    remark: str | None = None


@router.patch("/drawings/{drawing_no}")
def update_drawing(
    drawing_no: str,
    body: DrawingPatch,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("design:edit")),
):
    row = session.get(Drawing, drawing_no)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "图纸不存在")
    if row.status == "审核中":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "审核中的图纸不可修改 —— 先撤回或等退回（05 卷 §3.1）",
        )
    if row.status == "已发布" and (body.title or body.qty or body.source_type):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "已发布的正式版本不可覆盖 —— 请先「改版」出新版本再改（02 卷 §3.2 正式版本不可覆盖）",
        )
    labels = {"title": "名称", "qty": "数量", "unit": "单位", "source_type": "类型", "remark": "备注"}
    changes = []
    for field, new_value in body.model_dump(exclude_unset=True).items():
        old = getattr(row, field)
        if old == new_value:
            continue
        changes.append(
            {"field": field, "label": labels.get(field, field), "old": str(old or "—"), "new": str(new_value or "—")}
        )
        setattr(row, field, new_value)
    if row.source_type != "自制件" and "source_type" in body.model_dump(exclude_unset=True):
        item = session.get(Item, drawing_no)
        if item:
            item.source_type = row.source_type
    if row.title:
        item = session.get(Item, drawing_no)
        if item:
            item.display_name = f"{row.title}（{drawing_no}）"
    if changes:
        audit.log(
            session,
            user=current,
            action="update",
            object_type="drawing",
            object_ref=drawing_no,
            summary=f"编辑图纸 {drawing_no}：" + "；".join(f"{c['label']} {c['old']} → {c['new']}" for c in changes),
            detail={"changes": changes},
            ip=client_ip(request),
        )
    session.commit()
    return _drawing_dict(row, _names(session))


@router.delete("/drawings/{drawing_no}")
def delete_drawing(
    drawing_no: str,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("design:edit")),
):
    row = session.get(Drawing, drawing_no)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "图纸不存在")
    if row.status == "审核中":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "审核中的图纸不能删 —— 先撤回或等审核结果")
    if row.status == "已发布":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "已发布的图纸不能删除（会作废处理）")
    children = session.scalars(
        select(Drawing).where(Drawing.parent_drawing_no == drawing_no)
    ).all()
    if children:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"下面还挂着 {len(children)} 个子件，先处理子件"
        )
    session.delete(row)
    audit.log(
        session,
        user=current,
        action="delete",
        object_type="drawing",
        object_ref=drawing_no,
        summary=f"删除图纸 {drawing_no}（{row.title}）",
        ip=client_ip(request),
    )
    session.commit()
    return {"ok": True}


# ============================================================================
# 版本流转：草稿 →（评审单两级审核）→ 发布（= 冻结）；已发布 → 改版（V2）
# ============================================================================


def _current_version_row(session: Session, drawing_no: str) -> DrawingVersion | None:
    return session.scalar(
        select(DrawingVersion).where(
            DrawingVersion.drawing_no == drawing_no, DrawingVersion.is_current.is_(True)
        )
    )


@router.post("/drawings/{drawing_no}/draft")
async def upload_drawing_draft(
    drawing_no: str,
    file: UploadFile | None = File(default=None),
    change_reason: str = Form(""),
    request: Request = None,  # type: ignore[assignment]
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("design:edit")),
):
    """上传/更新草稿文件（05 卷 §3.1）。

    这里**不改变审核状态**：草稿可以反复覆盖；
    提交评审后在评审单里勾选这张图，两级审核通过才发布（= 冻结）。
    """
    row = session.get(Drawing, drawing_no)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "图纸不存在")
    if row.status != "草稿":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"只有草稿能上传（当前：{row.status}）—— 已发布的先「改版」，审核中的先撤回",
        )

    ver = _current_version_row(session, drawing_no)
    if ver is None:
        ver = DrawingVersion(drawing_no=drawing_no, version=row.current_version, is_current=True)
        session.add(ver)
    if file is not None:
        safe = Path(file.filename or "drawing").name
        target_dir = Path(settings.upload_dir) / row.project_no / "drawings" / drawing_no
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
        object_type="drawing",
        object_ref=drawing_no,
        summary=f"上传草稿 {drawing_no}（{ver.version}）"
        + (f"，附件《{ver.filename}》" if ver.filename else "")
        + (f"，说明：{change_reason}" if change_reason else ""),
        ip=client_ip(request) if request else None,
    )
    session.commit()
    return _drawing_dict(row, _names(session))


@router.post("/drawings/{drawing_no}/new-version")
def new_version(
    drawing_no: str,
    change_reason: str = Form(""),
    request: Request = None,  # type: ignore[assignment]
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    """改版：已发布的图号不变，版本 V1 → V2，回到草稿走审核发布流程。

    05 卷 §7：冻结版本改版必须先提改版申请 → 总监批准 → 下发任务 → 才能出新版。
    """
    row = session.get(Drawing, drawing_no)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "图纸不存在")
    if row.status not in ("已发布", "已作废"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "只有已发布的图纸需要改版")
    cr = change_flow.approved_for(session, TARGET_DRAWING, drawing_no)
    if cr is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "冻结图纸改版必须先提「改版申请」并等总监批准、下发任务",
        )
    if cr.status != CR_DISPATCHED:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"改版申请 {cr.cr_no} 已批准，等总监下发改版任务后再出新版"
        )
    task = session.get(Task, cr.change_task_id) if cr.change_task_id else None
    if not current.is_superuser and (task is None or task.owner_id != current.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "只有这条改版任务的负责人能出新版")
    n = int(row.current_version.lstrip("V") or "1") + 1
    prev = session.scalar(
        select(DrawingVersion).where(
            DrawingVersion.drawing_no == drawing_no, DrawingVersion.is_current.is_(True)
        )
    )
    if prev:
        prev.is_current = False
    new_ver = DrawingVersion(
        drawing_no=drawing_no,
        version=f"V{n}",
        change_reason=change_reason,
        submitted_by=None,
        is_current=True,
    )
    session.add(new_ver)
    row.current_version = f"V{n}"
    row.status = "草稿"
    audit.log(
        session,
        user=current,
        action="new_version",
        object_type="drawing",
        object_ref=drawing_no,
        summary=f"改版 {drawing_no}：V{n - 1} → V{n}"
        + (f"，原因：{change_reason}" if change_reason else "")
        + "（图号不变，走审核发布后生效）",
        ip=client_ip(request) if request else None,
    )
    session.commit()
    return _drawing_dict(row, _names(session))


@router.get("/drawings/{drawing_no}/versions")
def list_versions(
    drawing_no: str, session: Session = Depends(get_session), _: User = Depends(get_current_user)
):
    rows = session.scalars(
        select(DrawingVersion)
        .where(DrawingVersion.drawing_no == drawing_no)
        .order_by(DrawingVersion.id.desc())
    ).all()
    names = _names(session)
    return [
        {
            "version": v.version,
            "filename": v.filename,
            "change_reason": v.change_reason,
            "submitted_by": names.get(v.submitted_by) if v.submitted_by else None,
            "submitted_at": v.submitted_at,
            "reviewed_by": names.get(v.reviewed_by) if v.reviewed_by else None,
            "reviewed_at": v.reviewed_at,
            "published_at": v.published_at,
            "review_note": v.review_note,
            "is_current": v.is_current,
        }
        for v in rows
    ]


@router.get("/drawings/{drawing_no}/file")
def get_drawing_file(
    drawing_no: str, session: Session = Depends(get_session), _: User = Depends(get_current_user)
):
    """看/下电子图纸（手机端看图比对、外协随单）：返回当前版本的附件。"""
    row = session.get(Drawing, drawing_no)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "图纸不存在")
    ver = _current_version_row(session, drawing_no)
    if ver is None or not ver.file_path:
        ver = session.scalar(
            select(DrawingVersion)
            .where(DrawingVersion.drawing_no == drawing_no, DrawingVersion.file_path.is_not(None))
            .order_by(DrawingVersion.id.desc())
        )
    if ver is None or not ver.file_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{drawing_no} 还没上传图纸文件")
    path = Path(ver.file_path)
    if not path.exists():
        raise HTTPException(status.HTTP_410_GONE, "图纸文件已不存在")
    return FileResponse(
        path, media_type=guess_media_type(ver.filename), filename=ver.filename or f"{drawing_no}.pdf"
    )


# ============================================================================
# BOM 行（标准件 / 原材料）
# ============================================================================


class BomIn(BaseModel):
    parent_ref: str = Field(..., description="父级图号，或设备号（挂到总装时）")
    child_item_no: str = Field(..., description="标准库物料编码")
    qty: float = Field(default=1, gt=0)
    pos_no: str | None = None
    remark: str | None = None


def _add_bom(session: Session, project_no: str, body: BomIn, source: str, current: User, ip: str | None) -> BomItem:
    item = session.get(Item, body.child_item_no)
    if item is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"标准库里没有 {body.child_item_no} —— 请先去标准库把它建出来",
        )
    parent_ok = session.scalar(
        select(Drawing).where(Drawing.drawing_no == body.parent_ref)
    ) or session.scalar(
        select(Equipment).where(
            Equipment.project_no == project_no, Equipment.equip_no == body.parent_ref
        )
    )
    if parent_ok is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"父级不存在：{body.parent_ref}")
    dup = session.scalar(
        select(BomItem).where(
            BomItem.parent_ref == body.parent_ref,
            BomItem.child_item_no == body.child_item_no,
            BomItem.bom_source == source,
        )
    )
    if dup is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{body.parent_ref} 下已经有 {item.display_name} 了，改数量即可",
        )
    row = BomItem(
        project_no=project_no,
        parent_ref=body.parent_ref,
        child_item_no=body.child_item_no,
        bom_source=source,
        qty=body.qty,
        unit=item.unit,
        pos_no=body.pos_no,
        remark=body.remark,
        owner_id=current.id,
    )
    session.add(row)
    session.flush()
    label = "标准件" if source == BOM_DESIGN else "材料"
    audit.log(
        session,
        user=current,
        action="create",
        object_type="bom_item",
        object_ref=f"{body.parent_ref}/{body.child_item_no}",
        summary=f"加{label}：{body.parent_ref} ← {item.display_name} × {body.qty}",
        ip=ip,
    )
    return row


@router.post("/projects/{project_no}/bom/std", status_code=status.HTTP_201_CREATED)
def add_std_bom(
    project_no: str,
    body: BomIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("design:edit")),
):
    """设计 BOM：给组件/零件挂标准件（从标准库选）。"""
    _get_project(session, project_no)
    row = _add_bom(session, project_no, body, BOM_DESIGN, current, client_ip(request))
    session.commit()
    item = session.get(Item, row.child_item_no)
    return _bom_dict(row, item)


@router.post("/projects/{project_no}/bom/material", status_code=status.HTTP_201_CREATED)
def add_material_bom(
    project_no: str,
    body: BomIn,
    request: Request,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("design:edit")),
):
    """材料 BOM（工艺部）：给自制件挂原材料。"""
    _get_project(session, project_no)
    item = session.get(Item, body.child_item_no)
    if item is not None and item.source_type != SOURCE_STANDARD:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "材料 BOM 只能挂标准库里的物料")
    row = _add_bom(session, project_no, body, BOM_MATERIAL, current, client_ip(request))
    session.commit()
    return _bom_dict(row, session.get(Item, row.child_item_no))


@router.delete("/bom/{bom_id}")
def remove_bom(
    bom_id: int,
    session: Session = Depends(get_session),
    current: User = Depends(require_permission("design:edit")),
):
    row = session.get(BomItem, bom_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "BOM 行不存在")
    if row.status != "草稿":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"这条 BOM 行当前是「{row.status}」，不能直接删（冻结内容只能走改版流程）",
        )
    item = session.get(Item, row.child_item_no)
    session.delete(row)
    audit.log(
        session,
        user=current,
        action="delete",
        object_type="bom_item",
        object_ref=f"{row.parent_ref}/{row.child_item_no}",
        summary=f"删除 BOM 行：{row.parent_ref} ← {item.display_name if item else row.child_item_no}",
    )
    session.commit()
    return {"ok": True}


# ============================================================================
# 我的设计任务 → 打开对应设备的设计工作面
# ============================================================================


@router.get("/projects/{project_no}/design-overview")
def design_overview(
    project_no: str, session: Session = Depends(get_session), _: User = Depends(get_current_user)
):
    """项目下每台设备的设计进度（项目经理一眼看哪台设计到哪了，并且能点进去）。"""
    _get_project(session, project_no)
    equipments = session.scalars(
        select(Equipment).where(Equipment.project_no == project_no).order_by(Equipment.equip_no)
    ).all()
    drawings = session.scalars(select(Drawing).where(Drawing.project_no == project_no)).all()
    bom_rows = session.scalars(select(BomItem).where(BomItem.project_no == project_no)).all()

    out = []
    for eq in equipments:
        ds = [d for d in drawings if d.equip_no == eq.equip_no]
        if not ds:
            out.append(
                {
                    "equip_no": eq.equip_no,
                    "equip_name": eq.equip_name,
                    "state": "未开始",
                    "drawings": 0,
                    "parts": 0,
                    "unpublished": 0,
                    "parts_without_material": 0,
                }
            )
            continue
        in_tree = {d.drawing_no for d in ds}
        root_no = compose_mech_drawing_no(project_no, eq.equip_no, [EMPTY] * 4)
        children: dict[str, int] = {}
        for d in ds:
            if d.parent_drawing_no:
                children[d.parent_drawing_no] = children.get(d.parent_drawing_no, 0) + 1
        # ★ 走查 2026-10-04：同 get_design_tree —— BOM 行按本设备图纸收口，别串到别的设备
        refs = {b.parent_ref for b in bom_rows if b.bom_source == BOM_DESIGN and b.parent_ref in in_tree}
        mats = {b.parent_ref for b in bom_rows if b.bom_source == BOM_MATERIAL and b.parent_ref in in_tree}
        # ★ P1-8：同 design 详情页的口径（全站唯一口径函数）—— 叶子只看“有没有子图”，
        #   总装图不算零件；不能因为挂了标准件就把自制件踢出“待配材料”的检查。
        _comps, part_nos = split_components_parts(
            [(d.drawing_no, d.parent_drawing_no) for d in ds], root_no
        )
        leaves = [d for d in ds if d.drawing_no in part_nos]
        missing_mat = [p for p in leaves if p.source_type == "自制件" and p.drawing_no not in mats]
        unpublished = [d for d in ds if d.status != "已发布"]
        orphans = [
            d
            for d in ds
            if d.parent_drawing_no
            and d.parent_drawing_no != root_no
            and d.parent_drawing_no not in in_tree
        ]
        empty_root = root_no in in_tree and children.get(root_no, 0) == 0 and root_no not in refs
        design_done = not orphans and not unpublished and not empty_root
        material_done = bool(leaves) and not missing_mat
        state = (
            "BOM完整" if design_done and material_done else "设计BOM已提交" if design_done else "设计中"
        )
        out.append(
            {
                "equip_no": eq.equip_no,
                "equip_name": eq.equip_name,
                "state": state,
                "drawings": len(ds),
                "parts": len(leaves),
                "unpublished": len(unpublished),
                "parts_without_material": len(missing_mat),
            }
        )
    return out


@router.get("/my-design-equipment")
def my_design_equipment(
    session: Session = Depends(get_session), current: User = Depends(get_current_user)
):
    """我负责设计的设备（从设计任务推导），点了直接进设计工作面。"""
    from app.models.task import Task

    rows = session.scalars(
        select(Task).where(
            Task.owner_id == current.id, Task.task_type == "设计", Task.status != "已完成"
        )
    ).all()
    return [
        {
            "task_no": t.task_no,
            "project_no": t.project_no,
            "equip_no": t.equip_no,
            "profession": t.profession,
            "title": t.title,
            "status": t.status,
        }
        for t in rows
    ]
