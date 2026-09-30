import { App } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { errMsg, listShipments, toShip, type ShipmentRow, type ToShipRow } from '../api/client'

/**
 * 发运看板（重构 2.3 · 双端同源）：待发设备 + 批次列表
 * reload(pno?) 返回批次列表（PC 下发指令后接返回值刷新视图，原 load 即如此）
 */
export function useShipBoard(projectNo?: string) {
  const { message } = App.useApp()
  const [toShipRows, setToShipRows] = useState<ToShipRow[]>([])
  const [shipments, setShipments] = useState<ShipmentRow[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(
    async (pno?: string): Promise<ShipmentRow[]> => {
      setLoading(true)
      try {
        const [ts, list] = await Promise.all([
          pno ? toShip(pno) : Promise.resolve([]),
          listShipments(pno ? { project_no: pno } : {}),
        ])
        setToShipRows(ts)
        setShipments(list)
        return list
      } catch (e) {
        message.error(errMsg(e))
        return []
      } finally {
        setLoading(false)
      }
    },
    [message],
  )

  // ★ 作用域跟着页面的项目走（P2-5）：过去只在挂载时 `reload()`（无项目）→
  //   从通知/项目详情深链（?p=xx）进来时「待发设备」永远是空的、装配台报“这个项目还没有设备”，
  //   非等用户再手动点一下项目下拉才出现。
  useEffect(() => { void reload(projectNo) }, [reload, projectNo])
  // setShipments 暴露给壳层：生成清单后的局部乐观更新（保持原行为零变化）
  return { toShipRows, shipments, setShipments, loading, reload }
}
