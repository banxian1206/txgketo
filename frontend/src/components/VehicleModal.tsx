import { App, Form, Input, InputNumber, Modal, Typography } from 'antd'
import { useState } from 'react'

import { errMsg, requestVehicle } from '../api/client'
import { Muted, Stack } from './ui/Primitives'

/**
 * ★ 采购叫车（09 卷 §2.2）—— 一条发货指令指挥两个部门：
 *   PM 下指令（含发货日）→ **采购叫车**（当天把车订回来，登记几车 + 本次运费）→ 发运装车。
 *
 * 这个弹窗**只有一个实现**，两个台共用：
 *  · 发运台（发运的人看得见批次；采购有 ship 权限时也能在这儿点）
 *  · 采购工作台「待叫车」页签（★ 采购员没有 ship:edit / project:edit，**进不去发运台** ——
 *    2026-09-30 UI 真实场景测试 P1-1：叫车曾是"后端有接口、前端没入口"，装车被硬拦 → 发运死锁）
 *
 * 车辆费用**不进价格库**（地方/车型/时间不同价格必不同 —— AGENTS §8.1）。
 */
export interface VehicleTarget {
  id: number
  shipment_no: string
  plan_ship_date?: string | null
  project_no?: string | null
  project_name?: string | null
}

export default function VehicleModal({
  target,
  onClose,
  onDone,
}: {
  target: VehicleTarget | null
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  return (
    <Modal
      open={!!target}
      title={`采购叫车 · ${target?.shipment_no ?? ''}`}
      onCancel={onClose}
      confirmLoading={saving}
      okText="确认已叫车"
      destroyOnHidden
      onOk={() => {
        form.validateFields().then(async (v) => {
          if (!target) return
          setSaving(true)
          try {
            await requestVehicle(target.id, {
              count: Number(v.count),
              fee: v.fee ? Number(v.fee) : undefined,
              note: v.note,
            })
            message.success('已叫车，发运可以装车了')
            onClose()
            await onDone()
          } catch (e) {
            message.error(errMsg(e))
          } finally {
            setSaving(false)
          }
        })
      }}
    >
      <Typography.Paragraph>
        <Muted>
          按 PM 定的「发货日」当天把车订好；装货的人据此知道当天装几车。车辆费用只记本次金额，不进价格库。
        </Muted>
      </Typography.Paragraph>
      {target?.project_no && (
        <Typography.Paragraph>
          <Muted>
            {target.project_no} {target.project_name ?? ''}
            {target.plan_ship_date ? ` · 发货日 ${target.plan_ship_date}` : ' · ⚠ 这批没填发货日，请找项目经理确认哪天发'}
          </Muted>
        </Typography.Paragraph>
      )}
      <Form form={form} layout="vertical" preserve={false}>
        <Stack gap={12} align="start">
          <Form.Item name="count" label="几辆车" rules={[{ required: true, message: '装货的人要知道当天几车' }]} style={{ marginBottom: 0 }}>
            <InputNumber min={1} style={{ width: 110 }} />
          </Form.Item>
          <Form.Item name="fee" label="本次运费（不进价格库）" style={{ marginBottom: 0 }}>
            <InputNumber min={0} style={{ width: 150 }} placeholder="如 1800" />
          </Form.Item>
          <Form.Item name="note" label="承运商 / 备注" style={{ marginBottom: 0 }}>
            <Input placeholder="如 顺达物流 17.5米" />
          </Form.Item>
        </Stack>
      </Form>
    </Modal>
  )
}
