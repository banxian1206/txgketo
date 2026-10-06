import { Button, Pagination } from 'antd'
import { useState, type ReactNode } from 'react'

import { Empty, QueueGroup, QueueRow, type Tone } from './index'

/**
 * 队列板（docs/15 · 工作台队列化的体壳）
 * ─────────────────────────────────────────────────────────────────────────────
 * **一条 = 一个动作**。工作台的职责是"把该我干的活按流程顺序摊开、我逐条处理完"，
 * 所以体的默认语言是**队列行**（56px，右侧一个主按钮），不是表格。
 *
 * 什么时候该用表格（`ledger`）：**这一行没有唯一的下一步动作**（只是查 / 对账 / 要排序导出）。
 * 判定法写在工作台注册表里（`configs/boards.ts` 的 `kind`），护栏盯着它别漂。
 *
 * 这个壳统一了四件过去每页各写一遍的东西：
 *   ① 工具条位置（筛选 / 搜索在左上，批量动作在右上）
 *   ② 分组标题（`QueueGroup`：色条 + 标题 + 计数）
 *   ③ 分页（默认 20 条；`?` 不记住页码 —— 台账页才需要）
 *   ④ 空态（ds `Empty`：说人话 + 下一步按钮；**不再用 antd 默认灰插图**）
 */
export interface QItem {
  key: string | number
  /** 分组标题（相同 group 的连续项归一组；不传 = 不分组） */
  group?: ReactNode
  /** 组计数（画在组标题右边） */
  groupCount?: number
  /** 组色调（「需处理」= err / 「留意」= warn） */
  groupTone?: Tone
  lead?: ReactNode
  title: ReactNode
  meta?: ReactNode
  cells?: { text: ReactNode; tone?: Tone; title?: string }[]
  /** 唯一主按钮 */
  action?: ReactNode
  /** 次要动作（收在行尾） */
  actions?: ReactNode
  onClick?: () => void
  muted?: boolean
  /**
   * ★ 方向 2 ③：整行语义色（左侧 3px 色条）—— “这条要不要动 / 卡在哪”。
   * 不给就是中性行（守住“颜色只给异常”）。见 `QueueRow` 的 `tone`。
   */
  tone?: Tone
  /**
   * 行内明细（可展开）：有些队列**必须**看明细才能动手 —— 例如仓库的领料单要按材料逐条备料。
   * 给 `expand` 就自动出现「明细」开关；**默认不展开**（首屏只保留"要不要动这一条"）。
   */
  expand?: ReactNode
}

export default function QueueBoard({
  items,
  toolbar,
  search,
  emptyText = '这里没有要处理的。',
  emptyAction,
  pageSize = 10,   // ★ 全站统一：队列一页 10 条（10×56px ≈ 一屏内）
  loading,
}: {
  items: QItem[]
  /** 工具条右侧（批量动作 / 次级入口） */
  toolbar?: ReactNode
  /** 工具条左侧（搜索 / 筛选） */
  search?: ReactNode
  emptyText?: ReactNode
  emptyAction?: ReactNode
  pageSize?: number
  loading?: boolean
}) {
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const hasBar = Boolean(toolbar || search)
  if (!items.length && !loading) {
    return (
      <>
        {hasBar && (
          <div className="ds-q-bar">
            <div className="l">{search}</div>
            <div className="r">{toolbar}</div>
          </div>
        )}
        <Empty text={emptyText} action={emptyAction} />
      </>
    )
  }
  const total = items.length
  const maxPage = Math.max(1, Math.ceil(total / pageSize))
  const cur = Math.min(page, maxPage)
  const view = total > pageSize ? items.slice((cur - 1) * pageSize, cur * pageSize) : items

  return (
    <>
      {hasBar && (
        <div className="ds-q-bar">
          <div className="l">{search}</div>
          <div className="r">{toolbar}</div>
        </div>
      )}
      {view.map((it, i) => {
        const prev = view[i - 1]
        const showGroup = it.group !== undefined && (!prev || prev.group !== it.group)
        return (
          <div key={it.key}>
            {showGroup && (
              <QueueGroup label={it.group} count={it.groupCount} tone={it.groupTone} />
            )}
            <QueueRow
              lead={it.lead}
              title={it.title}
              meta={it.meta}
              cells={it.cells}
              actions={
                it.expand ? (
                  <>
                    <Button size="small" type="text" onClick={() => setOpen((o) => ({ ...o, [it.key]: !o[it.key] }))}>
                      {open[it.key] ? '收起明细' : '明细'}
                    </Button>
                    {it.actions}
                    {it.action}
                  </>
                ) : it.action || it.actions ? (
                  <>
                    {it.actions}
                    {it.action}
                  </>
                ) : undefined
              }
              onClick={it.onClick}
              muted={it.muted}
              tone={it.tone}
            />
            {it.expand && open[it.key] && <div className="ds-row-expand">{it.expand}</div>}
          </div>
        )
      })}
      {total > pageSize && (
        <div className="ds-q-page">
          <Pagination
            size="small"
            current={cur}
            pageSize={pageSize}
            total={total}
            showSizeChanger={false}
            onChange={setPage}
          />
        </div>
      )}
    </>
  )
}
