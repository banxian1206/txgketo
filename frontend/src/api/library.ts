// api/library.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

export interface SpecFieldDef {
  code: string
  name: string
  type: 'text' | 'number' | 'enum'
  unit?: string
  required?: boolean
  options?: string[]
  group?: string
}

export interface StdClassInfo {
  code: string
  name: string
  spec_template?: SpecFieldDef[] | null
  item_count?: number
  category_code?: string
  category_name?: string
}

export interface StdCategoryInfo {
  code: string
  name: string
  classes: StdClassInfo[]
}

export interface StdItem {
  item_no: string
  display_name: string
  source_type: string
  std_class_code?: string | null
  std_class_name?: string | null
  category_code?: string | null
  spec?: Record<string, unknown> | null
  spec_text?: string | null
  unit: string
  brand?: string | null
  mfr_model?: string | null
  is_active: boolean
}

export async function listLibraryCategories() {
  const { data } = await api.get<StdCategoryInfo[]>('/library/categories')
  return data
}

export async function getLibraryClass(code: string) {
  const { data } = await api.get<StdClassInfo>(`/library/classes/${code}`)
  return data
}

export async function listStdItems(params: {
  class_code?: string
  category_code?: string
  q?: string
  limit?: number
}) {
  const { data } = await api.get<StdItem[]>('/library/items', { params })
  return data
}

export async function createStdItem(body: {
  std_class_code: string
  spec: Record<string, unknown>
  unit?: string
  brand?: string
  mfr_model?: string
}) {
  const { data } = await api.post<StdItem>('/library/items', body)
  return data
}

/** 物料详情（编辑时拉全量规格） */

export async function getStdItem(itemNo: string) {
  const { data } = await api.get<StdItem>(`/library/items/${itemNo}`)
  return data
}

/** 编辑物料（品牌/型号/规格/单位/停用）—— 部分更新 */

export async function updateStdItem(
  itemNo: string,
  body: { unit?: string; brand?: string; mfr_model?: string; is_active?: boolean; spec?: Record<string, unknown> },
) {
  const { data } = await api.patch<StdItem>(`/library/items/${itemNo}`, body)
  return data
}

// ============================== 立项（团队 / 设备 / 节点 / 长周期采购）==========

export interface ItemLite {
  item_no: string
  display_name: string
  spec_text?: string | null
  brand?: string | null
  unit?: string | null
  std_class_name?: string | null
}

/** 物料搜索（标准件库，按编码/品名/规格/品牌/型号模糊） */

export async function searchItems(q: string, limit = 30) {
  const { data } = await api.get<ItemLite[]>('/library/items', { params: { q, limit } })
  return data
}
