import { useEffect, useState } from 'react'

import { workbenchMe, type WorkbenchItem } from '../../api/client'
import DomainShell from './DomainShell'
import type { TabItem } from '../../configs/domain'

/**
 * 工作台域壳（P0 修正 2026-09-23 · 用户纠偏：采购台/仓库台属工作台）：
 * - 右侧 Tab = GET /workbench/me 的 visible 列表**原样**（7 台 admin / 按角色裁剪）
 *   —— 权限过滤天然自动化（buyer1 只见 我的工作台+采购工作台）
 * - 子路由 = me.route 原样（/workbench* · /purchase · /warehouse），URL 零变
 * - 加载期 tabs 为空：内容照常渲染，Tab 条随 me 返回补上（约百毫秒）
 */
export default function WorkbenchShell({ children }: { children?: React.ReactNode }) {
  const [tabs, setTabs] = useState<TabItem[]>([])

  useEffect(() => {
    workbenchMe()
      .then((d) =>
        setTabs(
          (d.workbenches as WorkbenchItem[])
            .filter((w) => w.visible)
            .map((w) => ({ path: w.route, label: w.name })),
        ),
      )
      .catch(() => undefined)
  }, [])

  return <DomainShell tabs={tabs}>{children}</DomainShell>
}
