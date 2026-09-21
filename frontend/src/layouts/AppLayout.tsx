import { Avatar, Badge, Button, Layout, Menu, Space, Tooltip, Typography } from 'antd'
import { BellOutlined, SettingOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'

import NotificationsDrawer from '../components/NotificationsDrawer'
import {
  IMPERSONATE_KEY,
  IMPERSONATE_NAME_KEY,
  TOKEN_KEY,
  me as fetchMe,
  unreadNotificationCount,
  workbenchMe,
  type User,
  type WorkbenchItem,
} from '../api/client'

const { Header, Sider, Content } = Layout

export default function AppLayout() {
  const nav = useNavigate()
  const loc = useLocation()
  const name = localStorage.getItem('txgk_name') ?? '用户'
  const [profile, setProfile] = useState<User | null>(() => {
    try {
      return JSON.parse(localStorage.getItem('txgk_user') ?? 'null') as User | null
    } catch {
      return null
    }
  })
  // 用户与权限：系统管理员 + 总监（06 卷 §4）
  const canManageUsers = profile?.is_superuser === true || profile?.position === '总监'
  const impersonateName = localStorage.getItem(IMPERSONATE_NAME_KEY)
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

  // 每次进后台刷新一次用户信息（岗位/角色/权限），避免用旧的缓存看不到入口
  useEffect(() => {
    fetchMe()
      .then((u) => {
        setProfile(u)
        localStorage.setItem('txgk_user', JSON.stringify(u))
        localStorage.setItem('txgk_name', u.name)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    workbenchMe()
      .then((d) => setWorkbenches(d.workbenches.filter((w) => w.visible)))
      .catch(() => undefined)
  }, [])

  const selected = loc.pathname === '/' ? '/workbench' : loc.pathname
  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem('txgk_name')
    localStorage.removeItem('txgk_user')
    localStorage.removeItem(IMPERSONATE_KEY)
    localStorage.removeItem(IMPERSONATE_NAME_KEY)
    nav('/login')
  }

  return (
    <Layout style={{ minHeight: '100%' }}>
      <Sider theme="dark" breakpoint="lg" collapsedWidth={0}>
        {/* logo 固定，菜单可滚动（否则项目多了最下面的「管理」组会被挤出屏幕） */}
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              color: '#fff',
              padding: '16px 20px',
              fontWeight: 600,
              fontSize: 15,
              lineHeight: 1.4,
              flexShrink: 0,
            }}
          >
            同兴高科
            <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 400 }}>项目管理系统</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
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
          </div>
        </div>
      </Sider>
      <Layout>
        {impersonateName && (
          <div
            style={{
              background: '#fa8c16',
              color: '#fff',
              padding: '6px 20px',
              fontSize: 13,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>正在以「{impersonateName}」身份查看（只读，不能提交/审批/下单）</span>
            <a
              style={{ color: '#fff', textDecoration: 'underline' }}
              onClick={() => {
                localStorage.removeItem(IMPERSONATE_KEY)
                localStorage.removeItem(IMPERSONATE_NAME_KEY)
                window.location.href = '/users'
              }}
            >
              退出查看
            </a>
          </div>
        )}
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
            {canManageUsers && (
              <Link to="/users" style={{ fontSize: 13 }}>
                <SettingOutlined /> 用户与权限
              </Link>
            )}
            <Avatar size="small" style={{ background: '#1f6feb' }}>
              {name.slice(0, 1)}
            </Avatar>
            <Typography.Text>{name}</Typography.Text>
            <Tooltip title="站内消息">
              <Badge count={unread} size="small">
                <Button size="small" icon={<BellOutlined />} onClick={() => setNotifOpen(true)} />
              </Badge>
            </Tooltip>
            <Link to="/m" style={{ fontSize: 13 }}>
              手机端
            </Link>
            <a onClick={logout}>退出</a>
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
