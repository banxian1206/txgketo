import { Card, Space, Table, Tag, Typography } from 'antd'

import { CodeNo, Muted } from '../ui/Primitives'
import { useGoFrom } from '../../hooks/useFrom'
import { FS, T } from '../../theme/tokens'

/**
 * 泳道④「交付与售后」摘要（docs/12 §3.2 新增块）。
 *
 * 为什么原来没有：详情页只到"执行进度"为止，货发没发、客户验没验、质保到没到期、
 * 现场报修有没有处理 —— 用户只能挨个台去翻。这里做**只读摘要 + 跳台**，
 * 数据同源（复用各台接口），不在详情页里复制一套业务逻辑。
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
      when: s.signed_at ?? s.arrive_at ?? s.depart_at ?? s.instruct_at ?? s.plan_ship_date,
      who: [s.plate_no, s.driver].filter(Boolean).join(' ') || s.vehicle_note || '',
      to: '/delivery/shipping',
    })),
    ...acceptances.map((a) => ({
      kind: '验收',
      no: `#${a.id}`,
      state: a.status,
      when: a.accepted_at ?? a.applied_at,
      who: a.signed_by ?? '',
      to: '/workbench/pm?tab=acceptance',
    })),
    ...orders.map((o) => ({
      kind: '售后',
      no: o.so_no,
      state: o.status,
      when: o.reported_at ?? o.created_at,
      who: o.assignee_name ?? o.dispatched_to ?? '',
      to: '/delivery/service',
    })),
  ]

  if (!rows.length) {
    return (
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={4}>
          <Typography.Text strong style={{ fontSize: FS.md }}>
            交付与售后
          </Typography.Text>
          <Muted>还没有发运 / 验收 / 报修记录 —— 到「发运工作台」「现场工作台」「售后工作台」办理。</Muted>
        </Space>
      </Card>
    )
  }

  return (
    <Card size="small" title="交付与售后" style={{ marginBottom: 12 }}>
      <Table
        rowKey={(r) => `${r.kind}-${r.no}`}
        size="small"
        pagination={false}
        dataSource={rows}
        columns={[
          { title: '环节', dataIndex: 'kind', width: 72, render: (v: string) => <Tag>{v}</Tag> },
          {
            title: '单号',
            dataIndex: 'no',
            width: 130,
            render: (v: string) => <CodeNo>{v}</CodeNo>,
          },
          { title: '状态', dataIndex: 'state', width: 110 },
          {
            title: '经办',
            dataIndex: 'who',
            width: 110,
            render: (v: string) => v || <span style={{ color: T.textDisabled }}>—</span>,
          },
          {
            title: '时间',
            dataIndex: 'when',
            width: 120,
            render: (v: string | null) => (v ? <CodeNo>{String(v).slice(0, 10)}</CodeNo> : '—'),
          },
          {
            title: '',
            key: 'a',
            width: 84,
            render: (_: unknown, r: (typeof rows)[number]) => (
              <a onClick={() => go(r.to)}>去处理</a>
            ),
          },
        ]}
      />
    </Card>
  )
}
