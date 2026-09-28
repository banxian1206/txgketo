// api/site.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

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
  /** ★ G3：问题归属的零件（图号 / 物料号 + 名称快照） */
  drawing_no?: string | null
  item_no?: string | null
  part_name?: string | null
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
  /** ★ G3：挂到具体零件（图号，或标准件/原材料的物料号） */
  drawing_no?: string
  item_no?: string
  part_name?: string
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

export async function finishCommission(id: number) {
  const { data } = await api.post<{ id: number; status: string }>(`/site/commission/${id}/finish`)
  return data
}

// ============================== 售后（S11）=============================
// 报修受理 → 派工 → 到场 → 处理（备件更换）→ 客户签字 → 关闭；备件收发留痕。
