import { Button, Card, Space, Typography } from 'antd'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../contexts/AuthContext'

/** 我的：账号信息 + 常用入口 + 回电脑版 */
export default function MeM() {
  const nav = useNavigate()
  // 重构 1.3：用户信息/登出走 AuthContext（原散读 localStorage + 自己 fetchMe 刷缓存）
  const { user: profile, logout, refreshMe } = useAuth()

  useEffect(() => {
    void refreshMe()
  }, [refreshMe])

  const canManageUsers = profile?.is_superuser === true || profile?.position === '总监'

  const links = [
    { label: '我的任务', to: '/my-tasks' },
    { label: '设计评审', to: '/reviews' },
    { label: '改版申请', to: '/changes' },
    { label: '采购工作台', to: '/purchase' },
    { label: '商机 / 项目', to: '/projects' },
    ...(canManageUsers ? [{ label: '用户与权限', to: '/users' }] : []),
  ]

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Typography.Text strong>{profile?.name ?? '用户'}</Typography.Text>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {profile?.username ?? ''} {profile?.profession ?? ''} {profile?.position ?? ''}
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
          onClick={() => logout()}
        >
          退出登录
        </Button>
      </Space>
    </>
  )
}
