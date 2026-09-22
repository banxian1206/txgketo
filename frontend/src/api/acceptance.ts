// api/acceptance.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

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
