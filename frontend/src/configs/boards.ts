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
import { positionTier, type PositionKey } from '../contexts/session'

export interface BoardDef {
  key: string
  /** 台名（侧栏/工作台清单里的名字，也是 PageHead 标题） */
  name: string
  route: string
  /** 这个台有哪几类活儿（顺序 = 流程条顺序） */
  tabs: TabDef[]
  /**
   * ★ 2026-10-05 客户拍板：**默认落点按岗位走**（原来是写死的 `'mine'`）。
   *
   * 为什么改：注释写着“组员/经理/总监三视角”，实测**三种岗位看到的一模一样、都落「我的」** ——
   * 于是总监进来第一眼是组员那一层（还给他看“我提交的评审单”，他根本不提交）。
   * 客户原话：「我总监进来之后应该到顶层了呀」。
   *
   * 三档规则（`defaultTabFor` 是**单一出口**，九个台都走它）：
   *   总监 → 最上面那一档（部门/全局视角）
   *   经理 → 我组
   *   组员 → 我的
   * ⚠ 台页签**始终三个、不按岗位增减**（客户第二条）—— 只换**顺序 + 默认落点**，
   *   否则用户会发现“我今天怎么少一个页签”，多一层心智负担。
   */
  defaultTab?: string
  /**
   * ★ 按岗位分层（客户 2026-10-05 第一、二条）：**三档各自默认落在哪个页签 + 排序**。
   * 不声明 = 沿用 `defaultTab`（多数台的页签是**流程**顺序而非**层级**，
   * 仓管/采购/车间就一个台、看到的流程一样，分层无意义）。
   * 声明了的台（现只有工程部台：我的 / 我组 / 部门看板）才按岗位换默认落点与顺序。
   */
  byPosition?: Partial<Record<PositionKey, { tab: string; order?: string[] }>>
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
  // ★ 2026-10-05 客户拍板第 1 条补充（实测 bug：采购经理进来「待我审批 3 单」却落在一张空采购池上）。
  //   规则统一为：**默认落在「轮到我处理」的那一项**。
  //   —— 之前只有工程部台声明了分层，采购/仓库这些「待办组」结构的台没声明，
  //      于是 `defaultTab`（写死成台账）成了所有人的落点：经理该看审批却看台账。
   // 商务部台：组员落**我的商机/项目**；经理/总监落**待回款节点**（回款是商务的命门）。
  byPosition: {
    member: { tab: 'projects' },
    lead: { tab: 'payments' },
    director: { tab: 'payments' },
  },
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
  // ★ 2026-10-05 客户拍板第 1 条补充（实测 bug：采购经理进来「待我审批 3 单」却落在一张空采购池上）。
  //   规则统一为：**默认落在「轮到我处理」的那一项**。
  //   —— 之前只有工程部台声明了分层，采购/仓库这些「待办组」结构的台没声明，
  //      于是 `defaultTab`（写死成台账）成了所有人的落点：经理该看审批却看台账。
   // PM 台三档都落**看板**（验收与质保是第二档）。
  byPosition: {
    member: { tab: 'board' },
    lead: { tab: 'board' },
    director: { tab: 'board' },
  },
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
  // ★ 2026-10-05 客户拍板（岗位分层）：**默认落点按岗位 + 页签顺序按岗位**。
  //   实测旧行为：组员/经理/总监看到的**完全一样**、都落「我的」——总监第一眼是组员那一层，
  //   还给他看「我提交的评审单」（他根本不提交评审单）。客户原话「我总监进来应该到顶层了呀」。
  //   页签**始终三个不增减**（客户第二条），只换顺序与默认落点。
  byPosition: {
    member: { tab: 'mine', order: ['mine', 'team', 'board'] },          // 组员：先看自己的活
    lead: { tab: 'team', order: ['team', 'mine', 'board'] },             // 经理：先看我组在忙什么
    director: { tab: 'board', order: ['board', 'team', 'mine'] },        // 总监：先看部门卡在哪
  },
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
  // ★ 2026-10-05 客户拍板第 1 条补充（实测 bug：采购经理进来「待我审批 3 单」却落在一张空采购池上）。
  //   规则统一为：**默认落在「轮到我处理」的那一项**。
  //   —— 之前只有工程部台声明了分层，采购/仓库这些「待办组」结构的台没声明，
  //      于是 `defaultTab`（写死成台账）成了所有人的落点：经理该看审批却看台账。
   // 采购台：组员没有审批权（后端 `resolve_po_chain` 按岗位），落**采购池**才是他的活；
     // 经理/总监第一件事是**待我审批**（实测采购经理：3 单等他批，落在 pool 上正文是一张空表）。
  byPosition: {
    member: { tab: 'pool' },
    lead: { tab: 'approve' },
    director: { tab: 'approve' },
  },
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
  // ★ 2026-10-05 客户拍板第 1 条补充（实测 bug：采购经理进来「待我审批 3 单」却落在一张空采购池上）。
  //   规则统一为：**默认落在「轮到我处理」的那一项**。
  //   —— 之前只有工程部台声明了分层，采购/仓库这些「待办组」结构的台没声明，
  //      于是 `defaultTab`（写死成台账）成了所有人的落点：经理该看审批却看台账。
   // 仓库台三档都落**待验收**：货到了不验收就卡入库、卡领料，是仓库每一天的第一件事。
  byPosition: {
    member: { tab: 'incoming' },
    lead: { tab: 'incoming' },
    director: { tab: 'incoming' },
  },
}

/** 车间工作台（制造 5 类 → 2 组）：在制流程都是队列（下一条要干的活），外协是台账 */
export const SHOP_BOARD: BoardDef = {
  defaultTab: 'wait',
  key: 'shop',
  name: '车间工作台',
  route: '/workbench/shop',
  // 待下发/在制/待转运/返工 = 车间按单干活的队列（行尾一个按钮：下发/开工/验收/转运）
  // 外协是台账（要对比多列：发出日/回厂日/验收结果）
  tabs: MFG_TABS.map((t) => ({ ...t, kind: t.key === 'outsource' ? 'ledger' : 'queue' })),
  // ⚠ 不分组：`MFG_GROUPS` 只有 2 组（在制流程 / 返工与外协）→ 平白多一行——
  //   车间一屏已经有两行切换器（视图条「看板/制造/装配」+ 这 5 个队列），三段横条就是噪音。
  //   5 项 ≤4 不成立 → 平铺成一行胶囊（第 2 级样式）。
  // ★ 2026-10-05 客户拍板第 1 条补充（实测 bug：采购经理进来「待我审批 3 单」却落在一张空采购池上）。
  //   规则统一为：**默认落在「轮到我处理」的那一项**。
  //   —— 之前只有工程部台声明了分层，采购/仓库这些「待办组」结构的台没声明，
  //      于是 `defaultTab`（写死成台账）成了所有人的落点：经理该看审批却看台账。
   // 车间台三档都落**待下发**：没下任务，后面的在制/转运/验收全是空的（车间的头一棒）。
  byPosition: {
    member: { tab: 'wait' },
    lead: { tab: 'wait' },
    director: { tab: 'wait' },
  },
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
  // ★ 2026-10-05 客户拍板第 1 条补充（实测 bug：采购经理进来「待我审批 3 单」却落在一张空采购池上）。
  //   规则统一为：**默认落在「轮到我处理」的那一项**。
  //   —— 之前只有工程部台声明了分层，采购/仓库这些「待办组」结构的台没声明，
  //      于是 `defaultTab`（写死成台账）成了所有人的落点：经理该看审批却看台账。
   // 发运台只有执行角色（叫车归采购台，docs/15 决策 3），三档都落**待装车/待发运**。
  byPosition: {
    member: { tab: 'todo' },
    lead: { tab: 'todo' },
    director: { tab: 'todo' },
  },
}

/** 现场工作台（5 类 → 3 组）：来货清点/现场问题是队列，勘测/日报/调试是台账 */
export const SITE_BOARD: BoardDef = {
  defaultTab: 'incoming',
  key: 'site',
  name: '现场工作台',
  route: '/delivery/site',
  // 来货清点 / 现场问题 = 现场逐条处理的队列；勘测/日报/申请调试是记录台账
  tabs: SITE_TABS.map((t) => ({
    ...t,
    kind: (['incoming', 'issues'] as string[]).includes(t.key) ? 'queue' : 'ledger',
  })),
  groups: SITE_GROUPS,
  // ★ 2026-10-05 客户拍板第 1 条补充（实测 bug：采购经理进来「待我审批 3 单」却落在一张空采购池上）。
  //   规则统一为：**默认落在「轮到我处理」的那一项**。
  //   —— 之前只有工程部台声明了分层，采购/仓库这些「待办组」结构的台没声明，
  //      于是 `defaultTab`（写死成台账）成了所有人的落点：经理该看审批却看台账。
   // 现场台三档都落**来货清点**：货到了不动就卡安装（勘测/日报是记录，不是队列）。
  byPosition: {
    member: { tab: 'incoming' },
    lead: { tab: 'incoming' },
    director: { tab: 'incoming' },
  },
}

/** 售后工作台：工单是队列（每单有下一步：派工/到场/处理/签字），备件是台账 */
export const SERVICE_BOARD: BoardDef = {
  defaultTab: 'orders',
  key: 'service',
  name: '售后工作台',
  route: '/delivery/service',
  tabs: SERVICE_TABS.map((t) => ({ ...t, kind: t.key === 'orders' ? 'queue' : 'ledger' })),
  groups: SERVICE_GROUPS,
  // ★ 2026-10-05 客户拍板第 1 条补充（实测 bug：采购经理进来「待我审批 3 单」却落在一张空采购池上）。
  //   规则统一为：**默认落在「轮到我处理」的那一项**。
  //   —— 之前只有工程部台声明了分层，采购/仓库这些「待办组」结构的台没声明，
  //      于是 `defaultTab`（写死成台账）成了所有人的落点：经理该看审批却看台账。
   // 售后台三档都落**服务工单**（备件是台账）。
  byPosition: {
    member: { tab: 'orders' },
    lead: { tab: 'orders' },
    director: { tab: 'orders' },
  },
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

/**
 * 岗位分层 · 单一出口（九个台都走这两个函数，不在页面里各判一次 position）
 *
 * 为什么需要它：工程部台注释写着“组员/经理/总监三视角”，实测**三种岗位看到的一模一样、
 * 都落「我的」**——总监第一眼看到的是组员那一层（还给他看“我提交的评审单”，他根本不提交）。
 * 客户原话：「我总监进来之后应该到顶层了呀」。
 *
 * 两条规矩：
 *   ① `defaultTabFor` —— 默认落点按岗位（总监→顶层页签，经理→我组，组员→我的）
 *   ② `orderTabsFor`  —— 页签**始终三个、不增减**，只按岗位换**顺序**（客户第二条：
 *      增减会让用户“我今天怎么少一个页签”，多一层心智负担）
 */
export function defaultTabFor(board: BoardDef, position?: string | null): string | undefined {
  const tier = positionTier(position)
  return board.byPosition?.[tier]?.tab ?? board.defaultTab
}

export function orderTabsFor(board: BoardDef, position?: string | null): TabDef[] {
  const tier = positionTier(position)
  const order = board.byPosition?.[tier]?.order
  if (!order?.length) return board.tabs
  // 按声明的顺序排；没被列出的页签保持原相对顺序接在后面（别把页签弄丢）
  const byKey = new Map(board.tabs.map((t) => [t.key, t]))
  const head = order.map((k) => byKey.get(k)).filter((t): t is TabDef => !!t)
  const rest = board.tabs.filter((t) => !order.includes(t.key))
  return [...head, ...rest]
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
