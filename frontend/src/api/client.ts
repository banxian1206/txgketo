import axios from 'axios'

export const TOKEN_KEY = 'txgk_token'

export const api = axios.create({ baseURL: '/api/v1', timeout: 20000 })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      if (window.location.pathname !== '/login') window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export function errMsg(e: unknown): string {
  const anyErr = e as { response?: { data?: { detail?: string } }; message?: string }
  return anyErr?.response?.data?.detail ?? anyErr?.message ?? '操作失败'
}

export interface User {
  id: number
  username: string
  name: string
  is_superuser: boolean
  profession?: string | null
  position?: string | null
  org_id?: number | null
}

/** 用户管理页的行（比 User 多管理字段） */
export interface UserRow extends User {
  phone?: string | null
  is_active: boolean
  roles?: string[]
}

export interface OrgRow {
  id: number
  code: string
  name: string
  parent_id?: number | null
  kind?: string | null
}

export interface RoleRow {
  id: number
  code: string
  name: string
}

/** 工程部专业 / 岗位（05 卷 §2.1，与后端 PROFESSIONS / POSITIONS 对齐） */
export const PROFESSIONS = ['机械', '电气', '程序', '工艺']
export const POSITIONS = ['设计师', '设计组长', '工程总监']

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

export async function login(username: string, password: string) {
  const { data } = await api.post<{ access_token: string; user: User }>('/auth/login', {
    username,
    password,
  })
  return data
}

export async function me() {
  const { data } = await api.get<User>('/auth/me')
  return data
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

export async function listNumberRules() {
  const { data } = await api.get<
    { object_type: string; name: string; template: string; scope: string; remark?: string }[]
  >('/numbering/rules')
  return data
}

export async function listUsers() {
  const { data } = await api.get<UserRow[]>('/users')
  return data
}

export async function createUser(body: {
  username: string
  password: string
  name: string
  phone?: string | null
  org_id?: number | null
  profession?: string | null
  position?: string | null
  role_codes: string[]
}) {
  const { data } = await api.post<UserRow>('/users', body)
  return data
}

export async function updateUser(
  id: number,
  body: {
    name?: string
    phone?: string | null
    org_id?: number | null
    profession?: string | null
    position?: string | null
    role_codes?: string[]
    is_active?: boolean
    password?: string
  },
) {
  const { data } = await api.patch<UserRow>(`/users/${id}`, body)
  return data
}

export async function listOrgs() {
  const { data } = await api.get<OrgRow[]>('/orgs')
  return data
}

export async function listRoles() {
  const { data } = await api.get<RoleRow[]>('/roles')
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

export interface SpecFieldDef {
  code: string
  name: string
  type: 'text' | 'number' | 'enum'
  unit?: string
  required?: boolean
  options?: string[]
  group?: string
}

export interface StdClassInfo {
  code: string
  name: string
  spec_template?: SpecFieldDef[] | null
  item_count?: number
  category_code?: string
  category_name?: string
}

export interface StdCategoryInfo {
  code: string
  name: string
  classes: StdClassInfo[]
}

export interface StdItem {
  item_no: string
  display_name: string
  source_type: string
  std_class_code?: string | null
  std_class_name?: string | null
  category_code?: string | null
  spec?: Record<string, unknown> | null
  spec_text?: string | null
  unit: string
  brand?: string | null
  mfr_model?: string | null
  is_active: boolean
}

export async function listLibraryCategories() {
  const { data } = await api.get<StdCategoryInfo[]>('/library/categories')
  return data
}

export async function getLibraryClass(code: string) {
  const { data } = await api.get<StdClassInfo>(`/library/classes/${code}`)
  return data
}

export async function listStdItems(params: {
  class_code?: string
  category_code?: string
  q?: string
  limit?: number
}) {
  const { data } = await api.get<StdItem[]>('/library/items', { params })
  return data
}

export async function createStdItem(body: {
  std_class_code: string
  spec: Record<string, unknown>
  unit?: string
  brand?: string
  mfr_model?: string
}) {
  const { data } = await api.post<StdItem>('/library/items', body)
  return data
}

// ============================== 立项（团队 / 设备 / 节点 / 长周期采购）==========

export interface ProjectMember {
  id: number
  user_id: number
  user_name?: string | null
  project_role: string
  remark?: string | null
}

export interface EquipmentItem {
  id: number
  equip_no: string
  equip_name: string
  model?: string | null
  kind?: string | null
  line_no?: string | null
  seq_no?: number | null
  letter?: string | null
  bom_complete: boolean
  remark?: string | null
}

export interface MilestoneItem {
  id: number
  seq: number
  name: string
  plan_start?: string | null
  plan_end?: string | null
  actual_start?: string | null
  actual_end?: string | null
  owner_id?: number | null
  owner_name?: string | null
  status: string
  remark?: string | null
}

export interface PurchaseRequestItem {
  id: number
  project_no: string
  project_name?: string | null
  equip_no?: string | null
  part_no?: string | null
  item_no: string
  po_no?: string | null
  unit_price?: number | null
  amount?: number | null
  shipped_at?: string | null
  arrived_at?: string | null
  qty_received?: number | null
  overdue?: boolean
  item_name: string
  model?: string | null
  brand?: string | null
  spec_text?: string | null
  qty?: number | null
  unit?: string | null
  source: string
  lead_days?: number | null
  supplier_id?: number | null
  supplier_name?: string | null
  need_date?: string | null
  expected_date?: string | null
  ordered_at?: string | null
  status: string
  is_long_lead: boolean
  deliver_to?: string | null
  deliver_address?: string | null
  origin_request_id?: number | null
  remark?: string | null
}

export async function listMembers(no: string) {
  const { data } = await api.get<ProjectMember[]>(`/projects/${no}/members`)
  return data
}
export async function saveMember(no: string, userId: number, projectRole: string) {
  const { data } = await api.post(`/projects/${no}/members`, {
    user_id: userId,
    project_role: projectRole,
  })
  return data
}
export async function removeMember(no: string, memberId: number) {
  await api.delete(`/projects/${no}/members/${memberId}`)
}

export async function listEquipment(no: string) {
  const { data } = await api.get<EquipmentItem[]>(`/projects/${no}/equipment`)
  return data
}
export async function addEquipment(
  no: string,
  body: { equip_name: string; model?: string; kind?: string; line_no?: string; same_as?: string },
) {
  const { data } = await api.post<EquipmentItem>(`/projects/${no}/equipment`, body)
  return data
}
export async function updateEquipment(
  no: string,
  id: number,
  body: Partial<{ equip_name: string; model: string; kind: string; line_no: string; remark: string }>,
) {
  const { data } = await api.patch<EquipmentItem>(`/projects/${no}/equipment/${id}`, body)
  return data
}
export async function removeEquipment(no: string, id: number) {
  await api.delete(`/projects/${no}/equipment/${id}`)
}

export async function listMilestones(no: string) {
  const { data } = await api.get<MilestoneItem[]>(`/projects/${no}/milestones`)
  return data
}
export async function generateMilestones(no: string) {
  const { data } = await api.post<{ created: string[]; items: MilestoneItem[] }>(
    `/projects/${no}/milestones/generate`,
  )
  return data
}
export async function updateMilestone(
  no: string,
  id: number,
  body: Partial<{
    name: string
    plan_start: string | null
    plan_end: string | null
    owner_id: number | null
    status: string
    remark: string
  }>,
) {
  const { data } = await api.patch<MilestoneItem>(`/projects/${no}/milestones/${id}`, body)
  return data
}
export async function removeMilestone(no: string, id: number) {
  await api.delete(`/projects/${no}/milestones/${id}`)
}

export async function listPurchaseRequests(no: string) {
  const { data } = await api.get<PurchaseRequestItem[]>(`/projects/${no}/purchase-requests`)
  return data
}
export async function addPurchaseRequest(no: string, body: Record<string, unknown>) {
  const { data } = await api.post<PurchaseRequestItem>(`/projects/${no}/purchase-requests`, body)
  return data
}
export async function updatePurchaseRequest(no: string, id: number, body: Record<string, unknown>) {
  const { data } = await api.patch<PurchaseRequestItem>(
    `/projects/${no}/purchase-requests/${id}`,
    body,
  )
  return data
}
export async function removePurchaseRequest(no: string, id: number) {
  await api.delete(`/projects/${no}/purchase-requests/${id}`)
}

export async function initiateProject(no: string) {
  const { data } = await api.post<{
    project_no: string
    stage: string
    equipment_count: number
    milestone_count: number
    member_count: number
    long_lead_count: number
    long_lead_not_ordered: string[]
    task_count: number
  }>(`/projects/${no}/initiate`)
  return data
}

// ============================== 任务 ============================================

export interface TaskItem {
  id: number
  task_no: string
  project_no: string
  project_name?: string | null
  equip_no?: string | null
  task_type: string
  profession?: string | null
  title: string
  content?: string | null
  owner_id?: number | null
  owner_name?: string | null
  depends_on_id?: number | null
  parent_task_id?: number | null
  blocked?: boolean
  blocked_reason?: string | null
  plan_start?: string | null
  plan_end?: string | null
  status: string
  done_at?: string | null
  ref_type?: string | null
  ref_id?: number | null
  ref_no?: string | null
  remark?: string | null
}

export async function generateTasks(
  no: string,
  body: { professions: string[]; with_purchase: boolean },
) {
  const { data } = await api.post<{ created: number; unassigned: string[]; items: TaskItem[] }>(
    `/projects/${no}/generate-tasks`,
    body,
  )
  return data
}

export async function listProjectTasks(no: string) {
  const { data } = await api.get<TaskItem[]>(`/projects/${no}/tasks`)
  return data
}

export async function listMyTasks(status?: string, scope: 'mine' | 'team' = 'mine') {
  const params: Record<string, string> = { scope }
  if (status) params.status = status
  const { data } = await api.get<TaskItem[]>('/my-tasks', { params })
  return data
}

export async function splitTask(taskId: number, items: { owner_id: number; title?: string }[]) {
  const { data } = await api.post<TaskItem[]>(`/tasks/${taskId}/split`, { items })
  return data
}

export async function updateTask(
  id: number,
  body: Partial<{ status: string; owner_id: number; plan_start: string; plan_end: string; remark: string }>,
) {
  const { data } = await api.patch<TaskItem>(`/tasks/${id}`, body)
  return data
}

export async function taskSummary() {
  const { data } = await api.get<
    { owner: string; total: number; done: number; doing: number; todo: number }[]
  >('/tasks/summary')
  return data
}

// ============================== 工程设计（图纸 / 版本 / BOM）====================

export interface BomLine {
  id: number
  parent_ref: string
  child_item_no: string
  bom_source: string
  qty: number
  unit?: string | null
  pos_no?: string | null
  display_name?: string
  spec_text?: string | null
  brand?: string | null
  remark?: string | null
}

export interface VersionRow {
  version: string
  filename?: string | null
  change_reason?: string | null
  submitted_by?: string | null
  submitted_at?: string | null
  reviewed_by?: string | null
  reviewed_at?: string | null
  published_at?: string | null
  review_note?: string | null
  is_current: boolean
}

export interface DesignRoot {
  drawing_no: string
  title: string
  equip_no: string
  exists: boolean
}

export interface DesignTree {
  project_no: string
  equip_no: string
  root: DesignRoot
  tree: {
    drawing_no: string
    level: number
    parent_drawing_no?: string | null
    title: string
    kind: string
    qty: number
    unit: string
    source_type: string
    current_version: string
    status: string
    is_part: boolean
    owner_name?: string | null
  }[]
  std_bom: BomLine[]
  material_bom: BomLine[]
  state: string
  issues: {
    orphans: string[]
    empty_shells: string[]
    unpublished: string[]
    parts_without_material: string[]
  }
  counts: {
    drawings: number
    components: number
    parts: number
    self_made: number
    outsource: number
    std_items: number
    materials: number
  }
}

export interface DesignOverviewRow {
  equip_no: string
  equip_name: string
  state: string
  drawings: number
  parts: number
  unpublished: number
  parts_without_material: number
}

export async function getDesignOverview(projectNo: string) {
  const { data } = await api.get<DesignOverviewRow[]>(`/projects/${projectNo}/design-overview`)
  return data
}

export async function getDesignTree(projectNo: string, equipNo: string) {
  const { data } = await api.get<DesignTree>(
    `/projects/${projectNo}/equipment/${equipNo}/design`,
  )
  return data
}

export async function addDrawing(
  projectNo: string,
  equipNo: string,
  body: {
    parent_drawing_no?: string
    title: string
    qty?: number
    unit?: string
    source_type?: string
  },
) {
  const { data } = await api.post(`/projects/${projectNo}/equipment/${equipNo}/drawings`, body)
  return data
}

export async function updateDrawing(
  drawingNo: string,
  body: Partial<{ title: string; qty: number; unit: string; source_type: string; remark: string }>,
) {
  const { data } = await api.patch(`/drawings/${drawingNo}`, body)
  return data
}

export async function deleteDrawing(drawingNo: string) {
  await api.delete(`/drawings/${drawingNo}`)
}

export async function uploadDrawingDraft(drawingNo: string, changeReason: string, file?: File) {
  const form = new FormData()
  form.append('change_reason', changeReason ?? '')
  if (file) form.append('file', file)
  const { data } = await api.post(`/drawings/${drawingNo}/draft`, form)
  return data
}

// ============================== 设计评审（05 卷 §3） ==================================

export interface ReviewTicketBrief {
  id: number
  ticket_no: string
  task_id: number
  task_no?: string | null
  task_title?: string | null
  project_no: string
  equip_no?: string | null
  profession?: string | null
  submitter_id?: number | null
  submitter_name?: string | null
  status: string
  current_round: number
  created_at?: string | null
  updated_at?: string | null
}

export interface ReviewTicketItemRow {
  id: number
  round_no: number
  item_type: string
  item_label: string
  item_ref: string
  version?: string | null
  snapshot?: Record<string, unknown> | null
  submitted_by_name?: string | null
  submitted_at?: string | null
}

export interface ReviewActionRow {
  id: number
  round_no: number
  level: number
  reviewer_name?: string | null
  action: string
  note?: string | null
  acted_at?: string | null
}

export interface ReviewReleaseRow {
  release_no: string
  round_no: number
  released_by_name?: string | null
  released_at?: string | null
  summary?: Record<string, unknown> | null
}

export interface ReviewTicketDetail extends ReviewTicketBrief {
  items: ReviewTicketItemRow[]
  actions: ReviewActionRow[]
  releases: ReviewReleaseRow[]
}

export interface MyDesignTask {
  task_id: number
  task_no: string
  title: string
  profession?: string | null
  status: string
  parent_task_id?: number | null
  ticket: ReviewTicketBrief | null
}

export interface ReviewCandidate {
  drawings: { drawing_no: string; title: string; version: string; status: string; source_type: string; filename?: string | null }[]
  std_bom: { id: number; parent_ref: string; display_name: string; qty: number; unit?: string | null }[]
  material_bom: { id: number; parent_ref: string; display_name: string; qty: number; unit?: string | null }[]
  source_tags: { drawing_no: string; title: string; source_type: string; status: string }[]
  programs: { program_id: number; name: string; version: string; status: string; filename?: string | null }[]
}

export interface ReviewSelection {
  item_type: 'DRAWING' | 'BOM_DESIGN' | 'BOM_MATERIAL' | 'SOURCE_TAG' | 'PROGRAM'
  item_ref: string
  source_type?: string
}

export async function getMyDesignTasks(projectNo: string, equipNo: string) {
  const { data } = await api.get<MyDesignTask[]>(
    `/projects/${projectNo}/equipment/${equipNo}/my-design-tasks`,
  )
  return data
}

export async function getReviewCandidates(taskId: number) {
  const { data } = await api.get<ReviewCandidate>(`/tasks/${taskId}/review-candidates`)
  return data
}

export async function submitReview(taskId: number, items: ReviewSelection[], note: string) {
  const { data } = await api.post<ReviewTicketDetail>(`/tasks/${taskId}/submit-review`, {
    items,
    note,
  })
  return data
}

export async function getTicketByTask(taskId: number) {
  const { data } = await api.get<ReviewTicketDetail | null>(`/tasks/${taskId}/review-ticket`)
  return data
}

export async function listReviewTickets(scope: 'mine' | 'todo' | 'all', status?: string) {
  const params: Record<string, string> = { scope }
  if (status) params.status = status
  const { data } = await api.get<ReviewTicketBrief[]>('/review-tickets', { params })
  return data
}

export async function getReviewTicket(id: number) {
  const { data } = await api.get<ReviewTicketDetail>(`/review-tickets/${id}`)
  return data
}

export async function reviewTicket(id: number, action: '通过' | '退回', note: string) {
  const { data } = await api.post<ReviewTicketDetail>(`/review-tickets/${id}/review`, { action, note })
  return data
}

export async function withdrawTicket(id: number) {
  const { data } = await api.post<ReviewTicketDetail>(`/review-tickets/${id}/withdraw`)
  return data
}

// ============================== PLC 程序（05 卷 §8.1） ================================

export interface ProgramItem {
  id: number
  project_no: string
  equip_no: string
  name: string
  owner_id?: number | null
  owner_name?: string | null
  current_version: string
  status: string
  remark?: string | null
  current_filename?: string | null
}

export interface ProgramVersionRow {
  id: number
  version: string
  filename?: string | null
  change_reason?: string | null
  submitted_by?: string | null
  submitted_at?: string | null
  reviewed_by?: string | null
  published_by?: string | null
  published_at?: string | null
  review_note?: string | null
  is_current: boolean
}

export async function listPrograms(projectNo: string, equipNo: string) {
  const { data } = await api.get<ProgramItem[]>(`/projects/${projectNo}/equipment/${equipNo}/programs`)
  return data
}

export async function createProgram(
  projectNo: string,
  equipNo: string,
  body: { name: string; remark?: string },
) {
  const { data } = await api.post<ProgramItem>(`/projects/${projectNo}/equipment/${equipNo}/programs`, body)
  return data
}

export async function uploadProgramDraft(programId: number, changeReason: string, file?: File) {
  const form = new FormData()
  form.append('change_reason', changeReason ?? '')
  if (file) form.append('file', file)
  const { data } = await api.post<ProgramItem>(`/programs/${programId}/draft`, form)
  return data
}

export async function newProgramVersion(programId: number, changeReason: string) {
  const form = new FormData()
  form.append('change_reason', changeReason ?? '')
  const { data } = await api.post<ProgramItem>(`/programs/${programId}/new-version`, form)
  return data
}

export async function listProgramVersions(programId: number) {
  const { data } = await api.get<ProgramVersionRow[]>(`/programs/${programId}/versions`)
  return data
}

export async function deleteProgram(programId: number) {
  await api.delete(`/programs/${programId}`)
}

export async function newDrawingVersion(drawingNo: string, changeReason: string) {
  const form = new FormData()
  form.append('change_reason', changeReason ?? '')
  const { data } = await api.post(`/drawings/${drawingNo}/new-version`, form)
  return data
}

export async function listVersions(drawingNo: string) {
  const { data } = await api.get<VersionRow[]>(`/drawings/${drawingNo}/versions`)
  return data
}

export async function addBom(
  projectNo: string,
  kind: 'std' | 'material',
  body: { parent_ref: string; child_item_no: string; qty: number; pos_no?: string },
) {
  const { data } = await api.post(`/projects/${projectNo}/bom/${kind}`, body)
  return data
}

export async function removeBom(bomId: number) {
  await api.delete(`/bom/${bomId}`)
}

// ============================== 采购流程 ==========================================

export async function orderPurchase(
  projectNo: string,
  requestId: number,
  body: {
    supplier_id?: number
    supplier_name?: string
    po_no?: string
    unit_price?: number
    qty?: number
    ordered_at: string
    expected_date?: string
    deliver_to?: string
    deliver_address?: string
  },
) {
  const { data } = await api.post<PurchaseRequestItem>(
    `/projects/${projectNo}/purchase-requests/${requestId}/order`,
    body,
  )
  return data
}

export interface GoodsReceiptRow {
  id: number
  receipt_no: string
  project_no: string
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
}

export async function listGoodsReceipts(params: { deliver_to?: string; status?: string }) {
  const { data } = await api.get<GoodsReceiptRow[]>('/goods-receipts', { params })
  return data
}

/** 仓库验收（分批可多次）：合格 → 待入库；不合格 → 采购协商换货/退货 */
export async function inspectPurchase(
  projectNo: string,
  requestId: number,
  body: { receipt_date: string; qty: number; result: string; note?: string },
) {
  const { data } = await api.post<{
    receipt_no: string
    receipt_status: string
    request_status: string
    qty_received: number
  }>(`/projects/${projectNo}/purchase-requests/${requestId}/inspect`, body)
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
  project_no: string
  project_name?: string | null
  equip_no?: string | null
  part_no?: string | null
  part_title?: string | null
  qty: number
  need_date?: string | null
  source: string
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

export interface MergeOrderLineIn {
  request_id: number
  qty?: number
  unit_price?: number
}

export interface MergeOrderIn {
  supplier_id: number
  ordered_at: string
  expected_date?: string
  deliver_to: string
  deliver_address?: string
  po_no?: string
  lines: MergeOrderLineIn[]
  remark?: string
}

/** 合并下单：多条需求 → 一张采购单，共用一个 po_no */
export async function mergeOrder(body: MergeOrderIn) {
  const { data } = await api.post<{ po_no: string; count: number; total: number; supplier: string }>(
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
  unit?: string | null
  min_qty?: number | null
  lead_days?: number | null
  price_type: string
  quote_date: string
  valid_until?: string | null
  source?: string | null
  remark?: string | null
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
  }
  deals: QuoteRow[]
  quotes: QuoteRow[]
  ordered: {
    project_no: string
    unit_price?: number | null
    supplier_name?: string | null
    ordered_at?: string | null
    qty?: number | null
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
