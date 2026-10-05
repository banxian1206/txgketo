/**
 * 用法：import { Status, Chip } from '../../components/ds'
 *
 * 设计系统 · 方案 A「纸面 Paper」（2026-10-04 客户选定）
 * ─────────────────────────────────────────────────────────────────────────────
 * 为什么要有这一层：docs/12 §1.2 实测「125 张 Card、265 个 Tag、859 处 inline style」，
 * 根因不是颜色乱（颜色早就单源了），是**页面各写各的版面**。所以把版面收成 6 个壳组件，
 * 页面只准组合它们 —— 这样「规整」是结构保证，不是靠人自觉。
 *
 * 规矩（样式在 theme/paper.css，颜色变量由 main.tsx 从 tokens.ts 注入）：
 *   · 圆角只有 12/8/6/999；间距只有 4/8/12/16/24/32；字号只用 FS 六档
 *   · 状态只有一种画法：`<Status>`（圆点+文字）；只有异常/当前才允许 `<Chip tone>`
 *   · 说明文字进 `title`（浏览器原生气泡）或 `help`，**不上屏**
 */
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { FS, T } from '../../theme/tokens'

export type Tone = 'ok' | 'warn' | 'err' | 'run' | 'idle' | undefined
/** 徽标比状态多一档「主色」（用于「当前/共 N 项」这类非异常强调） */
export type ChipTone = Tone | 'acc'

const toneCls = (base: string, tone?: string) => (tone ? `${base} is-${tone}` : base)

/** 状态：圆点 + 文字（全站唯一画法）。语义色只在「有状态」时才出现 */
export function Status({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return <span className={toneCls('ds-st', tone)}>{children}</span>
}

/** 徽标：中性为默认；只有异常/当前/成功才上色
 *  ★ 也接受 `style`：从 antd `<Chip color=...>` 整体迁过来时偶尔要带个 margin（少一个 prop
 *  就得包一层 span，反而更乱）。除此之外**不接受 color**：颜色只能走 tone（A 的色板）。 */
export function Chip({
  tone,
  children,
  style,
  title,
  onClick,
}: {
  tone?: ChipTone
  children: ReactNode
  style?: CSSProperties
  title?: string
  /** 少数徽标本来就是可点的（如「+3 个设备」展开）—— 整体从 Tag 迁过来时保留 */
  onClick?: () => void
}) {
  return (
    <span className={toneCls('ds-ch', tone)} style={style} title={title} onClick={onClick}>
      {children}
    </span>
  )
}

/** 等宽编号（图号 / 单据号 / 物料号）—— 铁律 2：图号 = 物料号，必须能竖着扫 */
export function Code({
  children,
  to,
  title,
}: {
  children: ReactNode
  to?: string
  /** 可点时给一句"点了会看到什么"（如"看这个件的一生"） */
  title?: string
}) {
  return to ? (
    <Link className="ds-code" to={to} title={title}>
      {children}
    </Link>
  ) : (
    <span className="ds-code" title={title}>
      {children}
    </span>
  )
}

/** 等宽数字（数量 / 金额 / 日期） */
export function Num({ children }: { children: ReactNode }) {
  return <span className="ds-num">{children}</span>
}

/** 页面头：标题 + 一句现状 + 主操作（首屏必须给结论和动作） */
export function PageHead({
  title,
  sub,
  actions,
  crumb,
  help,
}: {
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  crumb?: ReactNode
  /** 这一屏怎么用（长说明一律进这里，不上屏） */
  help?: string
}) {
  return (
    <>
      {crumb && <div className="ds-crumb">{crumb}</div>}
      <div className="ds-head">
        <div>
          <h1>
            {title}
            {/* ★ 可访问名必须是「帮助」而不是整段文案：① 按钮名不该是一整段话；
                ② 实测会污染 e2e 的 getByRole('button', {name:/申请客户验收/}) 查找
                （帮助文案里恰好含这个词 → 抢先把「?」当成目标按钮，导致 P-13a/b 假红）。 */}
            {help && (
              <button type="button" className="ds-help" title={help} aria-label="帮助" style={{ marginLeft: 8, verticalAlign: 3 }}>
                ?
              </button>
            )}
          </h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {actions && <div className="act">{actions}</div>}
      </div>
    </>
  )
}

/** 面板：A 的基本容器（白纸 + 发丝线，不用「卡里嵌卡」） */
export function Panel({
  title,
  sub,
  help,
  extra,
  children,
  bodyStyle,
}: {
  title?: ReactNode
  sub?: ReactNode
  /** 长说明放这里（title 属性 → 原生气泡），不上屏 */
  help?: string
  extra?: ReactNode
  children: ReactNode
  bodyStyle?: CSSProperties
}) {
  return (
    <section className="ds-panel">
      {(title || extra) && (
        <header className="ds-panel-h">
          {title && <h3>{title}</h3>}
          {sub && <span className="sub">{sub}</span>}
          {help && (
            <button type="button" className="ds-help" title={help} aria-label="帮助">
              ?
            </button>
          )}
          {extra && <div className="act">{extra}</div>}
        </header>
      )}
      <div style={bodyStyle}>{children}</div>
    </section>
  )
}

export interface MetricItem {
  key: string
  label: string
  value: ReactNode
  unit?: string
  note?: string
  tone?: Tone
  /** 有去向就是可点的（一条指标 = 一个入口）。同一页内切换用 `to="?tab=xxx"` */
  to?: string
  title?: string
  onClick?: () => void
  dimZero?: boolean
  /** 值是文字（如客户名）而不是数字 —— 换字号/字体，别用 24px 等宽 */
  text?: boolean
}

/** 指标条：一行账目（替代「数字卡墙」——0 的项默认不进来） */
export function Metrics({ items }: { items: MetricItem[] }) {
  if (!items.length) return null
  return (
    <div className={`ds-metrics${items.length <= 3 ? ' is-short' : ''}`}>
      {items.map((m) => {
        const tone = m.dimZero && !m.value ? 'idle' : m.tone
        const inner = (
          <>
            <span className="k">{m.label}</span>
            <span className={m.text ? 'v is-text' : 'v'}>
              {m.value}
              {m.unit && <small> {m.unit}</small>}
            </span>
            {m.note && <span className="n">{m.note}</span>}
          </>
        )
        const cls = toneCls('ds-metric', tone)
        // ★ `to` 必须**真的跳**：之前只渲染 button 且只调 onClick → 传了 `to` 是死按钮
        //   （2026-10-05 发现）。结论条数字一律用 `to="?tab=xxx"` 深链，可分享、可回原队列。
        if (m.to) {
          return (
            <Link key={m.key} className={cls} to={m.to} title={m.title}>
              {inner}
            </Link>
          )
        }
        if (m.onClick) {
          return (
            <button key={m.key} type="button" className={cls} onClick={m.onClick} title={m.title}>
              {inner}
            </button>
          )
        }
        return (
          <div key={m.key} className={cls}>
            {inner}
          </div>
        )
      })}
    </div>
  )
}

/** 队列分组标题 */
export function QueueGroup({
  label,
  count,
  tone,
  action,
}: {
  label: ReactNode
  count?: number
  tone?: Tone
  action?: ReactNode
}) {
  return (
    <div className={toneCls('ds-q-group', tone)}>
      <span className="bar" />
      {label}
      {count !== undefined && <span className="c">{String(count).padStart(2, '0')}</span>}
      {action && <span className="act">{action}</span>}
    </div>
  )
}

/**
 * 队列行：一条 = 一个动作。
 * `cells` 是固定宽的次级列（责任人 / 到期 / 状态），最多 3 个 —— 再多就该进详情。
 */
export function QueueRow({
  lead,
  title,
  meta,
  cells,
  actions,
  onClick,
  muted,
}: {
  lead?: ReactNode
  title?: ReactNode
  meta?: ReactNode
  cells?: { text: ReactNode; tone?: Tone; title?: string }[]
  actions?: ReactNode
  onClick?: () => void
  muted?: boolean
}) {
  const body = (
    <>
      <div className="body">
        <div className="title">
          {lead}
          {title && <span className="nm">{title}</span>}
        </div>
        {meta && <div className="meta">{meta}</div>}
      </div>
      {cells?.map((c, i) => (
        <div key={i} className={toneCls('cell', c.tone)} title={c.title}>
          {c.text}
        </div>
      ))}
      {actions && <div className="act">{actions}</div>}
    </>
  )
  // ★ 行**不能**用 <button>：行内还会放 antd <Button>（动作），button 套 button 是非法 DOM
  //   （实测 console：validateDOMNesting）。所以用 div + role=button + 键盘可达。
  const cls = `ds-row${muted ? ' is-muted' : ''}${onClick ? ' is-clickable' : ''}`
  if (onClick) {
    return (
      <div
        className={cls}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
      >
        {body}
      </div>
    )
  }
  return <div className={cls}>{body}</div>
}

/** 空态：必须给下一步（不给插图，不写「暂无数据」四个字了事） */
export function Empty({ text, action }: { text: ReactNode; action?: ReactNode }) {
  return (
    <div className="ds-empty">
      <div>{text}</div>
      {action && <div className="act">{action}</div>}
    </div>
  )
}

/** 生命周期轨道：项目/设备/单据共用（12 段 → 一格一段，可点） */
export interface RailSegment {
  key: string
  name: string
  value: string
  date?: string
  state?: 'done' | 'now' | 'block'
  onClick?: () => void
}

export function Rail({ segments, help }: { segments: readonly RailSegment[]; help?: string }) {
  return (
    <div style={{ position: 'relative' }}>
      <div className="ds-rail">
        {segments.map((s) => {
          const cls = `ds-seg${s.state ? ` is-${s.state}` : ''}`
          const inner = (
            <>
              <span className="n">{s.name}</span>
              <span className="v">{s.value}</span>
              {s.date && <span className="d">{s.date}</span>}
            </>
          )
          // 可点段用 button（键盘可达），不可点段用 div（避免浏览器给 disabled 按钮上灰色，
          // 那会把「未开始」段显得像坏了）
          return s.onClick ? (
            <button key={s.key} type="button" className={`${cls} is-link`} onClick={s.onClick}>
              {inner}
            </button>
          ) : (
            <div key={s.key} className={cls}>
              {inner}
            </div>
          )
        })}
      </div>
      {help && (
        <span className="ds-help" title={help} style={{ position: 'absolute', top: 12, right: 14 }}>
          ?
        </span>
      )}
    </div>
  )
}

/** 活动流一条（谁 / 什么时候 / 干了什么） */
export function TimelineItem({
  tone,
  title,
  time,
  children,
}: {
  tone?: Tone
  title: ReactNode
  time?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className={toneCls('ds-tl-i', tone)}>
      <span className="pt" />
      <div>
        <div className="tx">{title}</div>
        {time && <div className="tm">{time}</div>}
        {children}
      </div>
    </div>
  )
}

/** 应用内用不到 antd 主色的地方，统一从这里取（避免页面里写 hex） */
export const DS = { brand: T.brand, dashes: '—' } as const
/** 表格里「无值」的统一占位（不要留空字符串，行会错位） */
export const NA = <span style={{ color: 'var(--ds-ink4)' }}>—</span>
/** 小字辅助（12px 灰）—— A 里只有这一档辅助文字 */
export const Muted = ({ children }: { children: ReactNode }) => (
  <span style={{ fontSize: FS.xs, color: 'var(--ds-ink3)' }}>{children}</span>
)
