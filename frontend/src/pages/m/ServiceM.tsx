import { App, Button, Card, Empty, Form, Input, InputNumber, Modal, Space, Tag } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import {
  arriveServiceOrder,
  createServiceOrder,
  dispatchServiceOrder,
  errMsg,
  fixServiceOrder,
  hasPerm,
  servicePhotoUrl,
  serviceWorkbench,
  signServiceOrder,
  uploadServicePhotos,
  type ServiceOrderRow,
  type ServiceWorkbench,
} from '../../api/client'
import MfgPhotoPicker from '../../components/MfgPhotoPicker'

const SO_COLOR: Record<string, string> = {
  待受理: 'error',
  已派工: 'processing',
  已到场: 'gold',
  待客户签字: 'cyan',
  已关闭: 'success',
}

/** 售后手机端（S11）：报修 / 派工 / 到场 / 处理完成（拍照）。 */
export default function ServiceM() {
  const { message } = App.useApp()
  const canEdit = hasPerm('service:edit')
  const [wb, setWb] = useState<ServiceWorkbench | null>(null)
  const [modal, setModal] = useState<{ kind: 'create' | 'dispatch' | 'fix' | 'sign'; order?: ServiceOrderRow } | null>(null)
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    try {
      setWb(await serviceWorkbench())
    } catch (e) {
      message.error(errMsg(e))
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const open = (kind: 'create' | 'dispatch' | 'fix' | 'sign', order?: ServiceOrderRow) => {
    setPhotos([])
    form.resetFields()
    setModal({ kind, order })
  }

  const submit = async () => {
    if (!modal) return
    const v = await form.validateFields()
    setSaving(true)
    try {
      if (modal.kind === 'create') {
        const r = await createServiceOrder(v)
        message.success(`已建工单 ${r.so_no}（${r.in_warranty ? '在保' : '过保'}）`)
      } else if (modal.kind === 'dispatch' && modal.order) {
        await dispatchServiceOrder(modal.order.id, v.dispatched_to)
        message.success('已派工')
      } else if (modal.kind === 'fix' && modal.order) {
        await fixServiceOrder(modal.order.id, { solution: v.solution, labor_hours: v.labor_hours, photos, remark: v.remark })
        message.success('处理完成，待客户签字')
      } else if (modal.kind === 'sign' && modal.order) {
        await signServiceOrder(modal.order.id, v.customer_sign)
        message.success('客户签字，工单关闭')
      }
      setModal(null)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const orderCard = (o: ServiceOrderRow) => (
    <Card key={o.id} size="small" style={{ marginBottom: 10 }}>
      <Space>
        <Tag color={SO_COLOR[o.status] ?? 'default'}>{o.status}</Tag>
        <b>{o.so_no}</b>
        {o.in_warranty != null && (o.in_warranty ? <Tag color="success">在保</Tag> : <Tag color="red">过保</Tag>)}
      </Space>
      <div style={{ fontSize: 13, marginTop: 4 }}>{o.fault ?? ''}</div>
      <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
        {o.project_no}{o.equip_no ? ` · ${o.equip_no}` : ''} · {o.dispatched_to ?? '未派工'}
      </div>
      {o.solution && <div style={{ fontSize: 12, color: '#52c41a', marginTop: 4 }}>✅ {o.solution}</div>}
      <Space wrap style={{ marginTop: 8 }}>
        {canEdit && o.status === '待受理' && <Button size="small" type="primary" onClick={() => open('dispatch', o)}>派工</Button>}
        {canEdit && o.status === '已派工' && <Button size="small" onClick={() => void arriveServiceOrder(o.id).then(() => void load()).catch((e) => message.error(errMsg(e)))}>到场</Button>}
        {canEdit && o.status === '已到场' && <Button size="small" type="primary" onClick={() => open('fix', o)}>处理完成</Button>}
        {canEdit && o.status === '待客户签字' && <Button size="small" onClick={() => open('sign', o)}>客户签字</Button>}
      </Space>
    </Card>
  )

  const c = wb?.counts

  return (
    <>
      <Card size="small" style={{ marginBottom: 10 }}>
        <Space split="|" wrap>
          <span>待受理 {c?.wait ?? 0}</span>
          <span>处理中 {c?.in_progress ?? 0}</span>
          <span>待签字 {c?.to_sign ?? 0}</span>
        </Space>
      </Card>

      {canEdit && (
        <Button type="primary" block style={{ marginBottom: 10 }} onClick={() => open('create')}>
          ＋ 报修（新建工单）
        </Button>
      )}

      {(wb?.orders.length ?? 0) === 0 && <Empty description="还没有服务工单" />}
      {wb?.orders.map(orderCard)}

      <Modal
        open={!!modal}
        title={modal?.kind === 'create' ? '报修' : modal?.kind === 'dispatch' ? '派工' : modal?.kind === 'fix' ? '处理完成' : '客户签字'}
        onCancel={() => setModal(null)}
        onOk={() => void submit()}
        confirmLoading={saving}
        okText="提交"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          {modal?.kind === 'create' && (
            <>
              <Form.Item name="project_no" label="项目号" rules={[{ required: true }]}><Input placeholder="如 TX26001" /></Form.Item>
              <Form.Item name="equip_no" label="设备号"><Input placeholder="如 01A" /></Form.Item>
              <Form.Item name="fault" label="故障描述" rules={[{ required: true, message: '必填：出了什么问题' }]}><Input.TextArea rows={2} /></Form.Item>
            </>
          )}
          {modal?.kind === 'dispatch' && (
            <Form.Item name="dispatched_to" label="派谁去修" rules={[{ required: true }]}><Input placeholder="如 李工" /></Form.Item>
          )}
          {modal?.kind === 'fix' && (
            <>
              <Form.Item name="solution" label="处理方案" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
              <Form.Item name="labor_hours" label="工时（小时）"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
              <Form.Item label="现场照片">
                <MfgPhotoPicker
                  projectNo={modal.order?.project_no ?? ''} refNo={modal.order?.so_no ?? ''} value={photos} onChange={setPhotos}
                  upload={uploadServicePhotos} photoUrl={servicePhotoUrl} label="拍照"
                />
              </Form.Item>
            </>
          )}
          {modal?.kind === 'sign' && (
            <Form.Item name="customer_sign" label="客户签字人" rules={[{ required: true }]}><Input placeholder="如 客户 王经理" /></Form.Item>
          )}
        </Form>
      </Modal>
    </>
  )
}
