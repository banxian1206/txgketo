"""现场域（《00 方案》§3.3 S8 · 《02 数据模型》§9）。

现场（客户工厂）以**手机为唯一终端**：
  ① 勘测现场 → 定入场时间
  ② 验收来货（含**直发现场**的货，防"对不齐"）
  ③ **每日汇报**（勾选清单 + 拍照 / 录视频）
  ④ 安装完成 → **申请调试**（一个动作；必须派人到现场）
  ⑤ 现场问题 → 触发变更（一切变动都是变更，必须审批）
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# 每日汇报的阶段
SITE_INSTALL = "安装"
SITE_DEBUG_ONE = "单机调试"
SITE_DEBUG_ALL = "联调"
SITE_STAGES = (SITE_INSTALL, SITE_DEBUG_ONE, SITE_DEBUG_ALL)

# 现场问题状态
ISSUE_OPEN = "待处理"
ISSUE_CHANGED = "已转变更"
ISSUE_CLOSED = "已闭环"
ISSUE_STATUS = (ISSUE_OPEN, ISSUE_CHANGED, ISSUE_CLOSED)

# 申请调试
COMMISSION_WAIT = "已申请"
COMMISSION_ONSITE = "已到现场"
COMMISSION_STARTED = "已开始调试"
COMMISSION_DONE = "调试完成"
COMMISSION_STATUS = (COMMISSION_WAIT, COMMISSION_ONSITE, COMMISSION_STARTED, COMMISSION_DONE)

# 现场到货验收结论
SITE_RECEIPT_OK = "齐"
SITE_RECEIPT_SHORT = "缺件"
SITE_RECEIPT_DAMAGED = "破损"
SITE_RECEIPT_RESULTS = (SITE_RECEIPT_OK, SITE_RECEIPT_SHORT, SITE_RECEIPT_DAMAGED)


class SiteSurvey(Base, TimestampMixin):
    """勘测现场：与甲方现场负责人沟通，确定入场时间。"""

    __tablename__ = "site_survey"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    surveyed_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    surveyed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    contact: Mapped[str | None] = mapped_column(String(64))  # 甲方现场负责人 + 电话
    floor_load: Mapped[str | None] = mapped_column(String(128))  # 地面承重
    passage: Mapped[str | None] = mapped_column(String(128))  # 通道 / 吊装口
    power: Mapped[str | None] = mapped_column(String(128))  # 电
    air: Mapped[str | None] = mapped_column(String(128))  # 气
    network: Mapped[str | None] = mapped_column(String(128))  # 网
    enter_date: Mapped[date | None] = mapped_column(Date)  # 约定入场时间
    photos: Mapped[list | None] = mapped_column(JSONB)
    remark: Mapped[str | None] = mapped_column(Text)


class SiteDaily(Base, TimestampMixin):
    """现场每日汇报（安装 + 调试都要每日汇报）：勾选清单 + 照片 / 视频。"""

    __tablename__ = "site_daily"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str | None] = mapped_column(String(16))
    report_date: Mapped[date | None] = mapped_column(Date)
    stage: Mapped[str] = mapped_column(String(16), default=SITE_INSTALL, server_default=SITE_INSTALL)
    done_items: Mapped[list | None] = mapped_column(JSONB)  # 勾选清单
    people: Mapped[int | None] = mapped_column(Numeric(6, 0))  # 现场人数
    photos: Mapped[list | None] = mapped_column(JSONB)
    videos: Mapped[list | None] = mapped_column(JSONB)
    problem: Mapped[str | None] = mapped_column(Text)  # 今天的问题 / 待协调
    reporter_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    remark: Mapped[str | None] = mapped_column(Text)


class SiteIssue(Base, TimestampMixin):
    """现场问题 / 改动单 → 触发变更（必须审批）。"""

    __tablename__ = "site_issue"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str | None] = mapped_column(String(16))
    # ★ G3（09 卷 §3）：问题要能挂到**具体零件**，不是只到设备级。
    #   客户口径：“他肯定是反映这个零件…它是有归属的噱。”图号=物料号（铁律 2），一般只填一个。
    drawing_no: Mapped[str | None] = mapped_column(String(64))  # 图号（自制/定制件）
    item_no: Mapped[str | None] = mapped_column(String(64))  # 物料号（标准件/原材料）
    part_name: Mapped[str | None] = mapped_column(String(128))  # 零件名称快照（展示用，免回查）
    title: Mapped[str] = mapped_column(String(128))
    desc: Mapped[str | None] = mapped_column(Text)
    photos: Mapped[list | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(16), default=ISSUE_OPEN, server_default=ISSUE_OPEN)
    related_change_id: Mapped[int | None] = mapped_column(ForeignKey("change_request.id"))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SiteCommission(Base, TimestampMixin):
    """申请调试（一个动作；必须派人到现场，设备太多远程调不了）。"""

    __tablename__ = "site_commission"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    request_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    request_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dispatch_to: Mapped[str | None] = mapped_column(String(128))  # 派谁去（调试工程师）
    plan_date: Mapped[date | None] = mapped_column(Date)
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default=COMMISSION_WAIT, server_default=COMMISSION_WAIT)
    photos: Mapped[list | None] = mapped_column(JSONB)
    remark: Mapped[str | None] = mapped_column(Text)


class SiteIncoming(Base, TimestampMixin):
    """现场到货验收（直发改客户现场的货，在这里清点）。"""

    __tablename__ = "site_incoming"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    receipt_id: Mapped[int | None] = mapped_column(ForeignKey("goods_receipt.id", ondelete="CASCADE"))
    result: Mapped[str] = mapped_column(String(16))
    shortage_detail: Mapped[list | None] = mapped_column(JSONB)
    photos: Mapped[list | None] = mapped_column(JSONB)
    received_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    remark: Mapped[str | None] = mapped_column(Text)
