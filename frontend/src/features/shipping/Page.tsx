import { useUrlState } from '../../hooks/useUrlState'
import { useShipBoard } from '../../hooks/useShipBoard'
import { App, Button, Card, Checkbox, Descriptions, Drawer, DatePicker, Form, Input, Modal, Select, Skeleton, Space, Table, Tooltip, Typography } from 'antd'
import { useEffect, useState } from 'react'

import { addManualShipItem, arriveShipment, createShipment, departShipment, errMsg, generateShipItems, hasPerm, listProjects, listShipments, loadShipment, markShipItems, receiptShipment, setItemPlacePhotos, shipPhotoUrl, uploadShipPhotos, type ShipmentItemRow, type ShipmentRow, type ToShipRow } from '../../api/client'
import AuthedImage from '../../components/AuthedImage'
import VehicleModal from '../../components/VehicleModal'
import { Muted } from '../../components/ui/Primitives'
import MfgPhotoPicker from '../../components/MfgPhotoPicker'
import { Chip, Code, Empty as DsEmpty, Status } from '../../components/ds'
import QueueBoard from '../../components/ds/QueueBoard'
import WorkbenchPage from '../../components/domain/WorkbenchPage'
import { SHIPPING_BOARD } from '../../configs/boards'
import { SHIP_STATUS as SHIP_COLOR, toneOf } from '../../theme/status'
import { T } from '../../theme/tokens'

export default function Shipping() {
  const { message } = App.useApp()
  const canEdit = hasPerm('ship:edit')
  const canBuy = hasPerm('purchase:edit')  // ★ §2.2：叫车是采购做的事

  const [projects, setProjects] = useState<{ project_no: string; project_name: string }[]>([])
  // ★ P5：项目选择器进 URL（?p=），刷新/分享回得到
  const [bUrl, setBUrl] = useUrlState({ p: undefined })
  const projectNo = bUrl.p
  const setProjectNo = (v?: string) => setBUrl({ p: v })
  const [selectedEquips, setSelectedEquips] = useState<string[]>([])
  // ★ §2.2：下达指令时**必须定发货日**（采购按这天叫车、装货的人按这天知道几车）
  const [instructOpen, setInstructOpen] = useState(false)
  const [instructForm] = Form.useForm()

  // 发运清单勾选
  const [itemsShip, setItemsShip] = useState<ShipmentRow | null>(null)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [shipPhotos, setShipPhotos] = useState<string[]>([])
  const [manualName, setManualName] = useState('')

  // 装车
  const [loadTarget, setLoadTarget] = useState<ShipmentRow | null>(null)
  const [loadPhotos, setLoadPhotos] = useState<string[]>([])
  const [loadForm] = Form.useForm()

  // ★ §2.2 叫车（采购）
  const [vehicleTarget, setVehicleTarget] = useState<ShipmentRow | null>(null)

  // 现场清点
  const [receiptTarget, setReceiptTarget] = useState<ShipmentRow | null>(null)
  const [receiptChecks, setReceiptChecks] = useState<Record<number, { result: string; reason?: string; received_qty?: number }>>({})
  const [receiptPhotos, setReceiptPhotos] = useState<string[]>([])

  const [detail, setDetail] = useState<ShipmentRow | null>(null)
  const [saving, setSaving] = useState(false)

  // 摆放位置照片
  const [placeItem, setPlaceItem] = useState<ShipmentItemRow | null>(null)
  const [placePhotos, setPlacePhotos] = useState<string[]>([])

  // 重构 2.3：看板数据走共享 hook（与另一端同源）
  const { toShipRows, shipments, setShipments, loading, reload: load } = useShipBoard(projectNo)

  useEffect(() => {
    listProjects()
      .then((rows) => setProjects(rows.map((p) => ({ project_no: p.project_no, project_name: p.project_name }))))
      .catch(() => undefined)
  }, [])

  const doInstruct = async () => {
    if (!projectNo || selectedEquips.length === 0) return
    let v: { plan_ship_date: { format: (f: string) => string }; remark?: string }
    try {
      v = await instructForm.validateFields()
    } catch {
      return // 表单自己会标红，不另弹提示
    }
    try {
      const r = await createShipment({
        project_no: projectNo,
        equip_nos: selectedEquips,
        plan_ship_date: v.plan_ship_date.format('YYYY-MM-DD'),
        remark: v.remark || undefined,
      })
      message.success(`已下达发货指令 ${r.shipment_no}（发货日 ${v.plan_ship_date.format('YYYY-MM-DD')}），已通知采购叫车`)
      setInstructOpen(false)
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

  const doDepart = (s: ShipmentRow) => {
    // R3-02 方案A：0 项已发不能发运（否则到货后无法清点 → 死批次）
    if (!s.items.some((i) => i.shipped)) {
      message.warning('本批一项都没勾「已发」——勾「已发」的就是实际发出的，先勾选实际发出的件再发运')
      return
    }
    confirmUnshipped(s, '发运', () => doDepartConfirmed(s))
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
    // ★ 发货与收货一致：只清点本批已勾「已发」的项
    const shipped = receiptTarget.items.filter((i) => i.shipped)
    if (!shipped.length) {
      message.warning('本批没有勾「已发」的项——先勾选实际发出的件再发运/清点')
      return
    }
    const checks = shipped.map((it) => {
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


  // ── 队列：车已叫回、该我装/该我发的批次（跨项目；叫车是采购的事，见 PURCHASE_BOARD）──
  const todoRows = shipments
    .filter((x) => ['已指令', '发货中', '已装车'].includes(x.status) && x.vehicle_status === '已叫车')
    .sort((a, b) => String(a.plan_ship_date ?? '9999').localeCompare(String(b.plan_ship_date ?? '9999')))
  const waitLoad = todoRows.filter((x) => x.status !== '已装车')
  const waitDepart = todoRows.filter((x) => x.status === '已装车')

  return (
    <div className="ds-page">
      {/* ★ docs/15 台骨架四件套：台头 → 结论条 → 流程条（注册表驱动）→ 体 */}
      <WorkbenchPage
        board={SHIPPING_BOARD}
        sub={
          // ★ 方向 2 ①：台头只说现状 + 异常（不重复结论条）。零异常时说“有几个批次”而不是“空”
          todoRows.length
            ? `${waitLoad.length} 个批次等装车${waitDepart.length ? ` · ${waitDepart.length} 个已装车等发运` : ''}`
            : '现在没有等装车/等发运的批次'
        }
        help="必经顺序：按设备结构生成发运清单 → 逐项勾「已发」+ 拍照 → 装车（拍照）→ 发运 → 现场按同一份清单清点（到/缺/损）。★ 采购没叫车不能装车。"
        actions={
          <>
            {!canEdit && <Chip>只读（需要 ship:edit 才能操作）</Chip>}
            <Button size="small" onClick={() => void load(projectNo)}>
              刷新
            </Button>
          </>
        }
        counts={{
          todo: todoRows.length,
          batches: shipments.filter((x) => !['已签收', '已取消'].includes(x.status)).length,
        }}
        metrics={[
          // ★ 方向 2 ② 主角指认：发运台主角 = **等装车**：采购把车叫回来了，此刻该动的是装车（再往后的等发运是它下一步）。（ds `MetricItem.lead`）
          { key: 'load', label: '等装车', value: waitLoad.length, unit: '批', tone: waitLoad.length ? 'warn' : undefined, dimZero: true, to: '?tab=todo', lead: true },
          { key: 'depart', label: '等发运', value: waitDepart.length, unit: '批', tone: waitDepart.length ? 'warn' : undefined, dimZero: true, to: '?tab=todo' },
          { key: 'transit', label: '在途', value: shipments.filter((x) => x.status === '在途').length, unit: '批', tone: shipments.filter((x) => x.status === '在途').length ? 'warn' : undefined, dimZero: true, to: '?tab=batches' },
          { key: 'open', label: '未完成批次', value: shipments.filter((x) => !['已签收', '已取消'].includes(x.status)).length, unit: '批', dimZero: true, to: '?tab=batches' },
          { key: 'signed', label: '已签收', value: shipments.filter((x) => x.status === '已签收').length, unit: '批', tone: 'ok', dimZero: true, to: '?tab=batches' },
        ]}
      >
        {(t: string) =>
          t === 'todo' ? (
            <QueueBoard
              search={<Muted>车由采购叫回来；你这边装车、发运。还没叫车的批次不在这里（去采购台的「待叫车」）。</Muted>}
              emptyText="没有等装车/等发运的批次 —— 项目经理下达发货指令、采购叫车之后会出现在这里。"
              items={todoRows.map((x) => ({
                key: x.shipment_no,
                group: x.status === '已装车' ? '已装车，等发运' : '已叫车，等装车',
                groupCount: x.status === '已装车' ? waitDepart.length : waitLoad.length,
                groupTone: x.status === '已装车' ? 'warn' : undefined,
                tone: x.status === '已装车' ? 'warn' : undefined,
                // ★ 方向 2 ③：只给「已装车等发运」上色（车都到了、只差发出去）；
                //   「已叫车等装车」是常态，整组同色会连成一条线 = 等于没上（同车间台的教训）。
                lead: <Code>{x.shipment_no}</Code>,
                title: `${x.project_no}`,
                meta: `发货日 ${x.plan_ship_date ?? '未定'} · ${x.vehicle_count ?? 0} 车 · ${
                  x.lines?.length ? `清单 ${x.lines.length} 项` : '清单还没生成'
                }`,
                cells: [{ text: <Status tone="run">{x.status}</Status> }],
                action: x.status === '已装车' ? (
                  <Button type="primary" size="small" disabled={!canEdit} onClick={() => setItemsShip(x)}>
                    跟踪/发运
                  </Button>
                ) : (
                  <Button type="primary" size="small" disabled={!canEdit} onClick={() => setLoadTarget(x)}>
                    装车
                  </Button>
                ),
              }))}
            />
          ) : (
            <>
      <div className="ds-toolbar">
        <Select
          showSearch
          optionFilterProp="label"
          aria-label="项目"
          style={{ width: 300 }}
          placeholder="选项目"
          value={projectNo}
          onChange={(v: string | undefined) => { setProjectNo(v); setSelectedEquips([]); void load(v) }}
          options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
        />
        {!canEdit && <Chip>只读（需要 ship:edit 才能操作）</Chip>}
      </div>

      {!projectNo && <DsEmpty text="先在上面选一个项目 —— 待发设备、发运清单、批次都是按项目看的。" />}

      {projectNo && (
        <>
          <Card size="small" title="待发设备（本次要发哪几台）" style={{ marginBottom: 12 }}>
            <Table<ToShipRow>
              rowKey="equip_no"
              size="small"
              loading={loading}
              dataSource={toShipRows}
              pagination={false}
              locale={{ emptyText: <DsEmpty text="没有可发的设备（设各未装配完成、或已在本轮未完成的批次里）" /> }}
              rowSelection={{
                selectedRowKeys: selectedEquips,
                onChange: (keys) => setSelectedEquips(keys as string[]),
                getCheckboxProps: (r) => ({
                  // ★ 已在批次里 或 还没装配完成 → 不能勾（后端同步硬拦，两边一个口径 —— P1-5）
                  disabled: r.in_open_shipment || !r.ready,
                }),
              }}
              columns={[
                { title: '设备', key: 'eq', width: 220, render: (_: unknown, r: ToShipRow) => `${r.equip_no} ${r.equip_name}` },
                {
                  title: '装配状态', dataIndex: 'assembly_status', width: 130,
                  render: (v: string | null) => (v ? <Chip tone={toneOf(v === '调试完成' ? 'success' : 'processing')}>{v}</Chip> : <Chip>未装配</Chip>),
                },
                { title: '齐套率', dataIndex: 'kitting_rate', width: 100, render: (v: number) => `${Math.round(v * 100)}%` },
                {
                  title: '能否发', key: 'ready', width: 150,
                  render: (_: unknown, r: ToShipRow) =>
                    r.in_open_shipment ? <Chip tone="warn">已在发运批次</Chip> : r.ready ? <Chip tone="ok">可发</Chip> : <Chip>未装配完成</Chip>,
                },
              ]}
            />
            <Space style={{ marginTop: 10 }}>
              {/* ★ F15（2026-10-04 走查核实）：禁用按钮必须说清为什么 —— 对齐采购池「合并下单」的 title 做法 */}
              <Button
                type="primary"
                disabled={!canEdit || selectedEquips.length === 0}
                title={!canEdit ? '没有权限：发货指令由项目经理/发运下达' : selectedEquips.length === 0 ? '先在下面勾选“装配完成”的设备（未装配完成的勾不上）' : undefined}
                onClick={() => setInstructOpen(true)}
              >
                下达发货指令（{selectedEquips.length} 台）
              </Button>
              {canEdit && selectedEquips.length === 0 && (
                <Typography.Text type="secondary" className="hint-inline">
                  （先在表里勾选设备；只有「可发」状态能勾 —— 还没装配完的设备要等装配完成）
                </Typography.Text>
              )}
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
            pagination={{ pageSize: 10, showSizeChanger: true }}
            locale={{ emptyText: <DsEmpty text="还没有发货指令" /> }}
            columns={[
              { title: '发运单号', dataIndex: 'shipment_no', width: 110, render: (v: string, r: ShipmentRow) => <a onClick={() => setDetail(r)}>{v}</a> },
              { title: '本次设备', key: 'lines', render: (_: unknown, r: ShipmentRow) => r.lines.map((l) => l.equip_no).join('、') },
              { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Status tone={toneOf(SHIP_COLOR[v])}>{v}</Status> },
              // ★ §2.2：PM 定的发货日 + 采购叫车结果（装货的人看“当天几车”）
              { title: '发货日', dataIndex: 'plan_ship_date', width: 110, render: (v?: string | null) => v ?? '—' },
              {
                title: '车辆', key: 'veh', width: 150,
                render: (_: unknown, r: ShipmentRow) =>
                  r.vehicle_status === '已叫车'
                    ? <span>已叫 {r.vehicle_count ?? '?'} 车{r.vehicle_note ? `· ${r.vehicle_note}` : ''}</span>
                    : <Chip tone="warn">待叫车</Chip>,
              },
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
                    {canEdit && ['已指令', '发货中', '已装车'].includes(r.status) && <a onClick={() => void openItems(r)}>发运清单</a>}
                    {canBuy && r.vehicle_status !== '已叫车' && ['已指令', '发货中'].includes(r.status) && (
                      <a onClick={() => setVehicleTarget(r)}>叫车</a>
                    )}
                    {canEdit && ['已指令', '发货中', '已装车'].includes(r.status) && <a onClick={() => { setLoadPhotos([]); setLoadTarget(r) }}>装车</a>}
                    {canEdit && r.status === '已装车' && <a onClick={() => void doDepart(r)}>发运</a>}
                    {canEdit && r.status === '在途' && <a onClick={() => void doArrive(r)}>登记到货</a>}
                    {canEdit && ['已到货', '在途'].includes(r.status) &&
                      (r.items.some((i) => i.shipped) ? (
                        <a onClick={() => openReceipt(r)}>现场清点</a>
                      ) : (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          未勾「已发」，不能清点
                        </Typography.Text>
                      ))}
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
              {(itemsShip?.items ?? []).length === 0 && <DsEmpty text="清单为空" />}
              {(itemsShip?.items ?? []).map((it) => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px solid ${T.border}` }}>
                  {/* ★ 没拍照就不能勾（P2-8）：
                    原来复选框不禁，点了只闪一下 warning，界面毫无变化 —— 用户以为点坏了；
                    而且反手点「完成」时才发现 0/N 项已发。现在直接置灰 + 悬浮说明。 */}
                  <Tooltip title={!it.shipped && !shipPhotos.length ? '先拍这个件的发货照片，再勾「已发」' : undefined}>
                    <span>
                      <Checkbox
                        checked={it.shipped}
                        disabled={!it.shipped && !shipPhotos.length}
                        onChange={() => void toggleShipped(it)}
                      >
                        <Typography.Text strong={it.kind === '组件'}>{it.ref}</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                          {it.name ?? ''} · {it.qty} {it.kind}
                        </Typography.Text>
                        {it.shipped && <Chip tone="ok" style={{ marginLeft: 6 }}>已发</Chip>}
                      </Checkbox>
                    </span>
                  </Tooltip>
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

      {/* ★ §2.2 下达发货指令：一条指令指挥两个部门，**发货日是必填项** */}
      <Modal
        open={instructOpen}
        title={`下达发货指令 · ${selectedEquips.length} 台`}
        onCancel={() => setInstructOpen(false)}
        onOk={() => void doInstruct()}
        okText="确认下达"
        destroyOnHidden
      >
        <Typography.Paragraph>
          <Muted>
            本次要发：{selectedEquips.join('、')}。指令下达后采购要去叫车、发运组据此装车 —— 所以发货日必须定下来。
          </Muted>
        </Typography.Paragraph>
        <Form form={instructForm} layout="vertical" preserve={false}>
          <Form.Item
            name="plan_ship_date"
            label="发货日（PM 定）"
            rules={[{ required: true, message: '请定发货日 —— 采购按这天叫车' }]}
          >
            <DatePicker style={{ width: 220 }} placeholder="哪天发出去" />
          </Form.Item>
          <Form.Item name="remark" label="备注" style={{ marginBottom: 0 }}>
            <Input.TextArea rows={2} placeholder="如：分两车，第二车下午到" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ★ §2.2 采购叫车（一条指令、两个部门：PM 定发货日 → 采购叫车 → 发运装车）
          弹窗实现**只有一个**（components/VehicleModal），采购台「待叫车」页签共用 —— 不在两处各写一套。 */}
      <VehicleModal
        target={vehicleTarget}
        onClose={() => setVehicleTarget(null)}
        onDone={() => void load(projectNo)}
      />

      {/* 装车 */}
      <Modal
        open={!!loadTarget}
        title={`装车 · ${loadTarget?.shipment_no ?? ''}`}
        onCancel={() => setLoadTarget(null)}
        onOk={() => {
          if (!loadTarget) return
          if (!loadPhotos.length) { message.warning('装车要拍照'); return }
          // ★ R5-01：0 项已发不能装车（装到底就发不出去、又开不了清单 = 死端）
          if (!loadTarget.items.some((i) => i.shipped)) {
            message.warning('本批一项都没勾「已发」，不能装车——先到「发运清单」勾选实际发出的件并拍照')
            return
          }
          confirmUnshipped(loadTarget, '装车', () =>
            loadForm.validateFields().then(async (v) => {
              try {
                await loadShipment(loadTarget.id, { vehicle: v.vehicle, driver: v.driver, plate_no: v.plate_no, photos: loadPhotos })
                message.success('已装车')
                setLoadTarget(null)
                await load(projectNo)
              } catch (e) { message.error(errMsg(e)) }
            }).catch(() => { /* ★ F3：校验没过时 reject 的是 errorInfo，接住防未处理拒绝 */ }),
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
          <br />
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
              <Descriptions.Item label="状态"><Status tone={toneOf(SHIP_COLOR[detail.status])}>{detail.status}</Status></Descriptions.Item>
              <Descriptions.Item label="本次设备">{detail.lines.map((l) => l.equip_no).join('、')}</Descriptions.Item>
              <Descriptions.Item label="车辆">{detail.vehicle ?? '—'} {detail.plate_no ?? ''} {detail.driver ?? ''}</Descriptions.Item>
              <Descriptions.Item label="指令 / 发运 / 到货">
                {detail.instruct_at?.slice(0, 16).replace('T', ' ') ?? '—'} / {detail.depart_at?.slice(0, 16).replace('T', ' ') ?? '—'} / {detail.arrive_at?.slice(0, 16).replace('T', ' ') ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="备注">{detail.remark ?? '—'}</Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5} style={{ marginTop: 16 }}>发运清单（{detail.items.length}）</Typography.Title>
            {detail.items.length === 0 && <DsEmpty text="清单为空" />}
            {detail.items.map((p) => (
              <div key={p.id} style={{ padding: '5px 0', borderBottom: `1px solid ${T.border}` }}>
                <Space>
                  {p.shipped ? <Chip tone="ok">已发</Chip> : <Chip>未发</Chip>}
                  <Typography.Text>{p.ref}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{p.name ?? ''} × {p.qty}</Typography.Text>
                  {p.check_result && <Status tone={p.check_result === '到' ? 'ok' : 'err'}>现场：{p.check_result}</Status>}
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
            {detail.receipts.length === 0 && <DsEmpty text="还没到货清点" />}
            {detail.receipts.map((r) => (
              <Card key={r.id} size="small" style={{ marginBottom: 8 }}>
                <Status tone={r.result === '齐' ? 'ok' : 'err'}>{r.result}</Status>
                {r.remark}
                {r.shortage_detail.length > 0 && (
                  <div style={{ fontSize: 12, color: T.error, marginTop: 4 }}>
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
      </>
          )
        }
      </WorkbenchPage>
    </div>
  )
}
