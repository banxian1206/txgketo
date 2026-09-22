import { App, Form, Input, Modal, Typography } from 'antd'
import { useEffect, useState } from 'react'

import { createChangeRequest, errMsg, type ChangeRequestRow } from '../api/client'

interface Props {
  open: boolean
  targetType: 'DRAWING' | 'PROGRAM' | 'BOM_ITEM' | null
  targetRef: string | null
  targetTitle?: string
  onClose: () => void
  onCreated?: (cr: ChangeRequestRow) => void
}

/** 提改版申请（05 卷 §7①）：任何部门/个人都能提，挂到具体冻结版本 */
export default function ChangeRequestModal({
  open,
  targetType,
  targetRef,
  targetTitle,
  onClose,
  onCreated,
}: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) form.resetFields()
  }, [open, form])

  const submit = async () => {
    if (!targetType || !targetRef) return
    const v = await form.validateFields()
    setSaving(true)
    try {
      const cr = await createChangeRequest({
        target_type: targetType,
        target_ref: targetRef,
        reason: v.reason,
        proposal: v.proposal ?? null,
      })
      message.success(`已提改版申请 ${cr.cr_no} —— 等总监裁决`)
      onClose()
      onCreated?.(cr)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="提改版申请"
      open={open}
      width={560}
      onCancel={onClose}
      onOk={() => void submit()}
      confirmLoading={saving}
      okText="提交申请"
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        对象：{targetTitle ?? targetRef} —— 冻结后要动，必须走改版申请：总监裁决 → 下发改版任务 →
        改完重走两级审核 → 新版本发布、旧版留档。否决时总监必须给替代方案。
      </Typography.Paragraph>
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="reason" label="问题是什么" rules={[{ required: true, message: '把问题写清楚' }]}>
          <Input.TextArea rows={3} placeholder="如：现场反馈安装孔位偏 5mm，装不上" />
        </Form.Item>
        <Form.Item name="proposal" label="建议怎么改（可留空）">
          <Input.TextArea rows={2} placeholder="如：安装孔整体左移 5mm" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
