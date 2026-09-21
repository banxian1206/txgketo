import { Avatar, Badge, Button, Layout, Menu, Space, Typography } from 'antd'
import { BellOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'

import NotificationsDrawer from '../components/NotificationsDrawer'
import { TOKEN_KEY, unreadNotificationCount, workbenchMe, type WorkbenchItem } from '../api/client'

const { Header, Sider, Content } = Layout

export default function AppLayout() {
  const nav = useNavigate()
  const loc = useLocation()
  const name = localStorage.getItem('txgk_name') ?? '用户'
  const me = (() => {
    try {
      return JSON.parse(localStorage.getItem('txgk_user') ?? '{}') as {
        is_superuser?: boolean
        position?: string
      }
    } catch {
      return {}
    }
  })()
  // 用户与权限：系统管理员 + 部门负责人（06 卷 §4）
  const canManageUsers = me.is_superuser === true || me.position === '部门负责人'
  const [workbenches, setWorkbenches] = useState<WorkbenchItem[]>([
    { key: 'mine', name: '我的工作台', route: '/workbench', visible: true },
  ])
  // 站内消息红点（06 卷 §9）：60s 轮询未读数
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

  useEffect(() => {
    workbenchMe()
      .then((d) => setWorkbenches(d.workbenches.filter((w) => w.visible)))
      .catch(() => undefined)
  }, [])

  const selected = loc.pathname === '/' ? '/workbench' : loc.pathname

  return (
    <Layout style={{ minHeight: '100%' }}>
      <Sider theme="dark" breakpoint="lg" collapsedWidth={0}>
        <div
          style={{
            color: '#fff',
            padding: '16px 20px',
            fontWeight: 600,
            fontSize: 15,
            lineHeight: 1.4,
          }}
        >
          同兴高科
          <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 400 }}>项目管理系统</div>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected]}
          items={[
            {
              type: 'group',
              label: '工作台',
              children: workbenches.map((w) => ({
                key: w.route,
                label: <Link to={w.route}>{w.name}</Link>,
              })),
            },
            {
              type: 'group',
              label: '业务',
              children: [
                { key: '/my-tasks', label: <Link to="/my-tasks">我的任务</Link> },
                { key: '/projects', label: <Link to="/projects">商机 / 项目</Link> },
                { key: '/reviews', label: <Link to="/reviews">设计评审</Link> },
                { key: '/changes', label: <Link to="/changes">改版</Link> },
                { key: '/suppliers', label: <Link to="/suppliers">供应商</Link> },
              ],
            },
            {
              type: 'group',
              label: '基础数据 / 管理',
              children: [
                { key: '/library', label: <Link to="/library">标准库</Link> },
                { key: '/numbering', label: <Link to="/numbering">编号规则</Link> },
                ...(canManageUsers
                  ? [{ key: '/users', label: <Link to="/users">用户与权限</Link> }]
                  : []),
              ],
            },
          ]}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingInline: 20,
          }}
        >
          <Typography.Text strong>项目全生命周期管理</Typography.Text>
          <Space>
            <Avatar size="small" style={{ background: '#1f6feb' }}>
              {name.slice(0, 1)}
            </Avatar>
            <Typography.Text>{name}</Typography.Text>
            <Badge count={unread} size="small">
              <Button size="small" icon={<BellOutlined />} onClick={() => setNotifOpen(true)} />
            </Badge>
            <Link to="/m" style={{ fontSize: 13 }}>
              手机端
            </Link>
            <a
              onClick={() => {
                localStorage.removeItem(TOKEN_KEY)
                localStorage.removeItem('txgk_name')
                localStorage.removeItem('txgk_user')
                nav('/login')
              }}
            >
              退出
            </a>
          </Space>
        </Header>
        <Content style={{ padding: 20 }}>
          <Outlet />
        </Content>
      </Layout>
      <NotificationsDrawer
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        onReadChange={setUnread}
      />
    </Layout>
  )
}
