import { Alert, App, Button, Checkbox, Form, Input, Spin, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { errMsg } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'
import { clearCredential, clearManualLogout, isManualLogout, readCredential, readRememberPref, saveCredential, saveRememberPref } from '../../utils/credential'

/**
 * 登录页（2026-09-23 重做 · 简单有格调 + 记住密码）
 * 桌面 = 左品牌面板（深空渐变 + 反白字标 + 橙 rule + 图纸网格暗纹）× 右极简表单
 * 移动 = 单栏白底 + 顶部正色字标（≤880px 由 styles.css 媒体查询切换）
 *
 * 记住密码（交互规范 §2.6）：
 * - 勾选后凭据存本机；session 被动失效（401 被踢）回登录页 → 自动重登，无需重输
 * - 主动退出会清凭据（AuthContext.logout）；凭据失效自动清理并回表单
 * - 「使用其他账号」可随时切换（清除凭据 + 回表单）
 */
export default function Login() {
  const [loading, setLoading] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const nav = useNavigate()
  const { message } = App.useApp()
  const { login } = useAuth()

  const [form] = Form.useForm()
  // 记住的【偏好本身】跨会话保留（2026-09-23 反馈：退出后勾选不该丢）
  const [remember, setRemember] = useState(readRememberPref)
  /** true = 展示表单：无凭据 / 主动退出（填充预填）/ 用户换号 / 自动登录失败回退 */
  const [manual, setManual] = useState(() => {
    const c = readCredential()
    return !c || isManualLogout()
  })
  const autoRan = useRef(false)

  // 主动退出回到登录页：表单预填好（填充模式 —— 点一下登录即可，无需重输）
  useEffect(() => {
    if (!manual) return
    const c = readCredential()
    if (c && isManualLogout()) {
      form.setFieldsValue({ username: c.username, password: c.password })
      setRemember(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goAfterLogin = () => {
    // 手机（窄屏）默认进移动端；电脑进工作台（03 卷：手机端是主要终端）
    const isPhone = window.matchMedia('(max-width: 820px)').matches
    nav(isPhone ? '/m' : '/workbench')
  }

  // 自动登录：有凭据且未在手动模式 → 静默重登（401 被踢后的无感恢复）
  useEffect(() => {
    if (manual || autoRan.current) return
    const cred = readCredential()
    if (!cred) return
    autoRan.current = true
    ;(async () => {
      try {
        await login(cred.username, cred.password)
        goAfterLogin()
      } catch {
        // 凭据失效（改密/停用）→ 清理并回表单，不循环
        clearCredential()
        setRemember(false)
        setManual(true)
        message.warning('记住的密码已失效，请重新登录')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual])

  const switchAccount = () => {
    clearCredential()
    saveRememberPref(false)
    clearManualLogout()
    setRemember(false)
    setManual(true)
    form.resetFields()
  }

  return (
    <div className="login-page">
      {/* 左：品牌面板（深底用反白字标，视觉规范 §6.3） */}
      <aside className="login-brand">
        <img className="login-logo-wide" src="/brand/logo-white.png" alt="同兴高科 TXGK" />
        <div className="login-rule" />
        <h2 className="login-slogan">项目全生命周期管理</h2>
        <p className="login-chain">
          <span>商机 · 立项 · 工程设计 · 采购 · 制造</span>
          <span>装配 · 发运 · 现场 · 验收 · 质保</span>
        </p>
        <div className="login-brand-foot">TXGK · Guangdong Tongxing High-Tech</div>
      </aside>

      {/* 右：表单 / 自动登录 */}
      <main className="login-pane">
        {/* 移动端可见的正色字标（桌面隐藏，但保留在 DOM——BRAND 断言依赖它真实加载） */}
        <img className="login-logo-compact" src="/brand/logo.png" alt="同兴高科 TXGK" />
        <div className="login-box">
          {manual ? (
            <>
              <h1 className="login-title">登录</h1>
              <p className="login-sub">使用管理员分配的账号访问系统</p>
              <Form
                form={form}
                onValuesChange={() => setLoginError(null)}
                layout="vertical"
                onFinish={async (v) => {
                  setLoading(true)
                  setLoginError(null)
                  try {
                    // 记住密码：偏好始终持久化；勾选才留凭据（取消勾选 = 主动清除）
                    saveRememberPref(remember)
                    if (remember) saveCredential(v.username, v.password)
                    else clearCredential()
                    clearManualLogout()
                    // 重构 1.3：登录写入统一走 AuthContext（单一 session，新登录天然清伪装）
                    await login(v.username, v.password)
                    goAfterLogin()
                  } catch (e) {
                    setLoginError(errMsg(e))
                  } finally {
                    setLoading(false)
                  }
                }}
              >
                <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
                  <Input size="large" placeholder="请输入账号" autoComplete="username" />
                </Form.Item>
                <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
                  <Input.Password size="large" autoComplete="current-password" />
                </Form.Item>
                <div className="login-remember">
                  <Checkbox
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  >
                    记住密码，本机下次自动登录
                  </Checkbox>
                </div>
                {loginError && <Alert className="login-error" type="error" showIcon role="alert" message={loginError} />}
                <Button type="primary" htmlType="submit" size="large" block loading={loading}>
                  登录
                </Button>
              </Form>
              <div className="login-foot">© 广东同兴高科智能装备有限公司</div>
            </>
          ) : (
            /* 凭据存在：自动登录中（通常一闪而过；失败则回上表单） */
            <div className="login-auto" data-testid="auto-login">
              <Spin />
              <Typography.Text type="secondary" style={{ marginTop: 16 }}>
                正在自动登录…
              </Typography.Text>
              <button type="button" className="login-switch" onClick={switchAccount}>
                使用其他账号
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
