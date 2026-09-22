// api/manufacturing.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

export interface MfgTaskRow {
  id: number
  step_name: string
  material_item_no?: string | null
  material_qty?: number | null
  drawing_no?: string | null
  drawing_version?: string | null
  issued_to?: string | null
  issued_at?: string | null
  photos: string[]
  remark?: string | null
}

export interface MfgAcceptanceRow {
  id: number
  result: string
  reason?: string | null
  accepted_at?: string | null
  photos: string[]
  transfer_at?: string | null
  transfer_to?: string | null
  transfer_photos: string[]
}

export interface ProdOrderRow {
  id: number
  order_no: string
  project_no: string
  equip_no?: string | null
  item_no: string
  item_name?: string | null
  spec_text?: string | null
  qty: number
  unit: string
  plan_start?: string | null
  plan_end?: string | null
  status: string
  team?: string | null
  worker_id?: number | null
  remark?: string | null
  material_item_no?: string | null
  tasks?: MfgTaskRow[]
  acceptances?: MfgAcceptanceRow[]
  overdue?: boolean
}

export interface OutsourceRow {
  id: number
  outsource_no: string
  project_no: string
  equip_no?: string | null
  item_no: string
  item_name?: string | null
  qty: number
  supplier_id?: number | null
  supplier_name?: string | null
  material_supplied: boolean
  sent_at?: string | null
  due_date?: string | null
  returned_at?: string | null
  status: string
  photos: string[]
  remark?: string | null
}

export interface MfgWorkbench {
  counts: {
    wait: number
    running: number
    to_accept: number
    to_transfer: number
    rework: number
    transferred: number
    overdue: number
    outsource: number
  }
  wait: ProdOrderRow[]
  running: ProdOrderRow[]
  to_accept: ProdOrderRow[]
  to_transfer: ProdOrderRow[]
  rework: ProdOrderRow[]
  outsource: OutsourceRow[]
}

export async function generateProdOrders(
  projectNo: string,
  equipNo: string,
  body: { plan_start?: string; plan_days?: number } = {},
) {
  const { data } = await api.post<{
    orders: string[]
    outsource: string[]
    order_count: number
    outsource_count: number
  }>(`/manufacturing/projects/${projectNo}/equipment/${equipNo}/generate-orders`, body)
  return data
}

export async function listProdOrders(params?: {
  project_no?: string
  equip_no?: string
  status?: string
  overdue_only?: boolean
}) {
  const { data } = await api.get<ProdOrderRow[]>('/manufacturing/orders', { params })
  return data
}

export async function getProdOrder(id: number) {
  const { data } = await api.get<ProdOrderRow>(`/manufacturing/orders/${id}`)
  return data
}

export async function prodWorkbench() {
  const { data } = await api.get<MfgWorkbench>('/manufacturing/workbench')
  return data
}

export async function shopBoard() {
  const { data } = await api.get<MfgWorkbench>('/workbench/shop')
  return data
}

export async function dispatchProdOrder(
  id: number,
  body: {
    step_name: string
    material_item_no?: string
    material_qty?: number
    issued_to?: string
    photos: string[]
    remark?: string
  },
) {
  const { data } = await api.post<ProdOrderRow>(`/manufacturing/orders/${id}/dispatch`, body)
  return data
}

export async function startProdOrder(id: number) {
  const { data } = await api.post<ProdOrderRow>(`/manufacturing/orders/${id}/start`)
  return data
}

export async function acceptProdOrder(
  id: number,
  body: { result: string; reason?: string; photos: string[] },
) {
  const { data } = await api.post<ProdOrderRow>(`/manufacturing/orders/${id}/accept`, body)
  return data
}

export async function transferProdOrder(
  id: number,
  body: { transfer_to?: string; photos: string[] },
) {
  const { data } = await api.post<ProdOrderRow>(`/manufacturing/orders/${id}/transfer`, body)
  return data
}

export async function listOutsource(params?: { project_no?: string; status?: string }) {
  const { data } = await api.get<OutsourceRow[]>('/manufacturing/outsource', { params })
  return data
}

export async function sendOutsource(
  id: number,
  body: {
    supplier_id?: number
    supplier_name?: string
    sent_at?: string
    due_date?: string
    material_supplied?: boolean
    photos?: string[]
    remark?: string
  },
) {
  const { data } = await api.post<OutsourceRow>(`/manufacturing/outsource/${id}/send`, body)
  return data
}

export async function returnOutsource(
  id: number,
  body: { returned_at?: string; photos?: string[]; remark?: string } = {},
) {
  const { data } = await api.post<OutsourceRow>(`/manufacturing/outsource/${id}/return`, body)
  return data
}

export async function acceptOutsource(
  id: number,
  body: { result: string; reason?: string; photos?: string[] },
) {
  const { data } = await api.post<OutsourceRow>(`/manufacturing/outsource/${id}/accept`, body)
  return data
}

/** 制造拍照上传（下发/验收/转运）：返回 token，放进 photos 列表 */

export async function uploadMfgPhotos(projectNo: string, ref: string, files: File[]) {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  const { data } = await api.post<{ token: string; filename: string }[]>('/manufacturing/photos', form, {
    params: { project_no: projectNo, ref },
  })
  return data
}

export function mfgPhotoUrl(token: string) {
  return `/manufacturing/photos?token=${encodeURIComponent(token)}`
}

// ============================== 装配与齐套率（S6）=============================
// 齐套率只展示：装配随时能开工（56%、78% 都行），不设 100% 门槛。
