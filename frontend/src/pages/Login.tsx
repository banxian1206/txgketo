import { App, Button, Card, Form, Input, Typography } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { TOKEN_KEY, errMsg, login } from '../api/client'

export default function Login() {
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()
  const { message } = App.useApp()

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg,#1f6feb 0%,#0f2b52 100%)',
      }}
    >
      <Card style={{ width: 380, boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
        <Typography.Title level={4} style={{ marginBottom: 4 }}>
          同兴高科项目管理系统
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
          Guangdong Tongxing High-Tech · TXGK
        </Typography.Paragraph>
        <Form
          layout="vertical"
          onFinish={async (v) => {
            setLoading(true)
            try {
              const data = await login(v.username, v.password)
              localStorage.setItem(TOKEN_KEY, data.access_token)
              localStorage.setItem('txgk_name', data.user.name)
              localStorage.setItem('txgk_user', JSON.stringify(data.user))
              // 手机（窄屏）默认进移动端；电脑进项目列表（03 卷：手机端是主要终端）
              const isPhone = window.matchMedia('(max-width: 820px)').matches
              nav(isPhone ? '/m' : '/workbench')
            } catch (e) {
              message.error(errMsg(e))
            } finally {
              setLoading(false)
            }
          }}
        >
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input size="large" placeholder="admin" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password size="large" autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  )
}
