import type { ReactNode } from 'react'
import type { WTabItem } from '../ds/WorkbenchTabs'

const INFO: Record<string, { title: string; note: string }> = {
  users: { title: '用户', note: '维护账号、部门与角色' },
  org: { title: '组织架构', note: '管理部门与下属小组' },
  roles: { title: '角色说明', note: '查看职责与权限范围' },
  integration: { title: '外部集成', note: '配置识别服务与连接' },
  logs: { title: '操作日志', note: '追溯系统操作记录' },
}

/** 管理页专用导航：保持原 tab key、权限过滤和 URL 状态。 */
export default function ManagementSections({ tab, onTab, items }: {
  tab: string; onTab: (key: string) => void; items: WTabItem[]
}) {
  const active = items.find((item) => item.key === tab) ?? items[0]
  if (!active) return null
  const info = INFO[active.key]
  return <div className="management-layout">
    <nav className="management-nav" aria-label="管理分区">
      <div className="management-nav-label">账号与系统</div>
      {items.map((item) => <button key={item.key} type="button"
        aria-current={active.key === item.key ? 'page' : undefined}
        onClick={() => onTab(item.key)}>
        <strong>{INFO[item.key]?.title ?? item.label}</strong>
        <span>{INFO[item.key]?.note}</span>
      </button>)}
    </nav>
    <section className="management-content" aria-label={info?.title}>
      <header className="management-section-head"><h2>{info?.title ?? active.label}</h2><p>{info?.note}</p></header>
      {active.children as ReactNode}
    </section>
  </div>
}
