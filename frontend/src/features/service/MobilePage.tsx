import { useSvcBoard } from '../../hooks/useSvcBoard'
import { App, Button, Form, Input, InputNumber, Modal, Select } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { arriveServiceOrder, createServiceOrder, dispatchServiceOrder, errMsg, fixServiceOrder, hasPerm, servicePhotoUrl, signServiceOrder, uploadServicePhotos, type ServiceOrderRow } from '../../api/client'
import MfgPhotoPicker from '../../components/MfgPhotoPicker'
import { MCard, MChip, MEmpty, MHead, MStatus } from '../../components/ds/mobile'
import { listEquipment } from '../../api/initiate'
import { listProjects } from '../../api/project'

/** 售后状态 → 作业卡 tone（与 PC 同一套语义） */
const SO_TONE: Record<string, 'ok' | 'warn' | 'err' | 'run' | undefined> = {
  待受理: 'err', 已派工: 'run', 已到场: 'warn', 待客户签字: 'warn', 已关闭: 'ok',
}

/** 售后手机端（S11）：报修 / 派工 / 到场 / 处理完成（拍照）。 */
export default function ServiceM() {
  const { message } = App.useApp()
  const canEdit = hasPerm('service:edit')
  const [modal, setModal] = useState<{ kind: 'create' | 'dispatch' | 'fix' | 'sign'; order?: ServiceOrderRow } | null>(null)
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  // ★ 报修的项目/设备改成选，不让人手打（P2-10）：选错设备 → 工单挂错机器，售后白跑一趟
  const [projOpts, setProjOpts] = useState<{ value: string; label: string }[]>([])
  const [equipOpts, setEquipOpts] = useState<{ value: string; label: string }[]>([])
  const [pickProject, setPickProject] = useState<string | undefined>()
  const loadProjects = useCallback(() => {
    listProjects()
      .then((rows) => setProjOpts(rows.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))))
      .catch(() => setProjOpts([]))
  }, [])
  useEffect(() => { loadProjects() }, [loadProjects])

  // 重构 2.3：看板数据走共享 hook（与另一端同源）
  const { wb, reload: load } = useSvcBoard()

  const open = (kind: 'create' | 'dispatch' | 'fix' | 'sign', order?: ServiceOrderRow) => {
    setPhotos([])
    form.resetFields()
    setModal({ kind, order })
  }

  const submit = async () => {
    if (!modal) return
    let v
    try { v = await form.validateFields() } catch { return }
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
    <MCard
      key={o.id}
      tone={SO_TONE[o.status]}
      head={
        <>
          <span className="ds-code" style={{ fontSize: 12 }}>{o.so_no}</span>
          <MStatus tone={SO_TONE[o.status]}>{o.status}</MStatus>
          <span style={{ marginLeft: 'auto' }}>
            {/* 在保/过保是售后第一眼要看的（决定要不要收费）—— 单独一个中性徽标 */}
            <MChip tone={o.in_warranty ? 'ok' : 'warn'}>{o.in_warranty ? '在保' : '过保'}</MChip>
          </span>
        </>
      }
      title={o.fault ?? o.so_no}
      lines={[
        <>
          {o.project_no}
          {o.equip_no ? ` · ${o.equip_no}` : ''} · {o.dispatched_to ?? '未派工'}
        </>,
        ...(o.solution
          ? [<span key="s" style={{ color: 'var(--ds-ok)' }}>{o.solution}</span>]
          : []),
      ]}
    >
      <div className="m-actions">
        {canEdit && o.status === '待受理' && (
          <Button block type="primary" onClick={() => open('dispatch', o)}>
            派工（派谁去修）
          </Button>
        )}
        {canEdit && o.status === '已派工' && (
          <Button
            block
            onClick={() => void arriveServiceOrder(o.id).then(() => void load()).catch((e) => message.error(errMsg(e)))}
          >
            到场
          </Button>
        )}
        {canEdit && o.status === '已到场' && (
          <Button block type="primary" onClick={() => open('fix', o)}>
            处理完成（拍照）
          </Button>
        )}
        {canEdit && o.status === '待客户签字' && (
          <Button block onClick={() => open('sign', o)}>
            客户签字
          </Button>
        )}
      </div>
    </MCard>
  )

  const c = wb?.counts

  return (
    <>
      <MHead
        title="售后"
        sub={
          (wb?.orders.length ?? 0) > 0
            ? `待受理 ${c?.wait ?? 0} · 处理中 ${c?.in_progress ?? 0} · 待签字 ${c?.to_sign ?? 0}`
            : '没有在办的服务工单'
        }
      />

      {canEdit && (
        <div className="m-actions" style={{ marginTop: 0, marginBottom: 12 }}>
          <Button block type="primary" onClick={() => open('create')}>
            ＋ 报修（新建工单）
          </Button>
        </div>
      )}

      {(wb?.orders.length ?? 0) === 0 && (
        <MEmpty text="还没有服务工单。客户报修时在这里建一张：项目 → 设备 → 故障描述，系统自动判定在保 / 过保。" />
      )}
      {wb?.orders.map(orderCard)}

      <Modal
        className="engineering-modal"
        open={!!modal}
        title={modal?.kind === 'create' ? '报修' : modal?.kind === 'dispatch' ? '派工' : modal?.kind === 'fix' ? '处理完成' : '客户签字'}
        onCancel={() => setModal(null)}
        onOk={() => void submit()}
        confirmLoading={saving}
        okText="提交"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          {modal?.kind === 'create' && (
            <>
              <Form.Item name="project_no" label="项目" rules={[{ required: true, message: '选项目' }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="选项目"
                  options={projOpts}
                  onChange={(v: string) => {
                    setPickProject(v)
                    setEquipOpts([])
                    form.setFieldValue('equip_no', undefined)
                    if (v) listEquipment(v).then((rows) => setEquipOpts(rows.map((e) => ({ value: e.equip_no, label: `${e.equip_no} ${e.equip_name}` })))).catch(() => setEquipOpts([]))
                  }}
                />
              </Form.Item>
              <Form.Item name="equip_no" label="设备">
                <Select allowClear placeholder={pickProject ? '选设备（可不选）' : '先选项目'} options={equipOpts} />
              </Form.Item>
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
