import { App, Button, Card, Checkbox, DatePicker, Empty, Form, Input, InputNumber, Modal, Radio, Select, Space, Switch, Tag, Typography } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'

import {
  arriveShipment,
  createShipment,
  departShipment,
  errMsg,
  hasPerm,
  listProjects,
  listShipments,
  loadShipment,
  packShipment,
  receiptShipment,
  shipPhotoUrl,
  toShip,
  uploadShipPhotos,
  type ShipmentRow,
  type ToShipRow,
} from '../../api/client'
import MfgPhotoPicker from '../../components/MfgPhotoPicker'

const SHIP_COLOR: Record<string, string> = { 已指令: 'default', 打包中: 'processing', 已装车: 'cyan', 在途: 'gold', 已到货: 'blue', 已签收: 'success' }
type Kind = 'instruct' | 'pack' | 'load' | 'receipt'

/** 手机端 · 发运（S7）：PM 勾选要发的设备；交付/现场做装车、发运、到货、验收。 */
export default function ShippingM() {
  const { message } = App.useApp()
  const canShip = hasPerm('ship:edit')
  const canReceive = hasPerm('ship:edit') || hasPerm('site:edit')
  const [projects, setProjects] = useState<{ project_no: string; project_name: string }[]>([])
  const [projectNo, setProjectNo] = useState<string | undefined>()
  const [toShipRows, setToShipRows] = useState<ToShipRow[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [shipments, setShipments] = useState<ShipmentRow[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [modal, setModal] = useState<{ kind: Kind; ship?: ShipmentRow } | null>(null)
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(
    async (pno?: string) => {
      try {
        const [ts, list] = await Promise.all([
          pno ? toShip(pno) : Promise.resolve([]),
          listShipments(pno ? { project_no: pno } : {}),
        ])
        setToShipRows(ts)
        setShipments(list)
      } catch (e) {
        message.error(errMsg(e))
      }
    },
    [message],
  )

  useEffect(() => {
    listProjects()
      .then((rows) => setProjects(rows.map((p) => ({ project_no: p.project_no, project_name: p.project_name }))))
      .catch(() => undefined)
    void load()
  }, [load])

  const pick = (pno?: string) => {
    setProjectNo(pno)
    setSelected([])
    setExpanded(null)
    void load(pno)
  }

  const openModal = (kind: Kind, ship?: ShipmentRow) => {
    setPhotos([])
    form.resetFields()
    if (kind === 'instruct') form.setFieldsValue({ plan_ship_date: dayjs() })
    if (kind === 'pack' && ship) form.setFieldsValue({ items: [{ equip_no: ship.lines[0]?.equip_no, qty: 1, disassembled: false }] })
    if (kind === 'load' && ship) form.setFieldsValue({ vehicle: ship.vehicle, plate_no: ship.plate_no, driver: ship.driver })
    if (kind === 'receipt') form.setFieldsValue({ result: '齐', shortage: [] })
    setModal({ kind, ship })
  }

  const submit = async () => {
    if (!modal) return
    const v = await form.validateFields()
    setSaving(true)
    try {
      if (modal.kind === 'instruct') {
        if (!projectNo) return
        const r = await createShipment({ project_no: projectNo, equip_nos: selected, plan_ship_date: v.plan_ship_date?.format('YYYY-MM-DD'), remark: v.remark })
        message.success(`已下达发货指令 ${r.shipment_no}`)
        setSelected([])
      } else if (modal.kind === 'pack' && modal.ship) {
        const items = (v.items ?? []).filter((i: { part_item_no?: string }) => i.part_item_no)
        if (!items.length) { message.warning('至少填一件'); setSaving(false); return }
        await packShipment(modal.ship.id, items)
      } else if (modal.kind === 'load' && modal.ship) {
        await loadShipment(modal.ship.id, { ...v, photos })
      } else if (modal.kind === 'receipt' && modal.ship) {
        if (!photos.length) { message.warning('到货验收要拍照'); setSaving(false); return }
        await receiptShipment(modal.ship.id, { result: v.result, shortage_detail: (v.shortage ?? []).filter((s: { item?: string }) => s.item), photos, remark: v.remark })
      }
      message.success('已提交')
      setModal(null)
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Select
        showSearch
        optionFilterProp="label"
        style={{ width: '100%', marginBottom: 12 }}
        placeholder="选项目"
        value={projectNo}
        onChange={(v: string | undefined) => pick(v)}
        options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
      />

      {projectNo && (
        <Card size="small" title="待发设备（勾本次要发的）" style={{ marginBottom: 12 }}>
          {toShipRows.length === 0 && <Empty description="没有设备" />}
          {toShipRows.map((t) => (
            <div key={t.equip_no} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0', opacity: t.in_open_shipment ? 0.5 : 1 }}>
              <Checkbox
                disabled={t.in_open_shipment}
                checked={selected.includes(t.equip_no)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, t.equip_no] : s.filter((x) => x !== t.equip_no)))}
              >
                <b>{t.equip_no}</b> {t.equip_name}{' '}
                <Tag color={t.ready ? 'success' : 'default'}>{t.assembly_status ?? '未装配'}</Tag>
                <Tag>{Math.round(t.kitting_rate * 100)}%</Tag>
                {t.in_open_shipment && <Tag color="orange">已在批次</Tag>}
              </Checkbox>
            </div>
          ))}
          <Button type="primary" block style={{ marginTop: 10 }} disabled={!canShip || selected.length === 0} onClick={() => openModal('instruct')}>
            下达发货指令（{selected.length} 台）
          </Button>
        </Card>
      )}

      {projectNo && <Typography.Title level={5}>发运批次</Typography.Title>}
      {projectNo && shipments.length === 0 && <Empty description="还没有发货指令" />}
      {projectNo &&
        shipments.map((s) => (
          <Card key={s.id} size="small" style={{ marginBottom: 10 }} title={`${s.shipment_no} · ${s.lines.map((l) => l.equip_no).join('、')}`} extra={<Tag color={SHIP_COLOR[s.status] ?? 'default'}>{s.status}</Tag>}>
            <div style={{ fontSize: 12, color: '#999' }}>
              {s.plate_no ?? ''} {s.driver ?? ''} · 装箱 {s.packing.length} 件
            </div>
            <Space wrap style={{ marginTop: 8 }}>
              {canShip && ['已指令', '打包中'].includes(s.status) && <Button size="small" onClick={() => openModal('pack', s)}>装箱</Button>}
              {canShip && ['已指令', '打包中', '已装车'].includes(s.status) && <Button size="small" onClick={() => openModal('load', s)}>装车</Button>}
              {canShip && ['已装车', '打包中'].includes(s.status) && <Button size="small" type="primary" onClick={() => void departShipment(s.id, {}).then(() => { message.success('已发运'); return load(projectNo) }).catch((e) => message.error(errMsg(e)))}>发运</Button>}
              {canShip && s.status === '在途' && <Button size="small" onClick={() => void arriveShipment(s.id).then(() => { message.success('已到货'); return load(projectNo) }).catch((e) => message.error(errMsg(e)))}>登记到货</Button>}
              {canReceive && ['在途', '已到货'].includes(s.status) && <Button size="small" type="primary" onClick={() => openModal('receipt', s)}>现场验收</Button>}
              <a onClick={() => setExpanded(expanded === s.id ? null : s.id)}>{expanded === s.id ? '收起清单' : '看清单'}</a>
            </Space>
            {expanded === s.id && (
              <div style={{ marginTop: 8 }}>
                {s.packing.map((p) => (
                  <div key={p.id} style={{ fontSize: 12, padding: '3px 0', borderBottom: '1px solid #f0f0f0' }}>
                    {p.equip_no ?? ''} {p.part_item_no} ×{p.qty} {p.package_no ? `· ${p.package_no}` : ''} {p.disassembled ? '· 拆解' : ''}
                  </div>
                ))}
                {s.receipts.map((r) => (
                  <div key={r.id} style={{ fontSize: 12, marginTop: 6 }}>
                    到货验收：<Tag color={r.result === '齐' ? 'success' : 'error'}>{r.result}</Tag>
                    {r.shortage_detail.map((sd, i) => (
                      <div key={i} style={{ color: '#cf1322' }}>{sd.item} ×{sd.qty} {sd.reason}</div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}

      <Modal
        open={!!modal}
        title={
          modal?.kind === 'instruct' ? `下达发货指令（${selected.join('、')}）`
            : modal?.kind === 'pack' ? '装箱清单'
              : modal?.kind === 'load' ? '装车' : '现场到货验收'
        }
        onCancel={() => setModal(null)}
        onOk={() => void submit()}
        confirmLoading={saving}
        okText="提交"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          {modal?.kind === 'instruct' && (
            <>
              <Form.Item name="plan_ship_date" label="计划发货日期"><DatePicker style={{ width: '100%' }} /></Form.Item>
              <Form.Item name="remark" label="备注"><Input placeholder="如 本次只发 01A" /></Form.Item>
            </>
          )}

          {modal?.kind === 'pack' && (
            <Form.List name="items">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((f) => (
                    <Card key={f.key} size="small" style={{ marginBottom: 8 }}>
                      <Form.Item name={[f.name, 'equip_no']} label="设备" style={{ marginBottom: 6 }}>
                        <Select style={{ width: '100%' }} options={(modal.ship?.lines ?? []).map((l) => ({ value: l.equip_no, label: l.equip_no }))} />
                      </Form.Item>
                      <Form.Item name={[f.name, 'part_item_no']} label="零件/物料号" style={{ marginBottom: 6 }}><Input /></Form.Item>
                      <Form.Item name={[f.name, 'part_name']} label="名称" style={{ marginBottom: 6 }}><Input /></Form.Item>
                      <Space>
                        <Form.Item name={[f.name, 'qty']} label="数量" style={{ marginBottom: 6 }}><InputNumber min={0} style={{ width: 90 }} /></Form.Item>
                        <Form.Item name={[f.name, 'package_no']} label="箱号" style={{ marginBottom: 6 }}><Input style={{ width: 90 }} /></Form.Item>
                        <Form.Item name={[f.name, 'weight']} label="kg" style={{ marginBottom: 6 }}><InputNumber min={0} style={{ width: 90 }} /></Form.Item>
                        <Form.Item name={[f.name, 'disassembled']} label="拆解" valuePropName="checked" style={{ marginBottom: 6 }}><Switch /></Form.Item>
                      </Space>
                      <a onClick={() => remove(f.name)}><MinusCircleOutlined /> 删掉这件</a>
                    </Card>
                  ))}
                  <Button type="dashed" block onClick={() => add({ qty: 1, disassembled: false })} icon={<PlusOutlined />}>再加一件</Button>
                </>
              )}
            </Form.List>
          )}

          {modal?.kind === 'load' && (
            <>
              <Form.Item name="vehicle" label="车辆"><Input placeholder="如 17.5 米平板" /></Form.Item>
              <Form.Item name="plate_no" label="车牌"><Input /></Form.Item>
              <Form.Item name="driver" label="司机 / 电话"><Input /></Form.Item>
              <Form.Item label="装车照片（必须）" required>
                <MfgPhotoPicker projectNo={modal.ship?.project_no ?? ''} refNo={modal.ship?.shipment_no ?? ''} value={photos} onChange={setPhotos} upload={uploadShipPhotos} photoUrl={shipPhotoUrl} label="拍照" />
              </Form.Item>
            </>
          )}

          {modal?.kind === 'receipt' && (
            <>
              <Form.Item name="result" label="到货验收结论" rules={[{ required: true }]}>
                <Radio.Group optionType="button" buttonStyle="solid">
                  <Radio.Button value="齐">齐</Radio.Button>
                  <Radio.Button value="缺件">缺件</Radio.Button>
                  <Radio.Button value="破损">破损</Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Form.List name="shortage">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map((f) => (
                      <Space key={f.key} wrap style={{ marginBottom: 6 }}>
                        <Form.Item name={[f.name, 'item']} style={{ marginBottom: 0 }}><Input placeholder="缺/损零件" style={{ width: 140 }} /></Form.Item>
                        <Form.Item name={[f.name, 'qty']} style={{ marginBottom: 0 }}><InputNumber placeholder="数量" min={0} style={{ width: 80 }} /></Form.Item>
                        <Form.Item name={[f.name, 'reason']} style={{ marginBottom: 0 }}><Input placeholder="原因" style={{ width: 130 }} /></Form.Item>
                        <MinusCircleOutlined onClick={() => remove(f.name)} />
                      </Space>
                    ))}
                    <Button type="dashed" block onClick={() => add()} icon={<PlusOutlined />}>加一条缺件</Button>
                  </>
                )}
              </Form.List>
              <Form.Item name="remark" label="备注" style={{ marginTop: 8 }}><Input /></Form.Item>
              <Form.Item label="到货照片（必须）" required>
                <MfgPhotoPicker projectNo={modal.ship?.project_no ?? ''} refNo={modal.ship?.shipment_no ?? ''} value={photos} onChange={setPhotos} upload={uploadShipPhotos} photoUrl={shipPhotoUrl} label="拍照" />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </>
  )
}
