import { App, Button, Card, Col, Empty, Row, Space, Table, Tabs, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import SuppliersPage from './SuppliersPage'
import ManualPurchaseModal from '../../components/ManualPurchaseModal'
import PoApproveModal from '../../components/PoApproveModal'
import MergeOrderModal from '../../components/MergeOrderModal'
import PriceReferencePanel from '../../components/PriceReferencePanel'
import PurchaseOrderDrawer from '../../components/PurchaseOrderDrawer'
import ReceiptNegotiateModal from '../../components/ReceiptNegotiateModal'
import {
  errMsg,
  listSuppliers,
  listGoodsReceipts,
  purchaseOrders,
  purchasePool,
  hasPerm,
  type GoodsReceiptRow,
  type PurchaseOrderSummary,
  type PurchasePoolDemand,
  type PurchasePoolGroup,
} from '../../api/client'
import { ORDER_STATUS as ORDER_STATUS_COLOR } from '../../theme/status'
import { RECEIPT_STATUS as RECEIPT_STATUS_COLOR } from '../../theme/status'
import { T } from '../../theme/tokens'

const today = () => dayjs().format('YYYY-MM-DD')

/**
 * 采购工作台：采购只做三件事：下单（采购池合并）· 取消 · 更改供应商。
 * 验收不合格的货会回到这里（「验收不合格」页签），采购跟供应商协商换货/退货。
 * 验收、入库由仓库做，状态自己变。
 */
export default function PurchaseWorkbench() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const [pool, setPool] = useState<PurchasePoolGroup[]>([])
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([])
  const [failedReceipts, setFailedReceipts] = useState<GoodsReceiptRow[]>([])
  const [resolveReceipts, setResolveReceipts] = useState<GoodsReceiptRow[]>([])
  const [doneReceipts, setDoneReceipts] = useState<GoodsReceiptRow[]>([])
  const [selected, setSelected] = useState<string[]>([])
  // A1（v2 方案 §2.0.6）：页签 = URL query（?tab=suppliers 深链 / 旧 /suppliers redirect 落点 / 分享可还原）
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') || 'pool'
  const setTab = (k: string) => setSp(k === 'pool' ? {} : { tab: k }, { replace: true })
  const [manualOpen, setManualOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [orderKey, setOrderKey] = useState<string | null>(null)
  const [approveKey, setApproveKey] = useState<string | null>(null)
  // A4：到货跟踪行内带供应商联系方式（催货一屏可见 —— 方案 §2.0.4）
  const [supMap, setSupMap] = useState<Record<number, { contact_name?: string | null; phone?: string | null }>>({})
  useEffect(() => {
    listSuppliers()
      .then((rows) => setSupMap(Object.fromEntries(rows.filter((r) => r.id != null).map((r) => [r.id, r]))))
      .catch(() => undefined)
  }, [])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [negotiate, setNegotiate] = useState<{
    open: boolean
    orderKey: string | null
    requestIds: number[]
    itemLabel?: string
    leadDays?: number | null
  }>({ open: false, orderKey: null, requestIds: [] })
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, o, failed, replaced, returned, pending, done, site] = await Promise.all([
        purchasePool(),
        purchaseOrders(),
        listGoodsReceipts({ status: '不合格' }),
        listGoodsReceipts({ status: '已换货' }),
        listGoodsReceipts({ status: '已退货' }),
        listGoodsReceipts({ status: '待入库' }),
        listGoodsReceipts({ status: '已入库' }),
        listGoodsReceipts({ status: '现场已验收' }),
      ])
      setPool(p)
      setOrders(o)
      setFailedReceipts(failed)
      setResolveReceipts(
        [...replaced, ...returned].sort((a, b) => (b.resolved_at ?? '').localeCompare(a.resolved_at ?? '')),
      )
      setDoneReceipts([...pending, ...done, ...site])
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const poolRequests = pool.reduce((s, g) => s + g.request_count, 0)
  const openOrders = orders.filter((o) => o.status !== '已取消' && o.status !== '已完成')
  const toApprove = orders.filter((o) => ['待经理审', '待总监审'].includes(o.po_status ?? ''))
  // 到货跟踪 = 没到齐的单（在途/部分到货），按预计到货日升序；超期红、3天内临期黄
  const arrivals = orders
    .filter((o) => o.status === '在途' || o.status === '部分到货')
    .slice()
    .sort((a, b) => String(a.expected_date ?? '9999-99-99').localeCompare(String(b.expected_date ?? '9999-99-99')))
  const overdueCount = arrivals.filter((o) => o.expected_date && dayjs(o.expected_date).isBefore(dayjs(), 'day')).length
  const canBuy = hasPerm('purchase:edit')

  const selectedGroups = useMemo(
    () => pool.filter((g) => selected.includes(g.item_no)),
    [pool, selected],
  )
  const selectedLines = selectedGroups.reduce((s, g) => s + g.request_count, 0)

  const openMerge = (groups: PurchasePoolGroup[]) => {
    setSelected(groups.map((g) => g.item_no))
    setMergeOpen(true)
  }

  const handleMerged = () => {
    setMergeOpen(false)
    setSelected([])
    void load()
  }

  const openOrder = (key: string) => {
    setOrderKey(key)
    setDrawerOpen(true)
  }

  const handleNegotiated = () => {
    setNegotiate((n) => ({ ...n, open: false }))
    void load()
  }

  return (
    <Card title="采购工作台" extra={<Button onClick={() => void load()}>刷新</Button>}>
      {/* 待办头（06 卷 §8）：进页面第一眼看到该处理什么 */}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        {[
          { label: '采购池待下单', value: poolRequests, sub: `${pool.length} 种`, tab: 'pool', color: poolRequests ? T.brand : T.textDisabled },
          { label: '在途采购单', value: openOrders.length, sub: '等货', tab: 'orders', color: openOrders.length ? T.orange : T.textDisabled },
          { label: '验收不合格', value: failedReceipts.length, sub: '待跟供应商协商', tab: 'failed', color: failedReceipts.length ? T.error : T.textDisabled },
          { label: '退换处理中', value: resolveReceipts.length, sub: '换货/退货', tab: 'resolve', color: resolveReceipts.length ? T.purple : T.textDisabled },
          { label: '到货跟踪', value: arrivals.length, sub: overdueCount > 0 ? `${overdueCount} 单已超期` : '在途盯货', tab: 'arrivals', color: overdueCount > 0 ? T.error : T.warning },
        ].map((s) => (
          <Col xs={12} md={4} key={s.label}>
            <Card size="small" hoverable onClick={() => setTab(s.tab)} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: T.textSecondary }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: T.textDisabled }}>{s.sub}</div>
            </Card>
          </Col>
        ))}
      </Row>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          // ---------------------------------------------------------------- ① 待我审批（二期）
          {
            key: 'approve',
            label: `待我审批 (${toApprove.length})`,
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                  采购单提交后走<b>两级审批</b>：采购经理 → 采购总监（08 §4/§5）。点「审批」一屏看单头 +
                  每行价格对比（本次价 vs <b>同口径</b>历史），通过或退回（退回必填说明）。审批通过后供应商即接单。
                </Typography.Paragraph>
                <Table
                  rowKey="key"
                  size="small"
                  dataSource={toApprove}
                  locale={{ emptyText: '没有待我审批的采购单' }}
                  columns={[
                    { title: '单号', dataIndex: 'po_no', width: 130 },
                    { title: '供应商', dataIndex: 'supplier_name', width: 170, render: (v) => v ?? '—' },
                    { title: '行数', dataIndex: 'line_count', width: 70 },
                    {
                      title: '状态',
                      dataIndex: 'po_status',
                      width: 110,
                      render: (v: string) => <Tag color={ORDER_STATUS_COLOR[v] ?? 'default'}>{v}</Tag>,
                    },
                    { title: '预计到货', dataIndex: 'expected_date', width: 110, render: (v) => v ?? '—' },
                    {
                      title: '',
                      key: 'a',
                      width: 90,
                      render: (_: unknown, r: PurchaseOrderSummary) => (
                        <Button type="primary" size="small" onClick={() => setApproveKey(r.key)}>
                          审批
                        </Button>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          // ---------------------------------------------------------------- ① 采购池
          {
            key: 'pool',
            label: `采购池 (${pool.length} 种 / ${poolRequests} 条)`,
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                  <b>先查仓库 → 缺的进池 → 攒一攒合并下单</b>
                  （00 卷 §3.1②）。各设计小组下单节点不一样，但东西大差不差：勾选同类物料一起买，
                  量大了价格才好谈，供应商也愿意一次送。手工申请（车间耗品/现场缺件/辅料）免审核，提交即进池。
                </Typography.Paragraph>
                <Space style={{ marginBottom: 12 }} wrap>
                  <Button
                    type="primary"
                    disabled={selected.length === 0 || !canBuy}
                    title={selected.length === 0 ? '先在下面勾选要合并下单的物料行' : '把勾选的物料合并成一张采购单'}
                    onClick={() => setMergeOpen(true)}
                  >
                    合并下单
                    {selected.length > 0 ? `（${selected.length} 种 / ${selectedLines} 条）` : ''}
                  </Button>
                  {selected.length > 0 && (
                    <Button type="link" onClick={() => setSelected([])}>
                      清空选择
                    </Button>
                  )}
                  <Button onClick={() => setManualOpen(true)}>手工申请</Button>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    单个物料只有一条需求时，点行尾「去下单」即可。
                  </Typography.Text>
                </Space>
                <Table<PurchasePoolGroup>
                  rowKey="item_no"
                  size="middle"
                  loading={loading}
                  dataSource={pool}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  scroll={{ x: 960 }}
                  rowSelection={{
                    selectedRowKeys: selected,
                    onChange: (keys) => setSelected(keys as string[]),
                    columnWidth: 46,
                  }}
                  locale={{
                    emptyText: <Empty description="采购池是空的：BOM 需求先查仓库，有库存的不进池" />,
                  }}
                  expandable={{
                    expandedRowRender: (g) => (
                      <Table<PurchasePoolDemand>
                        rowKey="id"
                        size="small"
                        pagination={false}
                        dataSource={g.requests}
                        scroll={{ x: 1160 }}
                        columns={[
                          {
                            title: '项目 / 归属',
                            dataIndex: 'project_no',
                            width: 260,
                            render: (v: string | null, r) =>
                              v ? (
                                <a onClick={() => nav(`/projects/${v}`)}>
                                  {v} {r.project_name ?? ''}
                                </a>
                              ) : (
                                <Tag color="blue">{r.attribution ?? '公司级'}</Tag>
                              ),
                          },
                          {
                            title: '设备',
                            dataIndex: 'equip_no',
                            width: 130,
                            render: (v: string | null) => v ?? '—',
                          },
                          {
                            title: '零件',
                            key: 'part',
                            width: 200,
                            render: (_: unknown, r) =>
                              r.part_no ? (
                                <>
                                  <div style={{ fontSize: 12 }}>{r.part_no}</div>
                                  <div style={{ fontSize: 12, color: T.textSecondary }}>
                                    {r.part_title ?? ''}
                                  </div>
                                </>
                              ) : (
                                '—'
                              ),
                          },
                          {
                            title: '数量',
                            dataIndex: 'qty',
                            width: 110,
                            render: (v: number) => `${v} ${g.unit ?? ''}`,
                          },
                          {
                            title: '需要到货',
                            dataIndex: 'need_date',
                            width: 120,
                            render: (v: string | null) =>
                              v && v < today() ? (
                                <Space size={4}>
                                  <span>{v}</span>
                                  <Tag color="red">已过期</Tag>
                                </Space>
                              ) : (
                                (v ?? '—')
                              ),
                          },
                          {
                            title: '来源',
                            dataIndex: 'source',
                            width: 150,
                            render: (v: string, r) =>
                              v === '退货重采' ? (
                                <>
                                  <Tag color="orange">退货重采</Tag>
                                  {r.origin_po_no && (
                                    <div style={{ fontSize: 12, color: T.textSecondary }}>
                                      原 {r.origin_po_no}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <>
                                  <Tag>{v}</Tag>
                                  {r.source_release_no && (
                                    <div style={{ fontSize: 12, color: T.textSecondary }}>
                                      {r.source_release_no}
                                    </div>
                                  )}
                                  {v === '手工' && r.requester_name && (
                                    <div style={{ fontSize: 12, color: T.textSecondary }}>
                                      {r.requester_name}
                                    </div>
                                  )}
                                </>
                              ),
                          },
                          {
                            title: '采购周期',
                            dataIndex: 'lead_days',
                            width: 100,
                            render: (v: number | null) => (v ? `${v} 天` : '—'),
                          },
                          { title: '备注', dataIndex: 'remark', render: (v) => v ?? '—' },
                        ]}
                      />
                    ),
                  }}
                  columns={[
                    {
                      title: '物料',
                      key: 'item',
                      width: 260,
                      fixed: 'left',
                      render: (_: unknown, g) => (
                        <>
                          <b>{g.display_name}</b>
                          <div style={{ fontSize: 12, color: T.textSecondary }}>
                            {g.item_no}
                            {g.spec_text ? ` · ${g.spec_text}` : ''}
                          </div>
                        </>
                      ),
                    },
                    {
                      title: '需求',
                      key: 'demand',
                      width: 140,
                      render: (_: unknown, g) => (
                        <Space size={4}>
                          <span>{g.request_count} 条</span>
                          {g.mergeable && <Tag color="gold">★可合并</Tag>}
                        </Space>
                      ),
                    },
                    {
                      title: '合计数量',
                      dataIndex: 'total_qty',
                      width: 110,
                      align: 'right',
                      render: (v: number, g) => (
                        <b>
                          {v} {g.unit ?? ''}
                        </b>
                      ),
                    },
                    {
                      title: '最紧要货',
                      dataIndex: 'earliest_need',
                      width: 150,
                      render: (v: string | null) => (
                        <Space size={4}>
                          <span>{v ?? '—'}</span>
                          {v && v < today() && <Tag color="red">已过期</Tag>}
                        </Space>
                      ),
                    },
                    {
                      title: '涉及项目',
                      key: 'projects',
                      width: 170,
                      render: (_: unknown, g) => {
                        const projs = [...new Set(g.requests.map((r) => r.project_no))]
                        return (
                          <span title={projs.join('、')}>
                            {projs.length > 2 ? `${projs.length} 个项目` : projs.join('、')}
                          </span>
                        )
                      },
                    },
                    {
                      title: '操作',
                      key: 'action',
                      width: 130,
                      fixed: 'right',
                      render: (_: unknown, g) => (
                        <Button
                          size="small"
                          type={g.mergeable ? 'default' : 'primary'}
                          disabled={!canBuy}
                          onClick={() => openMerge([g])}
                        >
                          {g.mergeable ? '合并下单' : '去下单'}
                        </Button>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },

          // ---------------------------------------------------------------- ② 采购单
          {
            key: 'orders',
            label: `采购单 (${openOrders.length})`,
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                  一张单 = 一个采购单号，下面挂着各项目/设备的需求（合并下单的「归属」都在详情里）。
                  采购只做三件事：<b>下单 · 取消 · 更改供应商</b>；到货、验收、入库由仓库做。
                </Typography.Paragraph>
                <Table<PurchaseOrderSummary>
                  rowKey="key"
                  size="middle"
                  loading={loading}
                  dataSource={orders}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  scroll={{ x: 1180 }}
                  locale={{ emptyText: <Empty description="还没有下过采购单" /> }}
                  columns={[
                    {
                      title: '采购单号',
                      dataIndex: 'po_no',
                      width: 150,
                      fixed: 'left',
                      render: (v: string | null, o) => (
                        <>
                          <b>{v ?? '未编号'}</b>
                          <div style={{ fontSize: 12, color: T.textSecondary }}>
                            {o.line_count} 条 · {o.item_kinds} 种物料
                          </div>
                        </>
                      ),
                    },
                    {
                      title: '供应商',
                      dataIndex: 'supplier_name',
                      width: 150,
                      render: (v: string | null) => v ?? '—',
                    },
                    {
                      title: '需求归属（项目 / 设备）',
                      key: 'belong',
                      width: 260,
                      render: (_: unknown, o) => (
                        <>
                          {o.projects.map((p) => (
                            <Tag key={p.project_no}>{p.project_no}</Tag>
                          ))}
                          {o.equipments.map((e) => (
                            <Tag key={`${e.project_no}-${e.equip_no}`} color="blue">
                              {e.equip_no} {e.equip_name ?? ''}
                            </Tag>
                          ))}
                          {o.equipments.length === 0 && (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              没挂具体设备
                            </Typography.Text>
                          )}
                        </>
                      ),
                    },
                    { title: '下单日期', dataIndex: 'ordered_at', width: 105, render: (v) => v ?? '—' },
                    {
                      title: '预计到货',
                      dataIndex: 'expected_date',
                      width: 130,
                      render: (v: string | null, o) => (
                        <Space size={4}>
                          <span>{v ?? '—'}</span>
                          {v && v < today() && ['在途', '部分到货'].includes(o.status) && (
                            <Tag color="orange">已超期</Tag>
                          )}
                        </Space>
                      ),
                    },
                    {
                      title: '金额',
                      dataIndex: 'total_amount',
                      width: 120,
                      align: 'right',
                      render: (v: number) => (v > 0 ? `¥${v.toLocaleString()}` : '—'),
                    },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 95,
                      render: (v: string, o) => (
                        <>
                          <Tag color={ORDER_STATUS_COLOR[v]}>{v}</Tag>
                          {o.exchanged_qty > 0 && (
                            <div>
                              <Tag color="orange">换 {o.exchanged_qty}</Tag>
                            </div>
                          )}
                          {o.returned_qty > 0 && (
                            <div>
                              <Tag>退 {o.returned_qty}</Tag>
                            </div>
                          )}
                        </>
                      ),
                    },
                    {
                      title: '操作',
                      key: 'action',
                      width: 90,
                      fixed: 'right',
                      render: (_: unknown, o) => (
                        <Button size="small" onClick={() => openOrder(o.key)}>
                          详情
                        </Button>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },

          // A4：到货跟踪（v2 §2.0.4「催到货」—— 只聚合在途信息，不发明催货动作）
          {
            key: 'arrivals',
            label: `到货跟踪 (${arrivals.length})`,
            children: (
              <Table<PurchaseOrderSummary>
                rowKey="key"
                dataSource={arrivals}
                pagination={{ pageSize: 20, showSizeChanger: false }}
                locale={{
                  emptyText: <Empty description="当前没有在途采购单 —— 下单后到「采购单」页签盯发货，验收后自动流转" />,
                }}
                columns={[
                  {
                    title: '采购单',
                    dataIndex: 'po_no',
                    width: 110,
                    render: (v: string | null, r) => (v ? <a onClick={() => openOrder(r.key)}>{v}</a> : '—'),
                  },
                  { title: '物料 / 行数', width: 120, render: (_v, r) => `${r.item_kinds} 种 · ${r.line_count} 行` },
                  { title: '归属项目', render: (_v, r) => r.projects.map((x) => x.project_no).join(' / ') || '辅料 / 其他' },
                  {
                    title: '收货地',
                    dataIndex: 'deliver_to',
                    width: 140,
                    render: (v: string | null) =>
                      v ? <Tag color={v.includes('直发') ? 'purple' : 'blue'}>{v}</Tag> : '—',
                  },
                  {
                    title: '预计到货',
                    dataIndex: 'expected_date',
                    width: 150,
                    defaultSortOrder: 'ascend',
                    sorter: (a, b) =>
                      String(a.expected_date ?? '9999-99-99').localeCompare(String(b.expected_date ?? '9999-99-99')),
                    render: (v: string | null) => {
                      if (!v) return <Typography.Text type="secondary">未约期</Typography.Text>
                      const d = dayjs(v)
                      if (d.isBefore(dayjs(), 'day')) return <span><Tag color="error">超期</Tag>{v}</span>
                      if (d.diff(dayjs(), 'day') <= 3) return <span><Tag color="warning">临期</Tag>{v}</span>
                      return v
                    },
                  },
                  {
                    title: '供应商 / 联系',
                    render: (_v, r) => {
                      const sup = r.supplier_id != null ? supMap[r.supplier_id] : undefined
                      return (
                        <>
                          {r.supplier_name ?? '—'}
                          {sup && (sup.contact_name || sup.phone) && (
                            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                              {[sup.contact_name, sup.phone].filter(Boolean).join(' · ')}
                            </Typography.Text>
                          )}
                        </>
                      )
                    },
                  },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 100,
                    render: (v: string) => <Tag color={ORDER_STATUS_COLOR[v] ?? 'default'}>{v}</Tag>,
                  },
                ]}
              />
            ),
          },

          // ---------------------------------------------------------------- ③ 验收不合格（采购协商）
          {
            key: 'failed',
            label: `验收不合格 (${failedReceipts.length})`,
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                  仓库验收不合格的货退到这里。<b>采购跟供应商协商</b>后处理：
                  <Tag color="orange">换货</Tag>＝原供应商补发，留在原单等货；
                  <Tag>退货</Tag>＝这家的货不要了，<b>需求回到采购池重新买</b>（可换供应商、可再合并）。
                </Typography.Paragraph>
                <Table<GoodsReceiptRow>
                  rowKey="id"
                  size="middle"
                  loading={loading}
                  dataSource={failedReceipts}
                  pagination={false}
                  scroll={{ x: 1230 }}
                  locale={{ emptyText: <Empty description="没有验收不合格的货" /> }}
                  columns={[
                    {
                      title: '到货单',
                      dataIndex: 'receipt_no',
                      width: 110,
                      fixed: 'left',
                      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
                    },
                    {
                      title: '物料',
                      key: 'item',
                      width: 220,
                      render: (_: unknown, r) => (
                        <>
                          <b>{r.display_name}</b>
                          <div style={{ fontSize: 12, color: T.textSecondary }}>{r.item_no}</div>
                        </>
                      ),
                    },
                    {
                      title: '数量',
                      dataIndex: 'qty',
                      width: 85,
                      render: (v: number | null, r) => (v ? `${v} ${r.unit ?? ''}` : '—'),
                    },
                    {
                      title: '采购单号',
                      dataIndex: 'po_no',
                      width: 125,
                      render: (v: string | null, r) => (
                        <a onClick={() => r.po_no && openOrder(r.po_no)}>{v ?? '—'}</a>
                      ),
                    },
                    {
                      title: '项目 / 设备',
                      key: 'belong',
                      width: 180,
                      render: (_: unknown, r) => (
                        <>
                          <div>{r.project_no}</div>
                          <div style={{ fontSize: 12, color: T.textSecondary }}>
                            {r.equip_no ? `${r.equip_no} ${r.equip_name ?? ''}` : (r.project_name ?? '')}
                          </div>
                        </>
                      ),
                    },
                    {
                      title: '不合格原因',
                      dataIndex: 'inspect_note',
                      width: 170,
                      render: (v: string | null) => v ?? '—',
                    },
                    {
                      title: '验收',
                      key: 'inspect',
                      width: 150,
                      render: (_: unknown, r) => (
                        <>
                          <div>{r.inspected_by ?? '—'}</div>
                          <div style={{ fontSize: 12, color: T.textSecondary }}>
                            {r.inspected_at ? dayjs(r.inspected_at).format('MM-DD HH:mm') : ''}
                          </div>
                        </>
                      ),
                    },
                    {
                      title: '操作',
                      key: 'action',
                      width: 100,
                      fixed: 'right',
                      render: (_: unknown, r) => (
                        <Button
                          danger
                          size="small"
                          onClick={() =>
                            setNegotiate({
                              open: true,
                              orderKey: r.po_no ?? null,
                              requestIds: r.request_id ? [r.request_id] : [],
                              itemLabel: r.display_name ?? '',
                              leadDays: r.lead_days ?? null,
                            })
                          }
                        >
                          处理
                        </Button>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },

          // ---------------------------------------------------------------- ④ 退换记录
          {
            key: 'resolve',
            label: `退换记录 (${resolveReceipts.length})`,
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                  验收不合格后采购跟供应商协商的结果都留在这里：
                  <Tag color="orange">换货</Tag>＝原供应商补发；<Tag>退货</Tag>＝需求已回采购池重采（看「后续」列）。
                  每条都带着仓库验收的不合格原因、采购的协商备注，以及验收人和处理人。
                </Typography.Paragraph>
                <Table<GoodsReceiptRow>
                  rowKey="id"
                  size="middle"
                  loading={loading}
                  dataSource={resolveReceipts}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  scroll={{ x: 1640 }}
                  locale={{ emptyText: <Empty description="还没有换货 / 退货记录" /> }}
                  columns={[
                    {
                      title: '到货单',
                      dataIndex: 'receipt_no',
                      width: 110,
                      fixed: 'left',
                      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
                    },
                    {
                      title: '处理',
                      dataIndex: 'status',
                      width: 90,
                      render: (v: string) =>
                        v === '已换货' ? <Tag color="orange">换货</Tag> : <Tag>退货</Tag>,
                    },
                    {
                      title: '物料',
                      key: 'item',
                      width: 220,
                      render: (_: unknown, r) => (
                        <>
                          <b>{r.display_name}</b>
                          <div style={{ fontSize: 12, color: T.textSecondary }}>{r.item_no}</div>
                        </>
                      ),
                    },
                    {
                      title: '数量',
                      dataIndex: 'qty',
                      width: 85,
                      render: (v: number | null, r) => (v ? `${v} ${r.unit ?? ''}` : '—'),
                    },
                    {
                      title: '采购单号',
                      dataIndex: 'po_no',
                      width: 125,
                      render: (v: string | null, r) => (
                        <a onClick={() => r.po_no && openOrder(r.po_no)}>{v ?? '—'}</a>
                      ),
                    },
                    {
                      title: '项目 / 设备',
                      key: 'belong',
                      width: 180,
                      render: (_: unknown, r) => (
                        <>
                          <div>{r.project_no}</div>
                          <div style={{ fontSize: 12, color: T.textSecondary }}>
                            {r.equip_no ? `${r.equip_no} ${r.equip_name ?? ''}` : (r.project_name ?? '')}
                          </div>
                        </>
                      ),
                    },
                    {
                      title: '不合格原因（仓库验收）',
                      dataIndex: 'inspect_note',
                      width: 170,
                      render: (v: string | null) => v ?? '—',
                    },
                    {
                      title: '协商备注（采购）',
                      dataIndex: 'resolve_note',
                      width: 190,
                      render: (v: string | null) => v ?? '—',
                    },
                    {
                      title: '后续',
                      key: 'retry',
                      width: 170,
                      render: (_: unknown, r) => {
                        if (r.status === '已换货') {
                          return (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              留在原单等补发
                            </Typography.Text>
                          )
                        }
                        const rs = r.retries ?? []
                        if (rs.length === 0) return '—'
                        return rs.map((x) =>
                          x.po_no ? (
                            <Tag
                              key={x.id}
                              color="blue"
                              style={{ cursor: 'pointer' }}
                              onClick={() => openOrder(x.po_no as string)}
                            >
                              重采 {x.po_no}
                            </Tag>
                          ) : (
                            <Tag key={x.id} color="gold">
                              回采购池 #{x.id}（{x.status}）
                            </Tag>
                          ),
                        )
                      },
                    },
                    {
                      title: '验收人 / 时间',
                      key: 'inspector',
                      width: 140,
                      render: (_: unknown, r) => (
                        <>
                          <div>{r.inspected_by ?? '—'}</div>
                          <div style={{ fontSize: 12, color: T.textSecondary }}>
                            {r.inspected_at ? dayjs(r.inspected_at).format('MM-DD HH:mm') : ''}
                          </div>
                        </>
                      ),
                    },
                    {
                      title: '处理人 / 时间',
                      key: 'resolver',
                      width: 140,
                      render: (_: unknown, r) => (
                        <>
                          <div>{r.resolved_by ?? '—'}</div>
                          <div style={{ fontSize: 12, color: T.textSecondary }}>
                            {r.resolved_at ? dayjs(r.resolved_at).format('MM-DD HH:mm') : ''}
                          </div>
                        </>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },

          // ---------------------------------------------------------------- ⑤ 入库记录
          {
            key: 'storage',
            label: `入库记录 (${doneReceipts.length})`,
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                  <Tag color="processing">待入库</Tag>＝仓库验收合格、还没入库；
                  <Tag color="success">已入库</Tag>＝已进公司仓库（记了库位）；
                  <Tag color="purple">现场已验收</Tag>＝直发客户现场，不进公司库存。分批送的货分批入库。
                </Typography.Paragraph>
                <Table<GoodsReceiptRow>
                  rowKey="id"
                  size="middle"
                  loading={loading}
                  dataSource={doneReceipts}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  scroll={{ x: 1230 }}
                  locale={{ emptyText: <Empty description="还没有到货记录" /> }}
                  columns={[
                    {
                      title: '到货单',
                      dataIndex: 'receipt_no',
                      width: 110,
                      fixed: 'left',
                      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
                    },
                    {
                      title: '物料',
                      key: 'item',
                      width: 220,
                      render: (_: unknown, r) => (
                        <>
                          <b>{r.display_name}</b>
                          <div style={{ fontSize: 12, color: T.textSecondary }}>{r.item_no}</div>
                        </>
                      ),
                    },
                    {
                      title: '数量',
                      dataIndex: 'qty',
                      width: 85,
                      render: (v: number | null, r) => (v ? `${v} ${r.unit ?? ''}` : '—'),
                    },
                    {
                      title: '采购单号',
                      dataIndex: 'po_no',
                      width: 125,
                      render: (v: string | null, r) => (
                        <a onClick={() => r.po_no && openOrder(r.po_no)}>{v ?? '—'}</a>
                      ),
                    },
                    {
                      title: '项目 / 设备',
                      key: 'belong',
                      width: 180,
                      render: (_: unknown, r) => (
                        <>
                          <div>{r.project_no}</div>
                          <div style={{ fontSize: 12, color: T.textSecondary }}>
                            {r.equip_no ? `${r.equip_no} ${r.equip_name ?? ''}` : (r.project_name ?? '')}
                          </div>
                        </>
                      ),
                    },
                    { title: '到货日期', dataIndex: 'receipt_date', width: 105 },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 100,
                      render: (v: string) => <Tag color={RECEIPT_STATUS_COLOR[v]}>{v}</Tag>,
                    },
                    {
                      title: '库位',
                      dataIndex: 'location',
                      width: 140,
                      render: (v: string | null) => v ?? '—',
                    },
                    {
                      title: '入库时间',
                      dataIndex: 'stored_at',
                      width: 130,
                      render: (v: string | null) => (v ? dayjs(v).format('MM-DD HH:mm') : '—'),
                    },
                  ]}
                />
              </>
            ),
          },
          ...(hasPerm('purchase:price')
            ? [
                {
                  key: 'reference',
                  label: '价格参考',
                  children: <PriceReferencePanel />,
                },
              ]
            : []),
          // A1：供应商入采购台（v2 拍板①）——可见性随台（采购角色可见）
          {
            key: 'suppliers',
            label: '供应商',
            children: <SuppliersPage />,
          },
        ]}
      />

      <PoApproveModal
        open={approveKey !== null}
        orderKey={approveKey}
        onClose={() => setApproveKey(null)}
        onDone={() => void load()}
      />
      <ManualPurchaseModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onDone={() => void load()}
      />
      <MergeOrderModal
        open={mergeOpen}
        groups={selectedGroups}
        onCancel={() => setMergeOpen(false)}
        onDone={handleMerged}
      />
      <PurchaseOrderDrawer
        orderKey={orderKey}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onChanged={() => void load()}
      />
      <ReceiptNegotiateModal
        open={negotiate.open}
        orderKey={negotiate.orderKey}
        requestIds={negotiate.requestIds}
        itemLabel={negotiate.itemLabel}
        leadDays={negotiate.leadDays}
        onCancel={() => setNegotiate((n) => ({ ...n, open: false }))}
        onDone={handleNegotiated}
      />
    </Card>
  )
}
