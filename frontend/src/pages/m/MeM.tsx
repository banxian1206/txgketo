import { Button, Card, Space, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { IMPERSONATE_KEY, IMPERSONATE_NAME_KEY, TOKEN_KEY, me as fetchMe, type User } from '../../api/client'

/** 我的：账号信息 + 常用入口 + 回电脑版 */
export default function MeM() {
  const nav = useNavigate()
  const [profile, setProfile] = useState<User | null>(() => {
    try {
      return JSON.parse(localStorage.getItem('txgk_user') ?? 'null') as User | null
    } catch {
      return null
    }
  })

  useEffect(() => {
    fetchMe()
      .then((u) => {
        setProfile(u)
        localStorage.setItem('txgk_user', JSON.stringify(u))
      })
      .catch(() => undefined)
  }, [])

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
          onClick={() => {
            localStorage.removeItem(TOKEN_KEY)
            localStorage.removeItem('txgk_name')
            localStorage.removeItem('txgk_user')
            localStorage.removeItem(IMPERSONATE_KEY)
            localStorage.removeItem(IMPERSONATE_NAME_KEY)
            nav('/login')
          }}
        >
          退出登录
        </Button>
      </Space>
    </>
  )
}
