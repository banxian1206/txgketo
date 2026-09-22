import { useCallback, useEffect, useRef, useState } from 'react'
import { errMsg } from '../api/client'

/**
 * 服务端数据三态 hook（重构 1.2 · 零依赖自封装）
 *   const { data, loading, error, reload } = useRequest(() => listLocations(), [])
 * - deps 变化自动重取；reload 手动刷新（动作成功后调它 = 反馈落在视图上）
 * - 错误统一 errMsg 分级前的原文，展示层按 §3 规则呈现
 */
export function useRequest<T>(fn: () => Promise<T>, deps: readonly unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const reload = useCallback(() => {
    setLoading(true)
    return fnRef
      .current()
      .then((d) => {
        setData(d)
        setError(null)
        return d
      })
      .catch((e) => {
        setError(errMsg(e))
        return null
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...deps])

  return { data, loading, error, reload }
}
