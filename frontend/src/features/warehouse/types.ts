// features/warehouse/types.ts —— 仓库域共享类型（重构 2.0：原 PC/移动各写一份，统一为超集）
import type { GoodsReceiptRow } from '../../api/client'

export interface IncomingRow {
  id: number
  project_no: string | null
  attribution?: string | null
  project_name?: string | null
  equip_no?: string | null
  equip_name?: string | null
  item_no: string
  display_name: string
  spec_text?: string | null
  qty: number
  qty_received: number
  unit?: string | null
  po_no?: string | null
  supplier_name?: string | null
  need_date?: string | null
  expected_date?: string | null
  overdue: boolean
}

export type StorageRow = GoodsReceiptRow

export interface Workbench {
  incoming: IncomingRow[]
  pending_storage: StorageRow[]
  pending_issues: IssueRow[]
  stock: { item_kinds: number; out_of_stock: number }
}

export interface Workbench {
  incoming: IncomingRow[]
  pending_storage: StorageRow[]
  pending_issues: IssueRow[]
  stock: { item_kinds: number; out_of_stock: number }
}

export interface StockRow {
  id: number; item_no: string; display_name: string; spec_text?: string | null; unit?: string | null
  location_name?: string | null; qty_on_hand: number; qty_locked: number; qty_available: number
}

export interface IssueRow {
  id: number; issue_no: string; project_no: string; equip_no?: string | null; status: string
  line_count: number; shortage_count: number; issued_to?: string | null
  lines: { id: number; item_no: string; display_name: string; qty_required: number; qty_issued: number; unit?: string | null; location_name?: string | null; shortage: boolean; for_part?: string | null }[]
}

export interface MoveRow {
  id: number; item_no: string; display_name: string; move_type: string; qty: number
  from_location?: string | null; to_location?: string | null; ref_no?: string | null; remark?: string | null
}
