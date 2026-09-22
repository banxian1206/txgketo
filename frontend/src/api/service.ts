// api/service.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

export interface ServiceOrderRow {
  id: number
  so_no: string
  project_no: string
  project_name?: string | null
  equip_no?: string | null
  reported_at?: string | null
  fault?: string | null
  status: string
  responded_at?: string | null
  dispatched_to?: string | null
  arrived_at?: string | null
  solution?: string | null
  labor_hours?: number | null
  photos: string[]
  customer_sign?: string | null
  closed_at?: string | null
  in_warranty?: boolean | null
  warranty_end?: string | null
  remark?: string | null
}

export interface SparePartRow {
  id: number
  project_no?: string | null
  equip_no?: string | null
  item_no: string
  item_name?: string | null
  qty_stock: number
  qty_installed: number
  min_qty?: number | null
  remark?: string | null
}

export interface ServiceWorkbench {
  counts: {
    open: number
    wait: number
    in_progress: number
    to_sign: number
    closed: number
    low_parts: number
  }
  orders: ServiceOrderRow[]
}

export async function serviceWorkbench(projectNo?: string) {
  const { data } = await api.get<ServiceWorkbench>('/service/workbench', {
    params: projectNo ? { project_no: projectNo } : {},
  })
  return data
}

export async function createServiceOrder(body: {
  project_no: string
  equip_no?: string
  fault?: string
  remark?: string
}) {
  const { data } = await api.post<ServiceOrderRow>('/service/orders', body)
  return data
}

export async function dispatchServiceOrder(id: number, dispatchedTo: string) {
  const { data } = await api.post<ServiceOrderRow>(`/service/orders/${id}/dispatch`, {
    dispatched_to: dispatchedTo,
  })
  return data
}

export async function arriveServiceOrder(id: number, photos: string[] = []) {
  const { data } = await api.post<ServiceOrderRow>(`/service/orders/${id}/arrive`, { photos })
  return data
}

export async function fixServiceOrder(
  id: number,
  body: { solution: string; labor_hours?: number; photos?: string[]; remark?: string },
) {
  const { data } = await api.post<ServiceOrderRow>(`/service/orders/${id}/fix`, body)
  return data
}

export async function signServiceOrder(id: number, customerSign: string) {
  const { data } = await api.post<ServiceOrderRow>(`/service/orders/${id}/sign`, {
    customer_sign: customerSign,
  })
  return data
}

export async function listSpareParts(projectNo?: string) {
  const { data } = await api.get<SparePartRow[]>('/service/parts', {
    params: projectNo ? { project_no: projectNo } : {},
  })
  return data
}

export async function createSparePart(body: {
  project_no?: string
  equip_no?: string
  item_no: string
  item_name?: string
  qty_stock?: number
  qty_installed?: number
  min_qty?: number
  remark?: string
}) {
  const { data } = await api.post<SparePartRow>('/service/parts', body)
  return data
}

export async function moveSparePart(body: {
  part_id: number
  move_type: string
  qty: number
  service_order_id?: number
  issued_to?: string
  remark?: string
}) {
  const { data } = await api.post<SparePartRow>('/service/parts/move', body)
  return data
}

export async function listSparePartMoves(partId?: number) {
  const { data } = await api.get<
    {
      id: number
      part_id: number
      move_type: string
      qty: number
      service_order_id?: number | null
      issued_to?: string | null
      moved_at?: string | null
      remark?: string | null
    }[]
  >('/service/parts/moves', { params: partId ? { part_id: partId } : {} })
  return data
}

export async function uploadServicePhotos(projectNo: string, ref: string, files: File[]) {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  const { data } = await api.post<{ token: string; filename: string }[]>('/service/photos', form, {
    params: { project_no: projectNo, ref },
  })
  return data
}

export function servicePhotoUrl(token: string) {
  return `/service/photos?token=${encodeURIComponent(token)}`
}
