import { useMfgBoard } from '../../hooks/useMfgBoard'
import { App, Button, Card, DatePicker, Descriptions, Drawer, Form, Input, InputNumber, Radio, Select, Space, Table, Typography } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState, type ReactNode } from 'react'
import { acceptOutsource, acceptProdOrder, dispatchProdOrder, drawingFileUrl, errMsg, generateProdOrders, hasPerm, listEquipment, listProjects, mfgPhotoUrl, returnOutsource, sendOutsource, startProdOrder, transferProdOrder, type OutsourceRow, type ProdOrderRow } from '../../api/client'
import MfgPhotoPicker from '../../components/MfgPhotoPicker'
import AppModal from '../../components/AppModal'
import AuthedImage from '../../components/AuthedImage'
import AuthedFileLink from '../../components/AuthedFileLink'
import { PROD_STATUS as STATUS_COLOR, toneOf } from '../../theme/status'
import { OUTSOURCE_STATUS as OS_COLOR } from '../../theme/status'
import { Chip, Code, Status, Empty as DsEmpty } from '../../components/ds'
import QueueBoard, { type QItem } from '../../components/ds/QueueBoard'
import ShopViews from '../../components/domain/ShopViews'
import { T } from '../../theme/tokens'
import { SHOP_BOARD } from '../../configs/boards'
import WorkbenchPage from '../../components/domain/WorkbenchPage'
import { Link } from 'react-router-dom'
const TEAMS = ['下料', '机加', '焊接', '钣金', '喷涂']
type ActionKind = 'dispatch' | 'accept' | 'transfer' | 'os-send' | 'os-accept'
export default function Manufacturing() {
  const { message } = App.useApp()
    const canEdit = hasPerm('mfg:edit')
  // 生成排产
  const [genProject, setGenProject] = useState<string | undefined>()
  const [genEquip, setGenEquip] = useState<string | undefined>()
  const [projects, setProjects] = useState<{ project_no: string; project_name: string }[]>([])
  const [equips, setEquips] = useState<{ equip_no: string; equip_name: string }[]>([])
  const [genLoading, setGenLoading] = useState(false)
  // 动作弹窗
  const [action, setAction] = useState<{ kind: ActionKind; order?: ProdOrderRow; os?: OutsourceRow } | null>(
    null,
  )
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const [actionInitial, setActionInitial] = useState<Record<string, unknown>>({})
  // 详情
  const [detail, setDetail] = useState<ProdOrderRow | null>(null)
  // 重构 2.3：看板数据走共享 hook（与另一端同源）
  const { wb, loading, reload: load } = useMfgBoard()
  useEffect(() => {
    listProjects()
      .then((rows) => setProjects(rows.map((p) => ({ project_no: p.project_no, project_name: p.project_name }))))
      .catch(() => undefined)
  }, [])
  const onGenProject = async (no?: string) => {
    setGenProject(no)
    setGenEquip(undefined)
    setEquips([])
    if (!no) return
    try {
      setEquips(await listEquipment(no))
    } catch (e) {
      message.error(errMsg(e))
    }
  }
  const doGenerate = async () => {
    if (!genProject || !genEquip) return
    setGenLoading(true)
    try {
      const r = await generateProdOrders(genProject, genEquip, { plan_days: 2 })
      if (r.order_count + r.outsource_count === 0) message.info('这台设备没有新的自制件/外协件需要排产')
      else message.success(`已排产：自制件 ${r.order_count} 个、外协件 ${r.outsource_count} 个`)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setGenLoading(false)
    }
  }
  const openAction = (kind: ActionKind, order?: ProdOrderRow, os?: OutsourceRow) => {
    setPhotos([])
    // 预填交给 AppModal initialValues（挂载时读）
    let init: Record<string, unknown> = {}
    if (kind === 'dispatch') init = { step_name: '下料', material_item_no: order?.material_item_no }
    if (kind === 'accept') init = { result: '合格' }
    if (kind === 'transfer') init = { transfer_to: '装配区' }
    if (kind === 'os-send') init = { material_supplied: true, sent_at: dayjs(), due_date: dayjs().add(7, 'day') }
    if (kind === 'os-accept') init = { result: '合格' }
    setActionInitial(init)
    setAction({ kind, order, os })
  }
  const submitAction = async () => {
    if (!action) return
    let v
    try { v = await form.validateFields() } catch { return }
    if (photos.length === 0) {
      message.warning('这一动作要拍照留痕')
      return
    }
    setSaving(true)
    try {
      if (action.kind === 'dispatch' && action.order) {
        await dispatchProdOrder(action.order.id, {
          step_name: v.step_name,
          material_item_no: v.material_item_no || undefined,
          material_qty: v.material_qty || undefined,
          issued_to: v.issued_to || undefined,
          photos,
          remark: v.remark || undefined,
        })
        message.success('已下发（原材料 + 图纸，已拍照）')
      } else if (action.kind === 'accept' && action.order) {
        if (v.result !== '合格' && !(v.reason || '').trim()) {
          message.warning('不合格/返工必须写明原因')
          setSaving(false)
          return
        }
        await acceptProdOrder(action.order.id, { result: v.result, reason: v.reason, photos })
        message.success(v.result === '合格' ? '验收合格 → 可转运' : '已标记返工')
      } else if (action.kind === 'transfer' && action.order) {
        await transferProdOrder(action.order.id, { transfer_to: v.transfer_to, photos })
        message.success('已转运装配区（已拍照）')
      } else if (action.kind === 'os-send' && action.os) {
        await sendOutsource(action.os.id, {
          supplier_name: v.supplier_name || undefined,
          sent_at: v.sent_at?.format('YYYY-MM-DD'),
          due_date: v.due_date?.format('YYYY-MM-DD'),
          material_supplied: v.material_supplied,
          photos,
          remark: v.remark || undefined,
        })
        message.success('外协已发出')
      } else if (action.kind === 'os-accept' && action.os) {
        await acceptOutsource(action.os.id, { result: v.result, reason: v.reason, photos })
        message.success('外协验收完成')
      }
      setAction(null)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }
  const doStart = async (o: ProdOrderRow) => {
    try {
      await startProdOrder(o.id)
      message.success('已开工')
      await load()
    } catch (e) {
      message.error(errMsg(e))
    }
  }
  const doReturn = async (o: OutsourceRow) => {
    try {
      await returnOutsource(o.id, {})
      message.success('已登记回厂待检')
      await load()
    } catch (e) {
      message.error(errMsg(e))
    }
  }
  /**
   * 队列行（docs/15）：车间是**按单干活**的 → 一行一个零件、行尾唯一主按钮（下发/开工/验收/转运）。
   * 过去是 7 列表格：图号要横着找、下一步动作混在「操作」列的一堆小链接里。
   */
  const orderRow = (kind: 'wait' | 'running' | 'transfer' | 'rework') => (r: ProdOrderRow): QItem => ({
    key: r.id,
    // ★ 方向 2 ③：左侧 3px 语义色条 —— **只给“这条与其他不同”的行**。
    //   实测教训（2026-10-05）：先给整个队列都上色（待下发=蓝、在制=蓝…）→ 5 行连成一条长线，
    //   等于没上（同一个队列里每一行都“正常”就没有一条值得标）。所以：
    //     超期 / 返工 = 红（真正卡住产线，值得从一屏里挑出来）
    //     其余一律中性（队���位置本身已经说明了它处在哪一步）
    tone: (r.overdue || kind === 'rework' ? 'err' : undefined) as QItem['tone'],
    lead: <Code to={`/items/${r.item_no}`}>{r.item_no}</Code>,
    title: `${r.item_name ?? ''} ${r.qty}${r.unit ?? ''}`,
    meta: (
      <>
        {r.order_no} · <Link to={`/projects/${r.project_no}`}>{r.project_no}</Link> {r.equip_no ?? ''} · 计划完成{' '}
        {r.plan_end ?? '未定'}
      </>
    ),
    cells: [
      { text: <Status tone={toneOf(STATUS_COLOR[r.status])}>{r.status}</Status>, title: '状态' },
      r.overdue ? { text: <Chip tone="err">超期</Chip>, title: '已过计划完成日' } : { text: '—', title: '计划完成' },
    ],
    actions: (
      <>
        <AuthedFileLink path={drawingFileUrl(r.item_no)}>看图纸</AuthedFileLink>
        <Button size="small" type="text" onClick={() => setDetail(r)}>
          详情
        </Button>
      </>
    ),
    action: !canEdit ? undefined : kind === 'wait' ? (
      <Button type="primary" size="small" onClick={() => openAction('dispatch', r)}>
        下发
      </Button>
    ) : kind === 'running' ? (
      r.status === '已派工' ? (
        <Button type="primary" size="small" onClick={() => void doStart(r)}>
          开工
        </Button>
      ) : (
        <Button type="primary" size="small" onClick={() => openAction('accept', r)}>
          验收
        </Button>
      )
    ) : kind === 'transfer' ? (
      <Button type="primary" size="small" onClick={() => openAction('transfer', r)}>
        转运
      </Button>
    ) : (
      <Button type="primary" size="small" onClick={() => openAction('dispatch', r)}>
        重新下发
      </Button>
    ),
  })

  const osColumns = [
    { title: '单号', dataIndex: 'outsource_no', width: 110 },
    {
      title: '项目 / 设备',
      key: 'pe',
      width: 150,
      render: (_: unknown, r: OutsourceRow) => `${r.project_no} · ${r.equip_no ?? ''}`,
    },
    {
      title: '零件（图号）',
      key: 'item',
      render: (_: unknown, r: OutsourceRow) => (
        // ★ 入口（2026-10-05）：车间按图号干活 → 图号直接进件档案（看是按哪版图、料到没到）
        <>
          <Code to={`/items/${r.item_no}`}>{r.item_no}</Code>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {' '}{r.item_name ?? ''}
          </Typography.Text>
        </>
      ),
    },
    { title: '数量', dataIndex: 'qty', width: 80, align: 'right' as const },
    { title: '供应商', dataIndex: 'supplier_name', width: 150, render: (v: string | null) => v ?? '—' },
    { title: '交期', dataIndex: 'due_date', width: 110, render: (v: string | null) => v ?? '—' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Status tone={toneOf(OS_COLOR[v])}>{v}</Status>,
    },
    {
      title: '操作',
      key: 'a',
      width: 160,
      render: (_: unknown, r: OutsourceRow) => (
        <Space size={4}>
          {canEdit && r.status === '待发出' && <a onClick={() => openAction('os-send', undefined, r)}>发出</a>}
          {canEdit && r.status === '外协中' && <a onClick={() => void doReturn(r)}>回厂</a>}
          {canEdit && r.status === '回厂待检' && <a onClick={() => openAction('os-accept', undefined, r)}>验收</a>}
        </Space>
      ),
    },
  ]
  const c = wb?.counts
  // 体：按页签 key 取（顺序 / 标题 / 徽标 / 可见性全来自注册表 SHOP_BOARD）
  const parts: Record<string, ReactNode> = {
    wait: (
      <>
        {/* ★ 这条队列的入口（生成排产单）必须留在这条队列里 —— 它属于"待下发"这一步 */}
      <Card size="small" title="生成排产单（按设备）" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: 240 }}
            placeholder="项目"
            value={genProject}
            onChange={(v: string | undefined) => void onGenProject(v)}
            options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
          />
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: 200 }}
            placeholder="设备"
            value={genEquip}
            onChange={setGenEquip}
            options={equips.map((e) => ({ value: e.equip_no, label: `${e.equip_no} ${e.equip_name}` }))}
          />
          <Button type="primary" disabled={!canEdit || !genProject || !genEquip} loading={genLoading} onClick={() => void doGenerate()}>
            生成排产单
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            按这台设备已发布的图纸展开：自制件 → 排产单，外协件 → 外协任务（重复生成不会重复建）。
          </Typography.Text>
        </Space>
      </Card>
        <QueueBoard
          emptyText="还没有待下发的排产单 —— 用上面的「生成排产单（按设备）」按已发布图纸展开。"
          items={(wb?.wait ?? []).map(orderRow('wait'))}
        />
      </>
    ),
    running: (
      <QueueBoard
        emptyText="没有在制 / 待验收的零件。"
        items={(wb?.running ?? []).map(orderRow('running'))}
      />
    ),
    transfer: (
      <QueueBoard
        emptyText="没有待转运装配区的零件（验收合格后要转运，装配那边才拿得到）。"
        items={(wb?.to_transfer ?? []).map(orderRow('transfer'))}
      />
    ),
    rework: (
      <QueueBoard
        emptyText="没有返工的零件。"
        items={(wb?.rework ?? []).map(orderRow('rework'))}
      />
    ),
    outsource: (
          <Table<OutsourceRow> rowKey="id" size="small" loading={loading} dataSource={wb?.outsource ?? []} pagination={{ pageSize: 10, showSizeChanger: true }} locale={{ emptyText: <DsEmpty text="没有外协任务" /> }} columns={osColumns} />
        
    ),
  }

  return (
    <div className="ds-page">
      {/* ★ docs/15 台骨架四件套（制造视图）：台头 → 结论条 → 流程条（注册表驱动）→ 体 */}
      <WorkbenchPage
        board={SHOP_BOARD}
        sub={c?.overdue ? `有 ${c.overdue} 张排产单已超期` : '没有超期的排产单'}
        help="车间只管两头：下任务 + 验收零件。上面数字可点，点了切到对应队列。"
        actions={
          <Button size="small" onClick={() => void load()}>
            刷新
          </Button>
        }
        toolbar={<ShopViews />}
        flowSize="small"
        counts={{
          wait: (c?.wait ?? 0),
          running: (c?.running ?? 0),
          transfer: (c?.to_transfer ?? 0),
          rework: (c?.rework ?? 0),
        }}
        metrics={[
          // ★ 方向 2 ② 主角指认：车间台主角 = **待下发**：没下任务，后面的在制/转运/验收全是空的（“车间的头一棒”）。（ds `MetricItem.lead`）
          { key: 'wait', label: '待下发', value: c?.wait ?? 0, unit: '项', tone: c?.wait ? 'warn' : undefined, dimZero: true, to: '?tab=wait', lead: true },
          { key: 'running', label: '在制 / 待验收', value: c?.running ?? 0, unit: '项', dimZero: true, to: '?tab=running' },
          { key: 'transfer', label: '待转运装配区', value: c?.to_transfer ?? 0, unit: '项', dimZero: true, to: '?tab=transfer' },
          { key: 'rework', label: '返工', value: c?.rework ?? 0, unit: '项', tone: c?.rework ? 'err' : undefined, dimZero: true, to: '?tab=rework' },
          { key: 'overdue', label: '超期排产单', value: c?.overdue ?? 0, unit: '张', tone: c?.overdue ? 'err' : undefined, dimZero: true, to: '?tab=running' },
        ]}
      >
        {(t) => parts[t]}
      </WorkbenchPage>
      {/* 动作弹窗 */}
      <AppModal
        open={!!action}
        title={
          action?.kind === 'dispatch'
            ? `下发到工序 · ${action?.order?.item_no ?? ''}`
            : action?.kind === 'accept'
              ? `到期验收 · ${action?.order?.item_no ?? ''}`
              : action?.kind === 'transfer'
                ? `转运 · ${action?.order?.item_no ?? ''}`
                : action?.kind === 'os-send'
                  ? `外协发出 · ${action?.os?.item_no ?? ''}`
                  : `外协验收 · ${action?.os?.item_no ?? ''}`
        }
        onClose={() => setAction(null)}
        onOk={() => void submitAction()}
        loading={saving}
        okText="提交"
        form={form}
        initialValues={actionInitial}
      >
          {action?.kind === 'dispatch' && (
            <>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                下发内容：**原材料 + 图纸**（图纸版本以发布版为准），拍照确认已交到工序。
              </Typography.Paragraph>
              <Space style={{ display: 'flex' }} size="middle" align="start">
                <Form.Item name="step_name" label="第一道工序" rules={[{ required: true }]}>
                  <Select style={{ width: 160 }} options={TEAMS.map((t) => ({ value: t, label: t }))} />
                </Form.Item>
                <Form.Item name="issued_to" label="交到（班组/人）">
                  <Input style={{ width: 160 }} placeholder="如 下料班" />
                </Form.Item>
              </Space>
              <Space style={{ display: 'flex' }} size="middle" align="start">
                <Form.Item name="material_item_no" label="原材料（型号级）">
                  <Input style={{ width: 220 }} placeholder="如 YL-FT-0001" />
                </Form.Item>
                <Form.Item name="material_qty" label="数量">
                  <InputNumber style={{ width: 120 }} min={0} />
                </Form.Item>
              </Space>
            </>
          )}
          {action?.kind === 'accept' && (
            <>
              <Form.Item name="result" label="验收结论" rules={[{ required: true }]}>
                <Radio.Group optionType="button" buttonStyle="solid">
                  <Radio.Button value="合格">合格</Radio.Button>
                  <Radio.Button value="不合格">不合格</Radio.Button>
                  <Radio.Button value="返工">返工</Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Form.Item name="reason" label="原因 / 说明">
                <Input.TextArea rows={2} placeholder="不合格或返工时写原因" />
              </Form.Item>
            </>
          )}
          {action?.kind === 'transfer' && (
            <Form.Item name="transfer_to" label="转运到" rules={[{ required: true }]}>
              <Select style={{ width: 200 }} options={['装配区', '半成品区', '待发区'].map((t) => ({ value: t, label: t }))} />
            </Form.Item>
          )}
          {action?.kind === 'os-send' && (
            <>
              <Space style={{ display: 'flex' }} size="middle" align="start">
                <Form.Item name="supplier_name" label="外协供应商">
                  <Input style={{ width: 200 }} placeholder="供应商名" />
                </Form.Item>
                <Form.Item name="material_supplied" label="供料方式">
                  <Radio.Group>
                    <Radio value={true}>我方供料</Radio>
                    <Radio value={false}>外协供料</Radio>
                  </Radio.Group>
                </Form.Item>
              </Space>
              <Space style={{ display: 'flex' }} size="middle" align="start">
                <Form.Item name="sent_at" label="发出日期">
                  <DatePicker style={{ width: 160 }} />
                </Form.Item>
                <Form.Item name="due_date" label="约定交期">
                  <DatePicker style={{ width: 160 }} />
                </Form.Item>
              </Space>
            </>
          )}
          {action?.kind === 'os-accept' && (
            <>
              <Form.Item name="result" label="验收结论" rules={[{ required: true }]}>
                <Radio.Group optionType="button" buttonStyle="solid">
                  <Radio.Button value="合格">合格</Radio.Button>
                  <Radio.Button value="不合格">不合格</Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Form.Item name="reason" label="原因 / 说明">
                <Input.TextArea rows={2} />
              </Form.Item>
            </>
          )}
          {action && (
            <Form.Item label="拍照留痕（必须）" required>
              <MfgPhotoPicker
                projectNo={action.order?.project_no ?? action.os?.project_no ?? ''}
                refNo={action.order?.order_no ?? action.os?.outsource_no ?? ''}
                value={photos}
                onChange={setPhotos}
              />
            </Form.Item>
          )}
      </AppModal>
      {/* 详情 */}
      <Drawer
        width={560}
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `排产单 ${detail.order_no}` : ''}
      >
        {detail && (
          <>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="项目 / 设备">{detail.project_no} · {detail.equip_no ?? ''}</Descriptions.Item>
              <Descriptions.Item label="零件">{detail.item_no} {detail.item_name ?? ''}</Descriptions.Item>
              <Descriptions.Item label="数量">{detail.qty} {detail.unit}</Descriptions.Item>
              <Descriptions.Item label="计划">{detail.plan_start ?? '—'} ~ {detail.plan_end ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="状态"><Status tone={toneOf(STATUS_COLOR[detail.status])}>{detail.status}</Status></Descriptions.Item>
              <Descriptions.Item label="原材料">{detail.material_item_no ?? '—'}</Descriptions.Item>
            </Descriptions>
            <Typography.Title level={5} style={{ marginTop: 16 }}>下发记录</Typography.Title>
            {(detail.tasks ?? []).length === 0 && <DsEmpty text="还没下发" />}
            {(detail.tasks ?? []).map((t) => (
              <Card key={t.id} size="small" style={{ marginBottom: 8 }}>
                <div>
                  {t.step_name} · {t.issued_to ?? '—'} · 图纸 {t.drawing_no} {t.drawing_version ?? ''}
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  原材料 {t.material_item_no ?? '—'} · {t.issued_at?.slice(0, 16).replace('T', ' ') ?? ''}
                </Typography.Text>
                <Space wrap style={{ marginTop: 6 }}>
                  {t.photos.map((p) => (
                    <AuthedImage key={p} path={mfgPhotoUrl(p)} size={56} />
                  ))}
                </Space>
              </Card>
            ))}
            <Typography.Title level={5} style={{ marginTop: 16 }}>验收 / 转运</Typography.Title>
            {(detail.acceptances ?? []).length === 0 && <DsEmpty text="还没验收" />}
            {(detail.acceptances ?? []).map((a) => (
              <Card key={a.id} size="small" style={{ marginBottom: 8 }}>
                <Status tone={a.result === '合格' ? 'ok' : 'err'}>{a.result}</Status>
                {a.reason}
                <div style={{ fontSize: 12, color: T.textSecondary }}>
                  {a.accepted_at?.slice(0, 16).replace('T', ' ') ?? ''}
                  {a.transfer_at ? ` · 已转运 ${a.transfer_to}（${a.transfer_at.slice(0, 16).replace('T', ' ')}）` : ''}
                </div>
                <Space wrap style={{ marginTop: 6 }}>
                  {[...a.photos, ...a.transfer_photos].map((p) => (
                    <AuthedImage key={p} path={mfgPhotoUrl(p)} size={56} />
                  ))}
                </Space>
              </Card>
            ))}
          </>
        )}
      </Drawer>
    </div>
  )
}
