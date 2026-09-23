import { App, Button, Form, Input } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { errMsg } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'

/**
 * 登录页（2026-09-23 重做 · 简单有格调）：
 * 桌面 = 左品牌面板（深空渐变 + 反白字标 + 橙 rule + 图纸网格暗纹）× 右极简表单
 * 移动 = 单栏白底 + 顶部正色字标（≤880px 由 styles.css 媒体查询切换）
 * 约束：e2e 选择器（placeholder="admin" / password / 按钮「登录」）与 BRAND 断言保持兼容
 */
export default function Login() {
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()
  const { message } = App.useApp()
  const { login } = useAuth()

  return (
    <div className="login-page">
      {/* 左：品牌面板（深底用反白字标，视觉规范 §6.3） */}
      <aside className="login-brand">
        <img className="login-logo-wide" src="/brand/logo-white.png" alt="同兴高科 TXGK" />
        <div className="login-rule" />
        <h2 className="login-slogan">项目全生命周期管理</h2>
        <p className="login-chain">
          商机 · 立项 · 工程设计 · 采购 · 制造 · 装配 · 发运 · 现场 · 验收 · 质保
        </p>
        <div className="login-brand-foot">TXGK · Guangdong Tongxing High-Tech</div>
      </aside>

      {/* 右：表单 */}
      <main className="login-pane">
        {/* 移动端可见的正色字标（桌面隐藏，但保留在 DOM——BRAND 断言依赖它真实加载） */}
        <img className="login-logo-compact" src="/brand/logo.png" alt="同兴高科 TXGK" />
        <div className="login-box">
          <h1 className="login-title">登录</h1>
          <p className="login-sub">使用管理员分配的账号访问系统</p>
          <Form
            layout="vertical"
            onFinish={async (v) => {
              setLoading(true)
              try {
                // 重构 1.3：登录写入统一走 AuthContext（单一 session，新登录天然清伪装）
                await login(v.username, v.password)
                // 手机（窄屏）默认进移动端；电脑进工作台（03 卷：手机端是主要终端）
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
          <div className="login-foot">© 广东同兴高科智能装备有限公司</div>
        </div>
      </main>
    </div>
  )
}
