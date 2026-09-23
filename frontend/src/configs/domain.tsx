import { Navigate, Route } from 'react-router-dom'

/**
 * 后台信息架构 · 域配置（全站 UI 重构 P0 · 方案 §2）
 * 三层：工作台 / 业务（我的工作·项目·交付执行·采购·基础数据）/ 系统管理
 * 二级 Tab = 子路由（刷新不丢、可分享、旧路径 redirect）
 */
export interface TabItem {
  path: string
  label: string
}

export const MINE_TABS: TabItem[] = [
  { path: '/mine/tasks', label: '我的任务' },
  { path: '/mine/reviews', label: '设计评审' },
  { path: '/mine/changes', label: '改版申请' },
]

export const DELIVERY_TABS: TabItem[] = [
  { path: '/delivery/mfg', label: '制造' },
  { path: '/delivery/assembly', label: '装配' },
  { path: '/delivery/shipping', label: '发运' },
  { path: '/delivery/site', label: '现场' },
  { path: '/delivery/acceptance', label: '验收与质保' },
  { path: '/delivery/service', label: '售后' },
]

export const PURCHASE_TABS: TabItem[] = [
  { path: '/purchase/orders', label: '采购工作台' },
  { path: '/purchase/suppliers', label: '供应商' },
]

export const BASE_TABS: TabItem[] = [
  { path: '/library', label: '标准库' },
  { path: '/numbering', label: '编号规则' },
]

export const ADMIN_TABS: TabItem[] = [
  { path: '/admin/users', label: '用户与权限' },
  // P3 追加：{ path: '/admin/audit', label: '操作日志' }
]

/** 旧路径 → 新路径（通知 link / 书签 / 外部引用不断 —— e2e 只增不改的前提） */
export const ROUTE_REDIRECTS: [string, string][] = [
  ['/my-tasks', '/mine/tasks'],
  ['/reviews', '/mine/reviews'],
  ['/changes', '/mine/changes'],
  ['/manufacturing', '/delivery/mfg'],
  ['/assembly', '/delivery/assembly'],
  ['/shipping', '/delivery/shipping'],
  ['/site', '/delivery/site'],
  ['/acceptance', '/delivery/acceptance'],
  ['/service', '/delivery/service'],
  ['/purchase', '/purchase/orders'],
  ['/suppliers', '/purchase/suppliers'],
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
  perm?: string
  admin?: boolean
}

export const SIDEBAR_ROOTS: SidebarRoot[] = [
  { key: '/workbench', label: '工作台', to: '/workbench', prefixes: ['/workbench', '/'], icon: 'home' },
  { key: '/mine/tasks', label: '我的工作', to: '/mine/tasks', prefixes: ['/mine'], icon: 'checklist', group: '业务' },
  { key: '/projects', label: '项目', to: '/projects', prefixes: ['/projects'], icon: 'folder', group: '业务' },
  { key: '/delivery/mfg', label: '交付执行', to: '/delivery/mfg', prefixes: ['/delivery'], icon: 'truck', group: '业务', perm: 'mfg' },
  { key: '/purchase/orders', label: '采购', to: '/purchase/orders', prefixes: ['/purchase'], icon: 'cart', group: '业务' },
  { key: '/library', label: '基础数据', to: '/library', prefixes: ['/library', '/numbering'], icon: 'database', group: '业务' },
  { key: '/admin/users', label: '系统管理', to: '/admin/users', prefixes: ['/admin', '/users'], icon: 'setting', group: '系统管理', admin: true },
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
