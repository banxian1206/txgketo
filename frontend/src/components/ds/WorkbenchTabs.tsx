import { Segmented, Tabs } from 'antd'
import type { ReactNode } from 'react'

import { groupOf, groupsOf, type TabGroup } from '../../configs/tabs'

/**
 * 台内页签（R3-B · 2026-10-04）：**一层组页签（≤4）+ 一层 Segmented**。
 *
 * 背景：采购台 10 个页签、仓库台 6 个，一排摆出来用户得先扫一遍猜哪个是"我的活儿"。
 * 分组后组名就是工作队列（待办 / 采购 / 到货与验收 / 主数据），组内才是具体视图。
 *
 * 两条硬约束：
 *   ① **tab key 一个都不改** —— 通知 link、`?tab=` 深链、`ROUTE_REDIRECTS` 全靠它；
 *      所以 `?tab=failed` 进来会落到「到货与验收」组、并把 Segmented 选中「验收不合格」。
 *   ② **单 key 的组不造组名**：页签直接显示那一项自己的标题（「供应商」「库位」「申请调试」），
 *      否则用户看到「主数据」根本不知道里面是什么。
 *
 * `groups` 不传 = 每项自成一组（等价旧 `Tabs`，UI 不变）。
 */
export interface WTabItem {
  key: string
  label: ReactNode
  children?: ReactNode
}

export default function WorkbenchTabs({
  tab,
  onTab,
  items,
  groups,
  tabBarExtraContent,
  layout = 'auto',
}: {
  tab: string
  onTab: (key: string) => void
  items: WTabItem[]
  groups?: TabGroup[]
  tabBarExtraContent?: ReactNode
  /**
   * `flat`：全部视图压成**一行 Segmented**（不画组页签条）。
   * 用在「已经身处另一条页签条之下」的页面 —— 例如车间台壳里已有「看板/制造/装配」，
   * 制造页再画一条组页签就成了三条横条叠在一起（实测）。
   */
  layout?: 'auto' | 'flat'
}) {
  const visible = items
  if (!visible.length) return null
  const gs = groupsOf(groups, visible.map((v) => v.key))
  if (!gs.length) return null
  const cur = groupOf(gs, tab)!
  const labelOf = (k: string) => visible.find((v) => v.key === k)?.label ?? k
  const active = visible.find((v) => v.key === tab) ?? visible.find((v) => v.key === cur.keys[0])!

  // ① 扁平：一行 Segmented（组序 = 配置顺序）
  // ② 只有一组：别为「一个组」再画一条页签条，直接用 Segmented（售后/工程/PM/评审/改版/任务都是这种）
  if (layout === 'flat' || gs.length <= 1) {
    const keys = layout === 'flat' ? gs.flatMap((g) => g.keys) : cur.keys
    if (keys.length <= 1) return <div className="ds-tabs-body">{active.children}</div>
    return (
      <>
        <div className="ds-subtabs" style={layout === 'flat' ? { paddingTop: 0 } : undefined}>
          <Segmented
            value={active.key}
            onChange={(v) => onTab(String(v))}
            options={keys.map((k) => ({ value: k, label: labelOf(k) }))}
          />
        </div>
        <div className="ds-tabs-body">{active.children}</div>
      </>
    )
  }

  return (
    <>
      <Tabs
        activeKey={cur.key}
        // 点组 = 进该组的第一个视图（切组不该保留另一组的 key）
        onChange={(k) => {
          const g = gs.find((x) => x.key === k)
          if (g) onTab(g.keys[0])
        }}
        tabBarExtraContent={tabBarExtraContent}
        items={gs.map((g) => ({
          key: g.key,
          // 单 key 组：直接显示那一项的标题（不造组名）
          label: g.keys.length === 1 ? labelOf(g.keys[0]) : g.label,
        }))}
      />
      {cur.keys.length > 1 && (
        <div className="ds-subtabs">
          <Segmented
            size="small"
            value={active.key}
            onChange={(v) => onTab(String(v))}
            options={cur.keys.map((k) => ({ value: k, label: labelOf(k) }))}
          />
        </div>
      )}
      <div className="ds-tabs-body">{active.children}</div>
    </>
  )
}
