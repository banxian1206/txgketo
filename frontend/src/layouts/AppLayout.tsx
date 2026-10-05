import OfflineBanner from '../components/OfflineBanner'
import { Avatar, Badge, Button, Layout, Menu, Space, Tooltip, Typography, type MenuProps } from 'antd'
import { BellOutlined, OrderedListOutlined, DatabaseOutlined, FolderOutlined, SearchOutlined, HomeOutlined, MobileOutlined, SettingOutlined, ShoppingCartOutlined, TruckOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

import CommandPalette from '../components/CommandPalette'
import NotificationsDrawer from '../components/NotificationsDrawer'
import { SIDEBAR_ROOTS, matchSidebarKey } from '../configs/domain'
import { contextPath } from '../hooks/useFrom'
import { useAuth } from '../contexts/AuthContext'
import { hasPerm, unreadNotificationCount } from '../api/client'
import { FS, PAPER, T } from '../theme/tokens'

const { Header, Sider, Content } = Layout

/**
 * ★ 面包屑（方案 A「纸面」2026-10-04）：从**路由**推出来，不编造业务状态。
 *
 * 为什么需要：A 的顶栏左侧要有"我在哪"，而侧栏只到一级。这里按已知前缀映射，
 * 命中的二级段（项目号 / 设备号等）用等宽显示 —— 未登记的路径**原样显示**，
 * 宁可显示得朴素，也不猜一个好看的名字。
 */
const CRUMB_MAP: [string, string][] = [
  ['/workbench/tasks', '我的任务'],
  ['/workbench/reviews', '评审单'],
  ['/workbench/changes', '改版申请'],
  ['/workbench/sales', '商务部工作台'],
  ['/workbench/pm', '项目经理工作台'],
  ['/workbench/eng', '工程部工作台'],
  ['/workbench/shop/mfg', '车间工作台 / 制造'],
  ['/workbench/shop/assembly', '车间工作台 / 装配'],
  ['/workbench/shop', '车间工作台'],
  ['/workbench', '我的工作台'],
  ['/dashboard', '经营驾驶舱'],
  ['/purchase', '采购工作台'],
  ['/warehouse', '仓库工作台'],
  ['/delivery/shipping', '发运工作台'],
  ['/delivery/site', '现场工作台'],
  ['/delivery/service', '售后工作台'],
  ['/library', '标准库'],
  ['/numbering', '编号规则'],
  ['/admin/users', '用户与权限'],
  ['/projects/new', '项目 / 新建商机'],
  // ★ R2：两个新档案页（对象层）—— 顶栏别显示裸路径
  ['/items', '件档案'],
  ['/equipment', '设备档案'],
]

/** 同一份映射的**纯文本**版（给 document.title 用）——避免两处各算一套 */
function crumbText(pathname: string): string {
  const hit = CRUMB_MAP.find(([p]) => pathname === p || pathname.startsWith(p + '/'))
  if (hit) return hit[1]
  if (pathname.startsWith('/projects/')) {
    const seg = pathname.split('/').filter(Boolean)
    const tail = seg[2] === 'initiate' ? ' / 立项' : seg[2] === 'design' ? ' / 设计面' : ''
    return `项目 / ${seg[1] ?? ''}${tail}`
  }
  if (pathname.startsWith('/projects')) return '项目'
  return pathname
}

function crumbs(pathname: string): ReactNode {
  const hit = CRUMB_MAP.find(([p]) => pathname === p || pathname.startsWith(p + '/'))
  if (hit) return <>{hit[1]}</>
  if (pathname.startsWith('/projects/')) {
    const seg = pathname.split('/').filter(Boolean) // ['projects', ':no', ...]
    const no = seg[1]
    const tail = seg[2] === 'initiate' ? ' / 立项' : seg[2] === 'design' ? ' / 设计面' : ''
    return (
      <>
        <Link to="/projects">项目</Link> / <span className="ds-code cur">{no}</span>
        {tail}
      </>
    )
  }
  if (pathname.startsWith('/projects')) return <>{'项目'}</>
  return <span className="ds-code">{pathname}</span>
}

export default function AppLayout() {
  const loc = useLocation()
  // 重构 1.3：登录态/用户名/伪装横幅全部来自 AuthContext（单一 session，不再散读 localStorage）
  const { user: profile, impersonateName, logout, refreshMe, stopImpersonate } = useAuth()
  const name = profile?.name ?? '用户'
  // ★ 重整 P3（docs/10 §8.1 拍板#4/#5）：可见性来源 = **后端下发的能力位**。
  const canManageUsers = hasPerm('admin:users')
  // 站内消息红点（06 卷 §9）：60s 轮询未读数
  const [unread, setUnread] = useState(0)
  const [notifOpen, setNotifOpen] = useState(false)
  // ★ R2 收尾：命令栏（⌘K / Ctrl+K）—— 「粘任意编号 → 直达」全局入口
  const [cmdkOpen, setCmdkOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdkOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  // ★ 标签页标题随路由变（2026-10-05 演示时实测：开 7 个标签全是「同兴高科项目管理系统」，
  //   分不清哪个是哪个；收藏/历史记录也一样）。用顶栏面包屑同一份文案，避免两处各算一套。
  useEffect(() => {
    const node = crumbText(loc.pathname)
    document.title = node ? `${node} · 同兴高科项目管理系统` : '同兴高科项目管理系统'
  }, [loc.pathname])

  // ★ 导航上下文（docs/11）：有 ?from= 就按来源算 —— 否则从台上点进项目详情，侧栏会被「项目」抢走
  const selected = matchSidebarKey(contextPath(loc.pathname, loc.search))

  const SIDEBAR_ICONS: Record<string, React.ReactNode> = {
    home: <HomeOutlined />, checklist: <OrderedListOutlined />, folder: <FolderOutlined />,
    truck: <TruckOutlined />, cart: <ShoppingCartOutlined />, database: <DatabaseOutlined />,
    setting: <SettingOutlined />,
  }
  /** P0：侧栏一级 21→7（三分类=组标题；二级由右侧 DomainShell Tab 承接）
   *  A 纸面：形状不变（客户定的 4 项终态不动），只换皮 —— 浅色底 + 分组标题 + 选中浅蓝 */
  const sidebarItems: MenuProps['items'] = (() => {
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
      {/* ★ A 纸面：侧栏由深色改浅色 —— 与主区同为"纸面"，靠发丝线分界，不再有两套底色打架 */}
      <Sider theme="light" className="app-sider" width={232} breakpoint="lg" collapsedWidth={0}>
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px 12px', flexShrink: 0 }}>
            {/* 品牌位（视觉规范 §6）：浅底用正色字标；字标自带「同兴高科」，不叠文字避免重复 */}
            <img src="/brand/logo.png" alt="同兴高科 TXGK" style={{ height: 26, display: 'block', marginBottom: 6 }} />
            <div style={{ fontSize: FS.xs, color: PAPER.ink3 }}>项目管理系统</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <Menu mode="inline" selectedKeys={[selected]} items={sidebarItems} />
          </div>
        </div>
      </Sider>
      <Layout>
        <OfflineBanner />
        {impersonateName && (
          <div
            style={{
              background: PAPER.warnSoft,
              color: PAPER.warn,
              borderBottom: `1px solid ${PAPER.warnLine}`,
              padding: '6px 24px',
              fontSize: FS.sm,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>正在以「{impersonateName}」身份查看（只读，不能提交/审批/下单）</span>
            <a style={{ color: PAPER.warn, textDecoration: 'underline' }} onClick={() => stopImpersonate()}>
              退出查看
            </a>
          </div>
        )}
        <Header className="app-header">
          <span className="ds-crumb" style={{ marginBottom: 0 }}>
            {crumbs(loc.pathname)}
          </span>
          {/* ★ 命令栏触发：以前这里没有搜索（不假装能用）；现在接的是真接口 /api/v1/search */}
          <button type="button" className="app-search" onClick={() => setCmdkOpen(true)} aria-label="全局检索">
            <SearchOutlined />
            搜编号 / 图号 / 物料 / 项目
            <span className="ds-kbd">⌘K</span>
          </button>
          <Space size={10} style={{ marginLeft: 'auto' }}>
            <Tooltip title="手机端（仓库 / 车间 / 现场的主终端）">
              <Link to="/m" style={{ fontSize: FS.sm, color: PAPER.ink2 }}>
                <MobileOutlined /> 手机端
              </Link>
            </Tooltip>
            <Tooltip title="站内消息">
              <Badge count={unread} size="small">
                <Button size="small" type="text" aria-label="站内消息" title="站内消息" icon={<BellOutlined />} onClick={() => setNotifOpen(true)} />
              </Badge>
            </Tooltip>
            <Avatar size={26} style={{ background: T.brand, color: PAPER.surface, fontSize: FS.xs, fontWeight: 600 }}>
              {name.slice(0, 1)}
            </Avatar>
            <Typography.Text style={{ fontSize: FS.sm }}>{name}</Typography.Text>
            <a style={{ fontSize: FS.sm, color: PAPER.ink3 }} onClick={logout}>
              退出
            </a>
          </Space>
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
      <NotificationsDrawer open={notifOpen} onClose={() => setNotifOpen(false)} onReadChange={setUnread} />
      <CommandPalette open={cmdkOpen} onClose={() => setCmdkOpen(false)} />
    </Layout>
  )
}
