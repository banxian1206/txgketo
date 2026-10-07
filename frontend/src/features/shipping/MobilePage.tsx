import { useShipBoard } from '../../hooks/useShipBoard'
import { App, Button, Checkbox, DatePicker, Form, Input, Modal, Select, Space, Typography } from 'antd'
import { useEffect, useState } from 'react'

import { arriveShipment, createShipment, departShipment, errMsg, generateShipItems, hasPerm, listProjects, loadShipment, markShipItems, receiptShipment, shipPhotoUrl, uploadShipPhotos, type ShipmentRow } from '../../api/client'
import { MCard, MCheckRow, MChip, MEmpty, MStatus } from '../../components/ds/mobile'
import AuthedImage from '../../components/AuthedImage'
import { Muted } from '../../components/ui/Primitives'
import MfgPhotoPicker from '../../components/MfgPhotoPicker'
import { T } from '../../theme/tokens'

/** 发运状态 → 作业卡 tone（与 PC 同一套语义） */
const SHIP_TONE: Record<string, 'ok' | 'warn' | 'err' | 'run' | undefined> = {
  已指令: 'run', 发货中: 'run', 已装车: 'warn', 在途: 'run', 已到货: 'warn', 已签收: 'ok',
}

/** 动线步骤标（手机上明确"现在这步干什么"） */
function MStep({ n, text }: { n: number; text: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          width: 20, height: 20, borderRadius: 999, background: 'var(--ds-acc)',
          color: 'var(--ds-surface)', fontSize: 12, fontWeight: 600, display: 'inline-grid', placeItems: 'center',
        }}
      >
        {n}
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{text}</span>
    </span>
  )
}

/** 手机端 · 发运（S7）：散件发运，逐项勾「已发」+ 拍照；现场按清单清点。 */
export default function ShippingM() {
  const { message } = App.useApp()
  const canShip = hasPerm('ship:edit')
  const canReceive = hasPerm('ship:edit') || hasPerm('site:edit')
  const [projects, setProjects] = useState<{ project_no: string; project_name: string }[]>([])
  const [projectNo, setProjectNo] = useState<string | undefined>()
  const [selected, setSelected] = useState<string[]>([])
  // ★ §2.2：手机上也要定发货日（采购按这天叫车）
  const [instructOpen, setInstructOpen] = useState(false)
  const [instructForm] = Form.useForm()
  const [expanded, setExpanded] = useState<number | null>(null)
  const [loadTarget, setLoadTarget] = useState<ShipmentRow | null>(null)
  const [loadPhotos, setLoadPhotos] = useState<string[]>([])
  const [receiptTarget, setReceiptTarget] = useState<ShipmentRow | null>(null)
  const [receiptChecks, setReceiptChecks] = useState<Record<number, { result: string; reason?: string; received_qty?: number }>>({})
  const [receiptPhotos, setReceiptPhotos] = useState<string[]>([])
  // 发运清单勾选（03 卷：手机端 = 发运清单勾选+拍照·装车·到货·清点）
  const [tickTarget, setTickTarget] = useState<ShipmentRow | null>(null)
  const [tickPhotos, setTickPhotos] = useState<string[]>([])
  const [ticking, setTicking] = useState(false)
  const [saving, setSaving] = useState(false)

  // 重构 2.3：看板数据走共享 hook（与另一端同源）
  const { toShipRows, shipments, reload: load } = useShipBoard(projectNo)

  useEffect(() => {
    listProjects()
      .then((rows) => setProjects(rows.map((p) => ({ project_no: p.project_no, project_name: p.project_name }))))
      .catch(() => undefined)
  }, [])

  const doInstruct = async () => {
    if (!projectNo || selected.length === 0) return
    let v: { plan_ship_date: { format: (f: string) => string }; remark?: string }
    try {
      v = await instructForm.validateFields()
    } catch {
      return
    }
    try {
      const r = await createShipment({
        project_no: projectNo,
        equip_nos: selected,
        plan_ship_date: v.plan_ship_date.format('YYYY-MM-DD'),
        remark: v.remark || undefined,
      })
      message.success(`已下达发货指令 ${r.shipment_no}（发货日 ${v.plan_ship_date.format('MM-DD')}），已通知采购叫车`)
      setSelected([])
      setInstructOpen(false)
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const openTick = async (s: ShipmentRow) => {
    setTickPhotos([])
    setTickTarget(s)
    if (s.items.length === 0 && canShip) {
      setTicking(true)
      try {
        const fresh = await generateShipItems(s.id)
        setTickTarget(fresh)
        await load(projectNo)
      } catch (e) {
        message.error(errMsg(e))
      } finally {
        setTicking(false)
      }
    }
  }

  const toggleShipped = async (ship: ShipmentRow, itemId: number) => {
    if (!tickPhotos.length) {
      message.warning('先拍这个件的发货照片，再勾「已发」')
      return
    }
    setTicking(true)
    try {
      await markShipItems([itemId], tickPhotos)
      setTickPhotos([])
      const list = await load(ship.project_no ?? projectNo)
      const fresh = (list ?? []).find((x) => x.id === ship.id)
      if (fresh) setTickTarget(fresh)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setTicking(false)
    }
  }

  const doDepart = async (s: ShipmentRow) => {
    // R3-02 方案A + D3：必须先装车（入口已只在已装车显示），再卡 0 项已发
    if (!s.items.some((i) => i.shipped)) {
      message.warning('本批一项都没勾「已发」——先勾选实际发出的件再发运')
      return
    }
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
        showSearch optionFilterProp="label" aria-label="项目" style={{ width: '100%', marginBottom: 12 }} placeholder="选项目"
        value={projectNo} onChange={(v: string | undefined) => { setProjectNo(v); setSelected([]); void load(v) }}
        options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
      />

      {/* 没选项目：先给「点一个项目」列表（移动端不留空屏） */}
      {!projectNo && (
        <>
          <MEmpty text="先选一个项目，看它的待发设备与发运批次。" />
          {projects.map((pj) => (
            <MCard
              key={pj.project_no}
              head={<span className="ds-code" style={{ fontSize: 12 }}>{pj.project_no}</span>}
              title={pj.project_name}
              onClick={() => {
                setProjectNo(pj.project_no)
                setSelected([])
                void load(pj.project_no)
              }}
            />
          ))}
        </>
      )}

      {projectNo && (
        <MCard head={<MStep n={1} text="勾本次要发的设备" />}>
          {toShipRows.length === 0 && (
            <MEmpty text="没有可发的设备（未装配完成，或已在未完成批次里）。" />
          )}
          {toShipRows.map((t) => (
            <MCheckRow
              key={t.equip_no}
              checked={selected.includes(t.equip_no)}
              onToggle={() => {
                if (t.in_open_shipment || !t.ready) return
                setSelected((x) => (x.includes(t.equip_no) ? x.filter((y) => y !== t.equip_no) : [...x, t.equip_no]))
              }}
              title={
                <>
                  {t.equip_no} {t.equip_name}
                </>
              }
              sub={
                <>
                  {t.assembly_status ?? '未装配'} · 齐套 {Math.round(t.kitting_rate * 100)}%
                  {t.in_open_shipment ? ' · 已在批次' : ''}
                </>
              }
              right={
                t.in_open_shipment ? (
                  <MChip tone="warn">已在批次</MChip>
                ) : t.ready ? (
                  <MChip tone="ok">可发</MChip>
                ) : (
                  <MChip>未装配完</MChip>
                )
              }
            />
          ))}
          {/* ★ F15：手机端没有 hover，禁用理由只能写成看得见的字 */}
          {canShip && selected.length === 0 && (
            <div className="hint-note">先在上面勾选设备；只有「装配完成」的能勾（没装配完的发不了）。</div>
          )}
          {!canShip && <div className="hint-note">发货指令由项目经理 / 发运下达，你这边只能看。</div>}
          <div className="m-actions">
            <Button block type="primary" disabled={!canShip || selected.length === 0} onClick={() => setInstructOpen(true)}>
              下达发货指令（{selected.length} 台）
            </Button>
          </div>
        </MCard>
      )}

      {projectNo && <div className="m-sec">发运批次</div>}
      {projectNo && shipments.length === 0 && <MEmpty text="还没有发货指令。先在上面勾设备、再下达指令。" />}
      {projectNo &&
        shipments.map((s) => {
          const done = s.items.filter((i) => i.shipped).length
          return (
            <MCard
              key={s.id}
              tone={SHIP_TONE[s.status]}
              head={
                <>
                  <span className="ds-code" style={{ fontSize: 12 }}>{s.shipment_no}</span>
                  <MStatus tone={SHIP_TONE[s.status]}>{s.status}</MStatus>
                  <span style={{ marginLeft: 'auto' }}>
                    <MChip tone={done === s.items.length && s.items.length > 0 ? 'ok' : 'warn'}>
                      已发 {done}/{s.items.length}
                    </MChip>
                  </span>
                </>
              }
              title={s.lines.map((l) => l.equip_no).join('、')}
              lines={[
                <>
                  {s.plate_no ?? '未装车'} {s.driver ?? ''}
                  {s.plan_ship_date ? ` · 发货日 ${s.plan_ship_date}` : ''}
                </>,
              ]}
            >
              <div className="m-actions">
                {canShip && ['已指令', '发货中', '已装车'].includes(s.status) && (
                  <Button block type="primary" onClick={() => void openTick(s)}>
                    发运清单（逐项勾已发 + 拍照）
                  </Button>
                )}
                {canShip && ['已指令', '发货中', '已装车'].includes(s.status) && (
                  <Button
                    block
                    onClick={() => {
                      if (!s.items.some((i) => i.shipped)) {
                        message.warning('本批一项都没勾「已发」，不能装车——先到「发运清单」勾选实际发出的件并拍照')
                        return
                      }
                      setLoadPhotos([])
                      setLoadTarget(s)
                    }}
                  >
                    装车（车型 / 司机 / 车牌 + 拍照）
                  </Button>
                )}
                {canShip && s.status === '已装车' && (
                  <Button block type="primary" onClick={() => void doDepart(s)}>
                    发运（在途）
                  </Button>
                )}
                {canShip && s.status === '在途' && (
                  <Button block onClick={() => void doArrive(s)}>
                    登记到货
                  </Button>
                )}
                {canReceive &&
                  ['已到货', '在途'].includes(s.status) &&
                  (s.items.some((i) => i.shipped) ? (
                    <Button
                      block
                      type="primary"
                      onClick={() => {
                        setReceiptChecks({})
                        setReceiptPhotos([])
                        setReceiptTarget(s)
                      }}
                    >
                      现场清点（逐项到 / 缺 / 损）
                    </Button>
                  ) : (
                    <Button block disabled>
                      未勾「已发」，不能清点
                    </Button>
                  ))}
                <Button block onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                  {expanded === s.id ? '收起清单' : `看清单（${s.items.length} 项）`}
                </Button>
              </div>
              {expanded === s.id && (
                <div style={{ marginTop: 8 }}>
                  {s.items.map((it) => (
                    <div className="m-row" key={it.id}>
                      <div className="m-row-tx">
                        <div className="m-row-t" style={{ fontFamily: 'var(--ds-mono)', fontSize: 12.5 }}>{it.ref}</div>
                        <div className="m-row-s">
                          {it.equip_no} · ×{it.qty}
                        </div>
                      </div>
                      <div className="m-row-r">
                        <MChip tone={it.shipped ? 'ok' : undefined}>{it.shipped ? '已发' : '未发'}</MChip>
                      </div>
                    </div>
                  ))}
                  {s.receipts.map((r) => (
                    <div key={r.id} style={{ marginTop: 6 }}>
                      <div className="m-card-l">
                        清点结论：{r.result}
                      </div>
                      {r.shortage_detail.map((sd, i) => (
                        <div key={i} className="m-card-l" style={{ color: 'var(--ds-err)' }}>
                          {sd.item}：{sd.result}（实到 {sd.received_qty ?? '—'}）{sd.reason}
                        </div>
                      ))}
                    </div>
                  ))}
                  <div className="m-photos">
                    {[...s.photos, ...s.receipts.flatMap((r) => r.photos)].map((p) => (
                      <AuthedImage key={p} path={shipPhotoUrl(p)} size={48} />
                    ))}
                  </div>
                </div>
              )}
            </MCard>
          )
        })}

      {/* 发运清单：逐项勾「已发」+ 拍照（03 卷：手机端也是勾选+拍照，不扫码） */}
      <Modal
        className="engineering-modal"
        open={!!tickTarget}
        title={`发运清单 · ${tickTarget?.shipment_no ?? ''}`}
        onCancel={() => setTickTarget(null)}
        footer={(
          /* ★ F16（2026-10-04）：“完成”只是关闭——真保存是勾 checkbox 那刻即时提交；文案说实话，未拍照的勾提醒补完再关 */
          <Button onClick={() => {
            const noPhoto = (tickTarget?.items ?? []).filter((i) => i.shipped && !(i.photos && i.photos.length))
            if (noPhoto.length) message.warning(`有 ${noPhoto.length} 项已勾“已发”但没拍照 —— 照片是现场清点的依据，补完再关`)
            setTickTarget(null)
          }}>关闭（勾选已实时保存）</Button>
        )}
        width={560}
        destroyOnHidden
      >
        <Space wrap style={{ marginBottom: 8 }}>
          <MfgPhotoPicker
            projectNo={tickTarget?.project_no ?? ''}
            refNo={tickTarget?.shipment_no ?? ''}
            value={tickPhotos}
            onChange={setTickPhotos}
            upload={uploadShipPhotos}
            photoUrl={shipPhotoUrl}
            label="发货拍照"
            max={9}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            先拍照再勾；勾大组件 = 整组都发了。没勾的留在后续批次。
          </Typography.Text>
        </Space>
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {(tickTarget?.items ?? []).map((it) => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${T.border}` }}>
              <Checkbox checked={it.shipped} disabled={ticking || it.shipped} onChange={() => void toggleShipped(tickTarget as ShipmentRow, it.id)}>
                <span style={{ fontSize: 13 }}>{it.equip_no} {it.ref} ×{it.qty} {it.kind}</span>
              </Checkbox>
              {it.shipped && <MChip tone="ok">已发</MChip>}
            </div>
          ))}
        </div>
      </Modal>

      {/* 装车 */}
      <Modal className="engineering-modal" open={!!loadTarget} title={`装车 · ${loadTarget?.shipment_no ?? ''}`} onCancel={() => setLoadTarget(null)} onOk={() => {
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
        className="engineering-modal"
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

      {/* ★ 下达发货指令（§2.2）：发货日必填 —— 采购按这天叫车、装货的人按这天知道几车 */}
      <Modal
        className="engineering-modal"
        open={instructOpen}
        title={`下达发货指令 · ${selected.length} 台`}
        onCancel={() => setInstructOpen(false)}
        onOk={() => void doInstruct()}
        okText="确认下达"
        destroyOnHidden
      >
        <Typography.Paragraph>
          <Muted>本次要发：{selected.join('、')}。指令下达后采购要去叫车，所以发货日必须定下来。</Muted>
        </Typography.Paragraph>
        <Form form={instructForm} layout="vertical" preserve={false}>
          <Form.Item
            name="plan_ship_date"
            label="发货日（PM 定）"
            rules={[{ required: true, message: '请定发货日 —— 采购按这天叫车' }]}
          >
            <DatePicker style={{ width: '100%' }} placeholder="哪天发出去" />
          </Form.Item>
          <Form.Item name="remark" label="备注" style={{ marginBottom: 0 }}>
            <Input placeholder="如：分两车，第二车下午到" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
