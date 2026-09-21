import { Badge, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

import NotificationsDrawer from '../components/NotificationsDrawer'
import { TOKEN_KEY, unreadNotificationCount } from '../api/client'

const TABS = [
  { key: '/m', label: '首页', icon: '🏠' },
  { key: '/m/warehouse', label: '仓库', icon: '📦' },
  { key: '/m/issues', label: '领料', icon: '🧰' },
  { key: '/m/me', label: '我的', icon: '👤' },
]

/** 手机端外壳（03 卷）：顶栏 + 底部四个入口，页面走「清单 + 勾选 + 拍照」动线 */
export default function MobileLayout() {
  const loc = useLocation()
  const nav = useNavigate()
  const name = localStorage.getItem('txgk_name') ?? '用户'
  const [unread, setUnread] = useState(0)
  const [notifOpen, setNotifOpen] = useState(false)

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
          onClick={() => {
            localStorage.removeItem(TOKEN_KEY)
            localStorage.removeItem('txgk_name')
            localStorage.removeItem('txgk_user')
            nav('/login')
          }}
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
