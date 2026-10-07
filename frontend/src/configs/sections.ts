/**
 * 分区注册表（docs/14 · 全站分区化框架 P1）
 * ─────────────────────────────────────────────────────────────────────────────
 * 为什么要有这张表：**"页面上摆什么"过去是各页自由发挥** —— 结果是每个详情页都变成
 * 「卡片一个一个往下摆」（设备档案 2.3 屏、立项页 2.6 屏、工程台一个页签里 10 张卡）。
 *
 * 现在改成**声明式**：每个页面在下面声明自己有哪些分区（key / 标题 / 徽标口径 / 默认），
 * 壳（`components/ds/SectionNav`）统一负责分区条、`?tab=`、徽标、空态、键盘切换。
 *
 * 规矩（由护栏 `OBJ-*` / `SHELL-*` 盯着）：
 *   ① 一屏最多 **1 条台页签 + 1 条分区条**（同类两条即红 —— 退回 docs/12 批过的「三层标题」）
 *   ② **分区不嵌套**（分区里不许再出现视图切换）
 *   ③ **每个块必须归属于某个分区**（不许有"孤儿卡"）
 *   ④ **空分区保留**（显示"还没有记录"+ 入口），不隐藏 —— 范围完整本身是信息
 *   ⑤ 分区 key 进 `?tab=`（`useTab`），默认分区不写进 URL
 */
import type { ReactNode } from 'react'

export interface SectionDef {
  key: string
  label: string
  /** 徽标：该分区里有几件事（不传 = 不显示徽标） */
  badge?: number
  /** 默认分区（`?tab=` 为空时落这里；不标 = 落第一个可见分区） */
  default?: boolean
  /** 内容（渲染函数留在页面里：注册表只管"有哪些区、怎么标"，不管业务 JSX） */
  children?: ReactNode
}

/** 按可见分区算默认 key（与 `useTab` 的 fallback 用法一致） */
export function defaultSectionKey(sections: Pick<SectionDef, 'key' | 'default'>[]): string | undefined {
  return sections.find((s) => s.default)?.key ?? sections[0]?.key
}

/** 徽标人话：`0` 不显示（与全站"0 不占位"一致） */
export function badgeText(n?: number): string | undefined {
  return n && n > 0 ? String(n) : undefined
}

/* ─────────────────────────── 各页分区（登记处）───────────────────────────
 * 只登记"稳定页"（对象档案 / 表单 / 主数据）。台类页的页签在 `configs/tabs.ts`，
 * 两者分工：tabs.ts = 台内工作队列；sections.ts = 页内对象分区。
 * ------------------------------------------------------------------------- */

/** 设备档案：这台设备的一生（00 卷 §2.1 对售后的承诺） */
export const EQUIPMENT_SECTIONS: Pick<SectionDef, 'key' | 'label' | 'default'>[] = [
  { key: 'overview', label: '概览', default: true }, // 卡点/齐套/缺件 —— 最常被问的一句
  { key: 'drawing', label: '图纸' },
  { key: 'mfg', label: '制造' },
  { key: 'assy', label: '装配' },
  { key: 'ship', label: '发运' },
  { key: 'site', label: '现场' },
  { key: 'svc', label: '售后' },
  { key: 'timeline', label: '时间线' },
]

/** 件档案：一个图号 / 物料号的一生（铁律 2：图号 = 物料号 → 两者共用这一页） */
export const ITEM_SECTIONS: Pick<SectionDef, 'key' | 'label' | 'default'>[] = [
  { key: 'overview', label: '概览', default: true },
  { key: 'purchase', label: '采购与到货' },
  { key: 'stock', label: '库存与领料' },
  { key: 'mfg', label: '制造与外协' },
  { key: 'delivery', label: '交付与售后' },
  { key: 'change', label: '改版与时间线' },
]

/**
 * 项目详情（P3 · 2026-10-05 落地）
 * ★ 粒度取"**用户认得的话题**"，不是"数据库表"也不是"原来那张卡"：
 *   原来一区「合同与商务」装了 5 张卡（1880px = 2 屏）—— 切了等于没切。
 *   现在拆到"基本信息 / 客户与联系人 / 时间与金额 / 成交与付款"各自一区，每区 1 屏内。
 */
export const PROJECT_SECTIONS: Pick<SectionDef, 'key' | 'label' | 'default'>[] = [
  { key: 'overview', label: '概览', default: true }, // 卡点清单（最要紧的一句）
  { key: 'basic', label: '基本信息' },
  { key: 'customer', label: '客户与联系人' },
  { key: 'time', label: '时间与金额' },
  { key: 'deal', label: '成交与付款' },
  { key: 'scope', label: '范围与资料' },
  { key: 'exec', label: '执行进度' },
  { key: 'delivery', label: '交付与售后' },
  { key: 'logs', label: '操作记录' },
]

/** 立项页（P4 用）—— 就是现在的 ①–⑤ */
export const INITIATE_SECTIONS: Pick<SectionDef, 'key' | 'label' | 'default'>[] = [
  { key: 'team', label: '① 项目团队', default: true },
  { key: 'equipment', label: '② 设备清单' },
  { key: 'milestone', label: '③ 节点计划' },
  { key: 'longlead', label: '④ 长周期采购' },
  { key: 'tasks', label: '⑤ 任务分派' },
]

/** 新建商机：先建立责任与客户联系，再明确需求，最后补资料。 */
export const CREATE_SECTIONS: Pick<SectionDef, 'key' | 'label' | 'default'>[] = [
  { key: 'basic', label: '① 商机与联系', default: true },
  { key: 'require', label: '② 需求与时间' },
  { key: 'follow', label: '③ 资料与商务' },
]

/** 设计面（P3 用） */
export const DESIGN_SECTIONS: Pick<SectionDef, 'key' | 'label' | 'default'>[] = [
  { key: 'drawing', label: '图纸与 BOM', default: true },
  { key: 'std', label: '标准件' },
  { key: 'material', label: '原材料' },
  { key: 'program', label: 'PLC 程序' },
]

/** 商务部台（P6 · 2026-10-05）：2 区 */
export const SALES_SECTIONS: Pick<SectionDef, 'key' | 'label' | 'default'>[] = [
  { key: 'projects', label: '我的商机 / 项目', default: true },
  { key: 'payments', label: '待回款节点' },
]

/** 登记表：护栏 `OBJ-分区来自注册表` 用它校验（页面 key 必须在这里登记过） */
export const SECTION_REGISTRY: Record<string, Pick<SectionDef, 'key' | 'label'>[]> = {
  equipment: EQUIPMENT_SECTIONS,
  item: ITEM_SECTIONS,
  project: PROJECT_SECTIONS,
  initiate: INITIATE_SECTIONS,
  create: CREATE_SECTIONS,
  design: DESIGN_SECTIONS,
  sales: SALES_SECTIONS,
}
