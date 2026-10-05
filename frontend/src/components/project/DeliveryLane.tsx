import { Table } from 'antd'

import { Chip, Code, Empty, NA, Panel, Status } from '../ds'
import { useGoFrom } from '../../hooks/useFrom'
import { toneOf } from '../../theme/status'
import { SHIP_STATUS, ACCEPTANCE_STATUS, SERVICE_ORDER_STATUS } from '../../theme/status'

/**
 * 泳道④「交付与售后」摘要（docs/12 §3.2 新增块；方案 A「纸面」2026-10-04 重做）。
 *
 * 为什么原来没有：详情页只到"执行进度"为止，货发没发、客户验没验、质保到没到期、
 * 现场报修有没有处理 —— 用户只能挨个台去翻。这里做**只读摘要 + 跳台**，
 * 数据同源（复用各台接口），不在详情页里复制一套业务逻辑。
 *
 * A 版改动：不再自套一层 `Card`（泳道已经是容器，卡里再套卡就是 docs/12 §1.1 的
 * 「125 张 Card 卡里嵌卡」）；状态用 `Status`（圆点+文字），环节用中性 `Chip`。
 */
export default function DeliveryLane({
  shipments,
  acceptances,
  orders,
}: {
  shipments: any[]
  acceptances: any[]
  orders: any[]
}) {
  const go = useGoFrom()
  const rows = [
    ...shipments.map((s) => ({
      kind: '发运',
      no: s.shipment_no,
      state: s.status,
      tone: toneOf(SHIP_STATUS[s.status]),
      when: s.signed_at ?? s.arrive_at ?? s.depart_at ?? s.instruct_at ?? s.plan_ship_date,
      who: [s.plate_no, s.driver].filter(Boolean).join(' ') || s.vehicle_note || '',
      to: '/delivery/shipping',
    })),
    ...acceptances.map((a) => ({
      kind: '验收',
      no: `#${a.id}`,
      state: a.status,
      tone: toneOf(ACCEPTANCE_STATUS[a.status]),
      when: a.accepted_at ?? a.applied_at,
      who: a.signed_by ?? '',
      to: '/workbench/pm?tab=acceptance',
    })),
    ...orders.map((o) => ({
      kind: '售后',
      no: o.so_no,
      state: o.status,
      tone: toneOf(SERVICE_ORDER_STATUS[o.status]),
      when: o.closed_at ?? o.fixed_at ?? o.arrived_at ?? o.reported_at,
      who: o.dispatched_to ?? '',
      to: '/delivery/service',
    })),
  ]

  if (!rows.length) {
    return (
      <Empty
        text="还没有发运 / 验收 / 报修记录。"
        action={
          <>
            <a onClick={() => go('/delivery/shipping')}>去发运台</a>
            <a onClick={() => go('/delivery/service')}>去售后台</a>
          </>
        }
      />
    )
  }

  return (
    <Panel
      sub={`${rows.length} 条 · 只读摘要，点「去处理」到对应台办理`}
      help="这里只汇总状态，不在这里做业务动作 —— 发运/验收/售后各自的工作台才是干活的地方（数据同源）。"
    >
      <Table
        rowKey={(r) => `${r.kind}-${r.no}`}
        size="small"
        pagination={false}
        dataSource={rows}
        columns={[
          { title: '环节', dataIndex: 'kind', width: 72, render: (v: string) => <Chip>{v}</Chip> },
          { title: '单号', dataIndex: 'no', width: 130, render: (v: string) => <Code>{v}</Code> },
          {
            title: '状态',
            dataIndex: 'state',
            width: 120,
            render: (v: string, r: (typeof rows)[number]) => <Status tone={r.tone}>{v}</Status>,
          },
          { title: '经办', dataIndex: 'who', width: 130, render: (v: string) => v || NA },
          {
            title: '时间',
            dataIndex: 'when',
            width: 120,
            render: (v: string | null) => (v ? <Code>{String(v).slice(0, 10)}</Code> : NA),
          },
          {
            title: '',
            key: 'a',
            width: 84,
            render: (_: unknown, r: (typeof rows)[number]) => <a onClick={() => go(r.to)}>去处理</a>,
          },
        ]}
      />
    </Panel>
  )
}
