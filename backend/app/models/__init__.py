"""模型聚合导入：让 Base.metadata 拿到全部表（Alembic 自动生成迁移要靠它）。"""

from app.models.base import Base
from app.models.engineering import BomItem, Drawing, DrawingVersion
from app.models.assembly import AssemblyRecord, KittingSnapshot
from app.models.shipment import Shipment, ShipmentItem, ShipmentLine, SiteReceipt
from app.models.site import SiteCommission, SiteDaily, SiteIncoming, SiteIssue, SiteSurvey
from app.models.acceptance import Acceptance, AcceptanceDocument
from app.models.service import ServiceOrder, SparePart, SparePartMove
from app.models.review import DesignRelease, ReviewAction, ReviewTicket, ReviewTicketItem
from app.models.program import EquipmentProgram, EquipmentProgramVersion
from app.models.production import (
    OutsourceTask,
    ProdAcceptance,
    ProdOrder,
    ProdTask,
)
from app.models.change import ChangeRequest
from app.models.notify import Notification
from app.models.warehouse import (
    MaterialIssue,
    MaterialIssueLine,
    StockItem,
    StockMove,
    WarehouseLocation,
)
from app.models.purchasing import Supplier, SupplierCatalog, SupplierQuote
from app.models.purchase_order import (
    PurchaseOrder,
    PurchaseOrderLine,
    compute_line_amounts,
)
from app.models.task import Task
from app.models.library import Item, StdCategory, StdClass
from app.models.initiation import (
    GoodsReceipt,
    Milestone,
    ProjectMember,
    PurchaseRequest,
)
from app.models.numbering import NumberRule, NumberSeq
from app.models.platform import (
    AuditLog,
    Org,
    Permission,
    Role,
    User,
    role_permission,
    user_role,
)
from app.models.project import (
    Attachment,
    Contact,
    Customer,
    Equipment,
    PaymentTerm,
    Project,
)

__all__ = [
    "Acceptance",
    "AcceptanceDocument",
    "Attachment",
    "AssemblyRecord",
    "AuditLog",
    "Base",
    "Contact",
    "Customer",
    "BomItem",
    "Drawing",
    "DrawingVersion",
    "Equipment",
    "GoodsReceipt",
    "Item",
    "KittingSnapshot",
    "StdCategory",
    "StdClass",
    "Supplier",
    "SupplierCatalog",
    "SupplierQuote",
    "MaterialIssue",
    "MaterialIssueLine",
    "StockItem",
    "StockMove",
    "WarehouseLocation",
    "Task",
    "Milestone",
    "ProjectMember",
    "PurchaseRequest",
    "PurchaseOrder",
    "PurchaseOrderLine",
    "compute_line_amounts",
    "ChangeRequest",
    "Notification",
    "DesignRelease",
    "EquipmentProgram",
    "EquipmentProgramVersion",
    "ReviewAction",
    "ReviewTicket",
    "ReviewTicketItem",
    "NumberRule",
    "NumberSeq",
    "OutsourceTask",
    "ShipmentItem",
    "Shipment",
    "ShipmentLine",
    "SiteReceipt",
    "SiteCommission",
    "SiteDaily",
    "SiteIncoming",
    "SiteIssue",
    "SiteSurvey",
    "ServiceOrder",
    "SparePart",
    "SparePartMove",
    "ProdAcceptance",
    "ProdOrder",
    "ProdTask",
    "Org",
    "PaymentTerm",
    "Permission",
    "Project",
    "Role",
    "User",
    "role_permission",
    "user_role",
]
