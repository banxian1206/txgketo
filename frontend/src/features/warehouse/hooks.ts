import { App } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { api, errMsg } from '../../api/client'
import type { IssueRow, MoveRow, StockRow, Workbench } from './types'

/**
 * 仓库看板数据（重构 2.0 · 双端同源）：
 * - PC 用 { full: true } 附带库存/流水/领料单；移动端只拉看板
 * - 两端同一请求同一状态 → 待验收/待入库计数天然一致（原双实现各拉各的）
 * - reload 供动作成功后调用（反馈落在视图上，交互规范 §3）
 */
export function useWarehouseBoard({ full = false }: { full?: boolean } = {}) {
  const { message } = App.useApp()
  const [wb, setWb] = useState<Workbench | null>(null)
  const [stock, setStock] = useState<StockRow[]>([])
  const [issueCount, setIssueCount] = useState(0)
  const [moves, setMoves] = useState<MoveRow[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      if (full) {
        const [a, b, c, d] = await Promise.all([
          api.get<Workbench>('/warehouse/workbench').then((r) => r.data),
          api.get<StockRow[]>('/warehouse/stock').then((r) => r.data),
          api.get<IssueRow[]>('/warehouse/issues').then((r) => r.data),
          api.get<MoveRow[]>('/warehouse/moves?limit=50').then((r) => r.data),
        ])
        setWb(a); setStock(b); setIssueCount(c.length); setMoves(d)
      } else {
        const { data } = await api.get<Workbench>('/warehouse/workbench')
        setWb(data)
      }
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [full, message])

  useEffect(() => { void reload() }, [reload])

  return { wb, stock, issueCount, moves, loading, reload }
}
