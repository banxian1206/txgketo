// api/design.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

import { ChangeBrief } from './change'
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
