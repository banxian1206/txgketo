import { Spin } from 'antd'
import type { ReactNode } from 'react'

import SectionNav from '../ds/SectionNav'
import { Metrics, PageHead, type MetricItem } from '../ds'
import { groupsFor, defaultTabFor, orderTabsFor, type BoardDef } from '../../configs/boards'
import { filterTabs, tabLabel, type TabDef } from '../../configs/tabs'
import { useTab } from '../../hooks/useTab'
import { readSession } from '../../contexts/session'

/**
 * 台骨架壳（docs/15 · 工作台队列化）
 * ─────────────────────────────────────────────────────────────────────────────
 * **四个位置，九个台一律一样**（顺序不许变 —— 车间台原来流程条跑到了标题之上）：
 *
 *   ① 台头    `PageHead`：台名 + 一句话现状 + 台级动作（≤2 个）
 *   ② 结论条  `Metrics`：≤5 个，**只放"要动手的数"**（身份、筛选器状态不算结论）
 *   ③ 流程条  `SectionNav`（台用同一个壳）：≤4 组；≤4 项时不分层
 *   ④ 体      页面自己渲染 —— 队列类用 `QueueBoard`，台账类用表格
 *
 * 为什么要这个壳：这轮返工的根因是"9 个工作台是 9 个不同时候手写的页面"：
 * 结论指标条 0~6 个不等（5 个台完全没有）、流程条 4 种形态、体内 3 种语言。
 * 把四个位置收进一个壳、由注册表（`configs/boards.ts`）驱动，**结构就不可能再各写各的**。
 *
 * ⚠ tab key 一个都不改（通知 link / `?tab=` 深链 / `ROUTE_REDIRECTS` 全靠它）。
 */
export default function WorkbenchPage({
  board,
  sub,
  help,
  actions,
  metrics,
  toolbar,
  flowSize,
  counts,
  loading,
  children,
}: {
  board: BoardDef
  /** 一句话现状（**只写现状**：身份、选中的项目这些都是上下文，别写这里） */
  sub?: ReactNode
  help?: string
  /** 台级动作（≤2 个） */
  actions?: ReactNode
  /** 流程条尺寸：`small` = 页面自己还有一条更重的视图条（如车间台的「看板/制造/装配」） */
  flowSize?: 'default' | 'small'
  /** 结论条（≤5 个） */
  metrics?: MetricItem[]
  /**
   * 筛选器槽位（项目/设备/状态等）—— **位置固定**：结论条之下、流程条之上。
   * 为什么要有它：筛选器过去散落各处（有的在标题右侧、有的在页签体内、有的当家结论用），
   * 同一个台里换个视图筛选器就找不到了。收进骨架 = 换个页签它还在原地。
   */
  toolbar?: ReactNode
  /** 流程条徽标口径（`countKey` → 后端下发的 counts） */
  counts?: Record<string, number> | null
  loading?: boolean
  /** 体：`(当前页签 key, 该页签定义) => ReactNode` */
  children: (tab: string, def: TabDef | undefined) => ReactNode
}) {
  // ★ 2026-10-05：页签**顺序与默认落点都按岗位**（客户第一、二条）。
  //   旧行为：所有岗位都落 `board.defaultTab`（工程台='mine'）——总监和组员看到的一模一样。
  //   `orderTabsFor` 保证页签不被增减（只换顺序），`defaultTabFor` 决定落点。
  const session = readSession()
  const position = session?.user?.position
  const ordered = orderTabsFor(board, position)
  const visible = filterTabs(ordered)
  // ★ 默认页签由注册表/岗位决定（不取“第一个” —— 采购台第一个是「待我审批」，
  //   而每天真正用的是「采购池」，取第一个等于把主队列藏在第二下点击后面）
  const [tab, setTab] = useTab(
    visible.map((t) => t.key),
    defaultTabFor(board, position),
  )
  const def = visible.find((t) => t.key === tab) ?? visible[0]
  // 体交给 SectionNav 渲染（它统一负责 `.ds-sec-body` 这张纸、空分区文案、切区回顶部）
  const sections = visible.map((t) => ({
    key: t.key,
    label: tabLabel(t, counts),
    badge: t.countKey ? counts?.[t.countKey] : undefined,
    children: t.key === def?.key ? children(t.key, t) : null,
  }))

  return (
    <div className="ds-page">
      {/* ① 台头 */}
      <PageHead title={board.name} sub={sub} help={help} actions={actions} />
      {/* ② 结论条（常驻：切页签时不动） */}
      {metrics && metrics.length > 0 && <Metrics items={metrics} />}
      {toolbar && <div className="ds-toolbar">{toolbar}</div>}
      <Spin spinning={Boolean(loading)}>
        {/* ③ 流程条 + ④ 体 */}
        <SectionNav
          variant="flow"
          flowSize={flowSize}
          sections={sections}
          groups={groupsFor(board, visible.map((t) => t.key))}
          tab={def?.key ?? ''}
          onTab={setTab}
          emptyText="这一类活儿现在没有要处理的。"
        />
      </Spin>
    </div>
  )
}
