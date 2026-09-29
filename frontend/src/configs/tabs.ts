import { hasPerm } from '../api/user'
import { readSession } from '../contexts/session'

/**
 * 页签注册表（重整方案 P0 · docs/10 §3.2）。
 *
 * 立这条的唯一目的：**页签条必须按权限过滤，且判断依据只能是"后端告诉我的能力"**——
 * 真实权限码（`hasPerm('mfg:view')`）或后端 scope（`can_manage_users`），
 * 不许再用 `position === '总监'` 这类前端猜岗位（docs/10 §1.5：那样造出「看得见、点了必 403」）。
 *
 * 用法（配合 hooks/useTab）：
 *   const vis = filterTabs(PURCHASE_TABS, { counts })
 *   const [tab, setTab] = useTab(vis.map(t => t.key))
 * 过滤后只剩 1 项 → 页面自己决定不画条；0 项 → 整页由路由守卫挡住。
 */
export interface TabDef {
  key: string
  label: string
  /** 真实权限码，命中任一即可见（未给 = 人人可见） */
  anyOf?: string[]
  /** 纯写动作队列：「以某人身份查看」（只读态）下隐藏，避免点进去满屏 403 */
  writeOnly?: boolean
  /** 自定义可见性（用后端返回的能力，如 /my-scope 的 can_manage_users） */
  show?: () => boolean
  /** 角标取自哪个计数字段（>0 才显示，全站唯一口径） */
  countKey?: string
}

/** 是否处于「以某人身份查看」（只读，06 卷 §4） */
export function isImpersonating(): boolean {
  return readSession()?.impersonateId !== undefined
}

export function tabVisible(def: TabDef): boolean {
  if (def.show && !def.show()) return false
  if (def.anyOf?.length && !def.anyOf.some((c) => hasPerm(c))) return false
  if (def.writeOnly && isImpersonating()) return false
  return true
}

export function filterTabs(defs: TabDef[]): TabDef[] {
  return defs.filter(tabVisible)
}

/** 角标：只在 `counts[countKey] > 0` 时拼上去（禁止前端自己再数一遍） */
export function tabLabel(def: TabDef, counts?: Record<string, number> | null): string {
  const n = def.countKey ? (counts?.[def.countKey] ?? 0) : 0
  return n > 0 ? `${def.label} (${n})` : def.label
}

/* ─────────────────────────── 各台的页签定义 ─────────────────────────── */

/** 采购工作台（键与页面现状一一对应；「验收不合格 + 退换记录 → 异常处理」的内容合并留给 P2） */
export const PURCHASE_TABS: TabDef[] = [
  { key: 'approve', label: '待我审批', anyOf: ['purchase:edit'], writeOnly: true },
  { key: 'pool', label: '采购池', anyOf: ['purchase:view', 'purchase:edit'] },
  { key: 'orders', label: '采购单', anyOf: ['purchase:view', 'purchase:edit'] },
  { key: 'arrivals', label: '到货跟踪', anyOf: ['purchase:view', 'purchase:edit'] },
  { key: 'failed', label: '验收不合格', anyOf: ['purchase:edit'], writeOnly: true },
  { key: 'resolve', label: '退换记录', anyOf: ['purchase:edit'] },
  { key: 'storage', label: '入库记录', anyOf: ['purchase:view', 'purchase:edit'] },
  { key: 'reference', label: '价格参考', anyOf: ['purchase:price'] },
  { key: 'suppliers', label: '供应商', anyOf: ['purchase:view', 'purchase:edit'] },
]

/** 仓库工作台 —— P2 已把「待办」拆成三个队列页签（与手机端 /m/warehouse 同构） */
export const WAREHOUSE_TABS: TabDef[] = [
  { key: 'incoming', label: '待验收', anyOf: ['warehouse:edit'], writeOnly: true },
  { key: 'storage', label: '待入库', anyOf: ['warehouse:edit'], writeOnly: true },
  { key: 'issues', label: '待领料', anyOf: ['warehouse:edit'], writeOnly: true },
  { key: 'stock', label: '库存', anyOf: ['warehouse:view', 'warehouse:edit'] },
  { key: 'moves', label: '出入库流水', anyOf: ['warehouse:view', 'warehouse:edit'] },
  { key: 'locations', label: '库位', anyOf: ['warehouse:view', 'warehouse:edit'] },
]

/** 车间工作台 · 制造（流程队列） */
export const MFG_TABS: TabDef[] = [
  { key: 'wait', label: '待下发', anyOf: ['mfg:view'] },
  { key: 'running', label: '在制 / 待验收', anyOf: ['mfg:view'] },
  { key: 'transfer', label: '待转运', anyOf: ['mfg:view'] },
  { key: 'rework', label: '返工', anyOf: ['mfg:view'] },
  { key: 'outsource', label: '外协', anyOf: ['mfg:view'] },
]

/** 现场工作台（PC 不做客户验收签认 —— 动线在手机端，docs/10 §8.1 D3） */
export const SITE_TABS: TabDef[] = [
  { key: 'survey', label: '勘测', anyOf: ['site:edit', 'project:edit'] },
  { key: 'incoming', label: '来货清点', anyOf: ['site:edit', 'project:edit'] },
  { key: 'daily', label: '每日汇报', anyOf: ['site:edit', 'project:edit'] },
  { key: 'commission', label: '申请调试', anyOf: ['site:edit', 'project:edit'] },
  { key: 'issues', label: '现场问题', anyOf: ['site:edit', 'project:edit'] },
]

/** 售后工作台 */
export const SERVICE_TABS: TabDef[] = [
  { key: 'orders', label: '服务工单', anyOf: ['service:edit'] },
  { key: 'parts', label: '备件', anyOf: ['service:edit'] },
]

/** 工程部工作台（我的 / 我组 / 部门看板）
 *  ★ 不用 design:audit 裁：/workbench/eng/board 与 /my-tasks?scope=team 后端**只要登录**，
 *    而 craft_manager（工艺经理）的角色是 CRAFT、没有 design:audit —— 用它裁就是把干活的人拦在门外（M-04 同款）。
 *    权限收紧的正确做法是先给后端接口加码，再让前端跟着（顺序别反）。 */
export const ENG_TABS: TabDef[] = [
  { key: 'mine', label: '我的' },
  { key: 'team', label: '我组' },
  { key: 'board', label: '部门看板' },
]

/** 项目经理台：看板 + 验收与质保（docs/10 §8.5 待拍板 A 的默认归属） */
export const PM_TABS: TabDef[] = [
  { key: 'board', label: '看板' },
  { key: 'acceptance', label: '验收与质保', anyOf: ['acceptance:edit'] },
]

/** 设计评审（视图三分；"待我处理"不裁角色，靠角标提示，避免误藏 craft_manager） */
export const REVIEW_TABS: TabDef[] = [
  { key: 'todo', label: '待我处理' },
  { key: 'mine', label: '我提交的' },
  { key: 'all', label: '全部' },
]

/** 改版申请（4→3：裁决 + 待改版合一，同一人不会同时命中两类） */
export const CHANGE_TABS: TabDef[] = [
  // 「待我裁决 + 待我改版 → 待我处理」的合并留给 P2（要重排 JSX，单独一轮做）
  { key: 'pending', label: '待我裁决' },
  { key: 'todo', label: '待我改版' },
  { key: 'mine', label: '我提的' },
  { key: 'all', label: '全部' },
]

/** 用户与权限（可见性来源=后端 /my-scope 与 system:admin，不再前端猜岗位）
 *  `canManageUsers` 由页面从 /my-scope 取并传进 show() —— 见 features/admin/Page.tsx */
/** 用户与权限页 —— ★ 可见性一律用**后端下发的码**：
 *  `admin:users` / `admin:audit` 是派生码（`deps.effective_permissions` ← `_scope()`：管理员=全部、总监=本部门），
 *  `system:admin` 只有 ADMIN 角色有 —— 于是「外部集成」不再对 4 位总监 + gm 显示（他们点了必 403）。
 */
export const USERS_TABS: TabDef[] = [
  { key: 'users', label: '用户', anyOf: ['admin:users'] },
  { key: 'org', label: '组织架构', anyOf: ['admin:users'] },
  { key: 'roles', label: '角色说明', anyOf: ['admin:users'] },
  { key: 'integration', label: '外部集成', anyOf: ['system:admin'] },
  { key: 'logs', label: '操作日志', anyOf: ['admin:audit'] },
]

/** 我的任务：归属用 Segmented（已经是筛选器），状态这组页签 P2 降级为筛选器 */
export const TASK_TABS: TabDef[] = [
  { key: '未完成', label: '未完成' },
  { key: '待开始', label: '待开始' },
  { key: '进行中', label: '进行中' },
  { key: '已完成', label: '已完成' },
  { key: '全部', label: '全部' },
]
