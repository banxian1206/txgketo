"""立项域：项目团队、设备清单、节点计划、长周期采购（依据 00 卷 §3 S1 立项）。

立项要做的三件事：
  ① 统一理解   → project_member（团队任命）
  ② 任务分配   → equipment（01A/02A… 各是什么设备，设备号自动发）
  ③ 节点时间段 → milestone（工程设计从几号到几号…）
  ＋ 长周期采购 → purchase_request(source='长周期')，立项即下单、不走合并
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# 项目内角色（与组织岗位无关：同一个人在不同项目可以是不同角色）
PROJECT_ROLES = (
    "项目经理",
    "技术负责人",
    "机械负责人",
    "电气负责人",
    "程序负责人",
    "工艺负责人",
    "采购负责人",
    "生产负责人",
    "装配负责人",
    "测试负责人",
    "现场负责人",
    "售后负责人",
)

# 设备类型
EQUIPMENT_KINDS = ("单机", "工位", "线体")

# 标准节点（立项时默认带出，日期由项目经理按实际情况定）
DEFAULT_MILESTONES = (
    "工程设计",
    "采购到货",
    "制造",
    "装配与厂内调试",
    "打包发运",
    "现场安装",
    "现场调试",
    "客户验收",
)

MILESTONE_STATUS = ("未开始", "进行中", "已完成", "延期")

# 采购需求来源与状态
REQUEST_SOURCES = ("常规", "长周期", "退货重采")  # 退货重采：退货后回池重新买的需求
# 采购状态线（客户口径）：
#   待采购 --合并/单条下单--> 在途（等货，可分多批）
#     --仓库验收合格--> 待入库 --仓库入库--> 已入库（直发现场：现场已验收）
#     --仓库验收不合格--> 不合格 --采购协商--> 换货（回到在途）/ 退货（结束）
#   仓库只有两个动作：验收（合格/不合格）、入库；到货/验收/入库都是分批的
REQUEST_STATUS = (
    "待采购",
    "在途",
    "待入库",
    "部分到货",
    "已入库",
    "现场已验收",
    "不合格",
    "已退货",
    "已取消",
)

# 到货单状态：验收合格 → 待入库 → 已入库；不合格 → 已换货 / 已退货
RECEIPT_STATUS = ("待入库", "已入库", "现场已验收", "不合格", "已换货", "已退货")

# 采购完成（采购员不用再管）
REQUEST_DONE = ("已入库", "现场已验收")

# 收货地点
DELIVER_TO = ("公司仓库", "直发客户现场")


class ProjectMember(Base, TimestampMixin):
    """项目团队：谁在这个项目里担任什么角色。"""

    __tablename__ = "project_member"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"))
    project_role: Mapped[str] = mapped_column(String(32))
    remark: Mapped[str | None] = mapped_column(String(255))

    __table_args__ = (
        UniqueConstraint("project_no", "project_role", name="uq_project_member_role"),
    )


class Milestone(Base, TimestampMixin):
    """节点计划：项目每个节点的时间段（立项时定下来）。"""

    __tablename__ = "milestone"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(64))
    plan_start: Mapped[date | None] = mapped_column(Date)
    plan_end: Mapped[date | None] = mapped_column(Date)
    actual_start: Mapped[date | None] = mapped_column(Date)
    actual_end: Mapped[date | None] = mapped_column(Date)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    status: Mapped[str] = mapped_column(String(16), default="未开始", server_default="未开始")
    remark: Mapped[str | None] = mapped_column(String(255))


# 采购需求归属（05 卷 §6）：手工申请必带
ATTRIBUTIONS = ("项目", "辅料", "办公用品", "其他")

# 采购需求来源（05 卷 §5）
SOURCE_LONG_LEAD = "长周期"
SOURCE_REGULAR = "常规"  # 设计面手动补跑
SOURCE_DESIGN_RELEASE = "设计发布"  # 机械/电气评审发布触发
SOURCE_CRAFT_RELEASE = "工艺发布"  # 工艺评审发布触发
SOURCE_MANUAL = "手工"  # 手工申请（免审核）
SOURCE_RETRY = "退货重采"


class PurchaseRequest(Base, TimestampMixin):
    """采购需求。

    ★ 长周期件（如 ABB 机器人，2 个月周期、不备货）在立项阶段就下单，
      不走「仓库优先 + 累计合并」那条通道。
    """

    __tablename__ = "purchase_request"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 手工申请可以不挂项目（辅料/办公用品是公司级需求）—— 归属里区分
    project_no: Mapped[str | None] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    equip_no: Mapped[str | None] = mapped_column(String(16))
    # 归属（05 卷 §6）：项目 / 辅料 / 办公用品 / 其他
    attribution: Mapped[str | None] = mapped_column(String(16))
    # 手工申请的申请人（05 卷 §6）
    requester_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    # ★ 零件归属：这条需求是给哪个零件的（图号）；挂设备总装/没零件的为空
    part_no: Mapped[str | None] = mapped_column(String(48))
    # ★ 从标准库里选（引用，不复制名称/型号）—— 库里没有就去库里建
    item_no: Mapped[str] = mapped_column(ForeignKey("item.item_no"))
    qty: Mapped[float | None] = mapped_column(Numeric(14, 3))
    unit: Mapped[str | None] = mapped_column(String(16))
    source: Mapped[str] = mapped_column(String(16), default="长周期", server_default="长周期")
    # ★ 依据哪一次发布冻结出来的（05 卷 §5）：设计发布/工艺发布的需求都带它
    source_release_id: Mapped[int | None] = mapped_column(ForeignKey("design_release.id"))
    # ★ 退货重采：这条待采购需求是从哪条旧需求退货回来的（换供应商重买，留个根）
    origin_request_id: Mapped[int | None] = mapped_column(ForeignKey("purchase_request.id"))
    lead_days: Mapped[int | None] = mapped_column(Integer)  # 采购周期（天）
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("supplier.id"))
    supplier_name: Mapped[str | None] = mapped_column(String(128))  # 下单时的快照
    need_date: Mapped[date | None] = mapped_column(Date)  # 需要到货日期
    expected_date: Mapped[date | None] = mapped_column(Date)  # 预计到货 = 下单 + 周期
    ordered_at: Mapped[date | None] = mapped_column(Date)  # 下单日期
    po_no: Mapped[str | None] = mapped_column(String(64))  # 采购单号（供应商单号或我方单号）
    unit_price: Mapped[float | None] = mapped_column(Numeric(14, 2))  # 单价
    amount: Mapped[float | None] = mapped_column(Numeric(14, 2))  # 金额
    shipped_at: Mapped[date | None] = mapped_column(Date)  # 供应商发货日
    # 收货地点在下单时就定：进公司仓库 / 直发客户现场（直发要填地址）
    deliver_to: Mapped[str | None] = mapped_column(String(16))
    deliver_address: Mapped[str | None] = mapped_column(String(255))
    arrived_at: Mapped[date | None] = mapped_column(Date)  # 到货日
    qty_received: Mapped[float | None] = mapped_column(Numeric(14, 3))  # 实收数量
    status: Mapped[str] = mapped_column(String(16), default="待采购", server_default="待采购")
    is_long_lead: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    remark: Mapped[str | None] = mapped_column(Text)


class GoodsReceipt(Base, TimestampMixin):
    """到货单：东西到了（仓库或直发现场），等验收。

    ★ 验收动作跟着货走：到仓库的由仓库验收，直发现场的由现场验收。
    """

    __tablename__ = "goods_receipt"

    id: Mapped[int] = mapped_column(primary_key=True)
    receipt_no: Mapped[str] = mapped_column(String(32))
    project_no: Mapped[str] = mapped_column(ForeignKey("project.project_no", ondelete="CASCADE"))
    request_id: Mapped[int | None] = mapped_column(ForeignKey("purchase_request.id"))
    item_no: Mapped[str | None] = mapped_column(String(32))
    qty: Mapped[float | None] = mapped_column(Numeric(14, 3))
    unit: Mapped[str | None] = mapped_column(String(16))
    receipt_date: Mapped[date | None] = mapped_column(Date)
    deliver_to: Mapped[str] = mapped_column(String(16), default="公司仓库", server_default="公司仓库")
    status: Mapped[str] = mapped_column(String(16), default="待入库", server_default="待入库")
    inspected_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    inspected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    inspect_note: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(String(64))  # 入库库位
    # ★ 验收与入库拆开：验收合格 → 待入库；入库时记是谁、什么时候入的
    stored_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    stored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 验收不合格后采购的处理结果：换货 / 退货（备注 + 谁、什么时候处理的）
    resolve_note: Mapped[str | None] = mapped_column(Text)
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    remark: Mapped[str | None] = mapped_column(Text)
