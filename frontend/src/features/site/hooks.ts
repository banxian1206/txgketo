import { App } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import {
  errMsg,
  listAcceptances,
  listProjects,
  siteIncoming,
  siteWorkbench,
  type AcceptanceRow,
  type SiteIncomingPending,
  type SiteWorkbench,
} from '../../api/client'

/**
 * 现场看板数据（重构 2.1 · 双端同源）：
 * - PC 与移动端同请求同状态（原两份 load 逐行重复）
 * - withAcceptance：移动端首页还挂验收单列表，PC 不需要
 * - reload(pno?) 完全复刻原 load(pno) 语义：无参=全项目看板，带参=该项目
 */
export function useSiteBoard({ withAcceptance = false }: { withAcceptance?: boolean } = {}) {
  const { message } = App.useApp()
  const [projectNo, setProjectNo] = useState<string | undefined>()
  const [projects, setProjects] = useState<{ project_no: string; project_name: string }[]>([])
  const [wb, setWb] = useState<SiteWorkbench | null>(null)
  const [incoming, setIncoming] = useState<{ pending: SiteIncomingPending[]; done: SiteIncomingPending[] }>({ pending: [], done: [] })
  const [accs, setAccs] = useState<AcceptanceRow[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(
    async (pno?: string) => {
      setLoading(true)
      try {
        const [w, inc, ac] = await Promise.all([
          siteWorkbench(pno),
          pno ? siteIncoming(pno) : Promise.resolve({ pending: [], done: [] }),
          withAcceptance && pno ? listAcceptances(pno) : Promise.resolve([]),
        ])
        setWb(w)
        setIncoming(inc)
        if (withAcceptance) setAccs(ac)
      } catch (e) {
        message.error(errMsg(e))
      } finally {
        setLoading(false)
      }
    },
    [withAcceptance, message],
  )

  useEffect(() => {
    listProjects()
      .then((rows) => setProjects(rows.map((p) => ({ project_no: p.project_no, project_name: p.project_name }))))
      .catch(() => undefined)
    void reload()
  }, [reload])

  return { projectNo, setProjectNo, projects, wb, incoming, accs, loading, reload }
}
