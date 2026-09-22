// api/change.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

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
