// api/purchase.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

import { PurchaseRequestItem } from './initiate'
export async function purchaseWorkbench() {
  const { data } = await api.get<PurchaseRequestItem[]>('/purchase/workbench')
  return data
}

// ---------------------------- 采购单（合并单）视图 -----------------------------------
// 一张采购单（po_no）= 单头 + 各项目/设备的需求行；采购只管下单/取消/改供应商，
// 到货验收由仓库推：仓库登记到货 → 验收 → 入库，需求状态自己变。

export interface PurchaseOrderSummary {
  key: string
  po_no?: string | null
  supplier_id?: number | null
  supplier_name?: string | null
  ordered_at?: string | null
  expected_date?: string | null
  deliver_to?: string | null
  deliver_address?: string | null
  status: string
  po_status?: string | null
  pay_status?: string | null
  line_count: number
  item_kinds: number
  total_amount: number
  exchanged_qty: number
  returned_qty: number
  projects: { project_no: string; project_name?: string | null }[]
  equipments: { project_no: string; equip_no: string; equip_name?: string | null }[]
  request_ids: number[]
}

export interface OrderLineReceipt {
  receipt_no: string
  status: string
  qty?: number | null
  unit?: string | null
  receipt_date?: string | null
  deliver_to: string
  location?: string | null
  inspect_note?: string | null
  inspected_by?: string | null
  inspected_at?: string | null
  stored_by?: string | null
  stored_at?: string | null
  resolve_note?: string | null
  resolved_by?: string | null
  resolved_at?: string | null
  retries?: { id: number; status: string; po_no?: string | null }[]
}

export interface PurchaseOrderLine extends PurchaseRequestItem {
  project_name?: string | null
  equip_name?: string | null
  part_title?: string | null
  po_line_id?: number | null
  tax_incl?: boolean
  /** 退换货留痕：原订购 / 退货 / 换货 数量（qty 是退货后的有效数） */
  qty_original: number
  qty_returned: number
  qty_exchanged: number
  receipts: OrderLineReceipt[]
}

export interface PurchaseOrderDetail {
  order: PurchaseOrderSummary
  lines: PurchaseOrderLine[]
}

/** 采购单列表（合并单按 po_no 归拢，历史无号单条单单独成单） */

export async function purchaseOrders() {
  const { data } = await api.get<PurchaseOrderSummary[]>('/purchase/orders')
  return data
}

/** 采购单详情：每行需求归属哪个项目/设备 + 对应到货单 */

export async function purchaseOrderDetail(key: string) {
  const { data } = await api.get<PurchaseOrderDetail>(`/purchase/orders/${encodeURIComponent(key)}`)
  return data
}

/** 取消采购（已到货/已验收的行动不了） */

export async function cancelPurchaseOrder(key: string, body: { request_ids?: number[]; reason?: string }) {
  const { data } = await api.post<{ cancelled: number; skipped: number }>(
    `/purchase/orders/${encodeURIComponent(key)}/cancel`,
    body,
  )
  return data
}

/** 作废整单（未执行）：需求全部回采购池，可重下 */
export async function voidPurchaseOrder(key: string, body: { reason?: string }) {
  const { data } = await api.post<{ voided: number; status: string }>(
    `/purchase/orders/${encodeURIComponent(key)}/void`,
    body,
  )
  return data
}

/** 整批退货关闭：到货单全转已退货，需求回池重采 */
export async function closeReturnPurchaseOrder(key: string, body: { note?: string }) {
  const { data } = await api.post<{ closed: number; retry_ids: number[]; status: string }>(
    `/purchase/orders/${encodeURIComponent(key)}/close-return`,
    body,
  )
  return data
}

// ── 二级审批（08 §4/§5）───────────────────────────────────────────────
export async function submitPurchaseOrder(key: string) {
  const { data } = await api.post<{ status: string }>(
    `/purchase/orders/${encodeURIComponent(key)}/submit`,
  )
  return data
}

export async function approvePurchaseOrder(
  key: string,
  body: { action: '通过' | '退回'; note?: string },
) {
  const { data } = await api.post<{ status: string }>(
    `/purchase/orders/${encodeURIComponent(key)}/approve`,
    body,
  )
  return data
}

export async function withdrawPurchaseOrder(key: string) {
  const { data } = await api.post<{ status: string }>(
    `/purchase/orders/${encodeURIComponent(key)}/withdraw`,
  )
  return data
}

export interface PoApprovalRow {
  round_no: number
  level: number
  reviewer_id?: number | null
  reviewer_name?: string | null
  action: string
  note?: string | null
  acted_at?: string | null
}

export async function listPoApprovals(key: string) {
  const { data } = await api.get<PoApprovalRow[]>(
    `/purchase/orders/${encodeURIComponent(key)}/approvals`,
  )
  return data
}

/** 更改供应商（还没到的行；可顺便改单价） */

export async function changeOrderSupplier(
  key: string,
  body: {
    supplier_id: number
    note?: string
    lines?: { request_id: number; unit_price?: number }[]
  },
) {
  const { data } = await api.post<{ changed: number }>(
    `/purchase/orders/${encodeURIComponent(key)}/change-supplier`,
    body,
  )
  return data
}

/** 验收不合格的处理：换货（等供应商补发）/ 退货（数量减掉、结束） */

export async function negotiateOrder(
  key: string,
  body: { request_ids: number[]; action: '换货' | '退货'; expected_date?: string; note?: string },
) {
  const { data } = await api.post<{ replaced: number; returned: number; retry_request_ids: number[] }>(
    `/purchase/orders/${encodeURIComponent(key)}/negotiate`,
    body,
  )
  return data
}

// ---------------------------- 采购池 + 合并下单 -------------------------------------
// 00 卷 §3.1②：仓库优先 → 净需求 → 进池累计合并（跨项目/按物料归拢）→ 一次下给同一个供应商

export interface PurchasePoolDemand {
  id: number
  project_no: string | null
  project_name?: string | null
  equip_no?: string | null
  part_no?: string | null
  part_title?: string | null
  qty: number
  need_date?: string | null
  source: string
  attribution?: string | null
  requester_id?: number | null
  requester_name?: string | null
  source_release_id?: number | null
  source_release_no?: string | null
  lead_days?: number | null
  origin_request_id?: number | null
  origin_po_no?: string | null
  remark?: string | null
}

export interface PurchasePoolGroup {
  item_no: string
  display_name: string
  spec_text?: string | null
  unit?: string | null
  total_qty: number
  earliest_need?: string | null
  request_count: number
  mergeable: boolean
  requests: PurchasePoolDemand[]
}

/** 采购池：所有「待采购」的需求，按物料归拢，标出哪些可合并 */

export async function purchasePool() {
  const { data } = await api.get<PurchasePoolGroup[]>('/purchase/pool')
  return data
}

// ------------------- 手工采购申请（05 卷 §6）-------------------

/** 归属（与后端 ATTRIBUTIONS 对齐） */

export const ATTRIBUTIONS = ['项目', '辅料', '办公用品', '其他']

export interface ManualPurchaseIn {
  attribution: string
  project_no?: string | null
  equip_no?: string | null
  item_no: string
  qty: number
  unit?: string | null
  need_date?: string | null
  note?: string | null
}

/** 手工申请：任何部门/个人可提，免审核直入采购池 */

export async function createManualPurchaseRequest(body: ManualPurchaseIn) {
  const { data } = await api.post<{
    id: number
    item_no: string
    display_name: string
    qty: number
    attribution: string
    source: string
    status: string
  }>('/purchase/manual-request', body)
  return data
}

// ------------------- BOM → 净需求 → 采购池（常规件通道）-------------------

export interface GeneratePurchaseResult {
  created: number
  need_lines: number
  need_qty: number
  buy_lines: number
  buy_qty: number
  covered_lines: number
  covered_qty: number
  need_date?: string | null
  message?: string
  requests?: {
    id: number
    item_no: string
    display_name: string
    part_no?: string | null
    qty: number
    unit?: string | null
  }[]
}

/** 按设备的完整 BOM 生成待采购需求（扣库存、扣在途，剩下的进池） */

export async function generateEquipmentPurchase(
  projectNo: string,
  equipNo: string,
  body: { need_date?: string; remark?: string },
) {
  const { data } = await api.post<GeneratePurchaseResult>(
    `/projects/${projectNo}/equipment/${equipNo}/generate-purchase`,
    body,
  )
  return data
}

/** 登记回款（可多次）：某个付款节点收到一笔款（payment:edit） */

export interface MergeOrderLineIn {
  request_id: number
  qty?: number
  unit_price?: number
  tax_incl: boolean
}

export interface MergeOrderIn {
  supplier_id: number
  ordered_at: string
  expected_date?: string
  deliver_to: string
  deliver_address?: string
  po_no?: string
  tax_rate?: number
  freight?: number
  discount?: number
  lines: MergeOrderLineIn[]
  remark?: string
}

/** 合并下单：多条需求 → 一张采购单，共用一个 po_no */

export async function mergeOrder(body: MergeOrderIn) {
  const { data } = await api.post<{ po_no: string; count: number; total: number; supplier: string; status?: string }>(
    '/purchase/merge-order',
    body,
  )
  return data
}

// ============================== 供应商 / 价格 =====================================

export interface SupplierRow {
  id: number
  code: string
  name: string
  short_name?: string | null
  kind?: string | null
  contact_name?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  payment_terms?: string | null
  tax_rate?: number | null
  rating?: number | null
  remark?: string | null
  is_active: boolean
  quote_count?: number
  deal_count?: number
  catalog?: CatalogRow[]
}

export interface QuoteRow {
  id: number
  item_no: string
  item_name?: string | null
  spec_text?: string | null
  supplier_id: number
  supplier_name?: string | null
  price: number
  tax_incl?: boolean
  qty?: number | null
  unit?: string | null
  min_qty?: number | null
  lead_days?: number | null
  price_type: string
  quote_date: string
  valid_until?: string | null
  source?: string | null
  remark?: string | null
}

export interface PriceSegment {
  last_price?: number | null
  last_supplier?: string | null
  last_date?: string | null
  last_qty?: number | null
  min_price?: number | null
  max_price?: number | null
  avg_price?: number | null
  deal_count: number
}

export interface PriceReference {
  item_no: string
  display_name: string
  spec_text?: string | null
  unit: string
  stats: {
    last_price?: number | null
    last_supplier?: string | null
    last_date?: string | null
    min_price?: number | null
    max_price?: number | null
    avg_price?: number | null
    deal_count: number
    quote_count: number
    last_tax_incl?: boolean | null
  }
  by_tax?: { 含税: PriceSegment; 不含税: PriceSegment }
  deals: QuoteRow[]
  quotes: QuoteRow[]
  ordered: {
    project_no?: string | null
    unit_price?: number | null
    qty?: number | null
    tax_incl?: boolean
    expect_date?: string | null
    supplier_name?: string | null
    ordered_at?: string | null
  }[]
}

export async function listSuppliers(params?: { q?: string; kind?: string }) {
  const { data } = await api.get<SupplierRow[]>('/suppliers', { params })
  return data
}

export async function createSupplier(body: Record<string, unknown>) {
  const { data } = await api.post<SupplierRow>('/suppliers', body)
  return data
}

export async function updateSupplier(id: number, body: Record<string, unknown>) {
  const { data } = await api.patch<SupplierRow>(`/suppliers/${id}`, body)
  return data
}

export async function listSupplierQuotes(supplierId: number) {
  const { data } = await api.get<QuoteRow[]>(`/suppliers/${supplierId}/quotes`)
  return data
}

export async function addSupplierQuote(supplierId: number, body: Record<string, unknown>) {
  const { data } = await api.post<QuoteRow>(`/suppliers/${supplierId}/quotes`, body)
  return data
}

export async function priceReference(itemNo: string) {
  const { data } = await api.get<PriceReference>(`/purchase/price-reference/${itemNo}`)
  return data
}

// ============================== 物料搜索 / 库位 / 其他入库 =============================

export interface LocationRow {
  id: number
  warehouse: string
  code: string
  name?: string | null
  item_count: number
  is_active: boolean
  remark?: string | null
}

export async function listLocations() {
  const { data } = await api.get<LocationRow[]>('/warehouse/locations')
  return data
}

export async function createLocation(body: {
  warehouse: string
  code: string
  name?: string
  remark?: string
}) {
  const { data } = await api.post<LocationRow>('/warehouse/locations', body)
  return data
}

/** 其他入库（没走采购流程：退料回库、盘盈等） */

export async function manualInbound(body: {
  item_no: string
  qty: number
  location_id: number
  project_no?: string
  equip_no?: string
  ref_no?: string
  remark?: string
}) {
  const { data } = await api.post('/warehouse/inbound', body)
  return data
}

// ============================== 供货范围 / 推荐供应商 =============================

export interface CatalogRow {
  id: number
  std_class_code?: string | null
  std_class_name?: string | null
  item_no?: string | null
  item_name?: string | null
  price?: number | null
  lead_days?: number | null
  min_qty?: number | null
  is_preferred: boolean
  remark?: string | null
}

export interface Recommendation {
  supplier_id: number
  code: string
  name: string
  kind?: string | null
  rating?: number | null
  payment_terms?: string | null
  match_level: string
  score: number
  reasons: string[]
  price_hint?: number | null
  lead_days?: number | null
  late: boolean
  last_deal_date?: string | null
}

export interface RecommendResult {
  item_no: string
  display_name: string
  spec_text?: string | null
  unit: string
  std_class_name?: string | null
  category_name?: string | null
  need_date?: string | null
  recommendations: Recommendation[]
  note: string
}

export async function listSupplierCatalog(supplierId: number) {
  const { data } = await api.get<CatalogRow[]>(`/suppliers/${supplierId}/catalog`)
  return data
}

export async function addSupplierCatalog(supplierId: number, body: Record<string, unknown>) {
  const { data } = await api.post(`/suppliers/${supplierId}/catalog`, body)
  return data
}

export async function removeSupplierCatalog(catalogId: number) {
  await api.delete(`/suppliers/catalog/${catalogId}`)
}

export async function recommendSuppliers(itemNo: string, needDate?: string) {
  const { data } = await api.get<RecommendResult>(`/purchase/recommend/${itemNo}`, {
    params: needDate ? { need_date: needDate } : {},
  })
  return data
}
