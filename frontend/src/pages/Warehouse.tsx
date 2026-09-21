import {
  App,
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, errMsg, inspectPurchase, storeReceipt, type GoodsReceiptRow } from '../api/client'

const ISSUE_COLOR: Record<string, string> = { 待备料: 'gold', 已备料: 'processing', 已领走: 'success' }

/** 在路上 / 部分到货：货到了就在这行上验收 */
interface IncomingRow {
  id: number
  project_no: string
  project_name?: string | null
  equip_no?: string | null
  equip_name?: string | null
  item_no: string
  display_name: string
  spec_text?: string | null
  qty: number
  qty_received: number
  unit?: string | null
  po_no?: string | null
  supplier_name?: string | null
  need_date?: string | null
  expected_date?: string | null
  overdue: boolean
}

/** 验收合格、等入库 */
type StorageRow = GoodsReceiptRow

interface Workbench {
  incoming: IncomingRow[]
  pending_storage: StorageRow[]
  pending_issues: IssueRow[]
  stock: { item_kinds: number; out_of_stock: number }
}
interface StockRow {
  id: number; item_no: string; display_name: string; spec_text?: string | null; unit?: string | null
  location_name?: string | null; qty_on_hand: number; qty_locked: number; qty_available: number
}
interface IssueRow {
  id: number; issue_no: string; project_no: string; equip_no?: string | null; status: string
  line_count: number; shortage_count: number; issued_to?: string | null
  lines: { id: number; item_no: string; display_name: string; qty_required: number; qty_issued: number; unit?: string | null; location_name?: string | null; shortage: boolean; for_part?: string | null }[]
}
interface MoveRow {
  id: number; item_no: string; display_name: string; move_type: string; qty: number
  from_location?: string | null; to_location?: string | null; ref_no?: string | null; remark?: string | null
}

/**
 * 仓库只有两个动作：
 *   ① 验收（货到了就验，合格 / 不合格）→ 合格进「待入库」，不合格回采购「验收不合格」协商
 *   ② 入库（选库位）—— 分批送货就分批验收、分批入库，剩下的还算未到货
 */
export default function Warehouse() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const [wb, setWb] = useState<Workbench | null>(null)
  const [stock, setStock] = useState<StockRow[]>([])
  const [issueCount, setIssueCount] = useState(0)
  const [moves, setMoves] = useState<MoveRow[]>([])
  const [loading, setLoading] = useState(false)
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [acceptTarget, setAcceptTarget] = useState<IncomingRow | null>(null)
  const [storeOpen, setStoreOpen] = useState(false)
  const [storeTarget, setStoreTarget] = useState<StorageRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [acceptForm] = Form.useForm()
  const [storeForm] = Form.useForm()
  const acceptResult = Form.useWatch('result', acceptForm)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, b, c, d] = await Promise.all([
        api.get<Workbench>('/warehouse/workbench').then((r) => r.data),
        api.get<StockRow[]>('/warehouse/stock').then((r) => r.data),
        api.get<IssueRow[]>('/warehouse/issues').then((r) => r.data),
        api.get<MoveRow[]>('/warehouse/moves?limit=50').then((r) => r.data),
      ])
      setWb(a); setStock(b); setIssueCount(c.length); setMoves(d)
    } catch (e) { message.error(errMsg(e)) } finally { setLoading(false) }
  }, [message])

  useEffect(() => { void load() }, [load])

  const openAccept = (r: IncomingRow) => {
    setAcceptTarget(r)
    acceptForm.setFieldsValue({
      receipt_date: dayjs(),
      qty: Math.max(r.qty - r.qty_received, 0.001),
      result: '合格',
      note: undefined,
    })
    setAcceptOpen(true)
  }

  const submitAccept = async () => {
    if (!acceptTarget) return
    let v: { receipt_date: dayjs.Dayjs; qty: number; result: string; note?: string }
    try { v = await acceptForm.validateFields() } catch { return }
    setSaving(true)
    try {
      const res = await inspectPurchase(acceptTarget.project_no, acceptTarget.id, {
        receipt_date: v.receipt_date.format('YYYY-MM-DD'),
        qty: v.qty,
        result: v.result,
        note: v.note,
      })
      message.success(
        v.result === '合格'
          ? `验收合格 → ${res.receipt_no} 待入库`
          : `验收不合格：${res.receipt_no} 已退回采购协商`,
      )
      setAcceptOpen(false)
      await load()
    } catch (e) { message.error(errMsg(e)) } finally { setSaving(false) }
  }

  const openStore = (r: StorageRow) => {
    setStoreTarget(r)
    storeForm.setFieldsValue({ location: undefined, note: undefined })
    setStoreOpen(true)
  }

  const submitStore = async () => {
    if (!storeTarget) return
    let v: { location?: string; note?: string }
    try { v = await storeForm.validateFields() } catch { return }
    setSaving(true)
    try {
      const res = await storeReceipt(storeTarget.id, { location: v.location, note: v.note })
      message.success(`已入库：${res.receipt_no} → ${res.location}`)
      setStoreOpen(false)
      await load()
    } catch (e) { message.error(errMsg(e)) } finally { setSaving(false) }
  }

  const issueAction = async (id: number, action: 'pick' | 'hand-over') => {
    const body: Record<string, unknown> = {}
    if (action === 'hand-over') body.issued_to = window.prompt('领料人（车间）') ?? undefined
    try {
      await api.post(`/warehouse/issues/${id}/${action}`, body)
      message.success(action === 'pick' ? '备料完成' : '已领走（库存已扣）')
      await load()
    } catch (e) { message.error(errMsg(e)) }
  }

  return (
    <Card
      title={
        <Space>
          <span>仓库</span>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            库存 {wb?.stock.item_kinds ?? 0} 种 · 缺货 {wb?.stock.out_of_stock ?? 0}
          </Typography.Text>
        </Space>
      }
      extra={<Button onClick={() => void load()}>刷新</Button>}
    >
      <Tabs
        items={[
          {
            key: 'todo',
            label: `待办 (${(wb?.incoming.length ?? 0) + (wb?.pending_storage.length ?? 0) + (wb?.pending_issues.length ?? 0)})`,
            children: (
              <>
                <Typography.Title level={5}>① 验收（货到了就验：合格 / 不合格）</Typography.Title>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                  分批送的货分批验收：合格 → 进「待入库」；不合格 → 回采购「验收不合格」协商换货/退货。
                </Typography.Paragraph>
                <Table<IncomingRow>
                  rowKey="id" size="small" loading={loading}
                  dataSource={wb?.incoming ?? []} pagination={false}
                  scroll={{ x: 1200 }}
                  locale={{ emptyText: <Empty description="没有在路上、等到公司仓库的货" /> }}
                  columns={[
                    { title: '采购单号', dataIndex: 'po_no', width: 125, fixed: 'left', render: (v: string | null) => v ?? '未编号' },
                    {
                      title: '物料', key: 'item', width: 230,
                      render: (_: unknown, r) => (
                        <>
                          <b>{r.display_name}</b>
                          <div style={{ fontSize: 12, color: '#8c8c8c' }}>{r.item_no}</div>
                        </>
                      ),
                    },
                    {
                      title: '订购 / 已到', key: 'qty', width: 110,
                      render: (_: unknown, r) => (
                        <>
                          <b>{r.qty} {r.unit ?? ''}</b>
                          <div style={{ fontSize: 12, color: '#8c8c8c' }}>已到 {r.qty_received}</div>
                        </>
                      ),
                    },
                    { title: '供应商', dataIndex: 'supplier_name', width: 140, render: (v) => v ?? '—' },
                    {
                      title: '项目 / 设备', key: 'belong', width: 190,
                      render: (_: unknown, r) => (
                        <>
                          <a onClick={() => nav(`/projects/${r.project_no}`)}>{r.project_no}</a>
                          <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                            {r.equip_no ? `${r.equip_no} ${r.equip_name ?? ''}` : (r.project_name ?? '')}
                          </div>
                        </>
                      ),
                    },
                    {
                      title: '预计到货', dataIndex: 'expected_date', width: 140,
                      render: (v: string | null, r) => (
                        <Space size={4}>
                          <span>{v ?? '—'}</span>
                          {r.overdue && <Tag color="red">赶不上需要日</Tag>}
                        </Space>
                      ),
                    },
                    {
                      title: '操作', key: 'a', width: 100, fixed: 'right',
                      render: (_: unknown, r) => (
                        <Button type="primary" size="small" onClick={() => openAccept(r)}>验收</Button>
                      ),
                    },
                  ]}
                />

                <Typography.Title level={5} style={{ marginTop: 24 }}>② 入库（验收合格，选库位入库）</Typography.Title>
                <Table<StorageRow>
                  rowKey="id" size="small" loading={loading}
                  dataSource={wb?.pending_storage ?? []} pagination={false}
                  scroll={{ x: 1200 }}
                  locale={{ emptyText: <Empty description="没有等待入库的货" /> }}
                  columns={[
                    { title: '到货单', dataIndex: 'receipt_no', width: 110, fixed: 'left', render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
                    {
                      title: '物料', key: 'item', width: 230,
                      render: (_: unknown, r) => (
                        <>
                          <b>{r.display_name}</b>
                          <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                            {r.item_no ?? ''}{r.spec_text ? ` · ${r.spec_text}` : ''}
                          </div>
                        </>
                      ),
                    },
                    { title: '数量', dataIndex: 'qty', width: 85, render: (v: number | null, r) => `${v ?? ''} ${r.unit ?? ''}` },
                    { title: '采购单号', dataIndex: 'po_no', width: 125, render: (v: string | null) => v ?? '未编号' },
                    {
                      title: '项目 / 设备', key: 'belong', width: 190,
                      render: (_: unknown, r) => (
                        <>
                          <a onClick={() => nav(`/projects/${r.project_no}`)}>{r.project_no}</a>
                          <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                            {r.equip_no ? `${r.equip_no} ${r.equip_name ?? ''}` : (r.project_name ?? '')}
                          </div>
                        </>
                      ),
                    },
                    { title: '验收日期', dataIndex: 'receipt_date', width: 105 },
                    {
                      title: '操作', key: 'a', width: 100, fixed: 'right',
                      render: (_: unknown, r) => (
                        <Button type="primary" size="small" onClick={() => openStore(r)}>入库</Button>
                      ),
                    },
                  ]}
                />

                <Typography.Title level={5} style={{ marginTop: 24 }}>③ 领料单（仓库备料 → 车间领走）</Typography.Title>
                <Table<IssueRow>
                  rowKey="id" size="small"
                  dataSource={wb?.pending_issues ?? []} pagination={false}
                  locale={{ emptyText: <Empty description="没有待处理的领料单" /> }}
                  expandable={{
                    expandedRowRender: (r) => (
                      <Table
                        rowKey="id" size="small" pagination={false} dataSource={r.lines}
                        columns={[
                          { title: '物料', dataIndex: 'display_name' },
                          { title: '需要', dataIndex: 'qty_required', width: 100, render: (v: number, x) => `${v} ${x.unit ?? ''}` },
                          { title: '库位', dataIndex: 'location_name', width: 150, render: (v: string | null) => v ?? '—' },
                          { title: '给哪个零件', dataIndex: 'for_part', width: 220 },
                          { title: '库存', dataIndex: 'shortage', width: 90, render: (v: boolean) => (v ? <Tag color="red">不足</Tag> : <Tag color="green">够</Tag>) },
                        ]}
                      />
                    ),
                  }}
                  columns={[
                    { title: '领料单', dataIndex: 'issue_no', width: 110, render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
                    { title: '项目 / 设备', key: 'p', render: (_: unknown, r) => <a onClick={() => nav(`/projects/${r.project_no}`)}>{r.project_no} · {r.equip_no ?? ''}</a> },
                    { title: '物料数', dataIndex: 'line_count', width: 90 },
                    { title: '缺料', dataIndex: 'shortage_count', width: 90, render: (v: number) => (v ? <Tag color="red">{v} 种</Tag> : <Tag color="green">齐</Tag>) },
                    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag color={ISSUE_COLOR[v]}>{v}</Tag> },
                    {
                      title: '操作', key: 'a', width: 150,
                      render: (_: unknown, r: IssueRow) => (
                        <Space>
                          {r.status === '待备料' && <Button size="small" type="primary" onClick={() => void issueAction(r.id, 'pick')}>备料完成</Button>}
                          {r.status === '已备料' && <Button size="small" type="primary" onClick={() => void issueAction(r.id, 'hand-over')}>车间领走</Button>}
                        </Space>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'stock',
            label: `库存 (${stock.length}) · 领料单 ${issueCount} 张`,
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                  入库动作完成后才有库存；车间来领料按这个出库。
                </Typography.Paragraph>
                <Table<StockRow>
                  rowKey="id" size="small" dataSource={stock} pagination={{ pageSize: 20, showSizeChanger: false }}
                  locale={{ emptyText: <Empty description="还没有库存" /> }}
                  columns={[
                    { title: '物料', dataIndex: 'item_no', width: 140 },
                    { title: '品名', dataIndex: 'display_name' },
                    { title: '规格', dataIndex: 'spec_text' },
                    { title: '库位', dataIndex: 'location_name', width: 160 },
                    { title: '在库', dataIndex: 'qty_on_hand', width: 100, align: 'right', render: (v: number, r) => `${v} ${r.unit ?? ''}` },
                    { title: '占用', dataIndex: 'qty_locked', width: 90, align: 'right' },
                    { title: '可用', dataIndex: 'qty_available', width: 100, align: 'right', render: (v: number) => (v > 0 ? <Tag color="green">{v}</Tag> : <Tag color="red">{v}</Tag>) },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'moves',
            label: '出入库流水',
            children: (
              <Table<MoveRow>
                rowKey="id" size="small" dataSource={moves} pagination={{ pageSize: 20, showSizeChanger: false }}
                columns={[
                  { title: '类型', dataIndex: 'move_type', width: 80, render: (v: string) => <Tag color={v === '入库' ? 'green' : 'orange'}>{v}</Tag> },
                  { title: '物料', dataIndex: 'item_no', width: 140 },
                  { title: '品名', dataIndex: 'display_name' },
                  { title: '数量', dataIndex: 'qty', width: 90, align: 'right' },
                  { title: '库位', key: 'loc', width: 170, render: (_: unknown, r: MoveRow) => r.to_location ?? r.from_location ?? '—' },
                  { title: '单据', dataIndex: 'ref_no', width: 130 },
                  { title: '说明', dataIndex: 'remark' },
                ]}
              />
            ),
          },
        ]}
      />

      {/* 验收（合格 / 不合格） */}
      <Modal
        title={`验收 · ${acceptTarget?.display_name ?? ''}`}
        open={acceptOpen}
        width={580}
        onCancel={() => setAcceptOpen(false)}
        onOk={() => void submitAccept()}
        confirmLoading={saving}
        okText="提交验收"
        okButtonProps={{ danger: acceptResult === '不合格' }}
        forceRender
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0 }}>
          采购单 {acceptTarget?.po_no ?? '未编号'} · {acceptTarget?.supplier_name ?? '—'} ·{' '}
          归属 {acceptTarget?.project_no} {acceptTarget?.equip_no ? `· ${acceptTarget.equip_no} ${acceptTarget.equip_name ?? ''}` : ''}
          {acceptTarget ? `　（订购 ${acceptTarget.qty} ${acceptTarget.unit ?? ''}，已到 ${acceptTarget.qty_received}）` : ''}
        </Typography.Paragraph>
        <Form form={acceptForm} layout="vertical">
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
              rules={[{ required: true }]}
            >
              <InputNumber style={{ width: '100%' }} min={0.001} addonAfter={acceptTarget?.unit ?? undefined} />
            </Form.Item>
          </Space>
          <Form.Item
            name="note"
            label="说明"
            rules={acceptResult === '不合格' ? [{ required: true, message: '不合格要说明原因' }] : []}
          >
            <Input.TextArea rows={2} placeholder={acceptResult === '不合格' ? '如：尺寸超差 / 外观划伤，采购去协商' : '可不填'} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 入库 */}
      <Modal
        title={`入库 · ${storeTarget?.receipt_no ?? ''}`}
        open={storeOpen}
        width={540}
        onCancel={() => setStoreOpen(false)}
        onOk={() => void submitStore()}
        confirmLoading={saving}
        okText="确认入库"
        forceRender
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0 }}>
          {storeTarget?.display_name} × {storeTarget?.qty} {storeTarget?.unit ?? ''} · 采购单{' '}
          {storeTarget?.po_no ?? '未编号'} · 项目 {storeTarget?.project_no}
          {storeTarget?.equip_no ? ` · ${storeTarget.equip_no}` : ''}
        </Typography.Paragraph>
        <Form form={storeForm} layout="vertical">
          <Form.Item name="location" label="入库库位">
            <Input placeholder="如 深圳仓 A-03-12（不填先用「待定」库位）" />
          </Form.Item>
          <Form.Item name="note" label="备注" style={{ marginBottom: 0 }}>
            <Input placeholder="可不填" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
