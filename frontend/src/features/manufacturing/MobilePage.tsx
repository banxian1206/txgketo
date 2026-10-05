import { useMfgBoard } from '../../hooks/useMfgBoard'
import { App, Button, Form, Input, Modal, Radio, Select } from 'antd'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { useState } from 'react'

import { acceptOutsource, acceptProdOrder, dispatchProdOrder, errMsg, hasPerm, returnOutsource, sendOutsource, startProdOrder, transferProdOrder, type OutsourceRow, type ProdOrderRow } from '../../api/client'
import MfgPhotoPicker from '../../components/MfgPhotoPicker'
import { MCard, MChip, MEmpty, MHead, MStatus } from '../../components/ds/mobile'

const TEAMS = ['下料', '机加', '焊接', '钣金', '喷涂']

/** 状态色（theme/status 的预设名）→ 作业卡的语义 tone（与 PC 的 toneOf 同一套语义） */
const STATUS_TONE: Record<string, 'ok' | 'warn' | 'err' | 'run' | undefined> = {
  success: 'ok', processing: 'run', error: 'err', gold: 'warn', default: undefined,
}
const OS_TONE = STATUS_TONE

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
  const { wb, reload: load, allowed } = useMfgBoard()

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
    <MCard
      key={o.id}
      tone={o.overdue ? 'err' : STATUS_TONE[o.status]}
      head={
        <>
          <span className="ds-code" style={{ fontSize: 12 }}>{o.order_no ?? o.item_no}</span>
          <MStatus tone={o.overdue ? 'err' : STATUS_TONE[o.status]}>{o.status}</MStatus>
          {o.overdue && (
            <span style={{ marginLeft: 'auto' }}>
              <MChip tone="err">超期</MChip>
            </span>
          )}
        </>
      }
      title={o.item_name ?? o.item_no}
      lines={[
        <>
          {o.item_no} · {o.qty} {o.unit}
        </>,
        <>
          {o.project_no} · {o.equip_no ?? ''} · 计划 {o.plan_end ?? '—'}
        </>,
      ]}
    >
      <div className="m-actions">
        {canEdit && kind === 'wait' && (
          <Button block type="primary" onClick={() => open('dispatch', o)}>
            下发原材料 + 图纸（拍照）
          </Button>
        )}
        {canEdit && kind === 'running' && o.status === '已派工' && (
          <Button block onClick={() => void startProdOrder(o.id).then(() => void load())}>
            开工
          </Button>
        )}
        {canEdit && kind === 'running' && (
          <Button block type="primary" onClick={() => open('accept', o)}>
            到期验收（拍照）
          </Button>
        )}
        {canEdit && kind === 'transfer' && (
          <Button block type="primary" onClick={() => open('transfer', o)}>
            转运装配区（拍照）
          </Button>
        )}
        {canEdit && kind === 'rework' && (
          <Button block danger onClick={() => open('dispatch', o)}>
            重新下发
          </Button>
        )}
      </div>
    </MCard>
  )

  const osCard = (o: OutsourceRow) => (
    <MCard
      key={o.id}
      tone={OS_TONE[o.status]}
      head={
        <>
          <span className="ds-code" style={{ fontSize: 12 }}>{o.outsource_no ?? o.item_no}</span>
          <MStatus tone={OS_TONE[o.status]}>{o.status}</MStatus>
        </>
      }
      title={o.item_name ?? o.item_no}
      lines={[
        <>
          {o.item_no} · {o.qty} · {o.project_no} {o.equip_no ?? ''}
        </>,
        o.due_date ? <>约定回厂 {o.due_date}</> : null,
      ].filter(Boolean) as React.ReactNode[]}
    >
      <div className="m-actions">
        {canEdit && o.status === '待发出' && (
          <Button block type="primary" onClick={() => open('os-send', undefined, o)}>
            外协发出（拍照）
          </Button>
        )}
        {canEdit && o.status === '外协中' && (
          <Button block onClick={() => void returnOutsource(o.id, {}).then(() => void load())}>
            登记回厂
          </Button>
        )}
        {canEdit && o.status === '回厂待检' && (
          <Button block type="primary" onClick={() => open('os-accept', undefined, o)}>
            回厂验收（拍照）
          </Button>
        )}
      </div>
    </MCard>
  )

  const c = wb?.counts

  if (!allowed) {
    return (
      <>
        <MHead title="车间" sub="你没有车间数据的查看权限" />
        <MEmpty text="制造任务是车间 / 装配的活。如果你是从别的页面点进来的，回首页选自己的工作台即可。" />
        <div className="m-actions">
          <Button block type="primary" onClick={() => nav('/m')}>
            回手机首页
          </Button>
        </div>
      </>
    )
  }

  const SEGS = [
    { key: 'wait', label: '待下发', n: wb?.wait.length ?? 0 },
    { key: 'running', label: '在制', n: wb?.running.length ?? 0 },
    { key: 'transfer', label: '待转运', n: wb?.to_transfer.length ?? 0 },
    { key: 'rework', label: '返工', n: wb?.rework.length ?? 0 },
    { key: 'os', label: '外协', n: wb?.outsource.length ?? 0 },
  ] as const
  const activeSeg = SEGS.find((x) => x.key === tab) ?? SEGS[0]

  return (
    <>
      <MHead
        title="车间"
        sub={`待下发 ${c?.wait ?? 0} · 在制 ${c?.running ?? 0} · 待转运 ${c?.to_transfer ?? 0}${
          c?.rework ? ` · 返工 ${c.rework}` : ''
        }${c?.overdue ? ` · 超期 ${c.overdue}` : ''}`}
      />

      {/* 视图切换：一排 Segmented（原来 5 条页签，手机上横着挤不下） */}
      <div className="m-seg wrap">
        {SEGS.map((x) => (
          <button key={x.key} type="button" className={tab === x.key ? 'on' : ''} onClick={() => setTab(x.key)}>
            {x.label}
            {x.n > 0 && <span className="m-seg-n">{x.n}</span>}
          </button>
        ))}
      </div>

      {activeSeg.key === 'os'
        ? (wb?.outsource.length ?? 0) === 0
          ? <MEmpty text="没有外协任务。" />
          : wb?.outsource.map(osCard)
        : (() => {
            const list =
              activeSeg.key === 'wait' ? wb?.wait
              : activeSeg.key === 'running' ? wb?.running
              : activeSeg.key === 'transfer' ? wb?.to_transfer
              : wb?.rework
            return (list?.length ?? 0) === 0
              ? <MEmpty text={`没有${activeSeg.label}的排产单。`} />
              : list!.map((o) => orderCard(o, activeSeg.key as 'wait' | 'running' | 'transfer' | 'rework'))
          })()}

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
