import { Button, Card, Space, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'

import { TOKEN_KEY } from '../../api/client'

/** 我的：账号信息 + 常用入口 + 回电脑版 */
export default function MeM() {
  const nav = useNavigate()
  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem('txgk_user') ?? '{}') as {
        name?: string
        username?: string
        profession?: string
        position?: string
      }
    } catch {
      return {}
    }
  })()

  const links = [
    { label: '我的任务', to: '/my-tasks' },
    { label: '设计评审', to: '/reviews' },
    { label: '改版申请', to: '/changes' },
    { label: '采购工作台', to: '/purchase' },
    { label: '商机 / 项目', to: '/projects' },
  ]

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Typography.Text strong>{user.name ?? '用户'}</Typography.Text>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {user.username ?? ''} {user.profession ?? ''} {user.position ?? ''}
          </Typography.Text>
        </div>
      </Card>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {links.map((l) => (
            <Button key={l.to} block onClick={() => nav(l.to)}>
              {l.label}
            </Button>
          ))}
        </Space>
      </Card>

      <Space direction="vertical" style={{ width: '100%' }}>
        <Button block onClick={() => nav('/projects')}>
          回到电脑版
        </Button>
        <Button
          block
          danger
          onClick={() => {
            localStorage.removeItem(TOKEN_KEY)
            localStorage.removeItem('txgk_name')
            localStorage.removeItem('txgk_user')
            nav('/login')
          }}
        >
          退出登录
        </Button>
      </Space>
    </>
  )
}
