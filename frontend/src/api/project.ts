// api/project.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

export interface ContactIn {
  name: string
  title?: string
  phone?: string
  wechat?: string
  email?: string
  role_tag?: string
}

export interface Project {
  project_no: string
  project_name: string
  customer_id: number
  customer_name?: string | null
  sales_name?: string | null
  attachment_count?: number
  attachments_brief?: { id: number; filename: string; category: string }[]
  stage: string
  project_desc?: string | null
  deadline?: string | null
  opportunity_days_left?: number | null
  delivery_days?: number | null
  delivery_start?: string | null
  delivery_end?: string | null
  delivery_days_left?: number | null
  deal_mode?: string | null
  received_docs?: string[] | null
  source?: string | null
  site_address?: string | null
  is_retrofit?: boolean
  product_type?: string | null
  required_cycle?: string | null
  required_capacity?: string | null
  est_amount?: number | null
  expect_sign_date?: string | null
  competitor?: string | null
  related_project_no?: string | null
  risk_note?: string | null
  sales_id?: number | null
  performance_deposit?: number | null
  performance_deposit_return_date?: string | null
  performance_deposit_returned?: boolean
  amount?: number | null
  amount_tax_incl?: boolean
  period_start?: string | null
  period_end?: string | null
  contract_no_customer?: string | null
  warranty_months?: number | null
  warranty_amount?: number | null
  penalty_note?: string | null
  acceptance_standard?: string | null
  designated_brand?: string | null
  delivery_mode?: string | null
  site_condition?: string | null
  is_batch_delivery?: boolean
  tech_agreement_frozen?: boolean
  close_reason?: string | null
  close_note?: string | null
  pm_id?: number | null
  created_at?: string | null
}

export interface ProjectCreate {
  customer_name: string
  project_name: string
  contacts?: ContactIn[]
  received_docs?: string[]
  project_desc?: string
  deadline?: string
  delivery_days?: number
  deal_mode?: string
  source?: string
  site_address?: string
  is_retrofit?: boolean
  product_type?: string
  required_cycle?: string
  required_capacity?: string
  est_amount?: number
  expect_sign_date?: string
  competitor?: string
  related_project_no?: string
  risk_note?: string
  sales_id?: number
  performance_deposit?: number
  performance_deposit_return_date?: string
  performance_deposit_returned?: boolean
}

export interface Attachment {
  id: number
  category: string
  filename: string
  size?: number | null
  version?: string | null
  is_frozen: boolean
  uploaded_at: string
}

export interface ProjectContact {
  id: number
  name: string
  title?: string | null
  phone?: string | null
  wechat?: string | null
  email?: string | null
  role_tag?: string | null
}

export interface PaymentTerm {
  seq: number
  node_name: string
  percent?: number | null
  amount?: number | null
  expect_date?: string | null
  condition?: string | null
  received_amount?: number | null
  received_date?: string | null
}

export interface ProjectDetail {
  project: Project
  contacts: ProjectContact[]
  attachments: Attachment[]
  payment_terms: PaymentTerm[]
  sales_name?: string | null
  pm_name?: string | null
}

export interface AuditLog {
  id: number
  username?: string | null
  action: string
  object_type?: string | null
  object_ref?: string | null
  summary?: string | null
  detail?: { changes?: { field: string; label: string; old: string; new: string }[] } | null
  created_at: string
}

export interface ProjectUpdate {
  customer_name?: string
  project_name?: string
  project_desc?: string | null
  deadline?: string | null
  delivery_days?: number | null
  deal_mode?: string | null
  source?: string | null
  site_address?: string | null
  is_retrofit?: boolean
  product_type?: string | null
  required_cycle?: string | null
  required_capacity?: string | null
  est_amount?: number | null
  expect_sign_date?: string | null
  competitor?: string | null
  related_project_no?: string | null
  risk_note?: string | null
  sales_id?: number | null
  performance_deposit?: number | null
  performance_deposit_return_date?: string | null
  performance_deposit_returned?: boolean | null
  received_docs?: string[]
  amount?: number | null
  amount_tax_incl?: boolean
  period_start?: string | null
  period_end?: string | null
  contract_no_customer?: string | null
  warranty_months?: number | null
  tech_agreement_frozen?: boolean
  pm_id?: number | null
}

export async function nextProjectNo() {
  const { data } = await api.get<{ project_no: string }>('/projects/next-number')
  return data.project_no
}

export async function listProjects(stage?: string) {
  const { data } = await api.get<Project[]>('/projects', { params: stage ? { stage } : {} })
  return data
}

export async function createProject(body: ProjectCreate) {
  const { data } = await api.post<Project>('/projects', body)
  return data
}

export async function listAttachments(projectNo: string) {
  const { data } = await api.get<Attachment[]>(`/projects/${projectNo}/attachments`)
  return data
}

export async function uploadAttachment(projectNo: string, category: string, file: File) {
  const form = new FormData()
  form.append('category', category)
  form.append('file', file)
  const { data } = await api.post<Attachment>(`/projects/${projectNo}/attachments`, form)
  return data
}

/** 下载资料（带鉴权，用 blob 方式触发浏览器下载） */

export async function downloadAttachment(projectNo: string, att: Attachment) {
  const res = await api.get(`/projects/${projectNo}/attachments/${att.id}/download`, {
    responseType: 'blob',
  })
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = att.filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 在线预览：拿回文件内容（图片/PDF 给 blob URL，文本直接读字符串） */

export async function previewAttachment(projectNo: string, att: Attachment) {
  const res = await api.get(`/projects/${projectNo}/attachments/${att.id}/preview`, {
    responseType: 'blob',
  })
  const blob = res.data as Blob
  const ext = att.filename.split('.').pop()?.toLowerCase() ?? ''
  if (['txt', 'md', 'csv', 'json', 'log', 'xml'].includes(ext)) {
    return { kind: 'text' as const, text: await blob.text() }
  }
  const url = URL.createObjectURL(blob)
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
    return { kind: 'image' as const, url }
  }
  if (ext === 'pdf') return { kind: 'pdf' as const, url }
  return { kind: 'unsupported' as const, url: '' }
}

export async function getProjectDetail(projectNo: string) {
  const { data } = await api.get<ProjectDetail>(`/projects/${projectNo}/detail`)
  return data
}

export async function listAuditLogs(params: { object_type?: string; object_ref?: string }) {
  const { data } = await api.get<AuditLog[]>('/audit-logs', { params })
  return data
}

/** 编辑项目（部分更新，后端逐字段留痕） */

export interface DealIn {
  period_start?: string | null
  period_end?: string | null
  amount?: number | null
  amount_tax_incl?: boolean
  contract_no_customer?: string | null
  warranty_months?: number | null
  warranty_amount?: number | null
  penalty_note?: string | null
  acceptance_standard?: string | null
  designated_brand?: string | null
  delivery_mode?: string | null
  site_condition?: string | null
  is_batch_delivery?: boolean
  tech_agreement_frozen?: boolean
  payment_terms?: {
    node_name: string
    percent?: number | null
    amount?: number | null
    expect_date?: string | null
    condition?: string | null
  }[]
}

/** 成交登记：阶段 线索 → 成交待立项 */

export async function registerDeal(projectNo: string, body: DealIn) {
  const { data } = await api.post<{ project: Project; payment_terms: number; total: number }>(
    `/projects/${projectNo}/deal`,
    body,
  )
  return data
}

/** 关闭订单（需填关闭原因） */

export async function closeProject(
  projectNo: string,
  body: { close_reason: string; close_note?: string },
) {
  const { data } = await api.post<Project>(`/projects/${projectNo}/close`, body)
  return data
}

// ============================== 标准库 ==========================================

export async function registerPayment(
  projectNo: string,
  seq: number,
  body: { received_amount?: number; received_date?: string; remark?: string },
) {
  const form = new FormData()
  if (body.received_amount != null) form.append('received_amount', String(body.received_amount))
  if (body.received_date) form.append('received_date', body.received_date)
  if (body.remark) form.append('remark', body.remark)
  const { data } = await api.post<{
    ok: boolean
    node_name: string
    received_amount: number
    unpaid: number
  }>(`/projects/${projectNo}/payment-terms/${seq}/receive`, form)
  return data
}

/** 按设备 BOM 生成领料单（自制件的原材料 + 整台设备的标准件） */

export async function updateProject(projectNo: string, body: ProjectUpdate) {
  const { data } = await api.patch<Project>(`/projects/${projectNo}`, body)
  return data
}

export async function createContact(projectNo: string, body: ContactIn) {
  const { data } = await api.post<ProjectContact>(`/projects/${projectNo}/contacts`, body)
  return data
}

export async function updateContact(projectNo: string, contactId: number, body: ContactIn) {
  const { data } = await api.patch<ProjectContact>(
    `/projects/${projectNo}/contacts/${contactId}`,
    body,
  )
  return data
}

// ============================== 制造域（S5）=============================
// ★ 只管两头：下发（原材料 + 图纸，拍照）→ 到期验收（拍照）→ 转运装配区（拍照）。
