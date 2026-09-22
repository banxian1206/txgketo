// api/initiate.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

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

export async function addMilestone(
  no: string,
  body: { name: string; plan_start?: string | null; plan_end?: string | null; owner_id?: number | null; status?: string; remark?: string | null },
) {
  const { data } = await api.post<MilestoneItem>(`/projects/${no}/milestones`, body)
  return data
}

export async function clearMilestones(no: string) {
  await api.post(`/projects/${no}/milestones/clear`)
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
