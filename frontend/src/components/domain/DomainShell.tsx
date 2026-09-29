import { Link, Outlet, useLocation } from 'react-router-dom'

import { hasPerm } from '../../api/user'
import { contextPath } from '../../hooks/useFrom'

import type { TabItem } from '../../configs/domain'

/**
 * 域壳（全站 UI 重构 P0 · 方案 §2.3）：右侧内容区顶部 Tab = 子路由切换
 * - 刷新不丢当前 Tab · URL 可分享 · 旧路径 redirect 后通知 link 不断
 * - pathless 用法：`<Route element={<DomainShell tabs={X}/>}>` 包裹兄弟子路由（路径零变）
 * - 嵌套用法：`<Route element={<DomainShell tabs={X}/>}>` 包兄弟子路由（如基础数据域）
 * - Tab 只做导航（Link），不做状态容器 —— 内容仍是独立页面（各自保留页内逻辑与页内 Tabs）
 */
export default function DomainShell({ tabs, children }: { tabs: TabItem[]; children?: React.ReactNode }) {
  const loc = useLocation()
  // ★ 有 ?from= 时按来源高亮（从采购台点进项目详情，台条仍应指出「采购工作台」）
  const here = contextPath(loc.pathname, loc.search)
  // ★ 重整 P0（docs/10 §3.2）：域/台这一层也按**真实权限码**过滤 ——
  //   原来 6 项「交付执行」谁都看全，现场/售后角色点进去就是空表或 403。
  const visible = tabs.filter((x) => !('anyOf' in x) || !x.anyOf?.length || x.anyOf.some((c) => hasPerm(c)))
  // 选中态 = 最长前缀优先（/workbench/eng 必须胜过父项 /workbench）；
  // 一个都不命中就不高亮（兜底 tabs[0] 会把无关页错标成第一个 Tab —— 用户实测 /workbench/eng
  // 被标成「我的工作台」即此因）
  const active =
    tabs
      .filter(
        (t) =>
          here === t.path ||
          (t.path !== '/' && here.startsWith(t.path + '/')),
      )
      .sort((a, b) => b.path.length - a.path.length)[0]?.path ?? ''
  if (visible.length <= 1) {
    // 只剩一项就没有“导航条”的意义了，直接渲染内容（少一条横条）
    return <div className="domain-shell">{children ?? <Outlet />}</div>
  }
  return (
    <div className="domain-shell">
      <nav className="domain-tabs" aria-label="模块切换">
        {visible.map((t) => (
          <Link key={t.path} to={t.path} className={active === t.path ? 'active' : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="domain-content">
        {children ?? <Outlet />}
      </div>
    </div>
  )
}
