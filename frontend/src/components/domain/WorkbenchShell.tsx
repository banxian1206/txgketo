import { Badge } from 'antd'
import { useEffect, useState } from 'react'

import { workbenchMe, type WorkbenchItem } from '../../api/client'
import DomainShell from './DomainShell'
import type { TabItem } from '../../configs/domain'

/**
 * 工作台域壳（P0 修正 2026-09-23 · 用户纠偏：采购台/仓库台属工作台）：
 * - 右侧 Tab = GET /workbench/me 的 visible 列表**原样**（7 台 admin / 按角色裁剪）
 *   —— 权限过滤天然自动化（buyer1 只见 采购工作台）
 * - 子路由 = me.route 原样（/workbench* · /purchase · /warehouse），URL 零变
 * - 加载期 tabs 为空：内容照常渲染，Tab 条随 me 返回补上（约百毫秒）
 */
export default function WorkbenchShell({ children }: { children?: React.ReactNode }) {
  const [tabs, setTabs] = useState<TabItem[]>([])

  // A3：台 Tab 待办角标 —— counts 与 tabs 同一响应；0 不显示
  useEffect(() => {
    workbenchMe()
      .then((d) => {
        const c = d.counts
        const badge: Record<string, number> = {
          '/workbench/sales': c.my_leads,
          '/workbench/eng': c.to_review + c.to_decide,
          '/purchase': c.to_purchase,
          '/warehouse': c.to_inspect + c.to_store + c.issues,
          '/workbench/shop': c.shop_wait + c.shop_accept + c.shop_transfer + c.shop_assembling + c.shop_debug,
        }
        setTabs(
          (d.workbenches as WorkbenchItem[])
            .filter((w) => w.visible)
            .map((w) => {
              const n = badge[w.route] ?? 0
              return {
                path: w.route,
                label: n > 0 ? <>{w.name}<Badge count={n} size="small" style={{ marginLeft: 6 }} /></> : w.name,
              }
            }),
        )
      })
      .catch(() => undefined)
  }, [])

  return <DomainShell tabs={tabs}>{children}</DomainShell>
}
