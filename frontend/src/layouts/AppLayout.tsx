import OfflineBanner from '../components/OfflineBanner'
import { Avatar, Badge, Button, Layout, Menu, Space, Tooltip, Typography, type MenuProps } from 'antd'
import {
  BellOutlined,
  OrderedListOutlined,
  DatabaseOutlined,
  FolderOutlined,
  HomeOutlined,
  SettingOutlined,
  ShoppingCartOutlined,
  TruckOutlined,
} from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'

import NotificationsDrawer from '../components/NotificationsDrawer'
import { SIDEBAR_ROOTS, matchSidebarKey } from '../configs/domain'
import { contextPath } from '../hooks/useFrom'
import { useAuth } from '../contexts/AuthContext'
import {
  hasPerm,
  unreadNotificationCount,
} from '../api/client'
import { T } from '../theme/tokens'

const { Header, Sider, Content } = Layout

export default function AppLayout() {
  const loc = useLocation()
  // 重构 1.3：登录态/用户名/伪装横幅全部来自 AuthContext（单一 session，不再散读 localStorage）
  const { user: profile, impersonateName, logout, refreshMe, stopImpersonate } = useAuth()
  const name = profile?.name ?? '用户'
  // ★ 重整 P3（docs/10 §8.1 拍板#4/#5）：可见性来源 = **后端下发的能力位**。
  //   `admin:users` 是派生码（deps.effective_permissions ← platform._scope：管理员=全部、总监=本部门），
  //   所以前端不再用 `position === '总监'` 猜岗位 —— 那正是「看得见、点了必 403」的成因。
  const canManageUsers = hasPerm('admin:users')
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

  // 每次进后台刷新一次用户信息（岗位/角色/权限），避免用旧的缓存看不到入口（重构 1.3：走 Context）
  useEffect(() => {
    void refreshMe()
  }, [refreshMe])


  // ★ 导航上下文（docs/11）：有 ?from= 就按来源算 —— 否则从台上点进项目详情，侧栏会被
  //   「项目」抢走（用户明明是从采购台来的），这是体检里最刺眼的一条
  const selected = matchSidebarKey(contextPath(loc.pathname, loc.search))

  const SIDEBAR_ICONS: Record<string, React.ReactNode> = {
    home: <HomeOutlined />, checklist: <OrderedListOutlined />, folder: <FolderOutlined />,
    truck: <TruckOutlined />, cart: <ShoppingCartOutlined />, database: <DatabaseOutlined />,
    setting: <SettingOutlined />,
  }
  /** P0：侧栏一级 21→7（三分类=组标题；二级由右侧 DomainShell Tab 承接） */
  const sidebarItems: MenuProps['items'] = (() => {
    // ★ 「交付执行」已从侧栏删除（docs/10 §8.1 D1）：业务线只在各角色的工作台里跑
    const roots = SIDEBAR_ROOTS.filter((r) => (r.admin ? canManageUsers : true))
    const groups: { label: string; keys: string[] }[] = [
      { label: '工作台', keys: ['/workbench'] },
      { label: '业务', keys: ['/projects', '/library'] },
      { label: '系统管理', keys: ['/admin/users'] },
    ]
    return groups
      .map((g) => ({
        type: 'group' as const,
        label: g.label,
        children: roots
          .filter((r) => g.keys.includes(r.key))
          .map((r) => ({
            key: r.key,
            icon: SIDEBAR_ICONS[r.icon],
            label: <Link to={r.to}>{r.label}</Link>,
          })),
      }))
      .filter((g) => (g.children as unknown[]).length > 0)
  })()


  return (
    <Layout style={{ minHeight: '100%' }}>
      <Sider theme="dark" breakpoint="lg" collapsedWidth={0}>
        {/* logo 固定，菜单可滚动（否则项目多了最下面的「管理」组会被挤出屏幕） */}
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              color: T.bg,
              padding: '16px 20px 12px',
              flexShrink: 0,
            }}
          >
            {/* 品牌位（重构 2.5 · 视觉规范 §6）：反白字标替代主名文字（字标自带“同兴高科”，不叠文字避免重复） */}
            <img
              src="/brand/logo-white.png"
              alt="同兴高科 TXGK"
              style={{ height: 28, display: 'block', marginBottom: 4 }}
            />
            <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 400 }}>项目管理系统</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <Menu
              theme="dark"
              mode="inline"
              selectedKeys={[selected]}
              items={sidebarItems}
            />
          </div>
        </div>
      </Sider>
      <Layout>
        <OfflineBanner />
        {impersonateName && (
          <div
            style={{
              background: T.orange,
              color: T.bg,
              padding: '6px 20px',
              fontSize: 13,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>正在以「{impersonateName}」身份查看（只读，不能提交/审批/下单）</span>
            <a
              style={{ color: T.bg, textDecoration: 'underline' }}
              onClick={() => stopImpersonate()}
            >
              退出查看
            </a>
          </div>
        )}
        <Header
          style={{
            background: T.bg,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingInline: 20,
          }}
        >
          <Typography.Text strong>项目全生命周期管理</Typography.Text>
          <Space>
            {canManageUsers && (
              <Link to="/admin/users" style={{ fontSize: 13 }}>
                <SettingOutlined /> 用户与权限
              </Link>
            )}
            <Avatar size="small" style={{ background: T.brand }}>
              {name.slice(0, 1)}
            </Avatar>
            <Typography.Text>{name}</Typography.Text>
            <Tooltip title="站内消息">
              <Badge count={unread} size="small">
                <Button size="small" aria-label="站内消息" title="站内消息" icon={<BellOutlined />} onClick={() => setNotifOpen(true)} />
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
