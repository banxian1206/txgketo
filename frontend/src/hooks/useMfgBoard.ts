import { App } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { errMsg, prodWorkbench, type MfgWorkbench } from '../api/client'

/** 制造看板（重构 2.3 · 双端同源）：PC 车间页与移动生产页原逐字重复两份 load */
export function useMfgBoard() {
  const { message } = App.useApp()
  const [wb, setWb] = useState<MfgWorkbench | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setWb(await prodWorkbench())
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => { void reload() }, [reload])
  return { wb, loading, reload }
}
