/** 对象档案与全局检索（docs/13 §5）—— 后端 `app/api/routes/dossier.py` */
import { api } from './http'

export interface SearchHit {
  kind: string
  code?: string | null
  title: string
  sub?: string | null
  route: string
  money?: boolean
}

export async function globalSearch(q: string) {
  const { data } = await api.get<{ q: string; count: number; items: SearchHit[] }>('/search', { params: { q } })
  return data
}

export interface ItemDossier {
  item_no: string
  kind: string
  display_name: string
  spec_text?: string | null
  brand?: string | null
  unit?: string | null
  source_type?: string | null
  project_no?: string | null
  project_name?: string | null
  equip_no?: string | null
  drawings: {
    drawing_no: string; title?: string | null; qty: number; unit?: string | null
    source_type?: string | null; status: string; version?: string | null; file: boolean
    owner?: string | null; parent?: string | null
  }[]
  parents: { drawing_no: string; title?: string | null }[]
  children: { drawing_no: string; title?: string | null; qty: number; status: string }[]
  bom_rows: { parent_ref: string; qty: number; kind: string; status: string; superseded: boolean }[]
  requests: {
    id: number; status: string; qty: number; unit?: string | null; po_no?: string | null
    supplier?: string | null; unit_price?: number | null; amount?: number | null
    need_date?: string | null; expected_date?: string | null; ordered_at?: string | null
    deliver_to?: string | null; source?: string | null; part_no?: string | null
    project_no?: string | null; equip_no?: string | null
  }[]
  receipts: {
    receipt_no: string; qty: number; unit?: string | null; status: string
    receipt_date?: string | null; location?: string | null; inspect_note?: string | null
    photos: number; project_no?: string | null
  }[]
  stock: { location_id: number; qty_on_hand: number; qty_locked: number; batch_no?: string | null }[]
  moves: { move_type: string; qty: number; ref_no?: string | null; project_no?: string | null; equip_no?: string | null; moved_at?: string | null; operator?: string | null }[]
  issues: {
    issue_no: string; status: string; project_no: string; equip_no?: string | null
    qty_required: number; qty_picked: number; qty_issued: number; shortage: boolean
    for_part?: string | null; issued_to?: string | null
  }[]
  prod_orders: { order_no: string; status: string; qty: number; plan_start?: string | null; plan_end?: string | null; team?: string | null; project_no: string; equip_no?: string | null; overdue: boolean }[]
  prod_tasks: { step_name: string; drawing_no: string; drawing_version?: string | null; material_item_no?: string | null; material_qty?: number | null; issued_to?: string | null; photos: number }[]
  outsource: { outsource_no: string; status: string; qty: number; supplier?: string | null; sent_at?: string | null; due_date?: string | null; returned_at?: string | null; material_supplied?: boolean | null; project_no: string }[]
  assembly: { project_no: string; equip_no: string; sub_assembly: string; status: string; kitting_rate: number; assembled_at?: string | null; assembled_by?: string | null; debug_result?: string | null }[]
  shipments: { shipment_no: string; status: string; equip_no: string; kind: string; qty: number; shipped: boolean; shipped_at?: string | null; check_result?: string | null; check_qty?: number | null; check_note?: string | null; photos: number }[]
  site_issues: { title: string; status: string; project_no: string; equip_no?: string | null; desc?: string | null; photos: number }[]
  spare_parts: { project_no?: string | null; equip_no?: string | null; qty_stock: number; qty_installed: number; min_qty: number }[]
  changes: { cr_no: string; status: string; target_type: string; target_ref: string; target_version?: string | null; reason?: string | null; applicant?: string | null; decided_by?: string | null }[]
  blocked: string[]
  counts: Record<string, number>
}

export async function itemDossier(itemNo: string) {
  const { data } = await api.get<ItemDossier>(`/items/${encodeURIComponent(itemNo)}/dossier`)
  return data
}

export interface EquipmentDossier {
  project_no: string
  project_name?: string | null
  equip_no: string
  equip_name: string
  kind?: string | null
  model?: string | null
  line_no?: string | null
  bom_complete: boolean
  root_drawing_no?: string | null
  drawing_summary: Record<string, number>
  drawings: {
    drawing_no: string; title?: string | null; qty: number; unit?: string | null
    source_type?: string | null; status: string; version?: string | null
    owner?: string | null; has_current_file: boolean
  }[]
  prod_orders: {
    order_no: string; item_no: string; item_name?: string | null; status: string
    qty: number; plan_end?: string | null; team?: string | null
    project_no: string; equip_no?: string | null
  }[]
  outsource: {
    outsource_no: string; item_no: string; item_name?: string | null; status: string
    supplier?: string | null; due_date?: string | null
  }[]
  assembly: {
    id: number; sub_assembly: string; status: string; kitting_rate: number
    assembled_at?: string | null; assembled_by?: string | null
    debug_result?: string | null; debug_note?: string | null; debug_at?: string | null
    unassembled?: { ref?: string; name?: string; qty?: number }[]
    photos: number
  }[]
  shipments: {
    shipment_no: string; status: string; plan_ship_date?: string | null
    depart_at?: string | null; arrive_at?: string | null; signed_at?: string | null
    items: number; shipped: number; checked: number; short: number
  }[]
  site_issues: {
    title: string; status: string; equip_no?: string | null
    drawing_no?: string | null; item_no?: string | null; desc?: string | null
  }[]
  site_surveys: { enter_date?: string | null; contact?: string | null; floor_load?: string | null; passage?: string | null; power?: string | null }[]
  site_dailies: { report_date?: string | null; stage: string; equip_no?: string | null; people?: number | null; done: number; problem?: string | null; photos: number; videos: number }[]
  site_commissions: { status: string; dispatch_to?: string | null; plan_date?: string | null; arrived_at?: string | null }[]
  service_orders: {
    so_no: string; status: string; fault?: string | null; in_warranty?: boolean | null
    dispatched_to?: string | null; reported_at?: string | null; fixed_at?: string | null
    solution?: string | null; labor_hours?: number | null; customer_sign?: string | null
  }[]
  kitting: { rate: number; total: number; arrived: number; total_qty: number; arrived_qty: number; missing: { ref: string; name?: string | null; state?: string | null; qty?: number }[] } | null
  blocked: string[]
}

export async function equipmentDossier(projectNo: string, equipNo: string) {
  const { data } = await api.get<EquipmentDossier>(
    `/equipment/${encodeURIComponent(projectNo)}/${encodeURIComponent(equipNo)}/dossier`,
  )
  return data
}

export interface TimelineRow {
  id: number
  at?: string | null
  who?: string | null
  action: string
  object_type?: string | null
  object_ref?: string | null
  summary?: string | null
}

export async function timeline(ref: string, limit = 50) {
  const { data } = await api.get<{ ref: string; count: number; items: TimelineRow[] }>('/timeline', {
    params: { ref, limit },
  })
  return data
}
