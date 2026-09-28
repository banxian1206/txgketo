// api/shipping.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

export interface ToShipRow {
  equip_no: string
  equip_name: string
  assembly_status?: string | null
  kitting_rate: number
  ready: boolean
  in_open_shipment: boolean
}

export interface ShipmentItemRow {
  id: number
  equip_no: string
  ref: string
  parent_ref?: string | null
  name?: string | null
  kind: string
  source: string
  qty: number
  unit?: string | null
  shipped: boolean
  shipped_at?: string | null
  photos: string[]
  place_photos: string[]
  check_result?: string | null
  check_qty?: number | null
  check_note?: string | null
  remark?: string | null
}

export interface ShipmentLineRow {
  id: number
  equip_no: string
  equip_name?: string | null
  qty: number
  remark?: string | null
}

export interface SiteReceiptRow {
  id: number
  result: string
  shortage_detail: { item_id?: number; equip_no?: string; item?: string; name?: string; qty?: number; received_qty?: number; result?: string; reason?: string }[]
  photos: string[]
  received_at?: string | null
  remark?: string | null
}

export interface ShipmentRow {
  id: number
  shipment_no: string
  project_no: string
  status: string
  plan_ship_date?: string | null
  // ★ §2.2：叫车（采购）
  vehicle_status?: string | null
  vehicle_count?: number | null
  vehicle_fee?: number | null
  vehicle_note?: string | null
  vehicle?: string | null
  driver?: string | null
  plate_no?: string | null
  instruct_at?: string | null
  depart_at?: string | null
  arrive_at?: string | null
  signed_at?: string | null
  photos: string[]
  remark?: string | null
  lines: ShipmentLineRow[]
  items: ShipmentItemRow[]
  receipts: SiteReceiptRow[]
}

export async function toShip(projectNo: string) {
  const { data } = await api.get<ToShipRow[]>('/shipping/to-ship', { params: { project_no: projectNo } })
  return data
}

export async function createShipment(body: {
  project_no: string
  equip_nos: string[]
  plan_ship_date?: string
  remark?: string
}) {
  const { data } = await api.post<ShipmentRow>('/shipping/instructions', body)
  return data
}

export async function listShipments(params?: { project_no?: string; status?: string }) {
  const { data } = await api.get<ShipmentRow[]>('/shipping/list', { params })
  return data
}

export async function shippingWorkbench(projectNo?: string) {
  const { data } = await api.get<{ counts: Record<string, number>; shipments: ShipmentRow[] }>(
    '/shipping/workbench',
    { params: projectNo ? { project_no: projectNo } : {} },
  )
  return data
}

export async function generateShipItems(shipId: number) {
  const { data } = await api.post<ShipmentRow>(`/shipping/${shipId}/items/generate`)
  return data
}

export async function addManualShipItem(
  shipId: number,
  body: { equip_no?: string; name: string; qty: number; remark?: string },
) {
  const { data } = await api.post<{ id: number }>(`/shipping/${shipId}/items/manual`, body)
  return data
}

export async function markShipItems(itemIds: number[], photos: string[] = []) {
  const { data } = await api.post<{ marked: number }>(`/shipping/items/ship`, { item_ids: itemIds, photos })
  return data
}

export async function setItemPlacePhotos(itemId: number, photos: string[]) {
  const { data } = await api.post(`/shipping/items/${itemId}/place`, { place_photos: photos })
  return data
}

export async function loadShipment(
  id: number,
  body: { vehicle?: string; driver?: string; plate_no?: string; photos: string[]; remark?: string },
) {
  const { data } = await api.post<ShipmentRow>(`/shipping/${id}/load`, body)
  return data
}

// ★ §2.2（09 卷）：采购叫车 —— 一条指令、两个部门（PM 定发货日 → 采购叫车 → 发运装车）
export async function requestVehicle(
  id: number,
  body: { count: number; fee?: number; note?: string },
) {
  const { data } = await api.post<ShipmentRow>(`/shipping/${id}/request-vehicle`, body)
  return data
}

export async function departShipment(
  id: number,
  body: { depart_at?: string; photos?: string[]; remark?: string } = {},
) {
  const { data } = await api.post<ShipmentRow>(`/shipping/${id}/depart`, body)
  return data
}

export async function arriveShipment(id: number) {
  const { data } = await api.post<ShipmentRow>(`/shipping/${id}/arrive`)
  return data
}

export async function receiptShipment(
  id: number,
  body: {
    checks: { item_id: number; result: string; received_qty?: number; reason?: string }[]
    photos: string[]
    remark?: string
  },
) {
  const { data } = await api.post<ShipmentRow>(`/shipping/${id}/receipt`, body)
  return data
}

export async function uploadShipPhotos(projectNo: string, ref: string, files: File[]) {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  const { data } = await api.post<{ token: string; filename: string }[]>('/shipping/photos', form, {
    params: { project_no: projectNo, ref },
  })
  return data
}

export function shipPhotoUrl(token: string) {
  return `/shipping/photos?token=${encodeURIComponent(token)}`
}

// ============================== 现场（S8）=============================
// 勘测 → 验收来货（含直发）→ 每日汇报（拍照/录视频）→ 申请调试；现场问题 → 变更。
