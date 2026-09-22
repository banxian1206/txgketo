// api/assembly.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

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
