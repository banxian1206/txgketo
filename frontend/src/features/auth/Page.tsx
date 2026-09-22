import { App, Button, Card, Form, Input, Typography } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { errMsg } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'
import { T } from '../../theme/tokens'

export default function Login() {
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()
  const { message } = App.useApp()
  const { login } = useAuth()

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(135deg,${T.brand} 0%,${T.brandDeep} 100%)`,
      }}
    >
      <Card style={{ width: 380, boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
        {/* 品牌位（重构 2.5 · 视觉规范 §6）：白卡内用正色字标替代标题文字 */}
        <img
          src="/brand/logo.png"
          alt="同兴高科 TXGK"
          style={{ height: 36, display: 'block', marginBottom: 4 }}
        />
        <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
          Guangdong Tongxing High-Tech · TXGK
        </Typography.Paragraph>
        <Form
          layout="vertical"
          onFinish={async (v) => {
            setLoading(true)
            try {
              // 重构 1.3：登录写入统一走 AuthContext（单一 session，新登录天然清伪装）
              await login(v.username, v.password)
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
