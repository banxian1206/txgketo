import {
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'

import {
  addManualShipItem,
  arriveShipment,
  createShipment,
  departShipment,
  errMsg,
  generateShipItems,
  hasPerm,
  listProjects,
  listShipments,
  loadShipment,
  markShipItems,
  receiptShipment,
  setItemPlacePhotos,
  shipPhotoUrl,
  toShip,
  uploadShipPhotos,
  type ShipmentItemRow,
  type ShipmentRow,
  type ToShipRow,
} from '../api/client'
import AuthedImage from '../components/AuthedImage'
import MfgPhotoPicker from '../components/MfgPhotoPicker'
import { SHIP_STATUS as SHIP_COLOR } from '../theme/status'

export default function Shipping() {
  const { message } = App.useApp()
  const canEdit = hasPerm('ship:edit')

  const [projects, setProjects] = useState<{ project_no: string; project_name: string }[]>([])
  const [projectNo, setProjectNo] = useState<string | undefined>()
  const [toShipRows, setToShipRows] = useState<ToShipRow[]>([])
  const [selectedEquips, setSelectedEquips] = useState<string[]>([])
  const [shipments, setShipments] = useState<ShipmentRow[]>([])
  const [loading, setLoading] = useState(false)

  // 发运清单勾选
  const [itemsShip, setItemsShip] = useState<ShipmentRow | null>(null)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [shipPhotos, setShipPhotos] = useState<string[]>([])
  const [manualName, setManualName] = useState('')

  // 装车
  const [loadTarget, setLoadTarget] = useState<ShipmentRow | null>(null)
  const [loadPhotos, setLoadPhotos] = useState<string[]>([])
  const [loadForm] = Form.useForm()

  // 现场清点
  const [receiptTarget, setReceiptTarget] = useState<ShipmentRow | null>(null)
  const [receiptChecks, setReceiptChecks] = useState<Record<number, { result: string; reason?: string; received_qty?: number }>>({})
  const [receiptPhotos, setReceiptPhotos] = useState<string[]>([])

  const [detail, setDetail] = useState<ShipmentRow | null>(null)
  const [saving, setSaving] = useState(false)

  // 摆放位置照片
  const [placeItem, setPlaceItem] = useState<ShipmentItemRow | null>(null)
  const [placePhotos, setPlacePhotos] = useState<string[]>([])

  const load = useCallback(
    async (pno?: string): Promise<ShipmentRow[]> => {
      setLoading(true)
      try {
        const [ts, list] = await Promise.all([
          pno ? toShip(pno) : Promise.resolve([]),
          listShipments(pno ? { project_no: pno } : {}),
        ])
        setToShipRows(ts)
        setShipments(list)
        return list
      } catch (e) {
        message.error(errMsg(e))
        return []
      } finally {
        setLoading(false)
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

  const doInstruct = async () => {
    if (!projectNo || selectedEquips.length === 0) return
    try {
      const r = await createShipment({ project_no: projectNo, equip_nos: selectedEquips })
      message.success(`已下达发货指令 ${r.shipment_no}，请按结构勾选发运清单`)
      setSelectedEquips([])
      const list = await load(projectNo)
      const fresh = list.find((s) => s.id === r.id)
      if (fresh && canEdit && fresh.items.length === 0) {
        const updated = await generateShipItems(fresh.id)
        setShipments((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
        message.success('已按设备结构生成发运清单，请逐项勾选「已发」')
      }
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const openItems = async (ship: ShipmentRow) => {
    setShipPhotos([])
    setItemsShip(ship)
    if (ship.items.length === 0 && canEdit) {
      setItemsLoading(true)  // P-19：生成清单期间显示骨架屏，不再先空壳
      try {
        const updated = await generateShipItems(ship.id)
        setShipments((prev) => prev.map((x) => (x.id === ship.id ? updated : x)))
        setItemsShip(updated)
      } catch (e) {
        message.error(errMsg(e))
      } finally {
        setItemsLoading(false)
      }
    }
  }

  const savePlacePhotos = async () => {
    if (!placeItem || !detail) return
    setSaving(true)
    try {
      await setItemPlacePhotos(placeItem.id, placePhotos)
      message.success('已保存摆放位置照片')
      setPlaceItem(null)
      const list = await listShipments({ project_no: detail.project_no })
      const fresh = list.find((s) => s.id === detail.id)
      if (fresh) setDetail(fresh)
      setShipments(list)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleShipped = async (it: ShipmentItemRow) => {
    if (it.shipped || !itemsShip) return
    if (!shipPhotos.length) {
      message.warning('先拍这个件的发货照片，再勾「已发」')
      return
    }
    try {
      await markShipItems([it.id], shipPhotos)
      setShipPhotos([])
      message.success(`已标记发：${it.ref}`)
      const list = await load(projectNo)
      setItemsShip((m) => (m ? { ...m, items: list.find((s) => s.id === m.id)?.items ?? m.items } : m))
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const addManual = async (ship: ShipmentRow) => {
    if (!manualName.trim()) {
      message.warning('填补充项名称（说明书 / 备件 / 工具…）')
      return
    }
    try {
      await addManualShipItem(ship.id, { name: manualName.trim(), qty: 1 })
      message.success('补充项已加')
      setManualName('')
      const list = await load(projectNo)
      setItemsShip((m) => (m ? { ...m, items: list.find((s) => s.id === ship.id)?.items ?? m.items } : m))
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const doDepartConfirmed = async (s: ShipmentRow) => {
    try {
      await departShipment(s.id, {})
      message.success('已发运（在途）')
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  // P-08：分批发运是正常业务 → 不硬拦，只提示未勾项并请确认
  const confirmUnshipped = (s: ShipmentRow, action: string, onOk: () => void | Promise<void>) => {
    const pending = s.items.filter((i) => !i.shipped).length
    if (pending === 0) {
      void onOk()
      return
    }
    Modal.confirm({
      title: `还有 ${pending} 项未勾「已发」`,
      content: `这批清单共 ${s.items.length} 项，还有 ${pending} 项没勾「已发」。分批发运是正常的，确认无误再${action}。`,
      okText: `确认${action}`,
      cancelText: '再检查一下',
      onOk: () => onOk(),
    })
  }

  const doDepart = (s: ShipmentRow) => confirmUnshipped(s, '发运', () => doDepartConfirmed(s))

  const doArrive = async (s: ShipmentRow) => {
    try {
      await arriveShipment(s.id)
      message.success('已登记到货')
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const openReceipt = (r: ShipmentRow) => {
    setReceiptChecks({})
    setReceiptPhotos([])
    setReceiptTarget(r)
  }

  const doReceipt = async () => {
    if (!receiptTarget) return
    if (!receiptPhotos.length) {
      message.warning('现场清点要拍照')
      return
    }
    const checks = receiptTarget.items.map((it) => {
      const st = receiptChecks[it.id] ?? { result: '到' }
      return { item_id: it.id, result: st.result || '到', received_qty: st.received_qty, reason: st.reason }
    })
    const bad = checks.find((ck) => ck.result !== '到' && !(ck.reason ?? '').trim())
    if (bad) {
      message.warning('缺/损的项必须写原因')
      return
    }
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

  const counts = {
    open: shipments.filter((s) => ['已指令', '发货中', '已装车', '在途', '已到货'].includes(s.status)).length,
    transit: shipments.filter((s) => s.status === '在途').length,
    signed: shipments.filter((s) => s.status === '已签收').length,
  }

  return (
    <Card
      title="发运（S7）"
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          按设备结构生成发运清单 → 逐项勾「已发」+ 拍照 → 现场按同一份清单清点（到/缺/损）
        </Typography.Text>
      }
    >
      <Space style={{ marginBottom: 12 }}>
        <Select
          showSearch
          optionFilterProp="label"
          style={{ width: 300 }}
          placeholder="选项目"
          value={projectNo}
          onChange={(v: string | undefined) => { setProjectNo(v); setSelectedEquips([]); void load(v) }}
          options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
        />
        {!canEdit && <Tag>只读（需要 ship:edit 才能操作）</Tag>}
      </Space>

      {!projectNo && <Empty description="先选一个项目" />}

      {projectNo && (
        <>
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={6}><Statistic title="未完成批次" value={counts.open} /></Col>
            <Col span={6}><Statistic title="在途" value={counts.transit} valueStyle={{ color: counts.transit ? '#d48806' : undefined }} /></Col>
            <Col span={6}><Statistic title="已签收" value={counts.signed} /></Col>
          </Row>

          <Card size="small" title="待发设备（本次要发哪几台）" style={{ marginBottom: 12 }}>
            <Table<ToShipRow>
              rowKey="equip_no"
              size="small"
              loading={loading}
              dataSource={toShipRows}
              pagination={false}
              locale={{ emptyText: <Empty description="这个项目还没有设备" /> }}
              rowSelection={{
                selectedRowKeys: selectedEquips,
                onChange: (keys) => setSelectedEquips(keys as string[]),
                getCheckboxProps: (r) => ({ disabled: r.in_open_shipment }),
              }}
              columns={[
                { title: '设备', key: 'eq', width: 220, render: (_: unknown, r: ToShipRow) => `${r.equip_no} ${r.equip_name}` },
                {
                  title: '装配状态', dataIndex: 'assembly_status', width: 130,
                  render: (v: string | null) => (v ? <Tag color={v === '调试完成' ? 'success' : 'processing'}>{v}</Tag> : <Tag>未装配</Tag>),
                },
                { title: '齐套率', dataIndex: 'kitting_rate', width: 100, render: (v: number) => `${Math.round(v * 100)}%` },
                {
                  title: '能否发', key: 'ready', width: 150,
                  render: (_: unknown, r: ToShipRow) =>
                    r.in_open_shipment ? <Tag color="orange">已在发运批次</Tag> : r.ready ? <Tag color="success">可发</Tag> : <Tag>未装配完成</Tag>,
                },
              ]}
            />
            <Space style={{ marginTop: 10 }}>
              <Button type="primary" disabled={!canEdit || selectedEquips.length === 0} onClick={() => void doInstruct()}>
                下达发货指令（{selectedEquips.length} 台）
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                一次指令 = 一个发运批次，可分批发；散件发运，逐项勾「已发」+ 拍照。
              </Typography.Text>
            </Space>
          </Card>

          <Typography.Title level={5}>发运批次</Typography.Title>
          <Table<ShipmentRow>
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={shipments}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            locale={{ emptyText: <Empty description="还没有发货指令" /> }}
            columns={[
              { title: '发运单号', dataIndex: 'shipment_no', width: 110, render: (v: string, r: ShipmentRow) => <a onClick={() => setDetail(r)}>{v}</a> },
              { title: '本次设备', key: 'lines', render: (_: unknown, r: ShipmentRow) => r.lines.map((l) => l.equip_no).join('、') },
              { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag color={SHIP_COLOR[v] ?? 'default'}>{v}</Tag> },
              { title: '车牌 / 司机', key: 'v', width: 160, render: (_: unknown, r: ShipmentRow) => `${r.plate_no ?? ''} ${r.driver ?? ''}` || '—' },
              {
                title: '发运进度', key: 'prog', width: 130,
                render: (_: unknown, r: ShipmentRow) => {
                  const done = r.items.filter((i) => i.shipped).length
                  return `${done}/${r.items.length || 0} 项已发`
                },
              },
              {
                title: '操作',
                key: 'a',
                width: 230,
                render: (_: unknown, r: ShipmentRow) => (
                  <Space size={4} wrap>
                    {canEdit && ['已指令', '发货中'].includes(r.status) && <a onClick={() => void openItems(r)}>发运清单</a>}
                    {canEdit && ['已指令', '发货中', '已装车'].includes(r.status) && <a onClick={() => { setLoadPhotos([]); setLoadTarget(r) }}>装车</a>}
                    {canEdit && ['已装车', '发货中'].includes(r.status) && <a onClick={() => void doDepart(r)}>发运</a>}
                    {canEdit && r.status === '在途' && <a onClick={() => void doArrive(r)}>登记到货</a>}
                    {canEdit && ['已到货', '在途'].includes(r.status) && <a onClick={() => openReceipt(r)}>现场清点</a>}
                    <a onClick={() => setDetail(r)}>详情</a>
                  </Space>
                ),
              },
            ]}
          />
        </>
      )}

      {/* 发运清单勾选 */}
      <Modal
        open={!!itemsShip}
        title={`发运清单 · ${itemsShip?.shipment_no ?? ''}（${itemsShip?.lines.map((l) => l.equip_no).join('、') ?? ''}）`}
        onCancel={() => setItemsShip(null)}
        width={720}
        footer={<Button onClick={() => setItemsShip(null)}>完成</Button>}
        destroyOnHidden
      >
        <Space style={{ marginBottom: 10 }} wrap>
          <MfgPhotoPicker
            projectNo={itemsShip?.project_no ?? ''} refNo={itemsShip?.shipment_no ?? ''}
            value={shipPhotos} onChange={setShipPhotos}
            upload={uploadShipPhotos} photoUrl={shipPhotoUrl} label="发货拍照" max={9}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            先拍发货照片，再勾「已发」；勾大组件 = 整组都发了。
          </Typography.Text>
        </Space>
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {itemsLoading ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : (
            <>
              {(itemsShip?.items ?? []).length === 0 && <Empty description="清单为空" />}
              {(itemsShip?.items ?? []).map((it) => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <Checkbox
                    checked={it.shipped}
                    onChange={() => void toggleShipped(it)}
                  >
                    <Typography.Text strong={it.kind === '组件'}>{it.ref}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                      {it.name ?? ''} · {it.qty} {it.kind}
                    </Typography.Text>
                    {it.shipped && <Tag color="success" style={{ marginLeft: 6 }}>已发</Tag>}
                  </Checkbox>
                </div>
              ))}
            </>
          )}
        </div>
        {canEdit && (
          <Space style={{ marginTop: 10 }} wrap>
            <Input style={{ width: 260 }} placeholder="结构外补充：说明书 / 备件 / 工具…" value={manualName} onChange={(e) => setManualName(e.target.value)} />
            <Button onClick={() => itemsShip && void addManual(itemsShip)}>加补充项</Button>
          </Space>
        )}
      </Modal>

      {/* 装车 */}
      <Modal
        open={!!loadTarget}
        title={`装车 · ${loadTarget?.shipment_no ?? ''}`}
        onCancel={() => setLoadTarget(null)}
        onOk={() => {
          if (!loadTarget) return
          if (!loadPhotos.length) { message.warning('装车要拍照'); return }
          confirmUnshipped(loadTarget, '装车', () =>
            loadForm.validateFields().then(async (v) => {
              try {
                await loadShipment(loadTarget.id, { vehicle: v.vehicle, driver: v.driver, plate_no: v.plate_no, photos: loadPhotos })
                message.success('已装车')
                setLoadTarget(null)
                await load(projectNo)
              } catch (e) { message.error(errMsg(e)) }
            }),
          )
        }}
        confirmLoading={saving}
        okText="确认装车"
        destroyOnHidden
      >
        <Form form={loadForm} layout="vertical" preserve={false}>
          <Space style={{ display: 'flex' }} size="middle" align="start">
            <Form.Item name="vehicle" label="车辆"><Input style={{ width: 170 }} placeholder="如 17.5 米平板" /></Form.Item>
            <Form.Item name="plate_no" label="车牌"><Input style={{ width: 130 }} /></Form.Item>
            <Form.Item name="driver" label="司机 / 电话"><Input style={{ width: 160 }} /></Form.Item>
          </Space>
          <Form.Item label="装车照片（必须）" required>
            <MfgPhotoPicker
              projectNo={loadTarget?.project_no ?? ''} refNo={loadTarget?.shipment_no ?? ''}
              value={loadPhotos} onChange={setLoadPhotos}
              upload={uploadShipPhotos} photoUrl={shipPhotoUrl} label="拍照"
            />
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
        width={720}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          按发运清单逐项勾「到 / 缺 / 损」；全到=齐，有缺=缺件，有损=破损，系统自动判定并通知。
        </Typography.Paragraph>
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {(receiptTarget?.items ?? []).map((it) => {
            const st = receiptChecks[it.id] ?? { result: '到' }
            return (
              <div key={it.id} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <Space wrap>
                  <Typography.Text>{it.ref}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>应发 {it.qty}</Typography.Text>
                  <Select
                    size="small"
                    style={{ width: 90 }}
                    value={st.result}
                    onChange={(v: string) => setReceiptChecks((m) => ({ ...m, [it.id]: { ...st, result: v } }))}
                    options={[
                      { value: '到', label: '到' },
                      { value: '缺', label: '缺' },
                      { value: '损', label: '损' },
                    ]}
                  />
                  {st.result !== '到' && (
                    <>
                      <Input
                        size="small" style={{ width: 110 }} placeholder="实到数量"
                        value={st.received_qty as unknown as string}
                        onChange={(e) => setReceiptChecks((m) => ({ ...m, [it.id]: { ...st, received_qty: e.target.value ? Number(e.target.value) : undefined } }))}
                      />
                      <Input
                        size="small" style={{ width: 160 }} placeholder="原因"
                        value={st.reason}
                        onChange={(e) => setReceiptChecks((m) => ({ ...m, [it.id]: { ...st, reason: e.target.value } }))}
                      />
                    </>
                  )}
                </Space>
              </div>
            )
          })}
        </div>
        <Form layout="vertical" style={{ marginTop: 10 }}>
          <Form.Item label="清点照片（必须）" required>
            <MfgPhotoPicker
              projectNo={receiptTarget?.project_no ?? ''} refNo={receiptTarget?.shipment_no ?? ''}
              value={receiptPhotos} onChange={setReceiptPhotos}
              upload={uploadShipPhotos} photoUrl={shipPhotoUrl} label="拍照"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情 */}
      <Drawer width={560} open={!!detail} onClose={() => setDetail(null)} title={detail?.shipment_no ?? ''}>
        {detail && (
          <>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="项目">{detail.project_no}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={SHIP_COLOR[detail.status] ?? 'default'}>{detail.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="本次设备">{detail.lines.map((l) => l.equip_no).join('、')}</Descriptions.Item>
              <Descriptions.Item label="车辆">{detail.vehicle ?? '—'} {detail.plate_no ?? ''} {detail.driver ?? ''}</Descriptions.Item>
              <Descriptions.Item label="指令 / 发运 / 到货">
                {detail.instruct_at?.slice(0, 16).replace('T', ' ') ?? '—'} / {detail.depart_at?.slice(0, 16).replace('T', ' ') ?? '—'} / {detail.arrive_at?.slice(0, 16).replace('T', ' ') ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="备注">{detail.remark ?? '—'}</Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5} style={{ marginTop: 16 }}>发运清单（{detail.items.length}）</Typography.Title>
            {detail.items.length === 0 && <Empty description="清单为空" />}
            {detail.items.map((p) => (
              <div key={p.id} style={{ padding: '5px 0', borderBottom: '1px solid #f0f0f0' }}>
                <Space>
                  {p.shipped ? <Tag color="success">已发</Tag> : <Tag>未发</Tag>}
                  <Typography.Text>{p.ref}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{p.name ?? ''} × {p.qty}</Typography.Text>
                  {p.check_result && <Tag color={p.check_result === '到' ? 'success' : 'error'}>现场：{p.check_result}</Tag>}
                  <a onClick={() => { setPlaceItem(p); setPlacePhotos([]) }}>摆放拍照</a>
                </Space>
                <Space wrap style={{ marginTop: 4 }}>
                  {[...p.photos, ...p.place_photos].map((ph) => (
                    <AuthedImage key={ph} path={shipPhotoUrl(ph)} size={48} />
                  ))}
                </Space>
              </div>
            ))}

            <Typography.Title level={5} style={{ marginTop: 16 }}>现场清点</Typography.Title>
            {detail.receipts.length === 0 && <Empty description="还没到货清点" />}
            {detail.receipts.map((r) => (
              <Card key={r.id} size="small" style={{ marginBottom: 8 }}>
                <Tag color={r.result === '齐' ? 'success' : 'error'}>{r.result}</Tag>
                {r.remark}
                {r.shortage_detail.length > 0 && (
                  <div style={{ fontSize: 12, color: '#cf1322', marginTop: 4 }}>
                    {r.shortage_detail.map((s, i) => (
                      <div key={i}>{s.equip_no ?? ''} {s.item ?? ''}：{s.result}（实到 {s.received_qty ?? '—'}）{s.reason}</div>
                    ))}
                  </div>
                )}
                <Space wrap style={{ marginTop: 6 }}>
                  {r.photos.map((p) => (
                    <AuthedImage key={p} path={shipPhotoUrl(p)} size={56} />
                  ))}
                </Space>
              </Card>
            ))}

            {detail.photos.length > 0 && (
              <>
                <Typography.Title level={5} style={{ marginTop: 16 }}>装车 / 发运照片</Typography.Title>
                <Space wrap>
                  {detail.photos.map((p) => (
                    <AuthedImage key={p} path={shipPhotoUrl(p)} size={56} />
                  ))}
                </Space>
              </>
            )}
          </>
        )}
      </Drawer>

      {/* 摆放位置照片（散件不装箱：登记每件放在车上的位置） */}
      <Modal
        title={`摆放位置照片 · ${placeItem?.ref ?? ''}`}
        open={!!placeItem}
        onCancel={() => setPlaceItem(null)}
        onOk={() => void savePlacePhotos()}
        confirmLoading={saving}
        okText="保存"
        destroyOnHidden
      >
        <MfgPhotoPicker
          projectNo={detail?.project_no ?? ''}
          refNo={detail?.shipment_no ?? ''}
          value={placePhotos}
          onChange={setPlacePhotos}
          upload={uploadShipPhotos}
          photoUrl={shipPhotoUrl}
          label="摆放位置照片"
        />
      </Modal>
    </Card>
  )
}
