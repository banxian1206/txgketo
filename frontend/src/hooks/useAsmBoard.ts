import { App } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { errMsg, kittingOverview, listAssemblyRecords, type AssemblyRecordRow, type KittingOverviewRow } from '../api/client'

/**
 * 装配看板（重构 2.3 · 双端同源）：齐套概览 + 装配记录
 * reload(pno?) —— 无参=全部记录，带参=按项目（与原 load(pno) 语义一致）；项目下拉等表单选项留壳层
 */
export function useAsmBoard() {
  const { message } = App.useApp()
  const [overview, setOverview] = useState<KittingOverviewRow[]>([])
  const [records, setRecords] = useState<AssemblyRecordRow[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(
    async (pno?: string) => {
      setLoading(true)
      try {
        const [ov, recs] = await Promise.all([
          pno ? kittingOverview(pno) : Promise.resolve([]),
          listAssemblyRecords(pno ? { project_no: pno } : {}),
        ])
        setOverview(ov)
        setRecords(recs)
      } catch (e) {
        message.error(errMsg(e))
      } finally {
        setLoading(false)
      }
    },
    [message],
  )

  useEffect(() => { void reload() }, [reload])
  return { overview, records, loading, reload }
}
