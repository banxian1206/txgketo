import { App, Button, Card, Empty, Input, Modal, Space, Table, Typography } from 'antd'
import { toneOf } from '../theme/status'
import { Chip } from '../components/ds'
import { useEffect, useState } from 'react'

import { approvePurchaseOrder, errMsg, priceReference, purchaseOrderDetail, type PriceReference, type PurchaseOrderDetail, type PurchaseOrderLine } from '../api/client'
import { T } from '../theme/tokens'

/**
 * 采购单审批（08 §5）：一级采购经理 → 二级采购总监。
 * ★ 审批页**内嵌价格参考**：每行直接摆出「本次价（口径）」与同口径的历史（上次/均价/区间/样本），
 *   并标出「本次高于历史最高」这类**客观事实**（客户口径 A）——不设阈值、不下"贵/不贵"结论。
 */
export default function PoApproveModal({
  open = true,
  orderKey,
  onClose,
  onDone,
}: {
  open?: boolean
  orderKey: string | null
  onClose: () => void
  onDone?: () => void
}) {
  const { message } = App.useApp()
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null)
  const [prices, setPrices] = useState<Record<string, PriceReference>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open || !orderKey) return
    void (async () => {
      try {
        const d = await purchaseOrderDetail(orderKey)
        setDetail(d)
        const uniq = Array.from(new Set(d.lines.map((l) => l.item_no)))
        const entries = await Promise.all(
          uniq.map(async (no) => {
            try {
              return [no, await priceReference(no)] as const
            } catch {
              return null
            }
          }),
        )
        const map: Record<string, PriceReference> = {}
        entries.forEach((e) => {
          if (e) map[e[0]] = e[1]
        })
        setPrices(map)
      } catch (e) {
        message.error(errMsg(e))
      }
    })()
  }, [open, orderKey, message])

  const act = async (action: '通过' | '退回') => {
    if (!orderKey) return
    if (action === '退回' && !note.trim()) {
      message.warning('退回必须填写说明')
      return
    }
    setBusy(true)
    try {
      const r = await approvePurchaseOrder(orderKey, { action, note: note.trim() || undefined })
      message.success(`${action} → ${r.status}`)
      onDone?.()
      onClose()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const o = detail?.order
  return (
    <Modal
      title={`审批采购单 ${o?.po_no ?? ''}${o?.supplier_name ? ` · ${o.supplier_name}` : ''}`}
      open={open}
      width={1000}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button danger loading={busy} onClick={() => void act('退回')}>
            退回
          </Button>
          <Button type="primary" loading={busy} onClick={() => void act('通过')}>
            通过
          </Button>
        </Space>
      }
      styles={{ body: { maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' } }}
    >
      {!o ? (
        <Empty description="加载中…" />
      ) : (
        <>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0 }}>
            当前状态 {o.po_status} · 合计（含税）¥{(o.total_amount ?? 0).toLocaleString()} · 收货{' '}
            {o.deliver_to ?? '—'} · {o.expected_date ? `预计到货 ${o.expected_date}` : ''}
          </Typography.Paragraph>

          <Table<PurchaseOrderLine>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={detail.lines}
            columns={[
              {
                title: '物料',
                key: 'item',
                width: 220,
                render: (_, l) => (
                  <>
                    <b>{l.item_name}</b>
                    <div style={{ fontSize: 12, color: T.textSecondary }}>
                      {l.item_no}
                      {l.spec_text ? ` · ${l.spec_text}` : ''}
                    </div>
                  </>
                ),
              },
              {
                title: '数量',
                key: 'qty',
                width: 90,
                render: (_, l) => `${l.qty} ${l.unit ?? ''}`,
              },
              {
                title: '本次价',
                key: 'price',
                width: 160,
                render: (_, l) => {
                  if (l.unit_price == null) return '—'
                  const seg = prices[l.item_no]?.by_tax?.[l.tax_incl ? '含税' : '不含税']
                  const high = seg?.max_price != null && l.unit_price > seg.max_price
                  return (
                    <Space direction="vertical" size={0}>
                      <span>
                        ¥{l.unit_price} <Chip tone={toneOf(l.tax_incl ? 'blue' : 'orange')}>{l.tax_incl ? '含税' : '不含税'}</Chip>
                      </span>
                      {high && <Chip tone="err">高于历史最高 ¥{seg?.max_price}</Chip>}
                    </Space>
                  )
                },
              },
              {
                title: '同口径历史（含税）',
                key: 'tax',
                render: (_, l) => <HistoryCell seg={prices[l.item_no]?.by_tax?.['含税']} />
              },
              {
                title: '同口径历史（不含税）',
                key: 'extax',
                render: (_, l) => <HistoryCell seg={prices[l.item_no]?.by_tax?.['不含税']} />
              },
            ]}
          />

          <Card size="small" title="审批说明" style={{ marginTop: 12 }}>
            <Input.TextArea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="退回必须填写原因；通过可不填"
            />
          </Card>
        </>
      )}
    </Modal>
  )
}

function HistoryCell({ seg }: { seg?: { last_price?: number | null; last_qty?: number | null; avg_price?: number | null; min_price?: number | null; max_price?: number | null; deal_count: number } }) {
  if (!seg || seg.deal_count === 0) return <span style={{ color: T.textDisabled }}>无历史</span>
  return (
    <div style={{ fontSize: 12 }}>
      <div>
        上次 ¥{seg.last_price}
        {seg.last_qty != null ? `（买 ${seg.last_qty}）` : ''}
      </div>
      <div style={{ color: T.textSecondary }}>
        均 ¥{seg.avg_price} · 区间 {seg.min_price}~{seg.max_price} · {seg.deal_count} 笔
      </div>
    </div>
  )
}
