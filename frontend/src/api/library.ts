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
  /** ★ 有历史价的条数（2026-10-07）：与价格库同一口径（`services/pricing`）——
   *  「看得到才能选得对」：选料时先知道这个品类里有多少料是能比价的。 */
  priced_count?: number
  category_code?: string
  category_name?: string
}

export interface StdCategoryInfo {
  code: string
  name: string
  /** ★ 这个类别归谁选（2026-10-07 客户口径）：设计 / 工艺 / 采购 / 皆可。
   *  `采购` 的语义是「对设计/工艺隐藏」，不是「只有采购看得到」。 */
  select_by?: string
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

export interface StdItemPrice {
  /** 历史成交条数（0 = 没历史价） */
  quote_count?: number
  /** 几家供过 */
  supplier_count?: number
  last_price?: number | null
  /** ≥2 家 → 可比价；≥3 家 → 可放心推荐（阈值见后端 pricing） */
  comparable?: boolean
  recommendable?: boolean
}

/** 标准库物料 + 价格可用性（`GET /library/items/page`） */
export interface StdItemPaged extends StdItem, StdItemPrice {}

export interface StdItemPage {
  total: number
  offset: number
  limit: number
  items: StdItemPaged[]
}

/**
 * 标准库物料 · **真服务端分页**（2026-10-07「两页统一标准」）。
 *
 * 与 `listStdItems` 的分工：那个是**选料候选搜索**（只取前 30~50 条，返回数组）；
 * 这个是**台账**（返回 `{total, items}`，带每行的价格可用性）。
 * 两者共存 —— 改老接口的返回形状会让所有选料弹窗静默失败。
 */
export async function listStdItemsPaged(params: {
  class_code?: string
  category_code?: string
  q?: string
  /** true = 跨全库搜（否则搜当前品类） */
  all_classes?: boolean
  /** 只看有历史价的 */
  only_priced?: boolean
  /** ★ 挂料按职责收口：design=设计+皆可 / process=工艺+皆可 / 不传=全量（采购） */
  pick_for?: 'design' | 'process' | 'purchase'
  limit?: number
  offset?: number
}) {
  const { data } = await api.get<StdItemPage>('/library/items/page', { params })
  return data
}

export async function listStdItems(params: {
  class_code?: string
  category_code?: string
  q?: string
  /** ★ 挂料按职责收口：design=设计+皆可 / process=工艺+皆可 / 不传=全量（采购） */
  pick_for?: 'design' | 'process' | 'purchase'
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
