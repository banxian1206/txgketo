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

// ★ G5（09 卷 §3）：多视角齐套率 —— 项目视角（主）/ 跨项目汇总
/** 项目漏斗的 5 个态（顺序即漏斗） */
export const FUNNEL_ORDER = ['未买', '在途', '验收已入库', '已领料', '已做成成品'] as const

export interface KittingFunnel {
  project_no: string
  total: number
  total_qty: number
  buckets: Record<string, { count: number; qty: number }>
  by_kind: Record<string, { count: number; qty: number }>
  arrived_qty: number
  assembled_rate: number
}

export interface ProjectFunnelRow extends KittingFunnel {
  project_name: string
  stage: string
}

export async function kittingFunnel(projectNo: string) {
  const { data } = await api.get<KittingFunnel>('/assembly/kitting/funnel', {
    params: { project_no: projectNo },
  })
  return data
}

/** 跨项目汇总：同时多个项目在跑时，按项目看齐套分布 */
export async function kittingProjects() {
  const { data } = await api.get<ProjectFunnelRow[]>('/assembly/kitting/projects')
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

/** ★ §2.1：装配完成时登记【未装清单】（还剩哪些零件没装上）→ 发运清单 = 1 组装体 + N 个零件 */
export interface UnassembledLine {
  ref: string
  name?: string | null
  qty?: number | null
  unit?: string | null
}

export async function finishAssembly(
  id: number,
  body: { photos?: string[]; remark?: string; unassembled?: UnassembledLine[] } = {},
) {
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
