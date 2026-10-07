import dayjs from 'dayjs'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { ProjectLifecycle } from '../../api/client'

/**
 * 项目全生命周期时间线（2026-10-07 · 客户口径）
 *
 * 一条线读完整个项目：**商机记录 → 立项 → 里程碑时间段 → 交付截止 → 质保 → 回款**。
 * 数据全部来自 `GET /projects/{no}/lifecycle`（只读聚合，不新增业务表）。
 *
 * 三条设计决定（都是客户实测后定的）：
 *  ① **里程碑会重叠**（工程设计 / 采购 / 生产可能并行）→ 按重叠**自动分甬道**
 *     （贪心：一段一段按开始排序，与已占用的时间段重叠就往下挪一道）
 *  ② **标签不重叠** 靠三件套：同日合并 → 贪心错排 → 边缘钳制
 *  ③ **状态不在前端算** —— 接口直接下发 `state`（后端 `services/deadline.py::milestone_state`
 *     是唯一口径）。前端再算一套就会和超期扫描漂移（AGENTS §8.5 的教训）。
 *
 * ⚠ 质保期**不按比例**：固定占 11% 的尾巴。按真实比例的话 12 个月质保会把前面
 *   5 个月的项目压成一条线（txam 也是这么做的）。
 */
const LANE = 26 // 甬道行高，与 paper.css 的 .ds-life-lanes .row 保持一致
const PAD = 0.016 // 左右留白（比例）
const WARRT = 0.11 // 质保尾段占内容区比例

/** 中文按 12px、西文数字按 7px 估标签宽度（只为「放不放得下」判断，不求精确） */
function estW(str: string): number {
  let n = 0
  for (const ch of str) n += ch.charCodeAt(0) > 255 ? 12.6 : 7.4
  return n + 18
}

type Align = 'center' | 'left' | 'right'
interface Packable {
  t: number
  text: string
  w: number
  left?: number
  cx?: number
  row?: number
  align?: Align
}

/** 标签定位：居中的用 `left: cx + translateX(-50%)`（**按浏览器量的真实宽度**居中，
 *  估算宽度只用于分道判断 —— 用估算居中会让标签中心偏 ~10px，客户实测看得出来）。 */
export function labelStyle(it: Packable): { left: number | string; transform?: string } {
  if (it.align === 'left') return { left: 0 }
  if (it.align === 'right') return { left: '100%', transform: 'translateX(-100%)' }
  return { left: it.cx ?? 0, transform: 'translateX(-50%)' }
}

/** 标签贪心错排 + 边缘钳制（就地写回 left/cx/row，返回行数） */
function packLabels(items: Packable[], toPx: (t: number) => number, total: number): number {
  const rows: number[] = []
  for (const it of items) {
    const cx = toPx(it.t)
    let left = cx - it.w / 2
    let align: Align = 'center'
    if (left < 0) {
      left = 0
      align = 'left'
    } else if (left + it.w > total) {
      left = Math.max(0, total - it.w)
      align = 'right'
    }
    it.left = left
    it.cx = cx
    it.align = align
    let r = 0
    for (;;) {
      if (rows[r] === undefined || left >= rows[r] + 6) {
        rows[r] = left + it.w
        it.row = r
        break
      }
      r++
    }
  }
  return Math.max(1, rows.length)
}

const STATE_CLS: Record<string, string> = {
  已完成: 'is-done',
  延期: 'is-late',
  未开始: 'is-idle',
  进行中: 'is-now',
}

export default function LifecycleTimeline({ data }: { data: ProjectLifecycle | null }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [data])

  const model = useMemo(() => {
    if (!data || w <= 0) return null
    const today = dayjs().startOf('day')
    const num = (s: string | null | undefined) => (s ? dayjs(s).valueOf() : null)

    const created = num(data.created_at) === null ? null : dayjs(data.created_at).startOf('day').valueOf()
    // ↑ 商机记录是**时间戳**（带时分秒），而这条线其余来源都是「日」粒度 ——
    //   不归一化的话，同一天建的项目里「商机记录」和「今天」会差出 30 多像素（00:00 vs 14:30），
    //   看着像两个不同的日子。
    const init = num(data.initiated_at)
    const ddl = num(data.deadline)
    const wS = num(data.warranty.start)
    const wE = num(data.warranty.end)

    // ── ③ 里程碑：分甬道（重叠的不同道）──
    const ms = data.milestones
      .map((m) => ({ m, bs: num(m.start), be: num(m.end) }))
      .filter((x) => x.bs !== null || x.be !== null)
      .sort((a, b) => (a.bs ?? a.be ?? 0) - (b.bs ?? b.be ?? 0))
    const lanes: { s: number; e: number }[][] = []
    const placed: { m: ProjectLifecycle['milestones'][number]; bs: number; be: number; lane: number }[] = []
    for (const x of ms) {
      if (x.bs === null || x.be === null) continue
      let lane = 0
      while ((lanes[lane] ?? []).some((r) => x.bs! < r.e && x.be! > r.s)) lane++
      if (!lanes[lane]) lanes[lane] = []
      lanes[lane].push({ s: x.bs, e: x.be })
      placed.push({ m: x.m, bs: x.bs, be: x.be, lane })
    }
    const laneCount = Math.max(1, ...placed.map((x) => x.lane + 1))

    // ── 坐标：主体（商机记录 → 交付截止）占 89%，质保固定尾巴 ──
    // ⚠ 两个曾经写错的地方（2026-10-07 实测 TX26005 抓到）：
    //   ① 范围起点必须取**里程碑的开始日**，不是结束日 —— 取错的话，
    //      开始得最早的节点会算成负坐标，**条跑到容器外面去**（客户反馈「超出整个生命周期宽度」）。
    //   ② 范围终点还要盖住「最后一个节点结束日」：节点可以晚于交付截止（那正是拖期），
    //      只按 deadline 取会把它们挤到尾巴区。
    const starts = placed.map((x) => x.bs)
    const ends = placed.map((x) => x.be)
    const allPts = [...starts, ...ends].filter((v): v is number => v !== null)
    const payPts = data.payments
      .flatMap((p) => [num(p.plan_date), num(p.received_date)])
      .filter((v): v is number => v !== null)
    // ★ 真实锚点（**不含**下面的最小窗口补白）——标题上印的必须是这些，不能印补白。
    //   2026-10-07 客户实测：「我今天创建的商机，为什么起始点是 9/30？」
    const realPts = [created, init, ddl, wS, wE, ...allPts, ...payPts].filter((v): v is number => v !== null)
    const realLo = realPts.length ? Math.min(...realPts) : today.valueOf()
    const realHi = realPts.length ? Math.max(...realPts) : today.valueOf()
    // 同一个日期内（没有任何真实跨度）→ 不画尺子，收成一行事实
    const hasSpan = realHi - realLo >= 86400000
    let lo = Math.min(...[created, ...allPts, today.valueOf()].filter((v): v is number => v !== null))
    let hi = Math.max(ddl ?? lo, ...allPts, today.valueOf())
    // ⚠ 这里**不做**「最小 14 天窗口」补白（曾经做过，被客户当场问住：
    //   「我今天建的商机，为什么起始点是 9/30？」—— 补白被当成真实日期印在标题上 = 编数据）。
    //   零跨度的情形由 `hasSpan` 拦下、收成一行事实；有真实跨度（≥1 天）时除法本来就安全。
    const min = lo
    const mainEnd = hi
    const max = Math.max(wE ?? mainEnd, mainEnd, today.valueOf())
    const CONTENT = 1 - PAD * 2
    const MAIN = CONTENT * (1 - WARRT)
    const L = (t: number) =>
      t <= mainEnd
        ? (PAD + ((t - min) / Math.max(1, mainEnd - min)) * MAIN) * 100
        : (PAD + MAIN + ((t - mainEnd) / Math.max(1, max - mainEnd)) * (CONTENT - MAIN)) * 100
    const toPx = (t: number) => (L(t) / 100) * w
    // 条形永远画在范围内（超出部分靠 tooltip 给真实日期）——防御性：数据脏了也不溢出
    const clampPct = (p: number) => Math.max(PAD * 100, Math.min((PAD + CONTENT) * 100, p))

    // ── 事件轨：同日合并 → 错排 ──
    const raw: { t: number; name: string; cls: string }[] = []
    if (created !== null) raw.push({ t: created, name: '商机记录', cls: 'is-start' })
    if (init !== null) raw.push({ t: init, name: '立项', cls: '' })
    if (ddl !== null) raw.push({ t: ddl, name: '交付截止', cls: 'is-end' })
    const evMap = new Map<number, { t: number; names: string[]; cls: string }>()
    for (const e of raw) {
      const k = dayjs(e.t).startOf('day').valueOf()
      const g = evMap.get(k) ?? { t: e.t, names: [], cls: '' }
      g.names.push(e.name)
      if (e.cls) g.cls = e.cls
      evMap.set(k, g)
    }
    const evs: Packable[] = [...evMap.values()].map((g) => {
      const text = `${g.names.join(' · ')} ${dayjs(g.t).format('MM/DD')}`
      return { t: g.t, text, w: estW(text), cls: g.cls } as Packable & { cls: string }
    })
    const evRows = packLabels(evs, toPx, w)

    // ── 回款轨：只画有日期的（没计划日期的排不上位置）→ 同日合并 → 错排 ──
    const pays = data.payments
      .filter((p) => p.plan_date || p.received_date)
      .map((p) => ({ ...p, pt: num(p.plan_date) ?? num(p.received_date)! }))
    const nextPay = pays.find((p) => !p.received && p.pt >= today.valueOf())
    const payCls = (p: (typeof pays)[number]) =>
      p.received ? 'is-done' : p.pt < today.valueOf() ? 'is-late' : p === nextPay ? 'is-next' : ''
    const payMap = new Map<number, { t: number; items: typeof pays }>()
    for (const p of pays) {
      const k = dayjs(p.pt).startOf('day').valueOf()
      const g = payMap.get(k) ?? { t: p.pt, items: [] }
      g.items.push(p)
      payMap.set(k, g)
    }
    const payLabels: (Packable & { items: typeof pays })[] = [...payMap.values()].map((g) => {
      const text = `${g.items.map((p) => p.name).join('·')} ${dayjs(g.t).format('MM/DD')}`
      return { t: g.t, text, w: estW(text), items: g.items }
    })
    const payRows = packLabels(payLabels, toPx, w)

    // ── 刻度：跨年带年份；相邻太近的错行 ──
    const tickSet = new Map<number, { t: number; end: boolean }>()
    const addTick = (t: number | null, end = false) => {
      if (t === null) return
      const k = dayjs(t).startOf('day').valueOf()
      if (!tickSet.has(k)) tickSet.set(k, { t, end })
    }
    addTick(min, true)
    addTick(mainEnd, true)
    for (const p of pays) addTick(p.pt)
    const y0 = dayjs(min).year()
    let lastMain = -1e9
    const ticks = [...tickSet.values()]
      .sort((a, b) => a.t - b.t)
      .map((c) => {
        const px = toPx(c.t)
        const yy = dayjs(c.t).year()
        const txt = (yy !== y0 ? `${String(yy).slice(2)}/` : '') + dayjs(c.t).format('MM/DD')
        if (px - lastMain >= 74) {
          lastMain = px
          return { ...c, txt, up: false }
        }
        return { ...c, txt, up: true }
      })

    const lateN = placed.filter((x) => x.m.state === '延期').length
    const nowN = placed.filter((x) => x.m.state === '进行中').length
    return {
      today: today.valueOf(),
      min,
      mainEnd,
      max,
      L,
      clampPct,
      MAIN,
      CONTENT,
      placed,
      laneCount,
      evs,
      evRows,
      payLabels,
      payRows,
      payCls,
      ticks,
      lateN,
      nowN,
      realLo,
      realHi,
      hasSpan,
      wS,
      wE,
    }
  }, [data, w])

  if (!data) return <div className="ds-life-note">时间线加载中…</div>
  if (!model) return <div className="ds-life" ref={boxRef} style={{ height: 8 }} />

  const {
    today, min, max, L, clampPct, MAIN, CONTENT, placed, laneCount, evs, evRows, payLabels, payRows, payCls, ticks, wS, wE,
    realLo, realHi, hasSpan,
  } = model
  // ★ 没有任何真实跨度（刚建的商机：只有「商机记录」这一天）→ 不画尺子。
  //   画一条全是补白的空轨道，等于拿编出来的日期骗人（客户实测原话见上）。
  if (!hasSpan) {
    return (
      <div className="ds-life" ref={boxRef}>
        <div className="ds-life-mini">
          <span>商机记录 <b>{dayjs(realLo).format('YY/MM/DD')}</b></span>
          {data.initiated_at && <span>立项 <b>{dayjs(data.initiated_at).format('YY/MM/DD')}</b></span>}
          <span className="miss">还没有节点计划</span>
        </div>
      </div>
    )
  }

  const inRange = today >= min && today <= max

  return (
    <div className="ds-life" ref={boxRef}>
      <div className="ds-life-hd">
        <span className="span">
          {dayjs(realLo).format('YY/MM/DD')} → {dayjs(realHi).format('YY/MM/DD')}
        </span>
        <span className="sp" />
        <span className="lg">
          <span><i className="is-idle" />未开始</span>
          <span><i className="is-now" />进行中</span>
          <span><i className="is-done" />已完成</span>
          <span><i className="is-late" />延期</span>
          <span><i className="is-warr" />质保期</span>
          <span><i className="is-today" />今天</span>
        </span>
      </div>
      {/* ① 事件：商机记录 / 立项 / 交付截止（同日合并） */}
      <div className="ds-life-ev" style={{ height: evRows * 24 }}>
        {evs.map((e) => (
          <span
            key={e.text}
            className={`ev ${(e as Packable & { cls: string }).cls}`}
            style={{ ...labelStyle(e), top: (e.row ?? 0) * 24 }}
            title={e.text}
          >
            {e.text}
          </span>
        ))}
      </div>

      {/* ⑥ 回款节点（同日合并） */}
      <div className="ds-life-pay" style={{ height: payRows * 24 }}>
        {payLabels.map((g) => (
          <span key={g.text} className="pw" style={{ ...labelStyle(g), top: (g.row ?? 0) * 24 }} title={g.text}>
            {g.items.map((p) => (
              <span key={p.seq} className={`p ${payCls(p)}`}>
                {p.name}
              </span>
            ))}
          </span>
        ))}
      </div>

      {/* ③ 里程碑甬道 + ⑤ 质保 */}
      <div className="ds-life-lanes" style={{ height: (laneCount + 1) * LANE }}>
        {Array.from({ length: laneCount + 1 }, (_, i) => (
          <div key={i} className={`row${i % 2 ? ' is-alt' : ''}`} style={{ top: i * LANE }} />
        ))}
        {placed.map((x) => {
          const l = clampPct(L(x.bs))
          const r = clampPct(L(x.be))
          const wPct = Math.max(r - l, 1.1)
          const wpx = (wPct / 100) * w
          const days = Math.round((x.be - x.bs) / 86400000)
          return (
            <div
              key={x.m.seq}
              className={`ds-life-bar ${STATE_CLS[x.m.state] ?? 'is-idle'}`}
              style={{ left: `${l}%`, width: `${wPct}%`, top: 3 + x.lane * LANE }}
              tabIndex={0}
              aria-label={`${x.m.name} ${x.m.state}：计划 ${dayjs(x.bs).format('MM/DD')} 到 ${dayjs(x.be).format('MM/DD')}，${days} 天`}
            >
              {wpx >= 44 && <span className="nm">{x.m.name}</span>}
              {wpx >= 96 && <span className="d">{days}天</span>}
              <div className="tip">
                <div><b>{x.m.name}</b></div>
                <div>
                  计划 <span className="d">{dayjs(x.bs).format('MM/DD')} → {dayjs(x.be).format('MM/DD')}</span>（{days} 天）
                </div>
                {x.m.actual_start && (
                  <div>实际开始 <span className="d">{dayjs(x.m.actual_start).format('MM/DD')}</span></div>
                )}
                {x.m.actual_end && (
                  <div>实际完成 <span className="d">{dayjs(x.m.actual_end).format('MM/DD')}</span></div>
                )}
                <div>负责人：{x.m.owner_name ? <b>{x.m.owner_name}</b> : <span className="miss">未指派</span>}</div>
                <div>状态：<b>{x.m.state}</b></div>
              </div>
            </div>
          )
        })}
        {wS !== null && wE !== null && (
          <div
            className="ds-life-bar is-warr"
            style={{ left: `${(PAD + MAIN) * 100}%`, width: `${(CONTENT - MAIN) * 100}%`, top: 3 + laneCount * LANE }}
            tabIndex={0}
            aria-label={`质保期 ${dayjs(wS).format('YY/MM/DD')} 到 ${dayjs(wE).format('YY/MM/DD')}`}
          >
            <span className="nm">质保期</span>
            <div className="tip">
              <div><b>质保期</b></div>
              <div className="d">{dayjs(wS).format('YY/MM/DD')} → {dayjs(wE).format('YY/MM/DD')}</div>
              <div>从客户验收通过起算（不按比例显示）</div>
            </div>
          </div>
        )}

        {/* 竖线：事件 / 回款 / 今天 */}
        {evs.map((e) => (
          <span key={`v${e.text}`} className="vline is-ev" style={{ left: e.cx }} />
        ))}
        {payLabels.map((g) => g.items.map((p) => (
          <span key={`vp${p.seq}`} className="vline is-pay" style={{ left: `${L(p.pt)}%` }} />
        )))}
        {inRange && (
          <>
            <span className="todaytag" style={{ left: `${L(today)}%` }}>今天</span>
            <span className="vline is-today" style={{ left: `${L(today)}%` }} />
          </>
        )}
      </div>

      {/* 刻度 */}
      <div className="ds-life-axis">
        {ticks.map((t) => (
          <span key={t.t} className={`t${t.up ? ' is-up' : ''}${t.end ? ' is-end' : ''}`} style={{ left: `${L(t.t)}%` }}>
            {t.txt}
          </span>
        ))}
      </div>
    </div>
  )
}
