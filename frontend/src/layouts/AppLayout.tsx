import { Avatar, Layout, Menu, Space, Typography } from 'antd'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { TOKEN_KEY } from '../api/client'

const { Header, Sider, Content } = Layout

export default function AppLayout() {
  const nav = useNavigate()
  const loc = useLocation()
  const name = localStorage.getItem('txgk_name') ?? '用户'
  const isAdmin = (() => {
    try {
      return JSON.parse(localStorage.getItem('txgk_user') ?? '{}').is_superuser === true
    } catch {
      return false
    }
  })()

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
          selectedKeys={[loc.pathname]}
          items={[
            { key: '/', label: <Link to="/">首页</Link> },
            { key: '/my-tasks', label: <Link to="/my-tasks">我的任务</Link> },
            { key: '/reviews', label: <Link to="/reviews">设计评审</Link> },
            { key: '/changes', label: <Link to="/changes">改版</Link> },
            { key: '/projects', label: <Link to="/projects">商机 / 项目</Link> },
            { key: '/warehouse', label: <Link to="/warehouse">仓库</Link> },
            { key: '/purchase', label: <Link to="/purchase">采购工作台</Link> },
            { key: '/suppliers', label: <Link to="/suppliers">供应商</Link> },
            { key: '/library', label: <Link to="/library">标准库</Link> },
            { key: '/numbering', label: <Link to="/numbering">编号规则</Link> },
            ...(isAdmin ? [{ key: '/users', label: <Link to="/users">用户与岗位</Link> }] : []),
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
    </Layout>
  )
}
