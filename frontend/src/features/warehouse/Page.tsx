import { useWarehouseBoard } from './hooks'
import type { IncomingRow, IssueRow, MoveRow, StockRow, StorageRow } from './types'
import { App, Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Radio, Select, Space, Table, Typography } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import AuthedImage from '../../components/AuthedImage'
import AppModal from '../../components/AppModal'
import { SelectLocation } from '../../components/fields'
import { useRequest } from '../../hooks/useRequest'
import { useSubmit } from '../../hooks/useSubmit'
import { api, createLocation, errMsg, generateEquipmentIssue, hasPerm, inspectPurchase, listEquipment, listLocations, listProjects, manualInbound, searchItems, storeReceipt, type ItemLite, type LocationRow } from '../../api/client'
import { WH_ISSUE_STATUS as ISSUE_COLOR, toneOf } from '../../theme/status'
import {Chip, Code, Empty as DsEmpty } from '../../components/ds'
import QueueBoard from '../../components/ds/QueueBoard'
import { WAREHOUSE_BOARD } from '../../configs/boards'
import WorkbenchPage from '../../components/domain/WorkbenchPage'
/**
 * 仓库只有两个动作：
 *   ① 验收（货到了就验，合格 / 不合格）→ 合格进「待入库」，不合格回采购「验收不合格」协商
 *   ② 入库（选库位）—— 分批送货就分批验收、分批入库，剩下的还算未到货
 */
export default function Warehouse() {
  const { message } = App.useApp()
  const canStore = hasPerm('warehouse:edit')
  // 生成领料单（按设备）
  const [genProject, setGenProject] = useState<string | undefined>()
  const [genEquip, setGenEquip] = useState<string | undefined>()
  const [genProjects, setGenProjects] = useState<{ project_no: string; project_name: string }[]>([])
  const [genEquips, setGenEquips] = useState<{ equip_no: string; equip_name: string }[]>([])
  const [genLoading, setGenLoading] = useState(false)
  const [genErr, setGenErr] = useState<string | null>(null)
  // 其他入库（退料回库 / 盘盈）
  const [inboundOpen, setInboundOpen] = useState(false)
  const [itemOptions, setItemOptions] = useState<ItemLite[]>([])
  const [inboundForm] = Form.useForm()
  // 库位管理（重构 1.2：库位数据改用下方 useRequest，不再 useState 手写）
  const [handOverId, setHandOverId] = useState<number | null>(null)
  const [handOverTo, setHandOverTo] = useState('')
  const [locOpen, setLocOpen] = useState(false)
  const [locForm] = Form.useForm()
  const itemSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [acceptTarget, setAcceptTarget] = useState<IncomingRow | null>(null)
  const [storeOpen, setStoreOpen] = useState(false)
  const [storeTarget, setStoreTarget] = useState<StorageRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [acceptForm] = Form.useForm()
  const [storeForm] = Form.useForm()
  const acceptResult = Form.useWatch('result', acceptForm)
  // 重构 2.0：数据与刷新走共享 hook（与移动端同源，计数必然一致）
  const { wb, stock, moves, issueCount, reload: load } = useWarehouseBoard({ full: true })
  // 生成领料单用：项目列表
  useEffect(() => {
    listProjects()
      .then((rows) => setGenProjects(rows.map((p) => ({ project_no: p.project_no, project_name: p.project_name }))))
      .catch(() => undefined)
  }, [])
  // ↓ 试点（重构 1.2）：库位选项改用 useRequest 三态（原 useEffect + useState 手写）
  const locsReq = useRequest(() => listLocations(), [])
  const locs = locsReq.data ?? []
  const searchItemOptions = (q: string) => {
    if (itemSearchTimer.current) clearTimeout(itemSearchTimer.current)
    itemSearchTimer.current = setTimeout(() => {
      searchItems(q)
        .then(setItemOptions)
        .catch(() => undefined)
    }, 250)
  }
  const doInbound = async () => {
    let v
    try { v = await inboundForm.validateFields() } catch { return }
    setSaving(true)
    try {
      await manualInbound({
        item_no: v.item_no,
        qty: v.qty,
        location_id: v.location_id,
        project_no: v.project_no || undefined,
        equip_no: v.equip_no || undefined,
        ref_no: v.ref_no || undefined,
        remark: v.remark || undefined,
      })
      message.success('已入库（其他入库）')
      setInboundOpen(false)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }
  const doCreateLocation = async () => {
    let v
    try { v = await locForm.validateFields() } catch { return }
    setSaving(true)
    try {
      await createLocation(v)
      message.success('库位已建')
      setLocOpen(false)
      locForm.resetFields()
      void locsReq.reload()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }
  const onGenProject = async (no?: string) => {
    setGenProject(no)
    setGenEquip(undefined)
    setGenEquips([])
    if (!no) return
    try {
      const rows = await listEquipment(no)
      setGenEquips(rows.map((e) => ({ equip_no: e.equip_no, equip_name: e.equip_name })))
    } catch (e) {
      message.error(errMsg(e))
    }
  }
  const doGenerateIssue = async () => {
    if (!genProject || !genEquip) return
    setGenLoading(true)
    setGenErr(null)
    try {
      const r = await generateEquipmentIssue(genProject, genEquip)
      // ★ 幂等（P1-7）：已有一张未结的领料单就复用它，不再重复建第二张
      if (r.reused) {
        message.info(r.reuse_hint ?? `已有一张未结的领料单 ${r.issue_no}，继续用它`)
      } else {
        message.success(
          `已生成领料单 ${r.issue_no}（${r.line_count} 种${r.shortage_count ? `，缺料 ${r.shortage_count} 种` : '，库存都够'}）—— 到「领料」里去备料`,
        )
      }
      await load()
    } catch (e) {
      // P-20：错误常驻在卡片上，不只一闪而过的 toast
      setGenErr(errMsg(e))
      message.error(errMsg(e))
    } finally {
      setGenLoading(false)
    }
  }
  const openAccept = (r: IncomingRow) => {
    // 重构 1.2：不再手工 setFieldsValue —— 预填交给 AppModal 的 initialValues（打开即挂载即读）
    setAcceptTarget(r)
    setAcceptOpen(true)
  }
  // 重构 1.2：提交走 useSubmit（validate/catch/防重/反馈一条龙，根治 P-09 类裸 await）
  const acceptSubmit = useSubmit(acceptForm, {
    request: (v) => {
      if (!acceptTarget) throw new Error('无验收目标')
      const qtyOk = v.result === '合格' && typeof v.qty_ok === 'number' ? v.qty_ok : undefined
      return inspectPurchase(acceptTarget.project_no, acceptTarget.id, {
        receipt_date: v.receipt_date.format('YYYY-MM-DD'),
        qty: v.qty,
        result: v.result,
        qty_ok: qtyOk,
        qty_rejected: qtyOk !== undefined ? Math.max(0, v.qty - qtyOk) : undefined,
        po_line_id: v.po_line_id,
        note: v.note,
      })
    },
    success: (res) =>
      acceptResult === '不合格'
        ? `验收不合格：${res.receipt_no} 已退回采购协商`
        : `验收合格 → ${res.receipt_no} 待入库`,
    close: () => setAcceptOpen(false),
    after: () => load(),
  })
  const openStore = (r: StorageRow) => {
    setStoreTarget(r)
    setStoreOpen(true)
  }
  const storeSubmit = useSubmit(storeForm, {
    request: (v) => {
      if (!storeTarget) throw new Error('无入库目标')
      return storeReceipt(storeTarget.id, { location: v.location, note: v.note })
    },
    success: (res) => `已入库：${res.receipt_no} → ${res.location}`,
    close: () => setStoreOpen(false),
    after: () => load(),
  })
  const issueAction = async (id: number, action: 'pick' | 'hand-over') => {
    if (action === 'hand-over') {
      // 领料人用弹窗录入（P-12：不再用浏览器原生 prompt）
      setHandOverId(id)
      setHandOverTo('')
      return
    }
    try {
      const res = await api.post<{ ok: boolean; status: string }>(`/warehouse/issues/${id}/pick`, {})
      // ★ 走查 2026-10-04 P2：部分领料再备后如实说清（还有缺料 → 补货后可在本页继续备）
      message.success(res.data.status === '部分领料' ? '已备料（仍有缺料，补货后可在本页继续备）' : '备料完成')
      await load()
    } catch (e) {
      message.error(errMsg(e))
    }
  }
  const doHandOver = async () => {
    if (!handOverId) return
    if (!handOverTo.trim()) {
      message.warning('请填领料人（谁领走的）')
      return
    }
    try {
      await api.post(`/warehouse/issues/${handOverId}/hand-over`, { issued_to: handOverTo.trim() })
      message.success('已领走（库存已扣）')
      setHandOverId(null)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    }
  }
  const openCount = (wb?.incoming.length ?? 0) + (wb?.pending_storage.length ?? 0) + (wb?.pending_issues.length ?? 0)
  // 体：按页签 key 取（顺序 / 标题 / 徽标 / 可见性全来自注册表 WAREHOUSE_BOARD）
  const parts: Record<string, ReactNode> = {
    incoming: (
      <QueueBoard
        emptyText="没有在路上、等到公司仓库的货。"
        items={(wb?.incoming ?? []).map((r: IncomingRow) => ({
          key: r.id,
          lead: <Code to={r.item_no ? `/items/${r.item_no}` : undefined}>{r.po_no ?? '未编号'}</Code>,
          title: r.display_name,
          meta: `${r.qty} ${r.unit ?? ''}（已到 ${r.qty_received}） · 供应商 ${r.supplier_name ?? '—'} · ${
            r.project_no ? `${r.project_no} ${r.equip_no ?? ''}` : (r.attribution ?? '辅料')
          }`,
          cells: [
            {
              text: r.expected_date ? (
                <>
                  {r.expected_date}
                  {r.overdue && <Chip tone="err" style={{ marginLeft: 6 }}>赶不上</Chip>}
                </>
              ) : (
                '未约期'
              ),
              title: '预计到货',
            },
          ],
          action: (
            <Button type="primary" size="small" disabled={!canStore} onClick={() => openAccept(r)}>
              验收
            </Button>
          ),
        }))}
      />
    ),
    storage: (
      <QueueBoard
        emptyText="没有等待入库的货。"
        items={(wb?.pending_storage ?? []).map((r: StorageRow) => ({
          key: r.id,
          lead: <Code>{r.receipt_no}</Code>,
          title: r.display_name,
          meta: `${r.qty ?? ''} ${r.unit ?? ''} · 验收 ${r.receipt_date ?? '—'} · ${r.project_no ?? ''} ${r.equip_no ?? ''}`,
          cells: [{ text: r.po_no ?? '—', title: '采购单' }],
          expand: (
            <Space wrap>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                验收照片：
              </Typography.Text>
              {(r.photos ?? []).length ? (
                (r.photos ?? []).map((p, i) => <AuthedImage key={i} path={p.url} size={72} />)
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  验收时没拍照
                </Typography.Text>
              )}
            </Space>
          ),
          action: (
            <Button type="primary" size="small" disabled={!canStore} onClick={() => openStore(r)}>
              入库
            </Button>
          ),
        }))}
      />
    ),
    issues: (
      <>
        <Card size="small" title="生成领料单（按设备）" style={{ marginBottom: 12 }}>
          <Space wrap>
            <Select
              showSearch
              optionFilterProp="label"
              aria-label="项目"
              style={{ width: 260 }}
              placeholder="项目"
              value={genProject}
              onChange={(v: string | undefined) => void onGenProject(v)}
              options={genProjects.map((p) => ({
                value: p.project_no,
                label: `${p.project_no} ${p.project_name}`,
              }))}
            />
            <Select
              showSearch
              optionFilterProp="label"
              aria-label="设备"
              style={{ width: 220 }}
              placeholder="设备"
              value={genEquip}
              onChange={setGenEquip}
              options={genEquips.map((e) => ({
                value: e.equip_no,
                label: `${e.equip_no} ${e.equip_name}`,
              }))}
            />
            <Button
              type="primary"
              disabled={!canStore || !genProject || !genEquip}
              loading={genLoading}
              onClick={() => void doGenerateIssue()}
            >
              生成领料单
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              按设备展开：自制件的原材料 + 整台设备的标准件；缺料会标出来，生成后到下面「领料」里备料 → 车间领走。
            </Typography.Text>
          </Space>
          {genErr && (
            <Alert
              type="warning"
              showIcon
              closable
              style={{ marginTop: 10 }}
              message="生成领料单失败"
              description={genErr}
              onClose={() => setGenErr(null)}
            />
          )}
        </Card>
        <QueueBoard
          emptyText="没有待处理的领料单 —— 在「制造」下发排产后，按设备在这里生成领料单。"
          items={(wb?.pending_issues ?? []).map((r: IssueRow) => ({
            key: r.id,
            lead: <Code>{r.issue_no}</Code>,
            title: `${r.project_no} · ${r.equip_no ?? ''}`,
            meta: `${r.line_count} 种物料 · ${
              r.shortage_count ? `${r.shortage_count} 种缺料（补货后可继续备料）` : '料齐'
            }`,
            cells: [
              { text: <Chip tone={toneOf(ISSUE_COLOR[r.status])}>{r.status}</Chip>, title: '状态' },
            ],
            expand: (
              <Table
                scroll={{ x: 850 }}
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={r.lines}
                columns={[
                  { title: '物料', dataIndex: 'display_name' },
                  { title: '需要', dataIndex: 'qty_required', width: 100, render: (v: number, x) => `${v} ${x.unit ?? ''}` },
                  { title: '库位', dataIndex: 'location_name', width: 150, render: (v: string | null) => v ?? '—' },
                  { title: '给哪个零件', dataIndex: 'for_part', width: 220 },
                  { title: '库存', dataIndex: 'shortage', width: 90, render: (v: boolean) => (v ? <Chip tone="err">不足</Chip> : <Chip tone="ok">够</Chip>) },
                ]}
              />
            ),
            action: (
              <>
                {/* ★ 走查 2026-10-04 P2：部分领料也必须能**继续备料**（后端 /pick 支持；补货后补差额） */}
                {(r.status === '待备料' || r.status === '部分领料') && (
                  <Button
                    size="small"
                    type={r.status === '部分领料' ? 'default' : 'primary'}
                    disabled={!canStore}
                    onClick={() => void issueAction(r.id, 'pick')}
                  >
                    {r.status === '部分领料' ? '继续备料' : '备料完成'}
                  </Button>
                )}
                {(r.status === '已备料' || r.status === '部分领料') && (
                  <Button size="small" type="primary" disabled={!canStore} onClick={() => void issueAction(r.id, 'hand-over')}>
                    车间领走
                  </Button>
                )}
              </>
            ),
          }))}
        />
      </>
    ),
    stock: (
      <>
        <Space wrap style={{ marginBottom: 12 }}>
          <Button disabled={!canStore} onClick={() => setInboundOpen(true)}>
            其他入库（退料回库 / 盘盈）
          </Button>
        </Space>
        <Table<StockRow>
          scroll={{ x: 1000 }}
          rowKey="id" size="small" dataSource={stock} pagination={{ pageSize: 10, showSizeChanger: true }}
          locale={{ emptyText: <DsEmpty text="还没有库存" /> }}
          columns={[
            { title: '物料', dataIndex: 'item_no', width: 140, render: (v: string) => <Code to={`/items/${v}`}>{v}</Code> },
            { title: '品名', dataIndex: 'display_name' },
            { title: '规格', dataIndex: 'spec_text' },
            { title: '库位', dataIndex: 'location_name', width: 160 },
            { title: '在库', dataIndex: 'qty_on_hand', width: 100, align: 'right', render: (v: number, r) => `${v} ${r.unit ?? ''}` },
            { title: '占用', dataIndex: 'qty_locked', width: 90, align: 'right' },
            { title: '可用', dataIndex: 'qty_available', width: 100, align: 'right', render: (v: number) => (v > 0 ? <Chip tone="ok">{v}</Chip> : <Chip tone="err">{v}</Chip>) },
          ]}
        />
      </>

    ),
    moves: (
      <Table<MoveRow>
          scroll={{ x: 1000 }}
        rowKey="id" size="small" dataSource={moves} pagination={{ pageSize: 10, showSizeChanger: true }}
        columns={[
          { title: '类型', dataIndex: 'move_type', width: 80, render: (v: string) => <Chip tone={toneOf(v === '入库' ? 'green' : 'orange')}>{v}</Chip> },
          { title: '物料', dataIndex: 'item_no', width: 140 },
          { title: '品名', dataIndex: 'display_name' },
          { title: '数量', dataIndex: 'qty', width: 90, align: 'right' },
          { title: '库位', key: 'loc', width: 170, render: (_: unknown, r: MoveRow) => r.to_location ?? r.from_location ?? '—' },
          { title: '单据', dataIndex: 'ref_no', width: 130 },
          { title: '说明', dataIndex: 'remark' },
        ]}
      />

    ),
    locations: (
      <>
        <Space wrap style={{ marginBottom: 12 }}>
          <Button type="primary" disabled={!canStore} onClick={() => setLocOpen(true)}>
            新建库位
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            入库时选库位；这里可以集中看/补建库位。
          </Typography.Text>
        </Space>
        <Table<LocationRow>
          scroll={{ x: 720 }}
          rowKey="id" size="small" dataSource={locs} pagination={{ pageSize: 10, showSizeChanger: true }}
          locale={{ emptyText: <DsEmpty text="还没有库位" /> }}
          columns={[
            { title: '仓库', dataIndex: 'warehouse', width: 130 },
            { title: '库位编码', dataIndex: 'code', width: 160 },
            { title: '名称', dataIndex: 'name', render: (v: string | null) => v ?? '—' },
            { title: '在库物料数', dataIndex: 'item_count', width: 110, align: 'right' },
            {
              title: '状态', dataIndex: 'is_active', width: 90,
              render: (v: boolean) => (v ? <Chip tone="ok">启用</Chip> : <Chip>停用</Chip>),
            },
            { title: '备注', dataIndex: 'remark', render: (v: string | null) => v ?? '—' },
          ]}
        />
      </>

    ),
  }
  return (
    <div className="ds-page">
      {/* ★ R3 统一壳：台 = PageHead（标题+一句现状+刷新） + Panel（装页签与内容）。
          页签 key 一个没改（通知 link / ROUTE_REDIRECTS / ?tab= 深链靠它）。 */}
      {/* ★ docs/15 台骨架四件套：台头 → 结论条 → 流程条（注册表驱动）→ 体 */}
      <WorkbenchPage
        board={WAREHOUSE_BOARD}
        sub={
          // ★ 方向 2 ①：台头只说**现状**，不把结论条那 5 个数再说一遍（同一批数说两遍 = 逼眼）。
          //   异常优先：先报“缺货几种 / 今日有没有活”，其余交给结论条。
          (wb?.stock.out_of_stock ?? 0) > 0
            ? `今天有 ${openCount} 项待办 · 缺货 ${wb?.stock.out_of_stock} 种`
            : openCount > 0
              ? `今天有 ${openCount} 项待办（收货 / 入库 / 领料）`
              : '今天没有待办的收货 / 入库 / 领料'
        }
        help="仓库只有两个动作：验收（合格/不合格）和入库；领料单在这里备料、车间来领走。上面的数字可点。"
        actions={
          <>
            {/* ★ 精调（2026-10-05）：台头 actions 只留**能按下去的动作**。
                 原来这里摆的是“缺货 3 种 / 到货超期 N / 有风险 N”这类**纯计数**——
                 而结论条里已经有同一个数（而且**可点**，点了直接切到那个队列）。
                 同一批数在一个页上出现两次，是“看着毛”的头号来源（实测 5 个台都有）。 */}
            <Button size="small" onClick={() => void load()}>
              刷新
            </Button>
          </>
        }
        counts={{
          incoming: wb?.incoming.length ?? 0,
          storage: wb?.pending_storage.length ?? 0,
          issues: wb?.pending_issues.length ?? 0,
        }}
        metrics={[
          // ★ 方向 2 ② 主角指认：仓库台主角 = **待验收**：货到了不验收就卡入库、卡领料，是仓库每一天的第一件事。（ds `MetricItem.lead`）
          { key: 'incoming', label: '待验收', value: wb?.incoming.length ?? 0, unit: '单', tone: wb?.incoming.length ? 'warn' : undefined, dimZero: true, to: '?tab=incoming', lead: true },
          { key: 'storage', label: '待入库', value: wb?.pending_storage.length ?? 0, unit: '单', tone: wb?.pending_storage.length ? 'warn' : undefined, dimZero: true, to: '?tab=storage' },
          { key: 'issues', label: '待领料', value: wb?.pending_issues.length ?? 0, unit: '单', tone: wb?.pending_issues.length ? 'warn' : undefined, dimZero: true, to: '?tab=issues' },
          { key: 'stock', label: '缺货', value: wb?.stock.out_of_stock ?? 0, unit: '种', tone: (wb?.stock.out_of_stock ?? 0) > 0 ? 'err' : undefined, dimZero: true, to: '?tab=stock' },
          { key: 'moves', label: '领料单未结', value: issueCount, unit: '张', dimZero: true, to: '?tab=moves' },
        ]}
      >
        {(t) => parts[t]}
      </WorkbenchPage>
      {/* 其他入库 */}
      <Modal
        className="engineering-modal"
        title="其他入库（退料回库 / 盘盈）"
        open={inboundOpen}
        onCancel={() => setInboundOpen(false)}
        onOk={() => void doInbound()}
        confirmLoading={saving}
        okText="入库"
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0 }}>
          没走采购流程的东西：退料回库、盘盈、其他来源。正常采购到货请用「待办 → 验收 → 入库」。
        </Typography.Paragraph>
        <Form form={inboundForm} layout="vertical" preserve={false}>
          <Form.Item name="item_no" label="物料" rules={[{ required: true, message: '选物料' }]}>
            <Select
              showSearch
              filterOption={false}
              placeholder="输编码 / 品名 / 规格搜物料"
              onSearch={searchItemOptions}
              options={itemOptions.map((i) => ({
                value: i.item_no,
                label: `${i.item_no} ${i.display_name}${i.spec_text ? ` · ${i.spec_text}` : ''}`,
              }))}
            />
          </Form.Item>
          <Space style={{ display: 'flex' }} size="middle" align="start">
            <Form.Item name="qty" label="数量" rules={[{ required: true, message: '填数量' }]}>
              <InputNumber min={0.001} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="location_id" label="入库库位" rules={[{ required: true, message: '选库位' }]} style={{ minWidth: 240 }}>
              <SelectLocation valueMode="id" placeholder="选库位" />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex' }} size="middle" align="start">
            <Form.Item name="project_no" label="项目号（可选）">
              <Input placeholder="如 TX26001" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="equip_no" label="设备号（可选）">
              <Input placeholder="如 01A" style={{ width: 140 }} />
            </Form.Item>
          </Space>
          <Form.Item name="ref_no" label="单据 / 参考号（可选）">
            <Input placeholder="如退料单号" />
          </Form.Item>
          <Form.Item name="remark" label="说明">
            <Input placeholder="如：车间多领退回" />
          </Form.Item>
        </Form>
      </Modal>
      {/* 新建库位 */}
      <Modal
        className="engineering-modal"
        title="新建库位"
        open={locOpen}
        onCancel={() => setLocOpen(false)}
        onOk={() => void doCreateLocation()}
        confirmLoading={saving}
        okText="创建"
        destroyOnHidden
      >
        <Form form={locForm} layout="vertical" preserve={false}>
          <Form.Item name="warehouse" label="仓库" rules={[{ required: true, message: '填仓库名' }]}>
            <Input placeholder="如 主仓 / 车间仓" />
          </Form.Item>
          <Form.Item name="code" label="库位编码" rules={[{ required: true, message: '填库位编码' }]}>
            <Input placeholder="如 A-01-02" />
          </Form.Item>
          <Form.Item name="name" label="名称（可选）">
            <Input placeholder="如 电气件区" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      {/* 验收（合格 / 不合格）—— 重构 1.2 试点：AppModal + useSubmit（预填走 initialValues，打开即生效） */}
      <AppModal
        open={acceptOpen}
        title={`验收 · ${acceptTarget?.display_name ?? ''}`}
        subtitle={
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0 }}>
            采购单 {acceptTarget?.po_no ?? '未编号'} · {acceptTarget?.supplier_name ?? '—'} ·{' '}
            归属 {acceptTarget?.project_no ?? acceptTarget?.attribution ?? '—'} {acceptTarget?.equip_no ? `· ${acceptTarget.equip_no} ${acceptTarget.equip_name ?? ''}` : ''}
            {acceptTarget ? `　（订购 ${acceptTarget.qty} ${acceptTarget.unit ?? ''}，已到 ${acceptTarget.qty_received}）` : ''}
          </Typography.Paragraph>
        }
        width={580}
        form={acceptForm}
        initialValues={
          acceptTarget
            ? {
                receipt_date: dayjs(),
                qty: Math.max(acceptTarget.qty - acceptTarget.qty_received, 0.001),
                result: '合格',
                po_line_id:
                  acceptTarget.lines && acceptTarget.lines.length === 1
                    ? acceptTarget.lines[0].po_line_id
                    : undefined,
              }
            : {}
        }
        onOk={acceptSubmit.run}
        loading={acceptSubmit.loading}
        okText="提交验收"
        danger={acceptResult === '不合格'}
        onClose={() => setAcceptOpen(false)}
      >
          <Form.Item name="result" label="验收结果" rules={[{ required: true }]}>
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="合格">合格</Radio.Button>
              <Radio.Button value="不合格">不合格</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Space style={{ display: 'flex' }} size="middle" align="start">
            <Form.Item
              name="receipt_date"
              label="到货日期"
              style={{ minWidth: 170 }}
              rules={[{ required: true, message: '请填到货日期' }]}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="qty"
              label={acceptResult === '不合格' ? '不合格数量' : '本次到货数量'}
              style={{ minWidth: 180 }}
              rules={[{ required: true, message: '请填本次到货数量（入库/结算的依据，不能空）' }]}
            >
              <InputNumber
                style={{ width: '100%' }}
                min={0.001}
                max={acceptTarget ? Math.max(0.001, acceptTarget.qty - acceptTarget.qty_received) : undefined}
                suffix={acceptTarget?.unit ?? undefined}
              />
            </Form.Item>
          </Space>
          {acceptTarget && (acceptTarget.lines?.length ?? 0) > 1 && (
            <Form.Item
              name="po_line_id"
              label="这批货是哪张采购单的"
              rules={[{ required: true, message: '拆给了多家，请指明是哪张单' }]}
              tooltip="一条需求拆给了多家供应商 —— 系统不猜，必须指明这批货是谁送的"
            >
              <Select
                options={(acceptTarget.lines ?? []).map((l) => ({
                  value: l.po_line_id,
                  label: `${l.po_no ?? '—'} · ${l.supplier_name ?? '—'} · 订 ${l.qty}（已到 ${l.received_qty}）`,
                }))}
              />
            </Form.Item>
          )}
          {acceptResult === '合格' && (
            <Form.Item
              name="qty_ok"
              label="其中合格数（不填 = 全部合格）"
              tooltip="部分合格：填合格数，剩余算不合格，会另生成一张「不合格」到货单回采购协商换货/退货"
            >
              <InputNumber
                style={{ width: 200 }}
                min={0}
                max={acceptTarget ? Math.max(0.001, acceptTarget.qty - acceptTarget.qty_received) : undefined}
                suffix={acceptTarget?.unit ?? undefined}
              />
            </Form.Item>
          )}
          <Form.Item
            name="note"
            label="说明"
            rules={acceptResult === '不合格' ? [{ required: true, message: '不合格要说明原因' }] : []}
          >
            <Input.TextArea rows={2} placeholder={acceptResult === '不合格' ? '如：尺寸超差 / 外观划伤，采购去协商' : '可不填'} />
          </Form.Item>
      </AppModal>
      {/* 入库 —— 重构 1.2 试点：AppModal + useSubmit */}
      <AppModal
        open={storeOpen}
        title={`入库 · ${storeTarget?.receipt_no ?? ''}`}
        subtitle={
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0 }}>
            {storeTarget?.display_name} × {storeTarget?.qty} {storeTarget?.unit ?? ''} · 采购单{' '}
            {storeTarget?.po_no ?? '未编号'} · 项目 {storeTarget?.project_no}
            {storeTarget?.equip_no ? ` · ${storeTarget.equip_no}` : ''}
          </Typography.Paragraph>
        }
        width={540}
        form={storeForm}
        onOk={storeSubmit.run}
        loading={storeSubmit.loading}
        okText="确认入库"
        onClose={() => setStoreOpen(false)}
      >
          <Form.Item name="location" label="入库库位" rules={[{ required: true, message: '入库必须定库位' }]}>
            <SelectLocation valueMode="text" />
          </Form.Item>
          <Form.Item name="note" label="备注" style={{ marginBottom: 0 }}>
            <Input placeholder="可不填" />
          </Form.Item>
      </AppModal>
      {/* 车间领走：录领料人（P-12） */}
      <Modal
        className="engineering-modal"
        title="车间领走"
        open={handOverId !== null}
        onCancel={() => setHandOverId(null)}
        onOk={() => void doHandOver()}
        okText="确认领走"
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="领料人" required>
            <Input
              value={handOverTo}
              onChange={(e) => setHandOverTo(e.target.value)}
              placeholder="如：车间 李四"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
