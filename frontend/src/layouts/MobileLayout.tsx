import OfflineBanner from '../components/OfflineBanner'
import { Badge, Space, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { BellOutlined, BuildOutlined, CarOutlined, ExportOutlined, HomeOutlined, SettingOutlined, InboxOutlined, ApartmentOutlined, ToolOutlined, UserOutlined } from '@ant-design/icons'

import NotificationsDrawer from '../components/NotificationsDrawer'
import { useAuth } from '../contexts/AuthContext'
import { hasPerm, unreadNotificationCount } from '../api/client'
import { T } from '../theme/tokens'

// 底部入口按角色/权限显示（03 卷）：仓库看仓库、车间看制造/装配、交付/现场看发运
// 图标用 antd icons（视觉规范 §4：emoji 不进 UI chrome，跨平台渲染一致）
const ALL_TABS: { key: string; label: string; icon: ReactNode; show: () => boolean; match?: string[] }[] = [
  { key: '/m', label: '首页', icon: <HomeOutlined />, show: () => true },
  {
    key: '/m/warehouse',
    // ★ docs/11：accept 是仓库动线的子页 —— 不带 match 时底部条会掉回「首页」
    match: ['/m/warehouse', '/m/accept'],
    label: '仓库',
    icon: <InboxOutlined />,
    show: () => hasPerm('warehouse:edit') || hasPerm('warehouse:view'),
  },
  { key: '/m/issues', label: '领料', icon: <ExportOutlined />, show: () => true, match: ['/m/issues'] },
  { key: '/m/production', label: '制造', icon: <SettingOutlined />, show: () => hasPerm('mfg:view') },
  { key: '/m/assembly', label: '装配', icon: <ApartmentOutlined />, show: () => hasPerm('mfg:view') },
  {
    key: '/m/shipping',
    label: '发运',
    icon: <CarOutlined />,
    show: () => hasPerm('ship:edit') || hasPerm('site:edit'),
  },
  {
    key: '/m/site',
    label: '现场',
    icon: <BuildOutlined />,
    show: () => hasPerm('site:edit') || hasPerm('project:edit'),
  },
  {
    key: '/m/service',
    label: '售后',
    icon: <ToolOutlined />,
    show: () => hasPerm('service:edit'),
  },
  { key: '/m/me', label: '我的', icon: <UserOutlined />, show: () => true },
]

/** 手机端外壳（03 卷）：顶栏 + 底部入口（按角色），页面走「清单 + 勾选 + 拍照」动线 */
export default function MobileLayout() {
  const loc = useLocation()
  const nav = useNavigate()
  // 重构 1.3：用户名/登出走 AuthContext（登出顺带清伪装 —— 原实现漏清了两个 impersonate key）
  const { user, logout } = useAuth()
  const name = user?.name ?? '用户'
  const [unread, setUnread] = useState(0)
  const [notifOpen, setNotifOpen] = useState(false)
  const TABS = ALL_TABS.filter((t) => t.show())

  const refreshUnread = useCallback(() => {
    unreadNotificationCount()
      .then(setUnread)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    refreshUnread()
    const t = setInterval(refreshUnread, 60_000)
    return () => clearInterval(t)
  }, [refreshUnread])

  const active =
    TABS.filter((t) => t.key !== '/m')
      .find((t) => (t.match ?? [t.key]).some((pre) => loc.pathname.startsWith(pre)))?.key ?? '/m'

  return (
    <div className="m-shell" style={{ minHeight: '100vh', background: T.bgPage, paddingBottom: 64 }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: T.brand,
          color: T.bg,
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        {/* 品牌位（重构 2.5）：蓝底用反白字标，保留“移动端”端型标识 */}
        <Space size={6}>
          <img src="/brand/logo-white.png" alt="同兴高科 TXGK" style={{ height: 22 }} />
          <Typography.Text style={{ color: T.bg, fontSize: 12, opacity: 0.85 }}>移动端</Typography.Text>
        </Space>
        {/* ★ 触控目标（规范 §5.2）：铃铛与退出是移动端仅有的两个顶栏动作，20px 按不准 */}
        <a
          style={{ color: T.bg, minWidth: 40, minHeight: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setNotifOpen(true)}
        >
          <Badge count={unread} size="small">
            <span style={{ fontSize: 16 }}><BellOutlined /></span>
          </Badge>
        </a>
        <a
          style={{ color: T.bg, fontSize: 13, minWidth: 44, minHeight: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}
          onClick={() => logout()}
        >
          {name} · 退出
        </a>
      </div>

      <OfflineBanner />

      <div style={{ padding: 12 }}>
        <Outlet />
      </div>

      <NotificationsDrawer
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        onReadChange={setUnread}
      />

      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: 58,
          background: T.bg,
          borderTop: `1px solid ${T.border}`,
          display: 'flex',
        }}
      >
        {TABS.map((t) => (
          <a
            key={t.key}
            onClick={() => nav(t.key)}
            style={{
              flex: 1,
              textAlign: 'center',
              paddingTop: 7,
              fontSize: 12,
              color: active === t.key ? T.brand : T.textStrong,
              userSelect: 'none',
            }}
          >
            <div style={{ fontSize: 20, lineHeight: 1.2 }}>{t.icon}</div>
            {t.label}
          </a>
        ))}
      </div>
    </div>
  )
}
