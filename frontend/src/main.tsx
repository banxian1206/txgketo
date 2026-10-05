import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import './styles.css'
import './theme/paper.css'
import { FS, MONO, PAPER, R, SHADOW, T } from './theme/tokens'

// PWA SW（重构 3.3）：仅生产注册 —— dev/e2e 不注册，防缓存污染 HMR 与回归护栏
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

/**
 * ★ 方案 A「纸面 Paper」（2026-10-04 客户选定）：把 tokens.ts 的颜色**注入成 CSS 变量**。
 *
 * 为什么这样做：`theme/paper.css` 是版面/密度层，它需要颜色，但 CSS 里写死 hex 就等于
 * 又开了第二个颜色来源（改一处漏一处）。所以颜色只在 `theme/tokens.ts` 定义一次，
 * 这里渲染前注入为 `--ds-*`，CSS 只引用变量。
 */
const CSS_VARS: Record<string, string> = {
  '--ds-bg': PAPER.bg,
  '--ds-surface': PAPER.surface,
  '--ds-surface2': PAPER.surface2,
  '--ds-surface3': PAPER.surface3,
  '--ds-line': PAPER.line,
  '--ds-line2': PAPER.line2,
  '--ds-ink': PAPER.ink,
  '--ds-ink2': PAPER.ink2,
  '--ds-ink3': PAPER.ink3,
  '--ds-ink4': PAPER.ink4,
  '--ds-acc': T.brand,
  '--ds-accentSoft': PAPER.accentSoft,
  '--ds-accentLine': PAPER.accentLine,
  '--ds-ok': PAPER.ok,
  '--ds-okSoft': PAPER.okSoft,
  '--ds-okLine': PAPER.okLine,
  '--ds-warn': PAPER.warn,
  '--ds-warnSoft': PAPER.warnSoft,
  '--ds-warnLine': PAPER.warnLine,
  '--ds-err': PAPER.err,
  '--ds-errSoft': PAPER.errSoft,
  '--ds-errLine': PAPER.errLine,
  '--ds-idle': PAPER.idle,
  '--ds-mono': MONO,
  '--ds-shadow': SHADOW,
}
{
  const el = document.createElement('style')
  el.setAttribute('data-ds', 'paper')
  el.textContent = `:root{${Object.entries(CSS_VARS).map(([k, v]) => `${k}:${v}`).join(';')}}`
  document.head.appendChild(el)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        // ★ 视觉底座（docs/12 §4-1 + docs/13 §4）：排版/密度/组件级 token 一次定死，
        //   页面里不许再各写各的字号（e2e:static「VIS-字号在刻度内」+「VIS-inline 棘轮」盯着）
        token: {
          colorPrimary: T.brand,
          colorSuccess: PAPER.ok,
          colorWarning: PAPER.warn,
          colorError: PAPER.err,
          colorBgLayout: PAPER.bg,
          colorBgContainer: PAPER.surface,
          colorBorder: PAPER.line2,
          colorBorderSecondary: PAPER.line,
          colorText: PAPER.ink,
          colorTextSecondary: PAPER.ink2,
          colorTextTertiary: PAPER.ink3,
          colorTextQuaternary: PAPER.ink4,
          // 圆角三档封顶（容器 12 / 控件 8 / 小元素 6）
          borderRadius: R.md,
          borderRadiusLG: R.lg,
          borderRadiusSM: R.sm,
          fontSize: FS.md,
          fontSizeSM: FS.xs,
          fontSizeLG: FS.lg,
          fontSizeXL: FS.xl,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
          // 阴影全站一档（A 不做多层阴影；层级靠发丝线 + 背景分层）
          boxShadow: SHADOW,
          boxShadowSecondary: SHADOW,
          boxShadowTertiary: SHADOW,
          wireframe: false,
          controlHeight: 32,
        },
        components: {
          Layout: {
            headerBg: PAPER.surface,
            headerHeight: 56,
            headerPadding: '0 24px',
            siderBg: PAPER.surface,
            bodyBg: PAPER.bg,
          },
          Menu: {
            itemBg: 'transparent',
            itemColor: PAPER.ink2,
            itemHoverBg: PAPER.surface3,
            itemHoverColor: PAPER.ink,
            itemSelectedBg: PAPER.accentSoft,
            itemSelectedColor: T.brand,
            itemHeight: 34,
            itemMarginInline: 8,
            itemMarginBlock: 2,
            itemBorderRadius: R.md,
            groupTitleColor: PAPER.ink4,
            groupTitleFontSize: FS.xs,
            iconSize: 15,
            collapsedIconSize: 16,
          },
          Table: {
            fontSize: FS.sm,
            cellFontSize: FS.sm,
            cellFontSizeSM: FS.sm,
            headerBg: PAPER.surface2,
            headerColor: PAPER.ink3,
            headerSplitColor: 'transparent',
            rowHoverBg: PAPER.surface2,
            borderColor: PAPER.line,
            // ★ 只收紧**小表**的纵向内边距（8 → 10 没意义，故保持 8；真正要的是行高统一）。
            //   ⚠ 横向内边距**不得覆盖**：antd 按 size 分档（middle 16 / small 8），
            //   一刀切成 16 会把小表的列整体撑宽 → 表格溢出容器、右侧列被裁
            //   （实测 /projects 销售列被裁掉，2026-10-04）。
            cellPaddingBlockSM: 9,
          },
          Card: { headerFontSize: FS.lg, headerFontSizeSM: FS.md, paddingLG: 20 },
          Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 500, defaultBorderColor: PAPER.line2 },
          Tag: { fontSizeSM: FS.xs, defaultBg: PAPER.surface3, defaultColor: PAPER.ink2 },
          Typography: { fontSize: FS.md },
          Statistic: { contentFontSize: FS.num },
          Drawer: { paddingLG: 16 },
          Descriptions: { labelBg: PAPER.surface2 },
        },
      }}
    >
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
