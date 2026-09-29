import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import './styles.css'

// PWA SW（重构 3.3）：仅生产注册 —— dev/e2e 不注册，防缓存污染 HMR 与回归护栏
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={{
        // ★ P0 视觉底座（docs/12 §4-1）：排版/密度/组件级 token 一次定死，
        //   页面里不许再各写各的字号（e2e:static「VIS-字号在刻度内」+「VIS-inline 棘轮」盯着）
        token: {
          colorPrimary: T.brand,
          borderRadius: 6,
          fontSize: FS.md,
          fontSizeSM: FS.xs,
          fontSizeLG: FS.lg,
          fontSizeXL: FS.xl,
        },
        components: {
          Table: { fontSize: FS.sm, cellFontSizeSM: FS.sm, headerBg: T.bgSunken },
          Card: { headerFontSize: FS.lg, headerFontSizeSM: FS.md },
          Tag: { fontSizeSM: FS.xs },
          Typography: { fontSize: FS.md },
        },
      }}>
      <AntApp>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
)

import { FS, T } from './theme/tokens'