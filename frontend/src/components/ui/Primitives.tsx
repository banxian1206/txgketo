// components/ui/Primitives.tsx —— 5 个高频排版件（docs/12 §4-3）
// 目的：把 848 处 inline style 里最高频的 5 种组合收掉，页面不再各写各的间距/字号/对齐。
import { Typography } from 'antd'
import type { ReactNode } from 'react'

import { FS, MONO, SP, T } from '../../theme/tokens'

/** 横向/纵向排列 + 刻度间距（替掉 `display:flex;gap:8` 这类写法） */
export function Stack({
  children,
  dir = 'row',
  gap = SP.xs,
  wrap = true,
  align,
  style,
}: {
  children: ReactNode
  dir?: 'row' | 'col'
  gap?: number
  wrap?: boolean
  align?: 'start' | 'center' | 'end' | 'baseline'
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: dir === 'col' ? 'column' : 'row',
        gap,
        flexWrap: wrap && dir === 'row' ? 'wrap' : undefined,
        alignItems: align === 'start' ? 'flex-start' : align,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/** 次要说明文字（统一 12px 灰，禁再手写 fontSize/color） */
export function Muted({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <span style={{ fontSize: FS.xs, color: T.textSecondary, ...style }}>{children}</span>
  )
}

/**
 * label:value 字段栅格 —— 详情页的骨架。
 * ★ 空值不占位（docs/12 §3.2）：`—` 只会让关键字段和空字段抢注意力；
 *   传 `showEmpty` 时才渲染（用于"这个字段本该有值却没有"的提示场景）。
 */
export function FieldGrid({
  items,
  columns = 3,
  showEmpty = false,
}: {
  items: { label: ReactNode; value?: ReactNode; full?: boolean }[]
  columns?: 2 | 3
  showEmpty?: boolean
}) {
  const rows = items.filter((it) => {
    const v = it.value
    const empty = v === null || v === undefined || v === '' || v === '—' || (Array.isArray(v) && v.length === 0)
    return showEmpty || !empty
  })
  if (!rows.length) return <Muted>暂无内容</Muted>
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: `${SP.xs}px ${SP.lg}px`,
      }}
    >
      {rows.map((it, i) => (
        <div key={i} style={{ gridColumn: it.full ? '1 / -1' : undefined, minWidth: 0 }}>
          <Typography.Text style={{ fontSize: FS.xs, color: T.textSecondary }}>{it.label}</Typography.Text>
          <div style={{ fontSize: FS.md, wordBreak: 'break-word' }}>{it.value}</div>
        </div>
      ))}
    </div>
  )
}

/** 等宽编号（图号/单号/物料号/日期）—— 视觉规范 §3.1 */
export function CodeNo({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <span style={{ fontFamily: MONO, fontSize: FS.sm, fontVariantNumeric: 'tabular-nums', ...style }}>
      {children}
    </span>
  )
}

/** 右对齐等宽数字 + 单位（表格/结论条里的数量、金额） */
export function NumCell({
  value,
  unit,
  strong,
}: {
  value: ReactNode
  unit?: ReactNode
  strong?: boolean
}) {
  return (
    <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontSize: FS.sm, textAlign: 'right', fontWeight: strong ? 600 : undefined }}>
      {value}
      {unit ? <span style={{ color: T.textSecondary, fontWeight: 400 }}> {unit}</span> : null}
    </span>
  )
}
