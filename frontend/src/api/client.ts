import axios from 'axios'

export const TOKEN_KEY = 'txgk_token'
// 管理员「以某人身份查看」（只读，06 卷 §4）
export const IMPERSONATE_KEY = 'txgk_impersonate'
export const IMPERSONATE_NAME_KEY = 'txgk_impersonate_name'

export const api = axios.create({ baseURL: '/api/v1', timeout: 20000 })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  const imp = localStorage.getItem(IMPERSONATE_KEY)
  if (imp) config.headers['X-Impersonate'] = imp
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
  title?: string | null
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
  is_active?: boolean
  user_count?: number
}

/** 我的权限范围（06 卷 §4）：能不能管用户/组织、能勾哪些角色 */
export interface MyScope {
  is_admin: boolean
  can_manage_users: boolean
  can_manage_org: boolean
  department: { id: number; code: string; name: string } | null
  assignable_role_codes: string[] | null
  positions: string[]
}

export interface RoleRow {
  id: number
  code: string
  name: string
}

/** 工程部专业 / 岗位（06 卷 §3，与后端 PROFESSIONS / POSITIONS 对齐） */
export const PROFESSIONS = ['机械', '电气', '程序', '工艺']
export const POSITIONS = ['组员', '经理', '总监']

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

export async function listUsers(params?: {
  org_id?: number
  role_code?: string
  is_active?: boolean
  q?: string
}) {
  const { data } = await api.get<UserRow[]>('/users', { params })
  return data
}

export async function getMyScope() {
  const { data } = await api.get<MyScope>('/my-scope')
  return data
}

/** 前端权限判断（06 卷 §4）：读登录时存的 permissions */
export function hasPerm(code: string): boolean {
  try {
    const u = JSON.parse(localStorage.getItem('txgk_user') ?? '{}') as {
      is_superuser?: boolean
      permissions?: string[]
    }
    return u.is_superuser === true || (u.permissions ?? []).includes(code)
  } catch {
    return false
  }
}

/** 离职/停用一键转交（06 卷 §10） */
export async function handoverUser(userId: number, body: { to_user_id: number; deactivate: boolean }) {
  const { data } = await api.post<{ ok: boolean; moved: Record<string, number>; deactivated: boolean }>(
    `/users/${userId}/handover`,
    body,
  )
  return data
}

/** 演示账号（06 卷 §4，仅管理员）：一键生成 / 停用 / 启用 */
export interface DemoUserRow {
  username: string
  name: string
  password: string
  org?: string | null
  position: string
  profession?: string | null
  roles: string[]
  created: boolean
}

export async function generateDemoUsers() {
  const { data } = await api.post<{ action: string; password: string; users: DemoUserRow[] }>(
    '/demo-users',
    { action: 'create' },
  )
  return data
}

export async function setDemoUsersActive(action: 'enable' | 'disable') {
  const { data } = await api.post<{ action: string; count: number }>('/demo-users', { action })
  return data
}

// ------------------- 工作台（06 卷 §8）-------------------

export interface WorkbenchItem {
  key: string
  name: string
  route: string
  visible: boolean
}

export interface WorkbenchMe {
  user: {
    id: number
    name: string
    position?: string | null
    title?: string | null
    profession?: string | null
    roles: string[]
    department: { id: number; name: string } | null
  }
  workbenches: WorkbenchItem[]
  counts: {
    my_tasks: number
    to_review: number
    to_decide: number
    my_changes: number
    to_change: number
    to_inspect: number
    to_store: number
    issues: number
    to_purchase: number
    shop_wait: number
    shop_accept: number
    shop_transfer: number
    shop_assembling: number
    shop_debug: number
    my_leads: number
    my_projects: number
    unread: number
  }
  my_projects: { project_no: string; project_name: string; stage: string }[]
}

export async function workbenchMe() {
  const { data } = await api.get<WorkbenchMe>('/workbench/me')
  return data
}

// ------------------- 工程部看板（06 卷 §3）-------------------

export interface EngCell {
  state: string
  task_no?: string | null
  owner?: string | null
  release_no?: string | null
  ticket_status?: string | null
  overdue: boolean
  plan_end?: string | null
}

export interface EngEquipment {
  project_no: string
  project_name?: string | null
  equip_no: string
  equip_name: string
  professions: Record<string, EngCell>
  released_count: number
  blocked: string[]
}

export interface EngBoard {
  summary: {
    equipments: number
    all_released: number
    blocked: number
    pending_reviews: number
    pending_changes: number
    overdue_tasks: number
    released: number
  }
  equipments: EngEquipment[]
  pending_reviews: {
    id: number
    ticket_no: string
    project_no: string
    equip_no?: string | null
    profession?: string | null
    submitter?: string | null
    round: number
  }[]
  pending_changes: {
    id: number
    cr_no: string
    target_type: string
    target_ref: string
    project_no: string
    equip_no?: string | null
    reason: string
  }[]
  overdue_tasks: {
    id: number
    task_no: string
    title: string
    profession?: string | null
    owner?: string | null
    plan_end?: string | null
    status: string
  }[]
}

export async function engBoard() {
  const { data } = await api.get<EngBoard>('/workbench/eng/board')
  return data
}

// ------------------- 商务部 / 项目经理 看板（06 卷 §3）-------------------

export interface SalesBoard {
  summary: {
    my_leads: number
    to_initiate: number
    executing: number
    overdue_followup: number
    payments_due: number
    payments_overdue: number
  }
  projects: {
    project_no: string
    project_name: string
    stage: string
    deadline?: string | null
    amount: number
    unpaid: number
    overdue_follow: boolean
  }[]
  payments: {
    project_no: string
    node_name: string
    amount: number
    unpaid: number
    expect_date?: string | null
    overdue: boolean
  }[]
}

export async function salesBoard() {
  const { data } = await api.get<SalesBoard>('/workbench/sales/board')
  return data
}

export interface PmProjectRow {
  project_no: string
  project_name: string
  stage: string
  deadline?: string | null
  delivery_days?: number | null
  design_done: number
  design_total: number
  purchase: { to_purchase: number; in_transit: number; stored: number }
  overdue_tasks: number
  shortage: number
  risks: string[]
}

export interface PmBoard {
  summary: { projects: number; at_risk: number; shortage: number; overdue_tasks: number; in_transit: number }
  projects: PmProjectRow[]
}

export async function pmBoard() {
  const { data } = await api.get<PmBoard>('/workbench/pm/board')
  return data
}

// ------------------- 站内消息（06 卷 §9）-------------------

export interface NotificationRow {
  id: number
  type: string
  title: string
  body?: string | null
  link?: string | null
  is_read: boolean
  created_at?: string | null
}

export async function listNotifications(unreadOnly = false) {
  const { data } = await api.get<{ unread: number; items: NotificationRow[] }>('/notifications', {
    params: unreadOnly ? { unread: true } : {},
  })
  return data
}

export async function unreadNotificationCount() {
  const { data } = await api.get<{ count: number }>('/notifications/unread-count')
  return data.count
}

export async function markNotificationRead(id: number) {
  await api.post(`/notifications/${id}/read`)
}

export async function markAllNotificationsRead() {
  const { data } = await api.post<{ ok: boolean; count: number }>('/notifications/read-all')
  return data
}

export async function createOrg(body: {
  name: string
  parent_id?: number | null
  kind?: string | null
}) {
  const { data } = await api.post<OrgRow>('/orgs', body)
  return data
}

export async function updateOrg(
  id: number,
  body: { name?: string; parent_id?: number | null; kind?: string | null; is_active?: boolean },
) {
  const { data } = await api.patch<OrgRow>(`/orgs/${id}`, body)
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
  title?: string | null
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
    title?: string | null
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

export interface ChangeBrief {
  id: number
  cr_no: string
  status: string
  change_task_owner_id?: number | null
}

export interface ChangeRequestRow {
  id: number
  cr_no: string
  project_no: string
  equip_no?: string | null
  target_type: string
  target_label: string
  target_ref: string
  target_version?: string | null
  target_title: string
  profession?: string | null
  part_no?: string | null
  reason: string
  proposal?: string | null
  applicant_id?: number | null
  applicant_name?: string | null
  status: string
  decided_by_name?: string | null
  decided_at?: string | null
  decision_note?: string | null
  solution?: string | null
  change_task_id?: number | null
  change_task_no?: string | null
  change_task_owner_id?: number | null
  change_task_owner?: string | null
  change_task_status?: string | null
  new_release_id?: number | null
  new_release_no?: string | null
  archived_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface ChangeImpact {
  purchase_requests: {
    id: number
    item_no: string
    qty: number
    unit?: string | null
    status: string
    po_no?: string | null
    qty_received: number
    part_no?: string | null
    source: string
    need_date?: string | null
  }[]
  material_issues: {
    issue_no: string
    status: string
    qty_required: number
    qty_issued: number
    project_no: string
  }[]
  has_open_purchase: boolean
  note: string
}

export async function listChangeRequests(scope: 'all' | 'pending' | 'mine' | 'todo', status?: string) {
  const params: Record<string, string> = { scope }
  if (status) params.status = status
  const { data } = await api.get<ChangeRequestRow[]>('/change-requests', { params })
  return data
}

export async function createChangeRequest(body: {
  target_type: 'DRAWING' | 'PROGRAM' | 'BOM_ITEM'
  target_ref: string
  reason: string
  proposal?: string | null
}) {
  const { data } = await api.post<ChangeRequestRow>('/change-requests', body)
  return data
}

export async function getChangeRequest(id: number) {
  const { data } = await api.get<ChangeRequestRow>(`/change-requests/${id}`)
  return data
}

export async function decideChangeRequest(
  id: number,
  body: { decision: '批准' | '否决'; note?: string; solution?: string },
) {
  const { data } = await api.post<ChangeRequestRow>(`/change-requests/${id}/decide`, body)
  return data
}

export async function dispatchChangeRequest(id: number, assigneeId: number) {
  const { data } = await api.post<ChangeRequestRow>(`/change-requests/${id}/dispatch`, {
    assignee_id: assigneeId,
  })
  return data
}

export async function reviseChangeBom(
  id: number,
  body: { qty?: number; child_item_no?: string | null; pos_no?: string | null; remark?: string | null },
) {
  const { data } = await api.post<{ ok: boolean; bom_id: number; status: string }>(
    `/change-requests/${id}/revise-bom`,
    body,
  )
  return data
}

export async function changeImpact(id: number) {
  const { data } = await api.get<ChangeImpact>(`/change-requests/${id}/impact`)
  return data
}

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
  status?: string
  owner_id?: number | null
  frozen_release_id?: number | null
  change_request?: ChangeBrief | null
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
    change_request?: ChangeBrief | null
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
  change_request?: ChangeBrief | null
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
    receipt_id: number
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
export async function fetchFileBlob(path: string): Promise<{ url: string; type: string }> {
  const { data } = await api.get(path, { responseType: 'blob' })
  const blob = data as Blob
  return { url: URL.createObjectURL(blob), type: blob.type || '' }
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
export async function generateEquipmentIssue(projectNo: string, equipNo: string) {
  const { data } = await api.post<{
    issue_no: string
    line_count: number
    shortage_count: number
    lines: { display_name: string; qty_required: number; shortage: boolean }[]
  }>(`/warehouse/projects/${projectNo}/equipment/${equipNo}/generate-issue`)
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

// ============================== 物料搜索 / 库位 / 其他入库 =============================

export interface ItemLite {
  item_no: string
  display_name: string
  spec_text?: string | null
  brand?: string | null
  unit?: string | null
  std_class_name?: string | null
}

/** 物料搜索（标准件库，按编码/品名/规格/品牌/型号模糊） */
export async function searchItems(q: string, limit = 30) {
  const { data } = await api.get<ItemLite[]>('/items', { params: { q, limit } })
  return data
}

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

export interface KittingLine {
  ref: string
  name?: string | null
  kind: string
  source: string
  qty: number
  unit?: string | null
  ready: boolean
  state: string
}

export interface KittingResult {
  project_no: string
  equip_no: string
  total: number
  arrived: number
  total_qty: number
  arrived_qty: number
  kitting_rate: number
  missing: KittingLine[]
  lines: KittingLine[]
}

export interface KittingOverviewRow {
  equip_no: string
  equip_name: string
  total: number
  arrived: number
  total_qty: number
  arrived_qty: number
  kitting_rate: number
}

export interface AssemblyRecordRow {
  id: number
  project_no: string
  equip_no: string
  sub_assembly: string
  kitting_rate: number
  total_qty: number
  arrived_qty: number
  status: string
  assembled_at?: string | null
  photos: string[]
  debug_at?: string | null
  debug_result?: string | null
  debug_note?: string | null
  debug_photos: string[]
  remark?: string | null
}

export async function getKitting(projectNo: string, equipNo: string) {
  const { data } = await api.get<KittingResult>('/assembly/kitting', {
    params: { project_no: projectNo, equip_no: equipNo },
  })
  return data
}

export async function kittingOverview(projectNo: string) {
  const { data } = await api.get<KittingOverviewRow[]>('/assembly/kitting/overview', {
    params: { project_no: projectNo },
  })
  return data
}

export async function listAssemblyRecords(params?: { project_no?: string; equip_no?: string }) {
  const { data } = await api.get<AssemblyRecordRow[]>('/assembly/records', { params })
  return data
}

export async function startAssembly(body: {
  project_no: string
  equip_no: string
  sub_assembly: string
  photos?: string[]
  remark?: string
}) {
  const { data } = await api.post<AssemblyRecordRow>('/assembly/records', body)
  return data
}

export async function finishAssembly(id: number, body: { photos?: string[]; remark?: string } = {}) {
  const { data } = await api.post<AssemblyRecordRow>(`/assembly/records/${id}/finish`, body)
  return data
}

export async function debugAssembly(
  id: number,
  body: { result: string; note?: string; photos?: string[] },
) {
  const { data } = await api.post<AssemblyRecordRow>(`/assembly/records/${id}/debug`, body)
  return data
}

// ============================== 发运（S7）=============================
// PM 勾选要发的设备 → 发货指令 → 打包 → 装车（拍照）→ 发运（分批）→ 现场到货验收。

export interface ToShipRow {
  equip_no: string
  equip_name: string
  assembly_status?: string | null
  kitting_rate: number
  ready: boolean
  in_open_shipment: boolean
}

export interface PackingItemRow {
  id: number
  equip_no?: string | null
  part_item_no: string
  part_name?: string | null
  qty: number
  package_no?: string | null
  weight?: number | null
  size?: string | null
  disassembled: boolean
  photos: string[]
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
  shortage_detail: { equip_no?: string; item?: string; qty?: number; reason?: string }[]
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
  packing: PackingItemRow[]
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

export async function packShipment(
  id: number,
  items: {
    equip_no?: string
    part_item_no: string
    part_name?: string
    qty: number
    package_no?: string
    weight?: number
    size?: string
    disassembled?: boolean
    photos?: string[]
    remark?: string
  }[],
) {
  const { data } = await api.post<ShipmentRow>(`/shipping/${id}/pack`, { items })
  return data
}

export async function loadShipment(
  id: number,
  body: { vehicle?: string; driver?: string; plate_no?: string; photos: string[]; remark?: string },
) {
  const { data } = await api.post<ShipmentRow>(`/shipping/${id}/load`, body)
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
    result: string
    shortage_detail?: { equip_no?: string; item?: string; qty?: number; reason?: string }[]
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

export interface SiteSurveyRow {
  id: number
  project_no: string
  surveyed_at?: string | null
  contact?: string | null
  floor_load?: string | null
  passage?: string | null
  power?: string | null
  air?: string | null
  network?: string | null
  enter_date?: string | null
  photos: string[]
  remark?: string | null
}

export interface SiteDailyRow {
  id: number
  project_no: string
  equip_no?: string | null
  report_date?: string | null
  stage: string
  done_items: string[]
  people?: number | null
  photos: string[]
  videos: string[]
  problem?: string | null
  remark?: string | null
}

export interface SiteIssueRow {
  id: number
  project_no: string
  equip_no?: string | null
  title: string
  desc?: string | null
  photos: string[]
  status: string
  related_change_id?: number | null
  closed_at?: string | null
}

export interface SiteCommissionRow {
  id: number
  project_no: string
  request_at?: string | null
  dispatch_to?: string | null
  plan_date?: string | null
  arrived_at?: string | null
  status: string
  remark?: string | null
}

export interface SiteIncomingPending {
  receipt_id: number
  receipt_no: string
  item_no: string
  qty: number
  unit?: string | null
  receipt_date?: string | null
  deliver_to: string
  status: string
  location?: string | null
}

export interface SiteWorkbench {
  counts: {
    surveyed: number
    daily_today: number
    open_issues: number
    to_dispatch: number
    debugging: number
  }
  surveys: SiteSurveyRow[]
  dailies: SiteDailyRow[]
  issues: SiteIssueRow[]
  commissions: SiteCommissionRow[]
}

export async function siteWorkbench(projectNo?: string) {
  const { data } = await api.get<SiteWorkbench>('/site/workbench', {
    params: projectNo ? { project_no: projectNo } : {},
  })
  return data
}

export async function listSiteSurvey(projectNo: string) {
  const { data } = await api.get<SiteSurveyRow[]>('/site/survey', { params: { project_no: projectNo } })
  return data
}

export async function saveSiteSurvey(body: Record<string, unknown>) {
  const { data } = await api.post<SiteSurveyRow>('/site/survey', body)
  return data
}

export async function addSiteDaily(body: {
  project_no: string
  equip_no?: string
  report_date?: string
  stage: string
  done_items?: string[]
  people?: number
  photos?: string[]
  videos?: string[]
  problem?: string
  remark?: string
}) {
  const { data } = await api.post<SiteDailyRow>('/site/daily', body)
  return data
}

export async function listSiteIssues(projectNo: string) {
  const { data } = await api.get<SiteIssueRow[]>('/site/issues', { params: { project_no: projectNo } })
  return data
}

export async function addSiteIssue(body: {
  project_no: string
  equip_no?: string
  title: string
  desc?: string
  photos?: string[]
}) {
  const { data } = await api.post<SiteIssueRow>('/site/issues', body)
  return data
}

export async function linkSiteIssue(id: number, body: { change_id?: number; close?: boolean }) {
  const { data } = await api.post<SiteIssueRow>(`/site/issues/${id}/link-change`, body)
  return data
}

export async function listSiteCommission(projectNo?: string) {
  const { data } = await api.get<SiteCommissionRow[]>('/site/commission', {
    params: projectNo ? { project_no: projectNo } : {},
  })
  return data
}

export async function requestCommission(body: {
  project_no: string
  dispatch_to?: string
  plan_date?: string
  remark?: string
}) {
  const { data } = await api.post<SiteCommissionRow>('/site/commission', body)
  return data
}

export async function commissionArrive(id: number) {
  const { data } = await api.post<SiteCommissionRow>(`/site/commission/${id}/arrive`)
  return data
}

export async function commissionStart(id: number) {
  const { data } = await api.post<SiteCommissionRow>(`/site/commission/${id}/start`)
  return data
}

export async function siteIncoming(projectNo: string) {
  const { data } = await api.get<{ pending: SiteIncomingPending[]; done: SiteIncomingPending[] }>(
    '/site/incoming',
    { params: { project_no: projectNo } },
  )
  return data
}

export async function acceptSiteIncoming(
  receiptId: number,
  body: {
    result: string
    shortage_detail?: { item?: string; qty?: number; reason?: string }[]
    photos: string[]
    remark?: string
  },
) {
  const { data } = await api.post(`/site/incoming/${receiptId}/accept`, body)
  return data
}

export async function uploadSitePhotos(projectNo: string, ref: string, files: File[]) {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  const { data } = await api.post<{ token: string; filename: string }[]>('/site/photos', form, {
    params: { project_no: projectNo, ref },
  })
  return data
}

export function sitePhotoUrl(token: string) {
  return `/site/photos?token=${encodeURIComponent(token)}`
}

// ============================== 验收与质保（S10）=============================
// 调试完成 → 申请客户验收 → 上传资料包 → 客户签字确认 → ★ 自动进入质保期。

export interface AcceptanceDocRow {
  id: number
  acceptance_id: number
  doc_type: string
  filename: string
  is_signed: boolean
  signed_at?: string | null
  remark?: string | null
}

export interface AcceptanceRow {
  id: number
  project_no: string
  project_name?: string | null
  applied_at?: string | null
  accepted_at?: string | null
  signed_by?: string | null
  result?: string | null
  status: string
  warranty_months?: number | null
  warranty_start?: string | null
  warranty_end?: string | null
  photos: string[]
  remark?: string | null
  documents: AcceptanceDocRow[]
  doc_count: number
  signed_count: number
}

export interface WarrantyWatchRow {
  project_no: string
  project_name?: string | null
  warranty_start?: string | null
  warranty_end?: string | null
  days_left?: number | null
  warranty_amount?: number | null
}

export interface AcceptanceWorkbench {
  counts: { pending: number; passed: number; rejected: number }
  acceptances: AcceptanceRow[]
  warranty_watch: WarrantyWatchRow[]
}

export async function acceptanceWorkbench() {
  const { data } = await api.get<AcceptanceWorkbench>('/acceptance/workbench')
  return data
}

export async function listAcceptances(projectNo?: string) {
  const { data } = await api.get<AcceptanceRow[]>('/acceptance', {
    params: projectNo ? { project_no: projectNo } : {},
  })
  return data
}

export async function applyAcceptance(body: { project_no: string; remark?: string }) {
  const { data } = await api.post<AcceptanceRow>('/acceptance/apply', body)
  return data
}

export async function uploadAcceptanceDocs(id: number, docType: string, files: File[], remark?: string) {
  const form = new FormData()
  form.append('doc_type', docType)
  if (remark) form.append('remark', remark)
  files.forEach((f) => form.append('files', f))
  const { data } = await api.post<AcceptanceDocRow[]>(`/acceptance/${id}/documents`, form)
  return data
}

export function acceptanceDocUrl(docId: number) {
  return `/acceptance/documents/${docId}`
}

export async function signAcceptanceDoc(docId: number) {
  const { data } = await api.post<AcceptanceDocRow>(`/acceptance/documents/${docId}/sign`)
  return data
}

export async function confirmAcceptance(
  id: number,
  body: { result: string; signed_by?: string; accepted_at?: string; remark?: string },
) {
  const { data } = await api.post<AcceptanceRow>(`/acceptance/${id}/confirm`, body)
  return data
}

export async function finishCommission(id: number) {
  const { data } = await api.post<{ id: number; status: string }>(`/site/commission/${id}/finish`)
  return data
}
