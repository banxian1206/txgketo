import {
  App,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'

import dayjs from 'dayjs'

import ReceiptNegotiateModal from './ReceiptNegotiateModal'
import {
  cancelPurchaseOrder,
  changeOrderSupplier,
  closeReturnPurchaseOrder,
  errMsg,
  listSuppliers,
  purchaseOrderDetail,
  voidPurchaseOrder,
  type PurchaseOrderDetail,
  type PurchaseOrderLine,
  type SupplierRow,
} from '../api/client'
import { PURCHASE_LINE_STATUS as STATUS_COLOR } from '../theme/status'
import { RECEIPT_STATUS as RECEIPT_COLOR } from '../theme/status'
import { ORDER_STATUS as ORDER_STATUS_COLOR } from '../theme/status'
import { T } from '../theme/tokens'

/** 到货单状态在行内标签上的短文案 */
const RECEIPT_LABEL: Record<string, string> = {
  待入库: '待入库',
  已入库: '入库',
  现场已验收: '现场验收',
  不合格: '不合格',
  已换货: '换货',
  已退货: '退货',
}

/** 还能取消的行（没落地）；待入库/已入库要走入库，不合格要走换货/退货 */
const CANCELABLE = ['待采购', '在途', '已下单', '部分到货']
/** 还能更改供应商的行（还没到货） */
const SUPPLIER_CHANGEABLE = ['在途', '已下单']

/**
 * 采购单详情：一张合并单 + 每行需求的归属（项目/设备/物料/价格/到货单）。
 * 采购在这里做：更改供应商、取消、验收不合格的换货/退货。
 */
export default function PurchaseOrderDrawer({
  orderKey,
  open,
  onClose,
  onChanged,
}: {
  orderKey: string | null
  open: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const { message } = App.useApp()
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [supplierOpen, setSupplierOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [negotiateLine, setNegotiateLine] = useState<PurchaseOrderLine | null>(null)
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [saving, setSaving] = useState(false)
  const [supplierForm] = Form.useForm()
  const [cancelForm] = Form.useForm()
  const [prices, setPrices] = useState<Record<number, number | null>>({})

  const load = useCallback(async () => {
    if (!orderKey) return
    setLoading(true)
    try {
      setDetail(await purchaseOrderDetail(orderKey))
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [orderKey, message])

  useEffect(() => {
    if (open && orderKey) void load()
  }, [open, orderKey, load])

  const lines = detail?.lines ?? []
  const cancelable = lines.filter((l) => CANCELABLE.includes(l.status))
  const changeable = lines.filter((l) => SUPPLIER_CHANGEABLE.includes(l.status))

  const openSupplier = async () => {
    try {
      setSuppliers(await listSuppliers())
    } catch {
      setSuppliers([])
    }
    setPrices({})
    supplierForm.resetFields()
    supplierForm.setFieldsValue({ supplier_id: detail?.order.supplier_id ?? undefined })
    setSupplierOpen(true)
  }

  const submitSupplier = async () => {
    let v: { supplier_id: number; note?: string }
    try {
      v = await supplierForm.validateFields()
    } catch {
      return
    }
    if (!orderKey) return
    const bodyLines = changeable
      .filter((l) => prices[l.id])
      .map((l) => ({ request_id: l.id, unit_price: prices[l.id] ?? undefined }))
    setSaving(true)
    try {
      const res = await changeOrderSupplier(orderKey, {
        supplier_id: v.supplier_id,
        note: v.note,
        lines: bodyLines.length > 0 ? bodyLines : undefined,
      })
      message.success(
        `已改为 ${suppliers.find((x) => x.id === v.supplier_id)?.name ?? '新供应商'}（${res.changed} 行）`,
      )
      setSupplierOpen(false)
      await load()
      onChanged()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const submitCancel = async () => {
    let v: { reason?: string }
    try {
      v = await cancelForm.validateFields()
    } catch {
      return
    }
    if (!orderKey) return
    setSaving(true)
    try {
      const res = await cancelPurchaseOrder(orderKey, { reason: v.reason })
      message.success(
        `已取消 ${res.cancelled} 行` + (res.skipped > 0 ? `；${res.skipped} 行已落地，没动` : ''),
      )
      setCancelOpen(false)
      await load()
      onChanged()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const doVoid = async () => {
    if (!orderKey) return
    try {
      await voidPurchaseOrder(orderKey, { reason: '整单作废' })
      message.success('已作废，需求已回采购池')
      await load()
      onChanged()
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const doCloseReturn = async () => {
    if (!orderKey) return
    try {
      const res = await closeReturnPurchaseOrder(orderKey, { note: '整批退货' })
      message.success(`已关闭，新建 ${res.retry_ids?.length ?? 0} 条待采购回池`)
      await load()
      onChanged()
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const cancelLine = async (l: PurchaseOrderLine) => {
    if (!orderKey) return
    try {
      await cancelPurchaseOrder(orderKey, { request_ids: [l.id], reason: '单行取消' })
      message.success('已取消该行')
      await load()
      onChanged()
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const handleNegotiated = () => {
    setNegotiateLine(null)
    void load()
    onChanged()
  }

  const o = detail?.order

  return (
    <Drawer
      title={
        <Space>
          <span>采购单 {o?.po_no ?? '（未编号）'}</span>
          {o && <Tag color={ORDER_STATUS_COLOR[o.status]}>{o.status}</Tag>}
        </Space>
      }
      width={1100}
      open={open}
      onClose={onClose}
      extra={
        <Space>
          <Button disabled={changeable.length === 0} onClick={() => void openSupplier()}>
            更改供应商
          </Button>
          <Button
            danger
            disabled={cancelable.length === 0}
            onClick={() => {
              cancelForm.resetFields()
              setCancelOpen(true)
            }}
          >
            取消未到的部分
          </Button>
          <Popconfirm
            title="作废整单？需求全部回采购池，可重新下单"
            disabled={!o || ['执行中', '已完成', '已作废', '已关闭'].includes(o.po_status ?? '')}
            onConfirm={() => void doVoid()}
          >
            <Button disabled={!o || ['执行中', '已完成', '已作废', '已关闭'].includes(o.po_status ?? '')}>
              作废整单
            </Button>
          </Popconfirm>
          <Popconfirm
            title="整批退货关闭？到货单全转已退货，需求回池重采"
            disabled={!o || !['已批准', '执行中'].includes(o.po_status ?? '')}
            onConfirm={() => void doCloseReturn()}
          >
            <Button disabled={!o || !['已批准', '执行中'].includes(o.po_status ?? '')}>
              整批退货关闭
            </Button>
          </Popconfirm>
        </Space>
      }
    >
      {!o ? (
        <Empty description={loading ? '加载中…' : '没有数据'} />
      ) : (
        <>
          <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="供应商">{o.supplier_name ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="合计金额">
              {o.total_amount > 0 ? `¥${o.total_amount.toLocaleString()}` : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="下单日期">{o.ordered_at ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="预计到货">{o.expected_date ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="收货地点">
              {o.deliver_to === '直发客户现场' ? (
                <Tag color="purple">直发客户现场</Tag>
              ) : (
                <Tag>公司仓库</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="送货地址">{o.deliver_address ?? '—'}</Descriptions.Item>
            {(o.exchanged_qty > 0 || o.returned_qty > 0) && (
              <Descriptions.Item label="退换货" span={2}>
                {o.exchanged_qty > 0 && <Tag color="orange">换货 {o.exchanged_qty}</Tag>}
                {o.returned_qty > 0 && <Tag>退货 {o.returned_qty}</Tag>}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  　展开下面每行看原因和采购处理记录
                </Typography.Text>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="需求归属" span={2}>
              {o.projects.map((p) => (
                <Tag key={p.project_no}>
                  {p.project_no} {p.project_name ?? ''}
                </Tag>
              ))}
              {o.equipments.map((e) => (
                <Tag key={`${e.project_no}-${e.equip_no}`} color="blue">
                  {e.equip_no} {e.equip_name ?? ''}
                </Tag>
              ))}
              {o.equipments.length === 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  　（这单的需求没挂到具体设备）
                </Typography.Text>
              )}
            </Descriptions.Item>
          </Descriptions>

          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            这批货分别来自下面这些项目/设备的需求；仓库到货、验收、入库和以后发货都按这里的归属对单。
          </Typography.Paragraph>

          <Table<PurchaseOrderLine>
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={lines}
            pagination={false}
            scroll={{ x: 1073 }}
            expandable={{
              expandedRowRender: (l) => (
                <Table<PurchaseOrderLine['receipts'][number]>
                  rowKey="receipt_no"
                  size="small"
                  pagination={false}
                  dataSource={l.receipts}
                  locale={{ emptyText: '这行还没有到货记录' }}
                  columns={[
                    {
                      title: '到货单',
                      dataIndex: 'receipt_no',
                      width: 110,
                      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
                    },
                    { title: '到货日期', dataIndex: 'receipt_date', width: 100, render: (v) => v ?? '—' },
                    {
                      title: '数量',
                      dataIndex: 'qty',
                      width: 90,
                      render: (v: number | null, g) => (v ? `${v} ${g.unit ?? ''}` : '—'),
                    },
                    {
                      title: '验收结果',
                      key: 'result',
                      width: 160,
                      render: (_: unknown, g) =>
                        g.status === '不合格' || g.status === '已换货' || g.status === '已退货' ? (
                          <>
                            <Tag color="red">不合格</Tag>
                            <div style={{ fontSize: 12, color: T.textSecondary }}>{g.inspect_note ?? '—'}</div>
                          </>
                        ) : (
                          <Tag color="green">
                            {g.status === '现场已验收' ? '合格（现场）' : '合格'}
                          </Tag>
                        ),
                    },
                    {
                      title: '处理 / 去向',
                      key: 'disposal',
                      width: 230,
                      render: (_: unknown, g) => {
                        if (g.status === '已换货') {
                          return (
                            <>
                              <Tag color="orange">换货</Tag>
                              <span style={{ fontSize: 12, color: T.textSecondary }}>{g.resolve_note ?? '等供应商补发'}</span>
                            </>
                          )
                        }
                        if (g.status === '已退货') {
                          return (
                            <>
                              <Tag>退货</Tag>
                              <span style={{ fontSize: 12, color: T.textSecondary }}>{g.resolve_note ?? '—'}</span>
                              {(g.retries ?? []).length > 0 && (
                                <div style={{ fontSize: 12, color: T.brand }}>
                                  → 需求已回采购池：
                                  {g.retries
                                    ?.map((x) => (x.po_no ? `重采 ${x.po_no}` : `新需求 #${x.id}（${x.status}）`))
                                    .join('、')}
                                </div>
                              )}
                            </>
                          )
                        }
                        if (g.status === '不合格') return <Tag color="error">等采购协商</Tag>
                        if (g.status === '待入库') return <Tag color="processing">等入库</Tag>
                        if (g.status === '已入库') return <Tag color="success">入库 {g.location ?? ''}</Tag>
                        return <Tag color="purple">现场验收</Tag>
                      },
                    },
                    {
                      title: '验收人 / 时间',
                      key: 'inspector',
                      width: 130,
                      render: (_: unknown, g) => (
                        <>
                          <div>{g.inspected_by ?? '—'}</div>
                          <div style={{ fontSize: 12, color: T.textSecondary }}>
                            {g.inspected_at ? dayjs(g.inspected_at).format('MM-DD HH:mm') : ''}
                          </div>
                        </>
                      ),
                    },
                    {
                      title: '处理人 / 时间',
                      key: 'resolver',
                      width: 140,
                      render: (_: unknown, g) => {
                        const by = g.resolved_by ?? g.stored_by
                        const at = g.resolved_at ?? g.stored_at
                        return (
                          <>
                            <div>{by ?? '—'}</div>
                            <div style={{ fontSize: 12, color: T.textSecondary }}>
                              {at ? dayjs(at).format('MM-DD HH:mm') : ''}
                            </div>
                          </>
                        )
                      },
                    },
                  ]}
                />
              ),
            }}
            columns={[
              {
                title: '物料',
                key: 'item',
                width: 180,
                fixed: 'left',
                render: (_: unknown, l) => (
                  <>
                    <b>{l.item_name}</b>
                    {l.source === '退货重采' && (
                      <Tag color="orange" style={{ marginLeft: 4 }}>
                        退货重采
                      </Tag>
                    )}
                    <div style={{ fontSize: 12, color: T.textSecondary }}>
                      {l.item_no}
                      {l.spec_text ? ` · ${l.spec_text}` : ''}
                    </div>
                  </>
                ),
              },
              {
                title: '项目 / 设备',
                key: 'belong',
                width: 150,
                render: (_: unknown, l) => (
                  <>
                    <div>{l.project_no}</div>
                    <div style={{ fontSize: 12, color: T.textSecondary }}>
                      {l.equip_no ? `${l.equip_no} ${l.equip_name ?? ''}` : (l.equip_name ?? '未挂设备')}
                    </div>
                    {l.part_no && (
                      <div
                        style={{ fontSize: 12, color: T.textSecondary }}
                        title={l.part_title ?? ''}
                      >
                        零件 {l.part_no}
                      </div>
                    )}
                  </>
                ),
              },
              {
                title: '数量',
                dataIndex: 'qty',
                width: 85,
                render: (v: number | null, l) => (
                  <>
                    <div>{v ? `${v} ${l.unit ?? ''}` : '—'}</div>
                    {(l.qty_returned > 0 || l.qty_exchanged > 0) && (
                      <div style={{ fontSize: 12, color: T.textSecondary }} title={`原订购 ${l.qty_original} ${l.unit ?? ''}`}>
                        原 {l.qty_original}
                        {l.qty_exchanged > 0 ? ` · 换 ${l.qty_exchanged}` : ''}
                        {l.qty_returned > 0 ? ` · 退 ${l.qty_returned}` : ''}
                      </div>
                    )}
                  </>
                ),
              },
              {
                title: '单价',
                dataIndex: 'unit_price',
                width: 80,
                align: 'right',
                render: (v: number | null) => (v ? `¥${v.toLocaleString()}` : '—'),
              },
              {
                title: '小计',
                dataIndex: 'amount',
                width: 85,
                align: 'right',
                render: (v: number | null) => (v ? `¥${v.toLocaleString()}` : '—'),
              },
              {
                title: '需要到货',
                dataIndex: 'need_date',
                width: 90,
                render: (v: string | null) => v ?? '—',
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 80,
                render: (v: string) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>,
              },
              {
                title: '到货情况',
                key: 'receipts',
                width: 175,
                render: (_: unknown, l) =>
                  l.receipts.length === 0 ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      还没到货
                    </Typography.Text>
                  ) : (
                    l.receipts.map((g) => (
                      <Tag
                        key={g.receipt_no}
                        color={RECEIPT_COLOR[g.status]}
                        title={
                          `${g.receipt_no} ${RECEIPT_LABEL[g.status] ?? g.status} ${g.qty ?? ''}${g.unit ?? ''}` +
                          (g.location ? ` · ${g.location}` : '') +
                          (g.inspect_note ? `\n不合格：${g.inspect_note}` : '') +
                          (g.resolve_note ? `\n处理：${g.resolve_note}` : '')
                        }
                        style={{ marginBottom: 2 }}
                      >
                        {g.receipt_no} {RECEIPT_LABEL[g.status] ?? g.status} {g.qty ?? ''}
                      </Tag>
                    ))
                  ),
              },
              {
                title: '操作',
                key: 'action',
                width: 100,
                fixed: 'right',
                render: (_: unknown, l) => {
                  if (l.status === '不合格') {
                    return (
                      <Button danger size="small" onClick={() => setNegotiateLine(l)}>
                        换货 / 退货
                      </Button>
                    )
                  }
                  if (CANCELABLE.includes(l.status)) {
                    return (
                      <Popconfirm title="取消这一行？" onConfirm={() => void cancelLine(l)}>
                        <Button type="link" size="small" danger>
                          取消
                        </Button>
                      </Popconfirm>
                    )
                  }
                  if (l.status === '待入库') {
                    return (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        等仓库入库
                      </Typography.Text>
                    )
                  }
                  return (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      —
                    </Typography.Text>
                  )
                },
              },
            ]}
          />
        </>
      )}

      {/* 更改供应商（还没到的行） */}
      <Modal
        title={`更改供应商 · ${o?.po_no ?? ''}`}
        open={supplierOpen}
        width={760}
        onCancel={() => setSupplierOpen(false)}
        onOk={() => void submitSupplier()}
        confirmLoading={saving}
        okText="确认更改"
        forceRender
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0 }}>
          还没到的行一起换供应商；要改价就在下面填新单价（不填保留原价）。
          已验收/已入库的货不动。
        </Typography.Paragraph>
        <Form form={supplierForm} layout="vertical">
          <Form.Item
            name="supplier_id"
            label="新供应商"
            style={{ maxWidth: 320 }}
            rules={[{ required: true, message: '请选供应商' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="从供应商里选"
              options={suppliers.map((x) => ({ value: x.id, label: `${x.code} ${x.name}` }))}
            />
          </Form.Item>
          {changeable.length > 0 && (
            <Table<PurchaseOrderLine>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={changeable}
              columns={[
                { title: '物料', dataIndex: 'item_name' },
                {
                  title: '项目 / 设备',
                  key: 'belong',
                  width: 150,
                  render: (_: unknown, l) => `${l.project_no}${l.equip_no ? ` · ${l.equip_no}` : ''}`,
                },
                {
                  title: '数量',
                  dataIndex: 'qty',
                  width: 90,
                  render: (v: number | null, l) => `${v ?? ''} ${l.unit ?? ''}`,
                },
                {
                  title: '原单价',
                  dataIndex: 'unit_price',
                  width: 100,
                  render: (v: number | null) => (v ? `¥${v.toLocaleString()}` : '—'),
                },
                {
                  title: '新单价（不填=不变）',
                  key: 'new_price',
                  width: 190,
                  render: (_: unknown, l) => (
                    <InputNumber
                      size="small"
                      style={{ width: '100%' }}
                      min={0}
                      placeholder={l.unit_price ? `${l.unit_price}` : '不填'}
                      value={prices[l.id] ?? undefined}
                      onChange={(x) =>
                        setPrices((prev) => ({ ...prev, [l.id]: x == null ? null : Number(x) }))
                      }
                    />
                  ),
                },
              ]}
            />
          )}
          <Form.Item name="note" label="备注" style={{ marginTop: 12, marginBottom: 0 }}>
            <Input placeholder="如：原供应商交期赶不上 / 质量问题换一家" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 取消未到的部分 */}
      <Modal
        title={`取消未到的部分 · ${o?.po_no ?? ''}`}
        open={cancelOpen}
        width={520}
        onCancel={() => setCancelOpen(false)}
        onOk={() => void submitCancel()}
        confirmLoading={saving}
        okText="确认取消"
        okButtonProps={{ danger: true }}
        forceRender
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          将取消 <b>{cancelable.length}</b> 行还没到货的部分。
          已经验收、待入库、已入库的行不会动（要退就等验收不合格后走换货/退货）。
        </Typography.Paragraph>
        <Form form={cancelForm} layout="vertical">
          <Form.Item name="reason" label="取消原因">
            <Input.TextArea rows={3} placeholder="如：客户改方案不做了 / 供应商涨价谈不拢" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 验收不合格：换货 / 退货 */}
      <ReceiptNegotiateModal
        open={negotiateLine !== null}
        orderKey={orderKey}
        requestIds={negotiateLine ? [negotiateLine.id] : []}
        itemLabel={negotiateLine?.item_name ?? ''}
        leadDays={negotiateLine?.lead_days ?? null}
        onCancel={() => setNegotiateLine(null)}
        onDone={handleNegotiated}
      />
    </Drawer>
  )
}
