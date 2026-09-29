import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * 页签状态的唯一驱动（重整方案 P0 · docs/10 §3.3）。
 *
 * 为什么要抽这一层：全站原来三套机制并存 —— 子路由 / `?tab=`（只有采购台）/ 组件 useState。
 * state 那批「刷新回第一个页签、URL 表达不了、通知深链指不到页签」，是页签乱的第一根因。
 *
 * 规则：
 *  - `?tab=` 是唯一真相；**默认页签不写进 URL**（保持首页链接干净，与采购台既有行为一致）
 *  - 未知值不炸：落回第一个**可见**页签（注册表按权限过滤后可能没有 fallback）
 *  - 只用于「页内页签」这一层；域/台层继续用子路由
 */
export function useTab(
  /** 已按权限过滤后的可见页签 key 列表 */
  visibleKeys: string[],
  fallback?: string,
): [string, (key: string) => void, (key: string) => string] {
  const [sp, setSp] = useSearchParams()
  const raw = sp.get('tab')
  const first = visibleKeys[0] ?? ''
  const tab = raw && visibleKeys.includes(raw) ? raw : (fallback && visibleKeys.includes(fallback) ? fallback : first)

  const set = useCallback(
    (key: string) => {
      const base = new URLSearchParams(sp)
      if (key === (fallback ?? first)) base.delete('tab')
      else base.set('tab', key)
      setSp(base, { replace: true })
    },
    [sp, setSp, fallback, first],
  )

  /** 给深链用：把当前 URL 的 tab 换成 key（fallback 时清掉，URL 保持干净） */
  const hrefFor = useCallback(
    (key: string) => {
      const base = new URLSearchParams(sp)
      if (key === (fallback ?? first)) base.delete('tab')
      else base.set('tab', key)
      const qs = base.toString()
      return qs ? `?${qs}` : ''
    },
    [sp, fallback, first],
  )

  return useMemo(() => [tab, set, hrefFor] as const, [tab, set, hrefFor])
}
