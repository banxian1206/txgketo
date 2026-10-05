/** 经营驾驶舱（00 卷 §2.1「一屏看完」）—— 后端 `app/api/routes/dashboard.py` */
import { api } from './http'

export interface GmStageRow {
  stage: string
  count: number
  amount: number | null
}

export interface GmDashboard {
  as_of: string
  orders: { total_count: number; total_amount: number | null; by_stage: GmStageRow[] }
  risks: { project_no: string; project_name: string; stage: string; days_left: number | null; items: string[]; level: 'err' | 'warn' }[]
  risks_count: number
  blocked: { project_no: string; project_name: string; stage: string; rows: { who: string; what: string; to: string; level: 'err' | 'warn' }[] }[]
  blocked_count: number
  after_sales: {
    warranty_soon: { project_no: string; project_name: string; warranty_end: string | null; days_left: number | null; warranty_amount: number | null }[]
    warranty_soon_count: number
    open_orders: { so_no: string; project_no: string; equip_no?: string | null; status: string; fault?: string | null; in_warranty: boolean }[]
    open_orders_count: number
    in_warranty_count: number
    parts_low: { item_no: string; item_name?: string | null; project_no?: string | null; equip_no?: string | null; qty_stock: number; min_qty: number }[]
    parts_low_count: number
    accepted_projects: { project_no: string; accepted_at: string | null }[]
  }
  cost: { available: boolean; reason: string }
}

export async function gmDashboard() {
  const { data } = await api.get<GmDashboard>('/dashboard/gm')
  return data
}
