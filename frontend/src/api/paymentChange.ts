// 付款计划变更单（2026-09-30 客户拍板）：成交后改付款计划的**唯一入口**（要商务总监审批）
// 口径：只改未来节点（已收款的原样保留）、比例合计 100%、金额不超合同额。
import { api } from './http'

export interface PayChangeTerm {
  seq?: number
  node_name: string
  trigger_node?: string | null
  percent?: number | null
  amount?: number | null
  expect_date?: string | null
  condition?: string | null
  /** 只在 `before_terms`（变更前快照）里有：这条已经收了多少 */
  received_amount?: number | null
  received_date?: string | null
}

export interface PayChangeRow {
  id: number
  change_no: string
  project_no: string
  reason: string
  status: string
  before_terms: PayChangeTerm[]
  terms: PayChangeTerm[]
  requested_by?: number | null
  requested_by_name?: string | null
  requested_at?: string | null
  decided_by?: number | null
  decided_by_name?: string | null
  decided_at?: string | null
  decision_note?: string | null
}

/**
 * 谁能审哪张 —— **由后端说了算**（`scope=pending` 只回“该我批”的），
 * 前端绝不按 `position==='总监'` 猜（那会漂移成「看得见、点了必 403」）。
 */
export async function listMyPendingPaymentChanges() {
  const { data } = await api.get<PayChangeRow[]>('/payment-changes', { params: { scope: 'pending' } })
  return data
}

export async function listPaymentChanges(projectNo: string) {
  const { data } = await api.get<PayChangeRow[]>(`/projects/${projectNo}/payment-changes`)
  return data
}

export async function createPaymentChange(
  projectNo: string,
  body: { reason: string; terms: PayChangeTerm[] },
) {
  const { data } = await api.post<PayChangeRow>(`/projects/${projectNo}/payment-changes`, body)
  return data
}

export async function decidePaymentChange(id: number, body: { approve: boolean; note?: string }) {
  const { data } = await api.post<PayChangeRow>(`/payment-changes/${id}/decide`, body)
  return data
}

export async function withdrawPaymentChange(id: number) {
  const { data } = await api.post<PayChangeRow>(`/payment-changes/${id}/withdraw`)
  return data
}
