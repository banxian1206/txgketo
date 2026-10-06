import { Chip, Code, Status, Empty as DsEmpty } from '../../components/ds'
import QueueBoard from '../../components/ds/QueueBoard'
import WorkbenchPage from '../../components/domain/WorkbenchPage'
import { PURCHASE_BOARD } from '../../configs/boards'
import { Muted } from '../../components/ui/Primitives'
import { App, Button, Space, Table, Typography } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import SuppliersPage from './SuppliersPage'
import ManualPurchaseModal from '../../components/ManualPurchaseModal'
import PoApproveModal from '../../components/PoApproveModal'
import MergeOrderModal from '../../components/MergeOrderModal'
import PriceReferencePanel from '../../components/PriceReferencePanel'
import { REBUY_SOURCES } from '../../configs/domain'
import PurchaseOrderDrawer from '../../components/PurchaseOrderDrawer'
import ReceiptNegotiateModal from '../../components/ReceiptNegotiateModal'
import VehicleModal from '../../components/VehicleModal'
import {
  errMsg,
  listSuppliers,
  listGoodsReceipts,
  purchaseOrders,
  purchasePool,
  purchaseToVehicle,
  hasPerm,
  type GoodsReceiptRow,
  type PurchaseOrderSummary,
  type ToVehicleRow,
  type PurchasePoolDemand,
  type PurchasePoolGroup,
} from '../../api/client'
import { ORDER_STATUS as ORDER_STATUS_COLOR, toneOf } from '../../theme/status'
import { RECEIPT_STATUS as RECEIPT_STATUS_COLOR } from '../../theme/status'
import { T } from '../../theme/tokens'
import { useGoFrom } from '../../hooks/useFrom'
const today = () => dayjs().format('YYYY-MM-DD')
/**
 * 采购工作台：采购只做三件事：下单（采购池合并）· 取消 · 更改供应商。
 * 验收不合格的货会回到这里（「验收不合格」页签），采购跟供应商协商换货/退货。
 * 验收、入库由仓库做，状态自己变。
 */
export default function PurchaseWorkbench() {
  const { message } = App.useApp()
  // ★ docs/11：跳去别的域时带上 ?from= （来源台/来源页），回来还在原来那一层
  const go = useGoFrom()
  const [pool, setPool] = useState<PurchasePoolGroup[]>([])
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([])
  const [failedReceipts, setFailedReceipts] = useState<GoodsReceiptRow[]>([])
  const [resolveReceipts, setResolveReceipts] = useState<GoodsReceiptRow[]>([])
  const [doneReceipts, setDoneReceipts] = useState<GoodsReceiptRow[]>([])
  const [selected, setSelected] = useState<string[]>([])
  // A1（v2 方案 §2.0.6）：页签 = URL query（?tab=suppliers 深链 / 旧 /suppliers redirect 落点 / 分享可还原）
  //  ★ 重整 P0：这段手写实现已抽成 hooks/useTab（全站同一套页签状态机，含未知值回退）
  const [manualOpen, setManualOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [orderKey, setOrderKey] = useState<string | null>(null)
  const [approveKey, setApproveKey] = useState<string | null>(null)
  // ★ §2.2 叫车是采购的活，而采购进不去发运台 → 采购台里必须能叫（2026-09-30 P1-1 发运死锁）
  const [toVehicle, setToVehicle] = useState<ToVehicleRow[]>([])
  const [vehicleTarget, setVehicleTarget] = useState<ToVehicleRow | null>(null)
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
      const [p, o, failed, replaced, returned, pending, done, site, veh] = await Promise.all([
        purchasePool(),
        purchaseOrders(),
        listGoodsReceipts({ status: '不合格' }),
        listGoodsReceipts({ status: '已换货' }),
        listGoodsReceipts({ status: '已退货' }),
        listGoodsReceipts({ status: '待入库' }),
        listGoodsReceipts({ status: '已入库' }),
        listGoodsReceipts({ status: '现场已验收' }),
        hasPerm('purchase:edit') ? purchaseToVehicle().catch(() => []) : Promise.resolve([]),
      ])
      setPool(p)
      setOrders(o)
      setFailedReceipts(failed)
      setResolveReceipts(
        [...replaced, ...returned].sort((a, b) => (b.resolved_at ?? '').localeCompare(a.resolved_at ?? '')),
      )
      setDoneReceipts([...pending, ...done, ...site])
      setToVehicle(veh)
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
  const openOrders = orders.filter(
    (o) => !['已取消', '已完成', '草稿', '待经理审', '待总监审', '已退回'].includes(o.status),
  )
  // ★ 只列**当前这一级真的轮到我**的单（后端 can_approve 判定）。
  //   过去按 po_status 取「待经理审 + 待总监审」两种 → 经理列表里混着待总监审的单、点了必 403（P2-1）
  const toApprove = orders.filter((o) => o.can_approve)
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
  const openTotal = toApprove.length + toVehicle.length + poolRequests + openOrders.length

  // 体：按页签 key 取（顺序 / 标题 / 徽标 / 可见性全来自注册表 PURCHASE_BOARD）
  const parts: Record<string, ReactNode> = {
    approve: (
      <QueueBoard
        emptyText="没有待我审批的采购单 —— 采购单提交后，轮到你这一级时才会出现在这里。"
        items={toApprove.map((r) => ({
          key: r.key,
          lead: <Code>{r.po_no}</Code>,
          title: r.supplier_name ?? '未选供应商',
          meta: `共 ${r.line_count} 行 · 预计到货 ${r.expected_date ?? '未约期'}`,
          cells: [{ text: <Status tone={toneOf(ORDER_STATUS_COLOR[r.po_status ?? ''])}>{r.po_status}</Status> }],
          action: (
            <Button type="primary" size="small" onClick={() => setApproveKey(r.key)}>
              审批
            </Button>
          ),
        }))}
      />
    ),
    vehicle: (
      <QueueBoard
        search={
          <Muted>
            项目经理下达发货指令后，<b>车由采购叫</b>：按发货日当天把车订好，登记「几辆车 + 本次运费」。<b>没叫车，发运那边装不了车</b>。
          </Muted>
        }
        emptyText="没有等着叫车的发货批次。"
        items={toVehicle.map((r) => ({
          key: r.id,
          lead: <Code>{r.shipment_no}</Code>,
          title: `${r.project_no} ${r.project_name ?? ''}`,
          meta: r.plan_ship_date
            ? `发货日 ${r.plan_ship_date}`
            : '⚠ 没填发货日 —— 请找项目经理确认哪天发',
          cells: [
            { text: <Status tone="run">{r.status}</Status> },
            { text: r.instruct_at ? dayjs(r.instruct_at).format('MM-DD HH:mm') : '—', title: '指令时间' },
          ],
          action: (
            <Button type="primary" size="small" onClick={() => setVehicleTarget(r)}>
              叫车
            </Button>
          ),
        }))}
      />
    ),
    pool: (
      <>
        {/* ★ 精调（2026-10-05）：原来这里是一整段 60 字的采购方法论（“先查仓库 → 缺的进池 → 攒一攒
            合并下单……”），在页面上占两行、把表格压到首屏之外。**方法论进 ? 气泡**，
            页面上只留一句“怎么办”（能扫一眼就懂的那种）。 */}
        {/* 精调：说明 + 批量动作收成**一条**工具条（原来散成两行、还说了两遍同一句话） */}
        <div className="ds-q-bar">
          <div className="l">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              勾同类物料一起买，量大价才好谈；只有一条需求时点行尾「去下单」。
            </Typography.Text>
          </div>
          <div className="r">
            {selected.length > 0 && (
              <Button size="small" type="text" onClick={() => setSelected([])}>
                清空选择
              </Button>
            )}
            <Button
              type="primary"
              size="small"
              disabled={selected.length === 0 || !canBuy}
              title={selected.length === 0 ? '先在下面勾选要合并下单的物料行' : '把勾选的物料合并成一张采购单'}
              onClick={() => setMergeOpen(true)}
            >
              合并下单
              {selected.length > 0 ? `（${selected.length} 种 / ${selectedLines} 条）` : ''}
            </Button>
            <Button size="small" onClick={() => setManualOpen(true)}>手工申请</Button>
          </div>
        </div>
        <Table<PurchasePoolGroup>
          rowKey="item_no"
          size="middle"
          loading={loading}
          dataSource={pool}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          scroll={{ x: 960 }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys as string[]),
            columnWidth: 46,
          }}
          locale={{
            emptyText: <DsEmpty text="采购池是空的：BOM 需求先查仓库，有库存的不进池" />,
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
                    // ★ 列治理：项目为主、设备为副（合并单里每行需求本来就带着归属）
                    title: '项目 / 设备（归属）',
                    dataIndex: 'project_no',
                    width: 240,
                    render: (v: string | null, r) =>
                      v ? (
                        <>
                          <a onClick={() => go(`/projects/${v}`)}>
                            {v} {r.project_name ?? ''}
                          </a>
                          <div style={{ fontSize: 12, color: T.textSecondary }}>
                            {r.equip_no ?? '未分到设备'}
                          </div>
                        </>
                      ) : (
                        <Status tone="run">{r.attribution ?? '公司级'}</Status>
                      ),
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
                    // 主=需要到货日，副=该物料的采购周期（下单前一眼看出赶不赶得上）
                    title: '需要到货（· 采购周期）',
                    dataIndex: 'need_date',
                    width: 150,
                    render: (v: string | null, r) => (
                      <>
                        <Space size={4}>
                          <span>{v ?? '—'}</span>
                          {v && v < today() && <Status tone="err">已过期</Status>}
                        </Space>
                        <div style={{ fontSize: 12, color: T.textSecondary }}>
                          周期 {r.lead_days ? `${r.lead_days} 天` : '未配'}
                        </div>
                      </>
                    ),
                  },
                  {
                    title: '来源',
                    dataIndex: 'source',
                    width: 150,
                    render: (v: string, r) =>
                      REBUY_SOURCES.includes(v) ? (
                        <>
                          {/* ★ 文案取真实来源（N20：条件已泛化而文案曾写死「退货重采」，
                              会把现场缺件/破损标成仓库退货，责任方与处理动作都不同） */}
                          <Status tone="warn">{v}</Status>
                          {r.origin_po_no && (
                            <div style={{ fontSize: 12, color: T.textSecondary }}>
                              原 {r.origin_po_no}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <Status>{v}</Status>
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
                  <div>
                    <Code to={`/items/${g.item_no}`}>{g.item_no}</Code> <b>{g.display_name}</b>
                  </div>
                  {g.spec_text ? <div style={{ fontSize: 12, color: T.textSecondary }}>{g.spec_text}</div> : null}
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
                  {g.mergeable && <Status tone="warn">★可合并</Status>}
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
                  {v && v < today() && <Status tone="err">已过期</Status>}
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
    orders: (
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
          pagination={{ pageSize: 10, showSizeChanger: true }}
          scroll={{ x: 1180 }}
          locale={{ emptyText: <DsEmpty text="还没有下过采购单" /> }}
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
                    <Status key={p.project_no}>{p.project_no}</Status>
                  ))}
                  {o.equipments.map((e) => (
                    <Status key={`${e.project_no}-${e.equip_no}`} tone="run">
                      {e.equip_no} {e.equip_name ?? ''}
                    </Status>
                  ))}
                  {o.equipments.length === 0 && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      没挂具体设备
                    </Typography.Text>
                  )}
                </>
              ),
            },
            {
              // 主=下单日期，副=预计到货（超期照旧标橙）
              title: '日期（下单 → 预计到货）',
              key: 'dates',
              width: 165,
              render: (_: unknown, o) => (
                <>
                  <div>{o.ordered_at ?? '—'}</div>
                  <Space size={4}>
                    <Muted>{o.expected_date ?? '—'}</Muted>
                    {o.expected_date && o.expected_date < today() && ['在途', '部分到货'].includes(o.status) && (
                      <Status tone="warn">已超期</Status>
                    )}
                  </Space>
                </>
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
                  <Status tone={toneOf(ORDER_STATUS_COLOR[v])}>{v}</Status>
                  {o.exchanged_qty > 0 && (
                    <div>
                      <Status tone="warn">换 {o.exchanged_qty}</Status>
                    </div>
                  )}
                  {o.returned_qty > 0 && (
                    <div>
                      <Status>退 {o.returned_qty}</Status>
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
    arrivals: (
      <Table<PurchaseOrderSummary>
        rowKey="key"
        dataSource={arrivals}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        locale={{
          emptyText: <DsEmpty text="当前没有在途采购单 —— 下单后到「采购单」页签盯发货，验收后自动流转" />,
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
              v ? <Status tone={toneOf(v.includes('直发') ? 'cyan' : 'blue')}>{v}</Status> : '—',
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
              // ★ 精调（2026-10-05）：原来 `<Status>超期</Status>{v}` 两个元素**粘在一起**，
              //   屏幕上读作“超期2026-09-29”。状态与日期之间必须有缝。
              if (d.isBefore(dayjs(), 'day')) return <span><Status tone="err">超期</Status> <span className="mono">{v}</span></span>
              if (d.diff(dayjs(), 'day') <= 3) return <span><Status tone="warn">临期</Status> <span className="mono">{v}</span></span>
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
            render: (v: string) => <Status tone={toneOf(ORDER_STATUS_COLOR[v] ?? 'default')}>{v}</Status>,
          },
        ]}
      />

    ),
    failed: (
      <QueueBoard
        search={
          <Muted>
            仓库验收不合格的货退到这里。<b>采购跟供应商协商</b>：换货＝原供应商补发（留在原单等货）；退货＝这家的货不要了，<b>需求回采购池重新买</b>。
          </Muted>
        }
        emptyText="没有验收不合格的货。"
        items={failedReceipts.map((r) => ({
          key: r.id,
          lead: <Code>{r.receipt_no}</Code>,
          title: r.display_name ?? '—',
          meta: `${r.qty ?? '—'} ${r.unit ?? ''} · ${r.project_no ?? ''} ${r.equip_no ?? ''} · 不合格原因：${r.inspect_note ?? '未填'}`,
          cells: [
            { text: r.inspected_at ? dayjs(r.inspected_at).format('MM-DD HH:mm') : '—', title: `验收人 ${r.inspected_by ?? '—'}` },
          ],
          action: (
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
        }))}
      />
    ),
    resolve: (
      <>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          验收不合格后采购跟供应商协商的结果都留在这里：
          <Status tone="warn">换货</Status>＝原供应商补发；<Status>退货</Status>＝需求已回采购池重采（看「后续」列）。
          每条都带着仓库验收的不合格原因、采购的协商备注，以及验收人和处理人。
        </Typography.Paragraph>
        <Table<GoodsReceiptRow>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={resolveReceipts}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          scroll={{ x: 1640 }}
          locale={{ emptyText: <DsEmpty text="还没有换货 / 退货记录" /> }}
          columns={[
            {
              // ★ 列治理（docs/12 §2-A）：到货单为主、采购单号为副，一列顶原来两列
              title: '到货单 / 采购单',
              dataIndex: 'receipt_no',
              width: 140,
              fixed: 'left',
              render: (v: string, r: GoodsReceiptRow) => (
                <>
                  <Typography.Text strong>{v}</Typography.Text>
                  <div style={{ fontSize: 12 }}>
                    {r.po_no ? <a onClick={() => openOrder(r.po_no as string)}>{r.po_no}</a> : <Muted>未编号</Muted>}
                  </div>
                </>
              ),
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
              // 主=仓库给的原因，副=采购的协商备注（原来两列并一列，读起来还是"问题→怎么谈"）
              title: '问题与协商',
              key: 'notes',
              width: 240,
              render: (_: unknown, r) => (
                <>
                  <div>{r.inspect_note ?? '—'}</div>
                  <Muted>协商：{r.resolve_note ?? '（无）'}</Muted>
                </>
              ),
            },
            {
              title: '处理与后续',
              key: 'retry',
              width: 190,
              render: (_: unknown, r) => {
                // 主行=采购怎么处理的（换货/退货），副行=后续去向（重采单号 / 回池）
                const tag =
                  r.status === '已换货' ? <Status tone="warn">换货</Status> : <Status>退货</Status>
                const rs = r.retries ?? []
                const next =
                  r.status === '已换货' ? (
                    <Muted>留在原单等补发</Muted>
                  ) : rs.length === 0 ? (
                    <Muted>—</Muted>
                  ) : (
                    <span>
                      {rs.map((x) =>
                  x.po_no ? (
                    <Chip
                      key={x.id}
                      tone="run"
                      style={{ cursor: 'pointer' }}
                      onClick={() => openOrder(x.po_no as string)}
                    >
                      重采 {x.po_no}
                    </Chip>
                  ) : (
                      <Status key={x.id} tone="warn">
                        回采购池 #{x.id}（{x.status}）
                      </Status>
                    ),
                  )
                    }
                  </span>
                )
                return (
                  <>
                    <div>{tag}</div>
                    <div style={{ fontSize: 12 }}>{next}</div>
                  </>
                )
              },
            },
            {
              // 验收与处理两笔经办合成一列（上=谁验的，下=谁处理的）
              title: '经办（验收 / 处理）',
              key: 'who',
              width: 150,
              render: (_: unknown, r) => (
                <>
                  <div>
                    {r.inspected_by ?? '—'}
                    <Muted> {r.inspected_at ? dayjs(r.inspected_at ?? '').format('MM-DD HH:mm') : ''}</Muted>
                  </div>
                  <div>
                    {r.resolved_by ?? '—'}
                    <Muted> {r.resolved_at ? dayjs(r.resolved_at ?? '').format('MM-DD HH:mm') : ''}</Muted>
                  </div>
                </>
              ),
            },
          ]}
        />
      </>

    ),
    storage: (
      <>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          <Status tone="run">待入库</Status>＝仓库验收合格、还没入库；
          <Status tone="ok">已入库</Status>＝已进公司仓库（记了库位）；
          <Status tone="run">现场已验收</Status>＝直发客户现场，不进公司库存。分批送的货分批入库。
        </Typography.Paragraph>
        <Table<GoodsReceiptRow>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={doneReceipts}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          scroll={{ x: 1230 }}
          locale={{ emptyText: <DsEmpty text="还没有到货记录" /> }}
          columns={[
            {
              // ★ 列治理（docs/12 §2-A）：到货单为主、采购单号为副，一列顶原来两列
              title: '到货单 / 采购单',
              dataIndex: 'receipt_no',
              width: 140,
              fixed: 'left',
              render: (v: string, r: GoodsReceiptRow) => (
                <>
                  <Typography.Text strong>{v}</Typography.Text>
                  <div style={{ fontSize: 12 }}>
                    {r.po_no ? <a onClick={() => openOrder(r.po_no as string)}>{r.po_no}</a> : <Muted>未编号</Muted>}
                  </div>
                </>
              ),
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
              // 主=到货日期，副=入库时间
              title: '时间（到货 → 入库）',
              key: 'times',
              width: 140,
              render: (_: unknown, r) => (
                <>
                  <div>{r.receipt_date ?? '—'}</div>
                  <Muted>{r.stored_at ? dayjs(r.stored_at ?? '').format('MM-DD HH:mm') : '未入库'}</Muted>
                </>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (v: string) => <Status tone={toneOf(RECEIPT_STATUS_COLOR[v])}>{v}</Status>,
            },
            {
              title: '库位',
              dataIndex: 'location',
              width: 140,
              render: (v: string | null) => v ?? '—',
            },
          ]}
        />
      </>

    ),
    reference: (
<PriceReferencePanel />
    ),
    suppliers: (
<SuppliersPage />
    ),
  }

  return (
    <>
      {/* ★ docs/15 台骨架四件套：台头 → 结论条 → 流程条（注册表驱动）→ 体 */}
      <WorkbenchPage
        board={PURCHASE_BOARD}
        sub={`待办 ${openTotal} 项${toApprove.length ? ` · 其中 ${toApprove.length} 单等你审批` : ''}${overdueCount ? ` · ${overdueCount} 单到货已超期` : ''}`}
        help="采购的活分五类：待我审批 / 待叫车 / 采购池 / 在途与到货 / 主数据。上面的数字可点，点了就切到对应队列。采购方法论：先查仓库 → 缺的进池 → 攒一攒合并下单（各设计小组下单节点不一样，但东西大差不差）；手工申请（车间耗品/现场缺件/辅料）免审核，提交即进池。"
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
          approve: toApprove.length,
          vehicle: toVehicle.length,
          pool: poolRequests,
          orders: openOrders.length,
          arrivals: arrivals.length,
          failed: failedReceipts.length,
        }}
        metrics={[
          // ★ 方向 2 ② 主角指认（下面每处 `lead: true` 都写了“为什么是它”）——见 ds `MetricItem.lead`
          // 采购台主角 = **待我审批**：它是唯一“轮到我、且卡着别人”的活；没得批时自然退到采购池。
          { key: 'approve', label: '待我审批', value: toApprove.length, unit: '单', tone: toApprove.length ? 'warn' : undefined, dimZero: true, to: '?tab=approve', lead: true },
          { key: 'vehicle', label: '待叫车', value: toVehicle.length, unit: '单', tone: toVehicle.length ? 'warn' : undefined, dimZero: true, to: '?tab=vehicle' },
          { key: 'pool', label: '采购池', value: poolRequests, unit: '条需求', dimZero: true, to: '?tab=pool' },
          { key: 'orders', label: '在途单', value: openOrders.length, unit: '单', dimZero: true, to: '?tab=orders' },
          { key: 'overdue', label: '到货已超期', value: overdueCount, unit: '单', tone: overdueCount ? 'err' : undefined, dimZero: true, to: '?tab=arrivals' },
        ]}
      >
        {(t) => parts[t]}
      </WorkbenchPage>
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
      <VehicleModal
        target={vehicleTarget}
        onClose={() => setVehicleTarget(null)}
        onDone={() => void load()}
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
    </>
  )
}
