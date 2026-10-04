import { useMfgBoard } from '../../hooks/useMfgBoard'
import { App, Button, Card, Empty, Form, Input, Modal, Radio, Select, Space, Tabs, Tag, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {useState} from 'react'

import {
  acceptOutsource,
  acceptProdOrder,
  dispatchProdOrder,
  errMsg,
  hasPerm,
  returnOutsource,
  sendOutsource,
  startProdOrder,
  transferProdOrder,
  type OutsourceRow,
  type ProdOrderRow,
} from '../../api/client'
import MfgPhotoPicker from '../../components/MfgPhotoPicker'
import { PROD_STATUS as STATUS_COLOR } from '../../theme/status'
import { OUTSOURCE_STATUS as OS_COLOR } from '../../theme/status'
import { T } from '../../theme/tokens'

const TEAMS = ['下料', '机加', '焊接', '钣金', '喷涂']

type Kind = 'dispatch' | 'accept' | 'transfer' | 'os-send' | 'os-accept'

/** 车间手机端（S5）：领料员/系统专员批量操作 —— 下发（拍照）→ 验收（拍照）→ 转运（拍照）。 */
export default function ProductionM() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const canEdit = hasPerm('mfg:edit')
  const [tab, setTab] = useState('wait')
  const [action, setAction] = useState<{ kind: Kind; order?: ProdOrderRow; os?: OutsourceRow } | null>(null)
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  // 重构 2.3：看板数据走共享 hook（与另一端同源）
  // ★ F17：hook 内部已按 mfg:view 短路（不发请求不吃 403），这里把“为什么是空的”说清楚
  const { wb, loading, reload: load, allowed } = useMfgBoard()

  const open = (kind: Kind, order?: ProdOrderRow, os?: OutsourceRow) => {
    setPhotos([])
    form.resetFields()
    if (kind === 'dispatch') form.setFieldsValue({ step_name: '下料', material_item_no: order?.material_item_no })
    if (kind === 'accept') form.setFieldsValue({ result: '合格' })
    if (kind === 'transfer') form.setFieldsValue({ transfer_to: '装配区' })
    if (kind === 'os-send') form.setFieldsValue({ material_supplied: true })
    if (kind === 'os-accept') form.setFieldsValue({ result: '合格' })
    setAction({ kind, order, os })
  }

  const submit = async () => {
    if (!action) return
    let v
    try { v = await form.validateFields() } catch { return }
    if (photos.length === 0) {
      message.warning('要拍照留痕')
      return
    }
    setSaving(true)
    try {
      if (action.kind === 'dispatch' && action.order)
        await dispatchProdOrder(action.order.id, { step_name: v.step_name, material_item_no: v.material_item_no || undefined, issued_to: v.issued_to || undefined, photos })
      else if (action.kind === 'accept' && action.order) {
        if (v.result !== '合格' && !(v.reason || '').trim()) {
          message.warning('不合格/返工必须写明原因')
          setSaving(false)
          return
        }
        await acceptProdOrder(action.order.id, { result: v.result, reason: v.reason, photos })
      }
      else if (action.kind === 'transfer' && action.order)
        await transferProdOrder(action.order.id, { transfer_to: v.transfer_to, photos })
      else if (action.kind === 'os-send' && action.os)
        await sendOutsource(action.os.id, { supplier_name: v.supplier_name || undefined, due_date: v.due_date ? dayjs(v.due_date).format('YYYY-MM-DD') : undefined, photos })
      else if (action.kind === 'os-accept' && action.os)
        await acceptOutsource(action.os.id, { result: v.result, reason: v.reason, photos })
      message.success('已提交')
      setAction(null)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const orderCard = (o: ProdOrderRow, kind: 'wait' | 'running' | 'transfer' | 'rework') => (
    <Card key={o.id} size="small" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography.Text strong>{o.item_no}</Typography.Text>
        <Tag color={STATUS_COLOR[o.status] ?? 'default'}>{o.status}</Tag>
      </div>
      <div style={{ fontSize: 13, color: T.textStrong, marginTop: 4 }}>
        {o.item_name ?? ''} · {o.qty} {o.unit}
      </div>
      <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>
        {o.project_no} · {o.equip_no ?? ''} · 计划 {o.plan_end ?? '—'} {o.overdue ? '（超期）' : ''}
      </div>
      <Space wrap style={{ marginTop: 10 }}>
        {canEdit && kind === 'wait' && <Button size="small" type="primary" onClick={() => open('dispatch', o)}>下发原材料+图纸</Button>}
        {canEdit && kind === 'running' && o.status === '已派工' && <Button size="small" onClick={() => void startProdOrder(o.id).then(() => void load())}>开工</Button>}
        {canEdit && kind === 'running' && <Button size="small" type="primary" onClick={() => open('accept', o)}>到期验收</Button>}
        {canEdit && kind === 'transfer' && <Button size="small" type="primary" onClick={() => open('transfer', o)}>转运装配区</Button>}
        {canEdit && kind === 'rework' && <Button size="small" danger onClick={() => open('dispatch', o)}>重新下发</Button>}
      </Space>
    </Card>
  )

  const osCard = (o: OutsourceRow) => (
    <Card key={o.id} size="small" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography.Text strong>{o.item_no}</Typography.Text>
        <Tag color={OS_COLOR[o.status] ?? 'default'}>{o.status}</Tag>
      </div>
      <div style={{ fontSize: 13, color: T.textStrong, marginTop: 4 }}>
        {o.item_name ?? ''} · {o.qty} · {o.project_no} {o.equip_no ?? ''}
      </div>
      <Space wrap style={{ marginTop: 10 }}>
        {canEdit && o.status === '待发出' && <Button size="small" type="primary" onClick={() => open('os-send', undefined, o)}>发出</Button>}
        {canEdit && o.status === '外协中' && (
          <Button size="small" onClick={() => void returnOutsource(o.id, {}).then(() => void load())}>登记回厂</Button>
        )}
        {canEdit && o.status === '回厂待检' && <Button size="small" type="primary" onClick={() => open('os-accept', undefined, o)}>验收</Button>}
      </Space>
    </Card>
  )

  const c = wb?.counts

  if (!allowed) {
    return (
      <Empty
        description={
          <Space direction="vertical">
            <Typography.Text>你没有车间数据的查看权限（mfg:view）</Typography.Text>
            <Typography.Text type="secondary" className="hint-inline">
              制造任务是车间/装配的活。如果你是从别的页面点进来的，回首页选自己的工作台即可。
            </Typography.Text>
          </Space>
        }
      >
        <Button onClick={() => nav('/m')}>回手机首页</Button>
      </Empty>
    )
  }

  return (
    <>
      <Card size="small" style={{ marginBottom: 10 }}>
        <Space split="|" wrap>
          <span>待下发 {c?.wait ?? 0}</span>
          <span>在制 {c?.running ?? 0}</span>
          <span>待转运 {c?.to_transfer ?? 0}</span>
          <span style={{ color: c?.rework ? T.error : undefined }}>返工 {c?.rework ?? 0}</span>
          <span style={{ color: c?.overdue ? T.error : undefined }}>超期 {c?.overdue ?? 0}</span>
        </Space>
      </Card>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'wait', label: `待下发 ${wb?.wait.length ?? 0}`, children: <div>{loading ? null : (wb?.wait.length ?? 0) === 0 ? <Empty description="没有待下发" /> : wb?.wait.map((o) => orderCard(o, 'wait'))}</div> },
          { key: 'running', label: `在制 ${wb?.running.length ?? 0}`, children: <div>{(wb?.running.length ?? 0) === 0 ? <Empty description="没有在制" /> : wb?.running.map((o) => orderCard(o, 'running'))}</div> },
          { key: 'transfer', label: `待转运 ${wb?.to_transfer.length ?? 0}`, children: <div>{(wb?.to_transfer.length ?? 0) === 0 ? <Empty description="没有待转运" /> : wb?.to_transfer.map((o) => orderCard(o, 'transfer'))}</div> },
          { key: 'rework', label: `返工 ${wb?.rework.length ?? 0}`, children: <div>{(wb?.rework.length ?? 0) === 0 ? <Empty description="没有返工" /> : wb?.rework.map((o) => orderCard(o, 'rework'))}</div> },
          { key: 'os', label: `外协 ${wb?.outsource.length ?? 0}`, children: <div>{(wb?.outsource.length ?? 0) === 0 ? <Empty description="没有外协" /> : wb?.outsource.map(osCard)}</div> },
        ]}
      />

      <Modal
        open={!!action}
        title={
          action?.kind === 'dispatch' ? '下发原材料 + 图纸'
            : action?.kind === 'accept' ? '到期验收'
              : action?.kind === 'transfer' ? '转运装配区'
                : action?.kind === 'os-send' ? '外协发出' : '外协验收'
        }
        onCancel={() => setAction(null)}
        onOk={() => void submit()}
        confirmLoading={saving}
        okText="提交"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          {action?.kind === 'dispatch' && (
            <>
              <Form.Item name="step_name" label="第一道工序" rules={[{ required: true }]}>
                <Select options={TEAMS.map((t) => ({ value: t, label: t }))} />
              </Form.Item>
              <Form.Item name="material_item_no" label="原材料（型号级）">
                <Input placeholder="如 YL-FT-0001" />
              </Form.Item>
              <Form.Item name="issued_to" label="交到（班组）">
                <Input placeholder="如 下料班" />
              </Form.Item>
            </>
          )}
          {(action?.kind === 'accept' || action?.kind === 'os-accept') && (
            <>
              <Form.Item name="result" label="验收结论" rules={[{ required: true }]}>
                <Radio.Group optionType="button" buttonStyle="solid">
                  <Radio.Button value="合格">合格</Radio.Button>
                  <Radio.Button value="不合格">{action?.kind === 'accept' ? '不合格' : '不合格'}</Radio.Button>
                  {action?.kind === 'accept' && <Radio.Button value="返工">返工</Radio.Button>}
                </Radio.Group>
              </Form.Item>
              <Form.Item name="reason" label="原因 / 说明">
                <Input.TextArea rows={2} />
              </Form.Item>
            </>
          )}
          {action?.kind === 'transfer' && (
            <Form.Item name="transfer_to" label="转运到" rules={[{ required: true }]}>
              <Select options={['装配区', '半成品区', '待发区'].map((t) => ({ value: t, label: t }))} />
            </Form.Item>
          )}
          {action?.kind === 'os-send' && (
            <>
              <Form.Item name="supplier_name" label="外协供应商">
                <Input />
              </Form.Item>
              <Form.Item name="material_supplied" label="供料方式">
                <Radio.Group>
                  <Radio value={true}>我方供料</Radio>
                  <Radio value={false}>外协供料</Radio>
                </Radio.Group>
              </Form.Item>
            </>
          )}
          {action && (
            <Form.Item label="拍照（必须）" required>
              <MfgPhotoPicker
                projectNo={action.order?.project_no ?? action.os?.project_no ?? ''}
                refNo={action.order?.order_no ?? action.os?.outsource_no ?? ''}
                value={photos}
                onChange={setPhotos}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  )
}
