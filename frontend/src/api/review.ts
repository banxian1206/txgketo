// api/review.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

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
