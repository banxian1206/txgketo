import { App, DatePicker, Form, Input, Modal, Radio, Typography } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'

import { errMsg, negotiateOrder } from '../api/client'

/**
 * 验收不合格的处理（采购和供应商协商的结果）：
 *   换货 → 供应商补发，回到「在途」等货
 *   退货 → 这部分不要了，订购数量减掉
 */
export default function ReceiptNegotiateModal({
  open,
  orderKey,
  requestIds,
  itemLabel,
  leadDays,
  onCancel,
  onDone,
}: {
  open: boolean
  orderKey: string | null
  requestIds: number[]
  itemLabel?: string
  leadDays?: number | null
  onCancel: () => void
  onDone: () => void
}) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [action, setAction] = useState<'换货' | '退货'>('换货')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setAction('换货')
    form.resetFields()
    form.setFieldsValue({
      expected_date: dayjs().add(leadDays && leadDays > 0 ? leadDays : 7, 'day'),
      note: undefined,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = async () => {
    let v: { expected_date?: dayjs.Dayjs; note?: string }
    try {
      v = await form.validateFields()
    } catch {
      return
    }
    if (!orderKey) return
    setSaving(true)
    try {
      const res = await negotiateOrder(orderKey, {
        request_ids: requestIds,
        action,
        expected_date:
          action === '换货' && v.expected_date ? v.expected_date.format('YYYY-MM-DD') : undefined,
        note: v.note,
      })
      message.success(
        action === '换货'
          ? '已按「换货」处理：留在原单等供应商补发（在途）'
          : `已按「退货」处理：需求已回到采购池重采（新需求 ${
              res.retry_request_ids.map((id) => `#${id}`).join('、') || ''
            }），可换供应商重新下单`,
      )
      onDone()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`验收不合格处理${itemLabel ? ` · ${itemLabel}` : ''}`}
      open={open}
      width={540}
      onCancel={onCancel}
      onOk={() => void submit()}
      confirmLoading={saving}
      okText="确认处理"
      forceRender
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0 }}>
        和供应商协商后选一个：
        <b>换货</b>＝货退回去、<b>原供应商补发</b>，留在原单等货（回「在途」）；
        <b>退货</b>＝这家的货不要了，<b>需求回到采购池重新买</b>（可换供应商、可再合并下单）。
      </Typography.Paragraph>
      <Radio.Group
        value={action}
        onChange={(e) => setAction(e.target.value)}
        optionType="button"
        buttonStyle="solid"
        style={{ marginBottom: 16 }}
      >
        <Radio.Button value="换货">换货（等补发）</Radio.Button>
        <Radio.Button value="退货">退货（回采购池重买）</Radio.Button>
      </Radio.Group>
      <Form form={form} layout="vertical">
        {action === '换货' && (
          <Form.Item
            name="expected_date"
            label="新的预计到货日期"
            rules={[{ required: true, message: '请填预计到货日期' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        )}
        <Form.Item name="note" label="协商结果 / 备注" style={{ marginBottom: 0 }}>
          <Input.TextArea
            rows={2}
            placeholder={
              action === '换货' ? '如：供应商同意 3 天内补发' : '如：质量问题退货，已通知供应商'
            }
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
