import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { useState } from 'react'

import {
  errMsg,
  listSuppliers,
  priceReference,
  recommendSuppliers,
  orderPurchase,
  type PriceReference,
  type RecommendResult,
  type PurchaseRequestItem,
  type SupplierRow,
} from '../api/client'

/**
 * 采购的下单动作（只做下单；到货/验收/入库由仓库推，见采购单详情）。
 * 采购员看到的不是「完成」，而是「现在能不能下单」。
 */
export default function PurchaseActions({
  row,
  onDone,
  size = 'small',
}: {
  row: PurchaseRequestItem
  onDone: () => void
  size?: 'small' | 'middle'
}) {
  const { message } = App.useApp()
  const [orderOpen, setOrderOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [orderForm] = Form.useForm()
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [priceRef, setPriceRef] = useState<PriceReference | null>(null)
  const [recos, setRecos] = useState<RecommendResult | null>(null)
  const [orderDeliverTo, setOrderDeliverTo] = useState('公司仓库')

  const submitOrder = async () => {
    const v = await orderForm.validateFields()
    setSaving(true)
    try {
      await orderPurchase(row.project_no, row.id, {
        supplier_id: v.supplier_id,
        supplier_name: suppliers.find((x) => x.id === v.supplier_id)?.name,
        po_no: v.po_no,
        unit_price: v.unit_price,
        qty: v.qty,
        ordered_at: v.ordered_at.format('YYYY-MM-DD'),
        expected_date: v.expected_date ? v.expected_date.format('YYYY-MM-DD') : undefined,
        deliver_to: v.deliver_to,
        deliver_address: v.deliver_to === '直发客户现场' ? v.deliver_address : undefined,
      })
      message.success('已下单（在途）')
      setOrderOpen(false)
      onDone()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const openOrder = async () => {
    try {
      const [sups, ref, rec] = await Promise.all([
        listSuppliers(),
        priceReference(row.item_no).catch(() => null),
        recommendSuppliers(row.item_no, row.need_date ?? undefined).catch(() => null),
      ])
      setSuppliers(sups)
      setPriceRef(ref)
      setRecos(rec)
    } catch {
      setSuppliers([])
      setPriceRef(null)
    }
    setOrderDeliverTo(row.deliver_to ?? '公司仓库')
    orderForm.setFieldsValue({
      supplier_name: row.supplier_name ?? undefined,
      po_no: row.po_no ?? undefined,
      unit_price: row.unit_price ?? undefined,
      qty: row.qty ?? 1,
      ordered_at: dayjs(),
      expected_date: row.lead_days ? dayjs().add(row.lead_days, 'day') : undefined,
      deliver_to: row.deliver_to ?? '公司仓库',
      deliver_address: row.deliver_address ?? undefined,
    })
    setOrderOpen(true)
  }

  return (
    <>
      <Space size="small">
        {row.status === '待采购' && (
          <Button
            type={size === 'small' ? 'primary' : 'default'}
            size={size}
            onClick={() => void openOrder()}
          >
            去下单
          </Button>
        )}
        {(row.status === '在途' || row.status === '已下单') && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            等仓库到货验收…
          </Typography.Text>
        )}
        {row.status === '部分到货' && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            部分到货，剩下的等仓库验收…
          </Typography.Text>
        )}
        {row.status === '待入库' && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            验收合格，等仓库入库…
          </Typography.Text>
        )}
        {row.status === '不合格' && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            验收不合格：去采购工作台「验收不合格」协商换货 / 退货
          </Typography.Text>
        )}
        {row.status === '已退货' && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已退货
          </Typography.Text>
        )}
      </Space>

      {/* 下单 */}
      <Modal
        title={`采购下单 · ${row.item_name ?? row.item_no}`}
        open={orderOpen}
        width={620}
        onCancel={() => setOrderOpen(false)}
        onOk={() => void submitOrder()}
        confirmLoading={saving}
        okText="确认下单"
        destroyOnHidden
      >
        <Form
          form={orderForm}
          layout="vertical"
          preserve={false}
          onValuesChange={(changed) => {
            if ('deliver_to' in changed) setOrderDeliverTo(changed.deliver_to)
          }}
        >
          <Space style={{ display: 'flex' }} size="middle">
            <Form.Item
              name="supplier_id"
              label="供应商"
              style={{ minWidth: 260 }}
              rules={[{ required: true, message: '请选供应商' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="从供应商里选"
                options={suppliers.map((x) => ({ value: x.id, label: `${x.code} ${x.name}` }))}
              />
            </Form.Item>
            <Form.Item name="po_no" label="采购单号" style={{ minWidth: 200 }}>
              <Input placeholder="不填自动发号 PO+年份+序号" />
            </Form.Item>
          </Space>
          {recos && recos.recommendations.length > 0 && (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
              message="推荐供应商（点一下选中，自动带出价格和交期）"
              description={
                <div style={{ fontSize: 12 }}>
                  {recos.recommendations.slice(0, 5).map((r) => (
                    <div
                      key={r.supplier_id}
                      style={{ cursor: 'pointer', padding: '4px 0', borderBottom: '1px dashed #f0f0f0' }}
                      onClick={() => {
                        orderForm.setFieldsValue({
                          supplier_id: r.supplier_id,
                          unit_price: r.price_hint ?? undefined,
                        })
                      }}
                    >
                      <Tag color={r.late ? 'red' : 'blue'}>{r.score} 分</Tag>
                      <b>{r.name}</b>
                      {r.price_hint ? `　参考价 ¥${r.price_hint.toLocaleString()}` : ''}
                      {r.lead_days ? `　交期 ${r.lead_days} 天` : ''}
                      {r.reasons.includes('首选供应商') && <Tag color="gold">首选</Tag>}
                      <div style={{ color: '#8c8c8c' }}>{r.reasons.join('　·　')}</div>
                    </div>
                  ))}
                  <div style={{ color: '#8c8c8c', marginTop: 4 }}>{recos.note}</div>
                </div>
              }
            />
          )}

          {priceRef && (priceRef.stats.deal_count > 0 || priceRef.stats.quote_count > 0) && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="价格参考（砍价依据）"
              description={
                <div style={{ fontSize: 12 }}>
                  <div>
                    上次成交：
                    {priceRef.stats.last_price ? (
                      <b>¥{priceRef.stats.last_price.toLocaleString()}</b>
                    ) : (
                      '无'
                    )}
                    {priceRef.stats.last_supplier
                      ? `（${priceRef.stats.last_supplier}，${priceRef.stats.last_date}）`
                      : ''}
                    {priceRef.stats.deal_count > 0 && (
                      <>
                        {'　历史区间：'}¥{priceRef.stats.min_price?.toLocaleString()} ~ ¥
                        {priceRef.stats.max_price?.toLocaleString()}　均价 ¥
                        {priceRef.stats.avg_price?.toLocaleString()}（{priceRef.stats.deal_count} 次）
                      </>
                    )}
                  </div>
                  {priceRef.quotes.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      在报价的供应商（从低到高，点一下填入单价）：
                      <div style={{ marginTop: 4 }}>
                        {priceRef.quotes.map((q) => (
                          <Tag
                            key={q.id}
                            style={{ cursor: 'pointer', marginBottom: 4 }}
                            onClick={() => orderForm.setFieldsValue({ unit_price: q.price })}
                          >
                            {q.supplier_name} ¥{q.price.toLocaleString()}
                            {q.lead_days ? ` / ${q.lead_days}天` : ''}
                          </Tag>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              }
            />
          )}
          <Space style={{ display: 'flex' }} size="middle">
            <Form.Item name="unit_price" label="单价（元）" style={{ minWidth: 150 }}>
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="qty" label="数量" style={{ minWidth: 130 }} rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={0.001} />
            </Form.Item>
            <Form.Item
              name="ordered_at"
              label="下单日期"
              style={{ minWidth: 170 }}
              rules={[{ required: true, message: '请填下单日期' }]}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="expected_date" label="预计到货日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Space style={{ display: 'flex' }} size="middle" align="start">
            <Form.Item
              name="deliver_to"
              label="收货地点"
              style={{ minWidth: 230 }}
              rules={[{ required: true }]}
              tooltip="验收动作跟着货走：到仓库的由仓库验收，直发现场的由现场验收"
            >
              <Select
                options={[
                  { value: '公司仓库', label: '公司仓库（仓库验收）' },
                  { value: '直发客户现场', label: '直发客户现场（现场验收）' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="deliver_address"
              label="送货地址"
              style={{ minWidth: 300 }}
              rules={
                orderDeliverTo === '直发客户现场'
                  ? [{ required: true, message: '直发客户现场必须填送货地址' }]
                  : []
              }
            >
              <Input
                placeholder={
                  orderDeliverTo === '直发客户现场' ? '客户现场详细地址' : '到公司仓库可不填'
                }
                disabled={orderDeliverTo !== '直发客户现场'}
              />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  )
}
