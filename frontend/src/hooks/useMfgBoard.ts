import { App } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { errMsg, prodWorkbench, type MfgWorkbench } from '../api/client'
import { hasPerm } from '../api/user'

/** 制造看板（重构 2.3 · 双端同源）：PC 车间页与移动生产页原逐字重复两份 load。
 *  ★ F17（2026-10-04 走查核实）：无 `mfg:view` 时**不发请求** ——
 *  修前 sales1 手机深链 /m/production 会吃一发 403 噪音 + 正文只剩 123 字的接近空白屏。 */
export function useMfgBoard() {
  const { message } = App.useApp()
  const allowed = hasPerm('mfg:view')
  const [wb, setWb] = useState<MfgWorkbench | null>(null)
  const [loading, setLoading] = useState(allowed)

  const reload = useCallback(async () => {
    if (!allowed) { setLoading(false); return }
    setLoading(true)
    try {
      setWb(await prodWorkbench())
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message, allowed])

  useEffect(() => { void reload() }, [reload])
  return { wb, loading, reload, allowed }
}
