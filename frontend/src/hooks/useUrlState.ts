import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * 列表页状态的唯一容器（docs/12 §2-A / P3）。
 *
 * 为什么必须进 URL：A 型页（台账列表）的日常用法是「我筛好一轮，回头还要用同一套条件」——
 * 放组件 state 的话刷新即丢、链接发不出去、从详情返回也不在原来的筛选上。
 * 台类页的页签已经这么做了（useTab），这里把同一套规则推广到筛选/搜索/分页。
 *
 * 约定：默认值不写进 URL（保持链接干净）；未知值不炸（回到默认）。
 */
export function useUrlState<T extends Record<string, string | number | undefined>>(defaults: T) {
  const [sp, setSp] = useSearchParams()
  const values = useMemo(() => {
    const out = { ...defaults } as Record<string, string | undefined>
    for (const k of Object.keys(defaults)) {
      const v = sp.get(k)
      out[k] = v === null || v === '' ? (defaults[k] === undefined ? undefined : String(defaults[k])) : v
    }
    return out as T & Record<string, string | undefined>
  }, [sp, defaults])

  const set = useCallback(
    (patch: Partial<Record<keyof T, string | number | undefined>>) => {
      const next = new URLSearchParams(sp)
      for (const [k, v] of Object.entries(patch)) {
        const key = k as keyof T
        const sv = v === undefined || v === null || v === '' ? undefined : String(v)
        if (sv === undefined || sv === String(defaults[key as string] ?? '')) next.delete(String(key))
        else next.set(String(key), sv)
      }
      setSp(next, { replace: true })
    },
    [sp, setSp, defaults],
  )

  return [values, set] as const
}
