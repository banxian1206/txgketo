import { Tabs } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

/**
 * 车间台壳（A5 · v2 §2.0.6）：台内 card 页签 = URL 子路由（看板 | 制造 | 装配）
 * 制造/装配 = 交付执行同款组件复用挂载（一期交付执行组保留，拍板③的双入口中间态）
 * 台内 card 页签与域 Tab（下划线）视觉区分 —— A6 观察项
 */
export default function ShopShell() {
  const loc = useLocation()
  const nav = useNavigate()
  const active = loc.pathname.endsWith('/mfg') ? 'mfg' : loc.pathname.endsWith('/assembly') ? 'assembly' : 'shop'
  return (
    <>
      <Tabs
        type="card"
        activeKey={active}
        onChange={(k) => nav(k === 'shop' ? '/workbench/shop' : `/workbench/shop/${k}`)}
        items={[
          { key: 'shop', label: '看板' },
          { key: 'mfg', label: '制造' },
          { key: 'assembly', label: '装配' },
        ]}
      />
      <Outlet />
    </>
  )
}
