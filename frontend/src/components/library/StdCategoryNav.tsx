import { Input, Tooltip } from 'antd'
import { useEffect, useMemo, useState } from 'react'

import type { StdCategoryInfo } from '../../api/client'

/**
 * 标准库/价格库 **共用**的品类导航（2026-10-07「两个页统一标准」）。
 *
 * 为什么抽出来：这两个页看的是**同一份数据**（`item`），以前各造了一棵 139 品类的树 ——
 * 用户要学两遍，改一处还得改两处（AGENTS §8.5「同一个概念不许各算一套」）。
 *
 * 三件实事（都是实测出来的，不是审美）：
 *  ① **类别可折叠**：139 品类平铺让页面高 4587px（4.5 屏），找「气缸」要滚很久。
 *     19 个类别默认折叠，只展开当前；还能**搜品类**。
 *  ② **每个品类带「物料 / 有价」两个数**：选料时先知道「这个品类里有多少能比价的」。
 *     实测钢材 2517 条里只有 1192 条有历史价 —— 这个数直接决定用哪个料。
 *  ③ 当前品类**高亮**且写清全名（`钢材 GC`），不再靠位置猜自己在哪。
 */
export default function StdCategoryNav({
  cats,
  classCode,
  categoryCode,
  onPick,
  width = 232,
}: {
  cats: StdCategoryInfo[]
  classCode?: string
  categoryCode?: string
  onPick: (classCode?: string, categoryCode?: string) => void
  width?: number
}) {
  const [kw, setKw] = useState('')
  // 展开的类别：139 品类平铺是页高 4587px 的根源，所以默认只展开一个。
  // ⚠ 第一版做成「全折叠」——实测**一个品类都看不见**（用户不知道自己在哪、也点不到东西）。
  //   所以规则是：展开**当前选中所在的类别**；一个都没选时展开**第一个有物料的类别**。
  const [open, setOpen] = useState<string[]>([])
  useEffect(() => {
    const cur = cats.find((c) => (categoryCode ? c.code === categoryCode : c.classes.some((k) => k.code === classCode)))
    const fallback = cats.find((c) => c.classes.some((k) => (k.item_count ?? 0) > 0)) ?? cats[0]
    const want = cur ?? fallback
    if (want) setOpen((prev) => (prev.includes(want.code) ? prev : [...prev, want.code]))
  }, [cats, classCode, categoryCode])

  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase()
    if (!k) return cats
    const hit = (n: string, c: string) => n.toLowerCase().includes(k) || c.toLowerCase().includes(k)
    return cats
      .map((c) => ({
        ...c,
        classes: c.classes.filter((x) => hit(x.name, x.code)),
        // 类别名命中 → 它的品类全留下
        ...(hit(c.name, c.code) ? { classes: c.classes } : {}),
      }))
      .filter((c) => c.classes.length > 0)
  }, [cats, kw])

  const searching = kw.trim().length > 0
  const total = cats.reduce((a, c) => a + c.classes.length, 0)

  return (
    <div className="ds-panel" style={{ width, flex: 'none', maxHeight: 620, overflowY: 'auto' }}>
      <div style={{ padding: '10px 12px' }}>
        <Input
          allowClear
          size="small"
          placeholder={`搜品类（共 ${total} 个）`}
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          aria-label="搜索品类"
        />
        {/* 「全部物料」— 跨品类浏览（搜索范围显式化的另一半） */}
        <button
          type="button"
          className={`std-nav-all${!classCode && !categoryCode ? ' on' : ''}`}
          onClick={() => onPick(undefined, undefined)}
        >
          全部物料
        </button>

        {(searching ? filtered : cats).map((c) => {
          const isOpen = searching || open.includes(c.code)
          const catOn = categoryCode === c.code && !classCode
          return (
            <div key={c.code}>
              <div className="std-nav-cat">
                {!searching && (
                  <button
                    type="button"
                    className="std-nav-fold"
                    aria-label={isOpen ? `收起${c.name}` : `展开${c.name}`}
                    onClick={() => setOpen((p) => (p.includes(c.code) ? p.filter((x) => x !== c.code) : [...p, c.code]))}
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                )}
                <button
                  type="button"
                  className={`std-nav-catname${catOn ? ' on' : ''}`}
                  onClick={() => onPick(undefined, catOn ? undefined : c.code)}
                  title={`${c.name}（${c.classes.length} 个品类）`}
                >
                  {c.name}
                </button>
                <span className="std-nav-n">{c.classes.length}</span>
              </div>

              {isOpen &&
                c.classes.map((k) => {
                  const on = classCode === k.code
                  return (
                    <button
                      key={k.code}
                      type="button"
                      className={`std-nav-item${on ? ' on' : ''}`}
                      onClick={() => onPick(on ? undefined : k.code, undefined)}
                    >
                      <span className="nm">{k.name}</span>
                      <Tooltip title={`${k.item_count ?? 0} 个物料 · ${k.priced_count ?? 0} 个有历史价`}>
                        <span className="n">
                          {k.item_count ?? 0}
                          {(k.priced_count ?? 0) > 0 && <em>{k.priced_count}</em>}
                        </span>
                      </Tooltip>
                    </button>
                  )
                })}
            </div>
          )
        })}
        {filtered.length === 0 && <div className="ds-empty">没有匹配的品类</div>}
      </div>
    </div>
  )
}
