import { App, Button, Spin } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { Chip, Code, Empty, Metrics, PageHead, Panel, QueueRow, Status, type MetricItem } from '../../components/ds'
import { gmDashboard, type GmDashboard } from '../../api/client'
import { errMsg } from '../../api/http'
import { useGoFrom } from '../../hooks/useFrom'
import { PROJECT_STAGE as STAGE_COLOR, toneOf } from '../../theme/status'

/**
 * ★ 经营驾驶舱（00 卷 §2.1 对总经理的原话承诺）：
 *   「在手订单、交付风险、项目毛利、售后质量，**一屏看完**」。
 *
 * 为什么**不做分区**（与 docs/14 其余页相反）：驾驶舱的全部价值就是"同屏对比四块"——
 * 切成 tab 就只剩一块，还要点三下才能在脑子里拼起来。所以这里用 2×2 网格同屏呈现。
 *
 * 四块口径（都复用已有服务，不另算一套）：
 *   ① 在手订单：阶段分布（数量 + 金额，金额按 `project:amount` 裁剪）
 *   ② 交付风险：交期临期/超期 · 齐套 <70% · 长周期件在途
 *   ③ 卡点榜：**卡在哪个部门、谁手上**（采购 / 车间 / 现场 / 售后 / 项目经理），每条可点
 *   ④ 售后与质保：60 天内到期质保 + 未关闭工单 + 备件低库存
 * 成本毛利：三期（未建表）→ 页面**如实说明**，不假装有。
 */
export default function DashboardPage() {
  const { message } = App.useApp()
  const go = useGoFrom()
  const [d, setD] = useState<GmDashboard | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setD(await gmDashboard())
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !d) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin />
      </div>
    )
  }
  if (!d) return <Empty text="驾驶舱数据加载失败。" />

  const money = (v: number | null) => (v == null ? '—' : `¥${Math.round(v).toLocaleString()}`)
  const metrics: MetricItem[] = [
    { key: 'orders', label: '在手订单', value: d.orders.total_count, unit: '个', to: '/projects' },
    { key: 'amount', label: '在手合同额', value: money(d.orders.total_amount), tone: undefined },
    { key: 'risk', label: '交付风险', value: d.risks_count, unit: '个', tone: d.risks_count ? 'err' : undefined },
    { key: 'blocked', label: '卡点项目', value: d.blocked_count, unit: '个', tone: d.blocked_count ? 'warn' : undefined },
    { key: 'warranty', label: '质保 60 天内到期', value: d.after_sales.warranty_soon_count, unit: '个', tone: d.after_sales.warranty_soon_count ? 'warn' : undefined },
    { key: 'svc', label: '未关闭工单', value: d.after_sales.open_orders_count, unit: '单', tone: d.after_sales.open_orders_count ? 'err' : undefined },
  ]

  return (
    <div className="ds-page">
      <PageHead
        title="经营驾驶舱"
        sub={`数据截至 ${d.as_of} · 在手 ${d.orders.total_count} 个项目 · 风险 ${d.risks_count} · 卡点 ${d.blocked_count}`}
        help="一屏看完：在手订单 / 交付风险 / 卡点（卡在哪个部门）/ 售后与质保。金额按你的权限显示；成本毛利在三期。"
        actions={
          <Button size="small" onClick={() => void load()}>
            刷新
          </Button>
        }
      />

      <Metrics items={metrics} />

      <div className="ds-grid2">
        {/* ① 在手订单 */}
        <Panel title="在手订单" sub="按阶段：数量 + 合同额（金额按权限）" bodyStyle={{ padding: 0 }}>
          {d.orders.by_stage.map((s) => (
            <QueueRow
              key={s.stage}
              lead={<Status tone={toneOf(STAGE_COLOR[s.stage])}>{s.stage}</Status>}
              title={`${s.count} 个`}
              cells={[{ text: money(s.amount) }]}
              onClick={() => go(`/projects?stage=${encodeURIComponent(s.stage)}`)}
            />
          ))}
        </Panel>

        {/* ② 交付风险 */}
        <Panel
          title="交付风险"
          sub={`${d.risks_count} 个项目有风险（交期 / 齐套 / 长周期件）`}
          help="判据：交期已过或 7 天内 · 某台设备齐套率 <70% · 有长周期件还在途。点项目进它的一生。"
          bodyStyle={{ padding: d.risks.length ? 0 : undefined }}
        >
          {d.risks.length === 0 ? (
            <Status tone="ok">没有交付风险</Status>
          ) : (
            d.risks.map((r) => (
              <QueueRow
                key={r.project_no}
                lead={
                  <>
                    <Chip tone={r.level === 'err' ? 'err' : 'warn'}>{r.days_left != null && r.days_left < 0 ? `过 ${-r.days_left} 天` : r.days_left != null ? `剩 ${r.days_left} 天` : r.stage}</Chip>
                    <Code>{r.project_no}</Code>
                  </>
                }
                title={r.project_name}
                meta={r.items.join(' · ')}
                actions={<Button size="small">去项目</Button>}
                onClick={() => go(`/projects/${r.project_no}`)}
              />
            ))
          )}
        </Panel>

        {/* ③ 卡点榜 */}
        <Panel
          title="卡点榜"
          sub={`${d.blocked_count} 个项目有人该动手（按阻塞项排序）`}
          help="口径：数「没做完的单据」并指出它归哪个部门 —— 采购需求 → 采购；齐套低于 70% → 采购/车间；现场问题 → 现场；工单 → 售后；交期过 → 项目经理。"
          bodyStyle={{ padding: d.blocked.length ? 0 : undefined }}
        >
          {d.blocked.length === 0 ? (
            <Status tone="ok">没有卡点</Status>
          ) : (
            d.blocked.map((b) => (
              <div key={b.project_no} style={{ borderTop: '1px solid var(--ds-line)' }}>
                <QueueRow
                  lead={<Code>{b.project_no}</Code>}
                  title={b.project_name}
                  meta={b.stage}
                  onClick={() => go(`/projects/${b.project_no}`)}
                />
                {b.rows.map((r) => (
                  <QueueRow
                    key={r.what}
                    lead={<Chip tone={r.level === 'err' ? 'err' : 'warn'}>{r.who}</Chip>}
                    title={r.what}
                    actions={
                      <Button size="small" onClick={() => go(r.to)}>
                        去处理
                      </Button>
                    }
                    onClick={() => go(r.to)}
                  />
                ))}
              </div>
            ))
          )}
        </Panel>

        {/* ④ 售后与质保 */}
        <Panel
          title="售后与质保"
          sub={`质保 60 天内到期 ${d.after_sales.warranty_soon_count} · 未关工单 ${d.after_sales.open_orders_count}（在保 ${d.after_sales.in_warranty_count}）· 备件低库存 ${d.after_sales.parts_low_count}`}
          bodyStyle={{ padding: 0 }}
        >
          {d.after_sales.warranty_soon.map((w) => (
            <QueueRow
              key={`w-${w.project_no}`}
              lead={<Chip tone="warn">{w.days_left} 天后到期</Chip>}
              title={`${w.project_no} ${w.project_name}`}
              meta={<>质保至 <Code>{w.warranty_end}</Code> · 质保金 {money(w.warranty_amount)}</>}
              onClick={() => go(`/projects/${w.project_no}`)}
            />
          ))}
          {d.after_sales.open_orders.map((o) => (
            <QueueRow
              key={o.so_no}
              lead={<Chip tone={o.in_warranty ? 'ok' : 'warn'}>{o.in_warranty ? '在保' : '过保'}</Chip>}
              title={o.fault ?? o.so_no}
              meta={<><Code>{o.so_no}</Code> · {o.project_no} {o.equip_no ?? ''}</>}
              cells={[{ text: <Status tone="run">{o.status}</Status> }]}
              onClick={() => go('/delivery/service')}
            />
          ))}
          {d.after_sales.parts_low.map((x) => (
            <QueueRow
              key={`p-${x.item_no}-${x.project_no ?? ''}`}
              lead={<Chip tone="err">低于安全库存</Chip>}
              title={x.item_name ?? x.item_no}
              meta={<>现存 {x.qty_stock} / 安全 {x.min_qty} · {x.project_no ?? ''} {x.equip_no ?? ''}</>}
              onClick={() => go(`/items/${x.item_no}`)}
            />
          ))}
          {!d.after_sales.warranty_soon_count && !d.after_sales.open_orders_count && !d.after_sales.parts_low_count && (
            <div style={{ padding: 16 }}>
              <Status tone="ok">质保、工单、备件都没有要盯的</Status>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="成本与毛利" sub="三期">
        <Status tone="idle">{d.cost.reason}</Status>
      </Panel>
    </div>
  )
}
