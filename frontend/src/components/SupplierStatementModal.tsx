import { App, Drawer, Table, Tabs, Typography } from 'antd'
import { Status, Chip } from '../components/ds'
import { useEffect, useState } from 'react'

import { errMsg, supplierStatement, type StatementPo, type SupplierStatement } from '../api/client'
import { ORDER_STATUS as ORDER_STATUS_COLOR, toneOf } from '../theme/status'

function cols(paidTab: boolean) {
  const base = [
    { title: '单号', dataIndex: 'po_no', width: 120 },
    { title: '下单日', dataIndex: 'order_date', width: 105, render: (v: string | null) => v ?? '—' },
    {
      title: '金额(含税)',
      dataIndex: 'total_tax_incl',
      width: 130,
      render: (v: number) => `¥${(v ?? 0).toLocaleString()}`,
    },
    { title: '承诺交期', dataIndex: 'expect_date', width: 105, render: (v: string | null) => v ?? '—' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Status tone={toneOf(ORDER_STATUS_COLOR[v])}>{v}</Status>,
    },
    {
      title: '逾期',
      dataIndex: 'delay_days',
      width: 80,
      render: (v: number | null) => (v != null && v > 0 ? <Chip tone="err">+{v} 天</Chip> : '—'),
    },
  ]
  if (!paidTab) return base
  return [
    ...base,
    { title: '财务付款日', dataIndex: 'paid_at', width: 110, render: (v: string | null) => v ?? '—' },
    { title: '标记人', dataIndex: 'paid_by', width: 90, render: (v: string | null) => v ?? '—' },
    {
      title: '凭证',
      dataIndex: 'voucher_count',
      width: 70,
      render: (v: number) => (v ? `${v} 张` : '—'),
    },
  ]
}

export default function SupplierStatementModal({
  open = true,
  supplierId,
  onClose,
}: {
  open?: boolean
  supplierId: number | null
  onClose: () => void
}) {
  const { message } = App.useApp()
  const [st, setSt] = useState<SupplierStatement | null>(null)

  useEffect(() => {
    if (!open || !supplierId) return
    void (async () => {
      try {
        setSt(await supplierStatement(supplierId))
      } catch (e) {
        message.error(errMsg(e))
      }
    })()
  }, [open, supplierId, message])

  return (
    <Drawer
      title={`往来对账${st ? ` · ${st.supplier.name}` : ''}`}
      open={open}
      width={720}
      onClose={onClose}
      footer={null}
    >
      {st && (
        <>
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            共 {st.summary.total_orders} 张单 · 已付 {st.summary.paid_count} · 未付{' '}
            {st.summary.unpaid_count} · 累计采购 ¥{st.summary.total_amount.toLocaleString()} · 累计已付 ¥
            ¥{st.summary.paid_amount.toLocaleString()}
          </Typography.Paragraph>
          <Tabs
            items={[
              {
                key: 'unpaid',
                label: `未付款 (${st.summary.unpaid_count})`,
                children: (
                  <Table<StatementPo>
                    rowKey="id"
                    size="small"
                    dataSource={st.unpaid}
                    columns={cols(false)}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    locale={{ emptyText: '没有未付款的单' }}
                  />
                ),
              },
              {
                key: 'paid',
                label: `已付款 (${st.summary.paid_count})`,
                children: (
                  <Table<StatementPo>
                    rowKey="id"
                    size="small"
                    dataSource={st.paid}
                    columns={cols(true)}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    locale={{ emptyText: '没有已付款的单' }}
                  />
                ),
              },
            ]}
          />
        </>
      )}
    </Drawer>
  )
}
