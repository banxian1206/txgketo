import { App } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { errMsg, listSpareParts, serviceWorkbench, type ServiceWorkbench, type SparePartRow } from '../api/client'

/**
 * 售后看板（重构 2.3 · 双端同源）
 * full：PC 售后台还要备件清单；移动首页只要工单看板
 */
export function useSvcBoard({ full = false }: { full?: boolean } = {}) {
  const { message } = App.useApp()
  const [wb, setWb] = useState<ServiceWorkbench | null>(null)
  const [parts, setParts] = useState<SparePartRow[]>([])

  const reload = useCallback(async () => {
    try {
      if (full) {
        const [w, p] = await Promise.all([serviceWorkbench(), listSpareParts()])
        setWb(w)
        setParts(p)
      } else {
        setWb(await serviceWorkbench())
      }
    } catch (e) {
      message.error(errMsg(e))
    }
  }, [full, message])

  useEffect(() => { void reload() }, [reload])
  return { wb, parts, reload }
}
