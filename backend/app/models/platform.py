"""平台基础：组织、用户、角色、权限、审计日志（T01）。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, String, Table, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

# 工程部专业（05 卷 §2.1）：用户归属专业 = 任务专业，同一条口径
PROFESSIONS = ("机械", "电气", "程序", "工艺")

# 岗位三级（06 卷 §3）：组员（一级） / 经理（二级） / 总监（三级）
POSITION_MEMBER = "组员"
POSITION_LEAD = "经理"
POSITION_DIRECTOR = "总监"
POSITIONS = (POSITION_MEMBER, POSITION_LEAD, POSITION_DIRECTOR)
# 旧岗位名 → 新三级（迁移兼容）
LEGACY_POSITIONS = {
    "成员": POSITION_MEMBER,
    "设计师": POSITION_MEMBER,
    "组长": POSITION_LEAD,
    "设计组长": POSITION_LEAD,
    "主管": POSITION_LEAD,
    "部门负责人": POSITION_DIRECTOR,
    "工程总监": POSITION_DIRECTOR,
}

# 部门（org 顶级 code）→ 总监可勾的角色（06 卷 §4.1）
DEPT_ROLE_CODES: dict[str, tuple[str, ...]] = {
    "SALES": ("SALES", "SCHEME"),
    "SCHEME": ("SCHEME", "SALES"),
    "ENG": ("DESIGN", "DESIGN_AUDIT", "CRAFT", "PM"),
    "PURCHASE": ("PURCHASE", "PURCHASE_LEAD"),
    "WH": ("WAREHOUSE",),
    "MFG": ("MFG", "ASSY"),
    "ASSY": ("MFG", "ASSY"),
    "QC": ("QC",),
    "DELIVERY": ("DELIVERY",),
    "SITE": ("SITE",),
    "SERVICE": ("SERVICE",),
    "GM": ("GM", "PM"),
    "FIN": ("FIN",),
}


class Org(Base, TimestampMixin):
    """组织/部门/车间/仓库/小组。"""

    __tablename__ = "org"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(64))
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("org.id"))
    kind: Mapped[str | None] = mapped_column(String(32))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")


class User(Base, TimestampMixin):
    """用户。注意：账号由"专职操作岗"持有（领料员/系统专员），不给每个一线工人开号。"""

    __tablename__ = "app_user"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(128))
    name: Mapped[str] = mapped_column(String(64))
    phone: Mapped[str | None] = mapped_column(String(32))
    org_id: Mapped[int | None] = mapped_column(ForeignKey("org.id"))
    # 专业（工程部用）：机械/电气/程序/工艺
    profession: Mapped[str | None] = mapped_column(String(16))
    # 岗位三级（06 卷 §3）：组员 / 经理 / 总监
    position: Mapped[str | None] = mapped_column(String(32))
    # 称谓（可选填，如“设计师”“销售员”），只影响显示
    title: Mapped[str | None] = mapped_column(String(32))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    remark: Mapped[str | None] = mapped_column(String(255))

    roles: Mapped[list[Role]] = relationship(secondary=lambda: user_role, lazy="selectin")


class Role(Base, TimestampMixin):
    __tablename__ = "role"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(64))
    remark: Mapped[str | None] = mapped_column(String(255))

    permissions: Mapped[list[Permission]] = relationship(
        secondary=lambda: role_permission, lazy="selectin"
    )


class Permission(Base):
    __tablename__ = "permission"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(64))
    module: Mapped[str] = mapped_column(String(32))


user_role = Table(
    "user_role",
    Base.metadata,
    Column("user_id", ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", ForeignKey("role.id", ondelete="CASCADE"), primary_key=True),
)

role_permission = Table(
    "role_permission",
    Base.metadata,
    Column("role_id", ForeignKey("role.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_id", ForeignKey("permission.id", ondelete="CASCADE"), primary_key=True),
)


class AuditLog(Base):
    """操作日志：所有写操作留痕（谁、何时、对什么、改了什么）。"""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    username: Mapped[str | None] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(32))
    object_type: Mapped[str | None] = mapped_column(String(64))
    object_ref: Mapped[str | None] = mapped_column(String(128))
    summary: Mapped[str | None] = mapped_column(Text)
    detail: Mapped[dict | None] = mapped_column(JSONB)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# ============================================================================
# 系统设置（KV）—— 现在只有「外部集成 / OCR」在用
# ============================================================================

# ★ 允许写入的键**白名单**（防止这个 KV 变成什么都能塞的杂物间）。
#   新加一个键时，同时在这里登记 + 在 `services/settings.py` 里写清它能存什么。
SETTING_OCR_API = "ocr.api"      # none / dashscope / zhipu
SETTING_OCR_KEY = "ocr.key"      # ★ 敏感：接口**永不回传原文**，只能整体替换或清空
SETTING_OCR_MODEL = "ocr.model"  # 如 glm-4v-flash / qwen-vl-ocr
# ★ 「上次测试连接的结果」—— 因为 `available` 只说明"配没配"，**不说明"能不能用"**：
#   实测踩过：Key 已失效但 available=true，面板显示「可用」，真调才 401。
SETTING_OCR_LAST_TEST = "ocr.last_test"  # 形如 "<iso>|ok" / "<iso>|fail:<原因>"
SETTING_KEYS = (SETTING_OCR_API, SETTING_OCR_KEY, SETTING_OCR_MODEL, SETTING_OCR_LAST_TEST)


class AppSetting(Base, TimestampMixin):
    """系统设置（K-V）。★ 敏感值（如 API Key）只存不读回原文，见 `services/settings.py`。"""

    __tablename__ = "app_setting"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
