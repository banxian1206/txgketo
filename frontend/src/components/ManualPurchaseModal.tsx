import { useEffect, useState } from 'react'
import { App, DatePicker, Form, Input, InputNumber, Modal, Select, Typography } from 'antd'

import {
  ATTRIBUTIONS,
  createManualPurchaseRequest,
  errMsg,
  listEquipment,
  listProjects,
  type EquipmentItem,
} from '../api/client'
import { SelectStdItem } from './fields'

interface Props {
  open: boolean
  onClose: () => void
  onDone: () => void
}

/** 手工采购申请（05 卷 §6）：任何部门/个人可提，**免审核**，提交即进采购池 */
export default function ManualPurchaseModal({ open, onClose, onDone }: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [projects, setProjects] = useState<{ project_no: string; project_name: string }[]>([])
  const [equipments, setEquipments] = useState<EquipmentItem[]>([])
  const [saving, setSaving] = useState(false)
  const [attribution, setAttribution] = useState('项目')

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({ attribution: '项目', qty: 1 })
    setAttribution('项目')
    setEquipments([])
    void listProjects().then(setProjects).catch(() => setProjects([]))
  }, [open, form])

  const onProjectChange = async (no?: string) => {
    form.setFieldValue('equip_no', undefined)
    setEquipments([])
    if (!no) return
    try {
      setEquipments(await listEquipment(no))
    } catch {
      setEquipments([])
    }
  }

  const submit = async () => {
    let v
    try { v = await form.validateFields() } catch { return }
    setSaving(true)
    try {
      const r = await createManualPurchaseRequest({
        attribution: v.attribution,
        project_no: v.attribution === '项目' ? v.project_no : null,
        equip_no: v.attribution === '项目' ? (v.equip_no ?? null) : null,
        item_no: v.item_no,
        qty: v.qty,
        unit: v.unit ?? null,
        need_date: v.need_date ? v.need_date.format('YYYY-MM-DD') : null,
        note: v.note ?? null,
      })
      message.success(`已进采购池：${r.display_name} × ${r.qty}（${r.attribution}）`)
      onClose()
      onDone()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="手工采购申请（免审核，直入采购池）"
      open={open}
      width={600}
      onCancel={onClose}
      onOk={() => void submit()}
      confirmLoading={saving}
      okText="提交进池"
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        车间耗品、现场缺件、辅料、办公用品都能提。每条需求有归属；不挂项目的（辅料/办公用品）
        也算需求，采购处理时判断合理性。物料从标准库选，库里没有先去标准库建。
      </Typography.Paragraph>
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="attribution" label="归属" rules={[{ required: true, message: '选归属' }]}>
          <Select
            onChange={(v) => setAttribution(v)}
            options={ATTRIBUTIONS.map((a) => ({ value: a, label: a }))}
          />
        </Form.Item>
        {attribution === '项目' && (
          <>
            <Form.Item
              name="project_no"
              label="项目"
              rules={[{ required: true, message: '归属项目时必须选项目' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                onChange={(v) => void onProjectChange(v)}
                options={projects.map((p) => ({
                  value: p.project_no,
                  label: `${p.project_no} ${p.project_name}`,
                }))}
              />
            </Form.Item>
            <Form.Item name="equip_no" label="设备（可不挂）">
              <Select
                allowClear
                options={equipments.map((e) => ({ value: e.equip_no, label: `${e.equip_no} ${e.equip_name}` }))}
              />
            </Form.Item>
          </>
        )}
        <Form.Item
          name="item_no"
          label="物料"
          rules={[{ required: true, message: '选物料' }]}
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              库里没有？
              <a onClick={() => window.open('/library', '_blank')}> 去标准库新建</a>
            </Typography.Text>
          }
        >
          <SelectStdItem />
        </Form.Item>
        <Form.Item name="qty" label="数量" rules={[{ required: true, message: '填数量' }]}>
          <InputNumber style={{ width: '100%' }} min={0.001} />
        </Form.Item>
        <Form.Item name="unit" label="单位">
          <Input placeholder="不填用库里的单位" />
        </Form.Item>
        <Form.Item name="need_date" label="需要到货">
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="note" label="用途说明">
          <Input.TextArea rows={2} placeholder="如：车间焊丝用完了 / 现场缺 2 个气管接头" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
