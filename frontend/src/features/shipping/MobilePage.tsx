import { useShipBoard } from '../../hooks/useShipBoard'
import { App, Button, Card, Checkbox, Empty, Form, Input, Modal, Select, Space, Tag, Typography } from 'antd'
import {useEffect, useState} from 'react'

import {
  arriveShipment,
  createShipment,
  departShipment,
  errMsg,
  hasPerm,
  listProjects,
  loadShipment,
  receiptShipment,
  shipPhotoUrl,
  uploadShipPhotos,
  type ShipmentRow,
} from '../../api/client'
import AuthedImage from '../../components/AuthedImage'
import MfgPhotoPicker from '../../components/MfgPhotoPicker'
import { SHIP_STATUS as SHIP_COLOR } from '../../theme/status'
import { T } from '../../theme/tokens'

/** 手机端 · 发运（S7）：散件发运，逐项勾「已发」+ 拍照；现场按清单清点。 */
export default function ShippingM() {
  const { message } = App.useApp()
  const canShip = hasPerm('ship:edit')
  const canReceive = hasPerm('ship:edit') || hasPerm('site:edit')
  const [projects, setProjects] = useState<{ project_no: string; project_name: string }[]>([])
  const [projectNo, setProjectNo] = useState<string | undefined>()
  const [selected, setSelected] = useState<string[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [loadTarget, setLoadTarget] = useState<ShipmentRow | null>(null)
  const [loadPhotos, setLoadPhotos] = useState<string[]>([])
  const [receiptTarget, setReceiptTarget] = useState<ShipmentRow | null>(null)
  const [receiptChecks, setReceiptChecks] = useState<Record<number, { result: string; reason?: string; received_qty?: number }>>({})
  const [receiptPhotos, setReceiptPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  // 重构 2.3：看板数据走共享 hook（与另一端同源）
  const { toShipRows, shipments, reload: load } = useShipBoard()

  useEffect(() => {
    listProjects()
      .then((rows) => setProjects(rows.map((p) => ({ project_no: p.project_no, project_name: p.project_name }))))
      .catch(() => undefined)
  }, [])

  const doInstruct = async () => {
    if (!projectNo || selected.length === 0) return
    try {
      const r = await createShipment({ project_no: projectNo, equip_nos: selected })
      message.success(`已下达发货指令 ${r.shipment_no}，请勾选发运项`)
      setSelected([])
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const doDepart = async (s: ShipmentRow) => {
    try {
      await departShipment(s.id, {})
      message.success('已发运（在途）')
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const doArrive = async (s: ShipmentRow) => {
    try {
      await arriveShipment(s.id)
      message.success('已登记到货')
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const doReceipt = async () => {
    if (!receiptTarget) return
    if (!receiptPhotos.length) { message.warning('现场清点要拍照'); return }
    // ★ 发货与收货一致：只清点本批已勾「已发」的项
    const shipped = receiptTarget.items.filter((i) => i.shipped)
    if (!shipped.length) { message.warning('本批没有勾「已发」的项——先勾选实际发出的件再发运/清点'); return }
    const checks = shipped.map((it) => {
      const st = receiptChecks[it.id] ?? { result: '到' }
      return { item_id: it.id, result: st.result || '到', received_qty: st.received_qty, reason: st.reason }
    })
    const bad = checks.find((ck) => ck.result !== '到' && !(ck.reason ?? '').trim())
    if (bad) { message.warning('缺/损的项必须写原因'); return }
    setSaving(true)
    try {
      await receiptShipment(receiptTarget.id, { checks, photos: receiptPhotos })
      message.success('现场清点完成')
      setReceiptTarget(null)
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
        showSearch optionFilterProp="label" style={{ width: '100%', marginBottom: 12 }} placeholder="选项目"
        value={projectNo} onChange={(v: string | undefined) => { setProjectNo(v); setSelected([]); void load(v) }}
        options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
      />

      {projectNo && (
        <Card size="small" title="待发设备（勾本次要发的）" style={{ marginBottom: 10 }}>
          {toShipRows.length === 0 && <Empty description="没有设备" />}
          {toShipRows.map((t) => (
            <div key={t.equip_no} style={{ padding: '6px 0', borderBottom: `1px solid ${T.border}`, opacity: t.in_open_shipment ? 0.5 : 1 }}>
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
          <Button type="primary" block style={{ marginTop: 10 }} disabled={!canShip || selected.length === 0} onClick={() => void doInstruct()}>
            下达发货指令（{selected.length} 台）
          </Button>
        </Card>
      )}

      {projectNo && <Typography.Title level={5}>发运批次</Typography.Title>}
      {projectNo && shipments.length === 0 && <Empty description="还没有发货指令" />}
      {projectNo &&
        shipments.map((s) => {
          const done = s.items.filter((i) => i.shipped).length
          return (
            <Card key={s.id} size="small" style={{ marginBottom: 10 }} title={`${s.shipment_no} · ${s.lines.map((l) => l.equip_no).join('、')}`} extra={<Tag color={SHIP_COLOR[s.status] ?? 'default'}>{s.status}</Tag>}>
              <div style={{ fontSize: 12, color: T.textSecondary }}>
                {s.plate_no ?? ''} {s.driver ?? ''} · 已发 {done}/{s.items.length} 项
              </div>
              <Space wrap style={{ marginTop: 8 }}>
                {canShip && ['已指令', '发货中'].includes(s.status) && <Button size="small" type="primary" onClick={() => void doDepart(s)}>发运</Button>}
                {canShip && ['已指令', '发货中', '已装车'].includes(s.status) && <Button size="small" onClick={() => { setLoadPhotos([]); setLoadTarget(s) }}>装车</Button>}
                {canShip && s.status === '在途' && <Button size="small" onClick={() => void doArrive(s)}>登记到货</Button>}
                {canReceive && ['已到货', '在途'].includes(s.status) &&
                  (s.items.some((i) => i.shipped) ? (
                    <Button size="small" type="primary" onClick={() => { setReceiptChecks({}); setReceiptPhotos([]); setReceiptTarget(s) }}>现场清点</Button>
                  ) : (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>未勾「已发」，不能清点</Typography.Text>
                  ))}
                <a onClick={() => setExpanded(expanded === s.id ? null : s.id)}>{expanded === s.id ? '收起清单' : '看清单'}</a>
              </Space>
              {expanded === s.id && (
                <div style={{ marginTop: 8 }}>
                  {s.items.map((it) => (
                    <div key={it.id} style={{ fontSize: 12, padding: '3px 0', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{it.equip_no} {it.ref} ×{it.qty}</span>
                      {it.shipped ? <Tag color="success">已发</Tag> : <Tag>未发</Tag>}
                    </div>
                  ))}
                  {s.receipts.map((r) => (
                    <div key={r.id} style={{ fontSize: 12, marginTop: 6 }}>
                      清点：<Tag color={r.result === '齐' ? 'success' : 'error'}>{r.result}</Tag>
                      {r.shortage_detail.map((sd, i) => (
                        <div key={i} style={{ color: T.error }}>{sd.item}：{sd.result}（实到 {sd.received_qty ?? '—'}）{sd.reason}</div>
                      ))}
                    </div>
                  ))}
                  <Space wrap style={{ marginTop: 6 }}>
                    {[...s.photos, ...s.receipts.flatMap((r) => r.photos)].map((p) => (
                      <AuthedImage key={p} path={shipPhotoUrl(p)} size={48} />
                    ))}
                  </Space>
                </div>
              )}
            </Card>
          )
        })}

      {/* 装车 */}
      <Modal open={!!loadTarget} title={`装车 · ${loadTarget?.shipment_no ?? ''}`} onCancel={() => setLoadTarget(null)} onOk={() => {
        if (!loadTarget) return
        if (!loadPhotos.length) { message.warning('装车要拍照'); return }
        setSaving(true)
        loadShipment(loadTarget.id, { photos: loadPhotos })
          .then(() => { message.success('已装车'); setLoadTarget(null); return load(projectNo) })
          .catch((e) => message.error(errMsg(e)))
          .finally(() => setSaving(false))
      }} confirmLoading={saving} okText="确认装车" destroyOnHidden>
        <Form layout="vertical">
          <Form.Item label="装车照片（必须）" required>
            <MfgPhotoPicker projectNo={loadTarget?.project_no ?? ''} refNo={loadTarget?.shipment_no ?? ''} value={loadPhotos} onChange={setLoadPhotos} upload={uploadShipPhotos} photoUrl={shipPhotoUrl} label="拍照" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 现场清点 */}
      <Modal
        open={!!receiptTarget}
        title={`现场清点 · ${receiptTarget?.shipment_no ?? ''}`}
        onCancel={() => setReceiptTarget(null)}
        onOk={() => void doReceipt()}
        confirmLoading={saving}
        okText="提交清点"
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          本批只清点**已勾「已发」**的 {receiptTarget?.items.filter((i) => i.shipped).length ?? 0} 项；
          未勾发的 {receiptTarget?.items.filter((i) => !i.shipped).length ?? 0} 项不在本次交付内（发货与收货一致）。
        </Typography.Paragraph>
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {(receiptTarget?.items ?? []).filter((i) => i.shipped).map((it) => {
            const st = receiptChecks[it.id] ?? { result: '到' }
            return (
              <div key={it.id} style={{ padding: '6px 0', borderBottom: `1px solid ${T.border}` }}>
                <Space wrap>
                  <Typography.Text>{it.ref}</Typography.Text>
                  <Select
                    size="small" style={{ width: 90 }} value={st.result}
                    onChange={(v: string) => setReceiptChecks((m) => ({ ...m, [it.id]: { ...st, result: v } }))}
                    options={[{ value: '到', label: '到' }, { value: '缺', label: '缺' }, { value: '损', label: '损' }]}
                  />
                  {st.result !== '到' && (
                    <Input size="small" style={{ width: 150 }} placeholder="原因" value={st.reason}
                      onChange={(e) => setReceiptChecks((m) => ({ ...m, [it.id]: { ...st, reason: e.target.value } }))} />
                  )}
                </Space>
              </div>
            )
          })}
        </div>
        <Form layout="vertical" style={{ marginTop: 10 }}>
          <Form.Item label="清点照片（必须）" required>
            <MfgPhotoPicker projectNo={receiptTarget?.project_no ?? ''} refNo={receiptTarget?.shipment_no ?? ''} value={receiptPhotos} onChange={setReceiptPhotos} upload={uploadShipPhotos} photoUrl={shipPhotoUrl} label="拍照" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
