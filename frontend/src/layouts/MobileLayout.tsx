import { Badge, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

import NotificationsDrawer from '../components/NotificationsDrawer'
import { useAuth } from '../contexts/AuthContext'
import { hasPerm, unreadNotificationCount } from '../api/client'

// 底部入口按角色/权限显示（03 卷）：仓库看仓库、车间看制造/装配、交付/现场看发运
const ALL_TABS: { key: string; label: string; icon: string; show: () => boolean }[] = [
  { key: '/m', label: '首页', icon: '🏠', show: () => true },
  {
    key: '/m/warehouse',
    label: '仓库',
    icon: '📦',
    show: () => hasPerm('warehouse:edit') || hasPerm('warehouse:view'),
  },
  { key: '/m/issues', label: '领料', icon: '🧰', show: () => true },
  { key: '/m/production', label: '制造', icon: '🏭', show: () => hasPerm('mfg:view') },
  { key: '/m/assembly', label: '装配', icon: '🔧', show: () => hasPerm('mfg:view') },
  {
    key: '/m/shipping',
    label: '发运',
    icon: '🚚',
    show: () => hasPerm('ship:edit') || hasPerm('site:edit'),
  },
  {
    key: '/m/site',
    label: '现场',
    icon: '🏗️',
    show: () => hasPerm('site:edit') || hasPerm('project:edit'),
  },
  {
    key: '/m/service',
    label: '售后',
    icon: '🛠️',
    show: () => hasPerm('service:edit'),
  },
  { key: '/m/me', label: '我的', icon: '👤', show: () => true },
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
    TABS.filter((t) => t.key !== '/m').find((t) => loc.pathname.startsWith(t.key))?.key ?? '/m'

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', paddingBottom: 64 }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: '#1f6feb',
          color: '#fff',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Typography.Text style={{ color: '#fff', fontWeight: 600 }}>同兴高科 · 移动端</Typography.Text>
        <a style={{ color: '#fff' }} onClick={() => setNotifOpen(true)}>
          <Badge count={unread} size="small">
            <span style={{ fontSize: 16 }}>🔔</span>
          </Badge>
        </a>
        <a
          style={{ color: '#fff', fontSize: 13 }}
          onClick={() => logout()}
        >
          {name} · 退出
        </a>
      </div>

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
          background: '#fff',
          borderTop: '1px solid #ececec',
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
              color: active === t.key ? '#1f6feb' : '#666',
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
