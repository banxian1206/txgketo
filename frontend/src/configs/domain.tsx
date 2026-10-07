import type { ReactNode } from 'react'

import { Navigate, Route } from 'react-router-dom'

/**
 * 后台信息架构 · 域配置（全站 UI 重构 P0 · 方案 §2）
 * 三层：工作台 / 业务（我的工作·项目·交付执行·采购·基础数据）/ 系统管理
 * 二级 Tab = 子路由（刷新不丢、可分享、旧路径 redirect）
 */
export interface TabItem {
  path: string
  label: ReactNode // 台 Tab 角标 Badge 需要节点（A3）
  /**
   * ★ 重整 P0（docs/10 §3.2）：真实权限码，命中任一才显示。未给 = 人人可见。
   *   目的：域/台这一层也按权限过滤，且只允许用**后端下发的真实码**
   *   （不许 `position === '总监'` 这类前端猜岗位 —— 那会造出「看得见、点了必 403」）。
   */
  anyOf?: string[]
}

/* ★ 「交付执行」域已删除（docs/10 §8.1 D1，客户拍板）：
   业务线只在**工作台**里跑，一个角色一台，登录看到自己的台。
   制造/装配 → 车间工作台；发运/现场/售后 → 各自的工作台（route 仍指 /delivery/*，URL 不改，壳换掉）。 */

export const BASE_TABS: TabItem[] = [
  { path: '/library', label: '标准库', anyOf: ['std:view', 'std:edit'] },
  // ★ 价格库（2026-10-07 客户口径：从采购台「价格参考」搬过来，只管**数据管理**）。
  //   查看要 purchase:price（金额分档铁律 N23）—— 没有它的人看不到这一页签。
  { path: '/library/prices', label: '价格库', anyOf: ['purchase:price'] },
  { path: '/numbering', label: '编号规则' }, // 只读页，人人可看自己公司怎么编号
]

export const ADMIN_TABS: TabItem[] = [
  { path: '/admin/users', label: '用户与权限', anyOf: ['admin:users', 'system:admin'] },
]

/**
 * 补采类来源（采购池/采购单里需要橙色高亮 + 显示「原 POxxxx」溯源的那几种）。
 *
 * 三种都是「货没成 → 数量减回原行 + 新建一条待采购需求回池」（08 §4.1 / §19）：
 *   退货重采 = 仓库验收不合格后采购协商退货
 *   现场缺件 / 现场破损 = 现场清点缺件或破损后回池（site.py SOURCE_SITE_*）
 *
 * ★ 单一事实源：以前两个文件各写一份字面量数组，加新来源就会漏一处（N18/N20 的成因）。
 *   新增来源请改这里，并同步后端 `models/initiation.py` 的 `REQUEST_SOURCES`（有契约断言拦）。
 */
export const REBUY_SOURCES: string[] = ['退货重采', '现场缺件', '现场破损']

/** 旧路径 → 新路径（通知 link / 书签 / 外部引用不断 —— e2e 只增不改的前提） */
export const ROUTE_REDIRECTS: [string, string][] = [
  ['/my-tasks', '/workbench/tasks'],
  ['/reviews', '/workbench/reviews'],
  ['/changes', '/workbench/changes'],
  ['/mine/tasks', '/workbench/tasks'],
  ['/mine/reviews', '/workbench/reviews'],
  ['/mine/changes', '/workbench/changes'],
  // ★ 目标全部**一跳到位**（D-E 拍板）：交付域删除后不再有 /delivery/mfg 这种中转站
  ['/manufacturing', '/workbench/shop/mfg'],
  ['/assembly', '/workbench/shop/assembly'],
  ['/shipping', '/delivery/shipping'],
  ['/site', '/delivery/site'],
  ['/acceptance', '/workbench/pm?tab=acceptance'], // 验收与质保归项目经理台（D-A 默认）
  ['/service', '/delivery/service'],
  ['/delivery', '/workbench/shop'],
  ['/delivery/mfg', '/workbench/shop/mfg'],
  ['/delivery/assembly', '/workbench/shop/assembly'],
  ['/delivery/acceptance', '/workbench/pm?tab=acceptance'],
  ['/purchase/orders', '/purchase'],
  ['/suppliers', '/purchase?tab=suppliers'],
  ['/purchase/suppliers', '/purchase?tab=suppliers'],
  ['/users', '/admin/users'],
]

/** 侧栏一级 → 默认落点（选中态与跳转共用） */
export interface SidebarRoot {
  key: string
  label: string
  to: string
  prefixes: string[]
  icon: string
  group?: string
  admin?: boolean
}

export const SIDEBAR_ROOTS: SidebarRoot[] = [
  // 工作台 = 角色台（Tab 化，数据 = /workbench/me 的 visible 列表；采购台 /purchase、仓库台 /warehouse 同属此类 —— 用户纠偏 2026-09-23）
  { key: '/workbench', label: '工作台', to: '/workbench', prefixes: ['/workbench', '/purchase', '/warehouse', '/delivery', '/'], icon: 'home' },
  { key: '/projects', label: '项目', to: '/projects', prefixes: ['/projects'], icon: 'folder', group: '业务' },
  // ★ 「交付执行」已删（docs/10 §8.1 D1）：它的内容现在是各角色的工作台，侧栏不再放业务流水线入口
  { key: '/library', label: '基础数据', to: '/library', prefixes: ['/library', '/numbering'], icon: 'database', group: '业务' },
  { key: '/admin/users', label: '用户与权限', to: '/admin/users', prefixes: ['/admin', '/users'], icon: 'setting', group: '系统管理', admin: true },
]

export function matchSidebarKey(pathname: string): string {
  // '/' 精确匹配工作台；其余取最长前缀命中（/delivery/mfg → 交付执行）
  if (pathname === '/') return '/workbench'
  let best = ''
  let bestLen = -1
  for (const r of SIDEBAR_ROOTS) {
    for (const pre of r.prefixes) {
      const hit = pathname === pre || pathname.startsWith(pre + '/')
      if (hit && pre.length > bestLen) { best = r.key; bestLen = pre.length }
    }
  }
  return best || pathname
}

/** 旧路径 redirect 的 <Route> 元素（配置单源，供 App 内联展开） */
export function redirectRoutes() {
  return ROUTE_REDIRECTS.map(([from, to]) => (
    <Route key={from} path={from.slice(1)} element={<Navigate to={to} replace />} />
  ))
}
