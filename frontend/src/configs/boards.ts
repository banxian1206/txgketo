/**
 * 台骨架注册表（docs/15 · 工作台队列化改造）
 * ─────────────────────────────────────────────────────────────────────────────
 * 为什么要有这张表：这轮返工的直接原因 —— **9 个工作台是 9 个不同时候手写的页面**，
 * 上一轮只统一了"外壳三件套"，于是：结论指标条 0~6 个不等（5 个台**完全没有**）、
 * 流程条 4 种形态（有的在标题之上、有的没有、有的按岗位换整页）、体内 3 种语言
 * （表格 / Card+表格 / 队列行）、40 处空态还是 antd 默认灰插图。
 *
 * 现在把"台长什么样"**声明化**：每个台在这里登记 ① 名字/路由 ② 流程条（= 有哪些一类活儿）
 * ③ 每类活儿的体内语言（`queue` / `ledger`）。壳（`components/ds/WorkbenchPage`）统一渲染
 * 台头 + 结论条 + 流程条，页面只负责"这一类活儿的数据从哪来、渲染成什么"。
 *
 * 四条规矩（护栏 `SHELL-*` 盯着）：
 *   ① 台骨架四件套顺序不许变：**台头 → 结论条 → 流程条 → 体**（车间台原来流程条跑到了标题之上）
 *   ② 结论条 ≤5 个，**只放"要动手的数"**（身份、筛选器状态不算结论）
 *   ③ 流程条 ≤4 组；≤4 项时不分层（少一层点击）
 *   ④ **tab key 一个都不许改**（通知 link / `?tab=` 深链 / `ROUTE_REDIRECTS` 全靠它）——
 *      所以这里只是"给已有的 *_TABS 加上台元信息与体内语言"，不新建 key。
 */
import {
  ENG_GROUPS,
  ENG_TABS,
  MFG_GROUPS,
  MFG_TABS,
  PM_GROUPS,
  PM_TABS,
  PURCHASE_GROUPS,
  PURCHASE_TABS,
  SERVICE_GROUPS,
  SERVICE_TABS,
  SITE_GROUPS,
  SITE_TABS,
  WAREHOUSE_GROUPS,
  WAREHOUSE_TABS,
  type TabDef,
  type TabGroup,
} from './tabs'

export interface BoardDef {
  key: string
  /** 台名（侧栏/工作台清单里的名字，也是 PageHead 标题） */
  name: string
  route: string
  /** 这个台有哪几类活儿（顺序 = 流程条顺序） */
  tabs: TabDef[]
  /**
   * ★ 默认落哪个页签（不写 = 第一个）。
   * **必须显式声明**：这轮改造时我让壳取"第一个"，结果采购台从「采购池」变成了「待我审批」——
   * 用户点采购工作台进来，看到的是 0 条的审批队列（真正每天用的采购池要再点一下）。
   * 默认页签是**台的行为契约**，不是实现细节，所以放注册表（也便于 e2e 静态校验）。
   */
  defaultTab?: string
  /** >4 项时的分组（≤4 项不传 = 一层到底） */
  groups?: TabGroup[]
}

/* ─────────────────────────── 九个台 + 收件箱 ─────────────────────────── */

/** 商务部工作台：商机是"我的项目"视图，回款是队列（有唯一的下一步动作：去催款） */
export const SALES_BOARD: BoardDef = {
  defaultTab: 'projects',
  key: 'sales',
  name: '商务部工作台',
  route: '/workbench/sales',
  // key 与页面现状（原 SALES_SECTIONS）逐字一致 —— 深链/通知靠它
  tabs: [
    { key: 'projects', label: '我的商机 / 项目', kind: 'ledger' },
    { key: 'payments', label: '待回款节点', kind: 'queue' },
  ],
}

/**
 * 项目经理台：两页签都是**汇总/台账**视图。
 * ⚠ TODO(docs/15 批 2)：`acceptance`（验收与质保）**目标**是队列（每张单有下一步：申请/确认），
 *    现在复用整个验收页（自带表格），所以**如实声明 ledger** —— 声明必须与实现一致，
 *    否则护栏 `SHELL-台骨架四件套` 会（也应该）报红：声明 queue 却找不到队列行 = 谎报。
 */
export const PM_BOARD: BoardDef = {
  defaultTab: 'board',
  key: 'pm',
  name: '项目经理台',
  route: '/workbench/pm',
  tabs: PM_TABS.map((t) => ({ ...t, kind: 'ledger' })),
  groups: PM_GROUPS,
}

/** 工程部台：我的任务/我组是队列（逐条干完），部门看板是台账（看进度） */
export const ENG_BOARD: BoardDef = {
  defaultTab: 'mine',
  key: 'eng',
  name: '工程部工作台',
  route: '/workbench/eng',
  // ⚠ TODO(docs/15 批 3)：mine/team 目标是队列（逐条干完），现仍是卡+表
  tabs: ENG_TABS.map((t) => ({ ...t, kind: 'ledger' })),
  groups: ENG_GROUPS,
}

/** 采购工作台（10 类活儿 → 4 组） */
export const PURCHASE_BOARD: BoardDef = {
  defaultTab: 'pool',
  key: 'purchase',
  name: '采购工作台',
  route: '/purchase',
  tabs: PURCHASE_TABS.map((t) => ({
    ...t,
    // 待办类：扣在"我身上、有下一步动作"的量 → 队列行
    // 台账类：单/记录/主数据 → 表格（要看多列、要排序导出）
    kind: (['approve', 'vehicle', 'failed'] as string[]).includes(t.key) ? 'queue' : 'ledger',
  })),
  groups: PURCHASE_GROUPS,
}

/** 仓库工作台（6 类 → 3 组）：三个待办是队列，库存/流水/库位是台账 */
export const WAREHOUSE_BOARD: BoardDef = {
  defaultTab: 'incoming',
  key: 'warehouse',
  name: '仓库工作台',
  route: '/warehouse',
  tabs: WAREHOUSE_TABS.map((t) => ({
    ...t,
    kind: (['incoming', 'storage', 'issues'] as string[]).includes(t.key) ? 'queue' : 'ledger',
  })),
  groups: WAREHOUSE_GROUPS,
}

/** 车间工作台（制造 5 类 → 2 组）：在制流程都是队列（下一条要干的活），外协是台账 */
export const SHOP_BOARD: BoardDef = {
  defaultTab: 'wait',
  key: 'shop',
  name: '车间工作台',
  route: '/workbench/shop',
  // ⚠ TODO(docs/15 批 2)：待下发/在制/待转运/返工 目标是队列，现仍是表
  tabs: MFG_TABS.map((t) => ({ ...t, kind: 'ledger' })),
  groups: MFG_GROUPS,
}

/** 发运工作台：批次是台账（要对比多列），但"待装车/在途"是队列（这一步该动了） */
export const SHIPPING_BOARD: BoardDef = {
  defaultTab: 'todo',
  key: 'shipping',
  name: '发运工作台',
  route: '/delivery/shipping',
  // ★ 一件事只在一个台成队列（docs/15 决策 3）：「叫车」归**采购台**，发运台只做
  //   「车叫回来后我该装/该发」——两个台都摆一遍 = 谁都以为对方在做。
  tabs: [
    { key: 'todo', label: '待装车 / 待发运', kind: 'queue' },
    { key: 'batches', label: '发运批次', kind: 'ledger' },
  ],
}

/** 现场工作台（5 类 → 3 组）：来货清点/现场问题是队列，勘测/日报/调试是台账 */
export const SITE_BOARD: BoardDef = {
  defaultTab: 'incoming',
  key: 'site',
  name: '现场工作台',
  route: '/delivery/site',
  // ⚠ TODO(docs/15 批 2)：来货清点/现场问题 目标是队列，现仍是表
  tabs: SITE_TABS.map((t) => ({ ...t, kind: 'ledger' })),
  groups: SITE_GROUPS,
}

/** 售后工作台：工单是队列（每单有下一步：派工/到场/处理/签字），备件是台账 */
export const SERVICE_BOARD: BoardDef = {
  defaultTab: 'orders',
  key: 'service',
  name: '售后工作台',
  route: '/delivery/service',
  tabs: SERVICE_TABS.map((t) => ({ ...t, kind: t.key === 'orders' ? 'queue' : 'ledger' })),
  groups: SERVICE_GROUPS,
}

/** 全部台（键 = WORKBENCHES 里的 key，后端是台清单的唯一事实源） */
export const BOARDS: Record<string, BoardDef> = {
  sales: SALES_BOARD,
  pm: PM_BOARD,
  eng: ENG_BOARD,
  purchase: PURCHASE_BOARD,
  warehouse: WAREHOUSE_BOARD,
  shop: SHOP_BOARD,
  shipping: SHIPPING_BOARD,
  site: SITE_BOARD,
  service: SERVICE_BOARD,
}

/** 流程条分组：≤4 项时不分层（少一层点击 —— docs/15 决策 2） */
export function groupsFor(board: BoardDef, visibleKeys: string[]): TabGroup[] | undefined {
  if (visibleKeys.length <= 4) return undefined
  return board.groups
}

/** 台账类页签的 key（护栏用：这些才允许出现 `<Table`） */
export function ledgerKeys(board: BoardDef): string[] {
  return board.tabs.filter((t) => t.kind !== 'queue').map((t) => t.key)
}
