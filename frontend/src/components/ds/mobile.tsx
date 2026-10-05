import type { ReactNode } from 'react'

/**
 * 移动端设计系统（R4 · 2026-10-04）：**作业卡 Job**。
 *
 * 手机是仓库/车间/现场的主终端（03 卷），原来的页面是「PC 表格的缩小版」：
 * 首页 14 个数字格（一半是 0）、列表把同一个物料重复十几张卡、动作藏在卡里要往上够。
 *
 * 这一层定四条：
 *   ① 一屏一件事：**一张卡 = 一个动作**，主按钮吸底（`.m-actionbar`，拇指不用往上够）
 *   ② **同一张单折叠成一组**（同一采购单送来的货一起验收，别一张张点）
 *   ③ **0 的不占位**：首页只列今天真要干的（任务流），没得干就说"没有待办"
 *   ④ 状态只有一种画法：卡片左侧 3.5px 色条 + 圆点文字（与 PC 的 `Status` 同源语义）
 *
 * 触控与字号由 `.m-shell` 作用域 CSS 兜底（≥40px），这里只管版式。
 */

export type MTone = 'ok' | 'warn' | 'err' | 'run' | undefined

/** 页面头（移动端只有一行：标题 + 一句现状） */
export function MHead({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="m-head">
      <div className="m-head-t">{title}</div>
      {sub && <div className="m-head-s">{sub}</div>}
    </div>
  )
}

/** 分组标题（同一张单 = 一组，组头说清楚"谁送来的、几项、共多少"） */
export function MGroup({
  title,
  sub,
  right,
}: {
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="m-group">
      <div className="m-group-l">
        <div className="m-group-t">{title}</div>
        {sub && <div className="m-group-s">{sub}</div>}
      </div>
      {right && <div className="m-group-r">{right}</div>}
    </div>
  )
}

/** 作业卡：一张卡 = 一件事。`tone` 决定左侧色条（异常/临期一眼可见） */
export function MCard({
  tone,
  head,
  title,
  lines,
  photos,
  onClick,
  children,
}: {
  tone?: MTone
  /** 左上角的小行：编号 + 状态 */
  head?: ReactNode
  title?: ReactNode
  /** 信息行（每行一条，别塞成一段话） */
  lines?: ReactNode[]
  /** 照片缩略图（照片是本系统的主要凭证 —— 直接上卡片） */
  photos?: ReactNode
  onClick?: () => void
  children?: ReactNode
}) {
  return (
    <div
      className={`m-card${tone ? ` is-${tone}` : ''}${onClick ? ' is-tap' : ''}`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {head && <div className="m-card-h">{head}</div>}
      {title && <div className="m-card-t">{title}</div>}
      {lines?.map((l, i) => (
        <div className="m-card-l" key={i}>
          {l}
        </div>
      ))}
      {photos && <div className="m-photos">{photos}</div>}
      {children}
    </div>
  )
}

/** 清单行（勾选 + 文本 + 数量 + 拍照位）—— 「清单 + 勾选 + 拍照」的最小单位 */
export function MCheckRow({
  checked,
  onToggle,
  title,
  sub,
  right,
  photo,
}: {
  checked: boolean
  onToggle: () => void
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
  photo?: ReactNode
}) {
  return (
    <div className="m-row">
      <div
        className={`m-check${checked ? ' on' : ''}`}
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        {checked ? '✓' : ''}
      </div>
      <div className="m-row-tx">
        <div className="m-row-t">{title}</div>
        {sub && <div className="m-row-s">{sub}</div>}
      </div>
      {right && <div className="m-row-r">{right}</div>}
      {photo}
    </div>
  )
}

/** 状态：圆点 + 文字（与 PC 的 ds-st 语义一致，移动端字号更大） */
export function MStatus({ tone, children }: { tone?: MTone; children: ReactNode }) {
  return <span className={`m-st${tone ? ` is-${tone}` : ''}`}>{children}</span>
}

/** 小徽标 */
export function MChip({ tone, children }: { tone?: MTone | 'acc'; children: ReactNode }) {
  return <span className={`m-chip${tone ? ` is-${tone}` : ''}`}>{children}</span>
}

/** 空态：说清楚"为什么没有、去哪干"，不给插图 */
export function MEmpty({ text }: { text: ReactNode }) {
  return <div className="m-empty">{text}</div>
}
