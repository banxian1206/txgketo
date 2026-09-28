// api/workbench.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

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
    /** ★ 到期扫描：我名下超期未完成的任务数 */
    overdue_tasks?: number
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
