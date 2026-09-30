// api/warehouse.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

export interface GoodsReceiptRow {
  id: number
  receipt_no: string
  project_no: string | null
  attribution?: string | null
  project_name?: string | null
  request_id?: number | null
  po_no?: string | null
  equip_no?: string | null
  equip_name?: string | null
  supplier_name?: string | null
  lead_days?: number | null
  item_no?: string | null
  display_name?: string | null
  spec_text?: string | null
  qty?: number | null
  unit?: string | null
  receipt_date?: string | null
  deliver_to: string
  status: string
  inspected_by?: string | null
  inspected_at?: string | null
  location?: string | null
  inspect_note?: string | null
  stored_by?: string | null
  stored_at?: string | null
  resolve_note?: string | null
  resolved_by?: string | null
  resolved_at?: string | null
  retries?: { id: number; status: string; po_no?: string | null }[]
  photos?: { filename?: string | null; by?: string | null; at?: string | null; url: string }[]
}

export async function listGoodsReceipts(params: { deliver_to?: string; status?: string }) {
  const { data } = await api.get<GoodsReceiptRow[]>('/goods-receipts', { params })
  return data
}

/** 仓库验收（分批可多次）：合格 → 待入库；不合格 → 采购协商换货/退货 */

export interface PoLineBrief {
  po_line_id: number
  po_no?: string | null
  supplier_name?: string | null
  qty: number
  received_qty: number
}

export async function inspectPurchase(
  projectNo: string | null | undefined,
  requestId: number,
  body: {
    receipt_date: string
    qty: number
    result: string
    qty_ok?: number
    qty_rejected?: number
    po_line_id?: number
    note?: string
  },
) {
  // 辅料 / 办公用品 / 其他类采购没有项目号（P-02）→ 走不依赖项目号的验收接口
  const url = projectNo
    ? `/projects/${projectNo}/purchase-requests/${requestId}/inspect`
    : `/purchase-requests/${requestId}/inspect`
  const { data } = await api.post<{
    receipt_id: number
    receipt_no: string
    receipt_status: string
    request_status: string
    qty_received: number
  }>(url, body)
  return data
}

/** 入库：验收合格（待入库）的到货单 → 选库位入库（分批入库） */

export async function storeReceipt(receiptId: number, body: { location?: string; note?: string }) {
  const { data } = await api.post<{
    receipt_no: string
    status: string
    location: string
    request_status: string
  }>(`/goods-receipts/${receiptId}/store`, body)
  return data
}

// ============================== 移动端（03 卷） ==================================

export interface MobileHome {
  user: { id: number; name: string; profession?: string | null; position?: string | null }
  counts: {
    to_inspect: number
    to_store: number
    issues: number
    my_tasks: number
    to_review: number
    to_decide: number
    to_dispatch: number
    to_accept: number
    to_transfer: number
    assembling: number
    to_debug: number
    shipments_open: number
    shipments_receive: number
    site_open_issues: number
    site_to_dispatch: number
    acceptance_pending: number
    service_open: number
  }
}

export async function mobileHome() {
  const { data } = await api.get<MobileHome>('/m/home')
  return data
}

export interface MobileMaterial {
  id: number
  project_no: string | null
  project_name?: string | null
  equip_no?: string | null
  equip_name?: string | null
  item_no: string
  display_name: string
  spec_text?: string | null
  brand?: string | null
  qty: number
  qty_received: number
  unit?: string | null
  po_no?: string | null
  supplier_name?: string | null
  need_date?: string | null
  expected_date?: string | null
  status: string
  deliver_to?: string | null
  part_no?: string | null
  lines?: PoLineBrief[]
  drawing?: {
    drawing_no: string
    title: string
    version: string
    kind: string
    file_url: string
  } | null
  receipts: {
    id: number
    receipt_no: string
    qty: number
    unit?: string | null
    status: string
    receipt_date?: string | null
    location?: string | null
    inspect_note?: string | null
    photos: { filename?: string | null; by?: string | null; at?: string | null; url: string }[]
  }[]
}

export async function mobileMaterial(requestId: number) {
  const { data } = await api.get<MobileMaterial>(`/m/materials/${requestId}`)
  return data
}

/** 验收拍照（手机端）：一次可传多张（前端已压缩） */

export async function uploadReceiptPhotos(receiptId: number, files: File[]) {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  const { data } = await api.post<{
    count: number
    photos: { filename?: string | null; url: string }[]
  }>(`/goods-receipts/${receiptId}/photos`, form)
  return data
}

/** 带鉴权取文件（图纸/照片/程序）→ objectURL + MIME，供 <img>/<iframe> 直接用 */

export async function generateEquipmentIssue(projectNo: string, equipNo: string) {
  const { data } = await api.post<{
    issue_no: string
    line_count: number
    shortage_count: number
    lines: { display_name: string; qty_required: number; shortage: boolean }[]
    /** ★ 幂等：这台设备已有未结的领料单 → 复用，没有再建一张（P1-7） */
    reused?: boolean
    reuse_hint?: string
  }>(`/warehouse/projects/${projectNo}/equipment/${equipNo}/generate-issue`)
  return data
}
