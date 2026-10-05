import { hasPerm } from '../../api/user'
import ProjectSummaryBar from '../../components/project/ProjectSummaryBar'
import SectionNav from '../../components/ds/SectionNav'
import { Chip, Panel, QueueRow, Status } from '../../components/ds'
import { PROJECT_SECTIONS, defaultSectionKey } from '../../configs/sections'
import { useTab } from '../../hooks/useTab'
import DeliveryLane from '../../components/project/DeliveryLane'
import BasicCard from '../../components/project/BasicCard'
import CustomerCard from '../../components/project/CustomerCard'
import RequireCard from '../../components/project/RequireCard'
import TimeCard from '../../components/project/TimeCard'
import DealCard from '../../components/project/DealCard'
import PaymentChangeCard from '../../components/project/PaymentChangeCard'
import DesignProgressCard from '../../components/project/DesignProgressCard'
import EquipmentsCard from '../../components/project/EquipmentsCard'
import InitiateCards from '../../components/project/InitiateCards'
import AttsCard from '../../components/project/AttsCard'
import LogsCard from '../../components/project/LogsCard'
import DealModals from '../../components/project/DealModals'
import { App, Button, Empty, Form, Spin, Typography } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useGoFrom } from '../../hooks/useFrom'

import { listShipments } from '../../api/shipping'
import { listAcceptances } from '../../api/acceptance'
import { serviceWorkbench } from '../../api/service'
import AttachmentPreviewModal, { type PreviewState } from '../../components/AttachmentPreviewModal'
import { closeProject, createContact, errMsg, getDesignOverview, getProjectDetail, listAuditLogs, listUsers, previewAttachment, registerDeal, updateContact, updateProject, uploadAttachment, type Attachment, type AuditLog, type ContactIn, type ProjectContact, type DesignOverviewRow, type ProjectDetail as Detail, type ProjectUpdate, kittingOverview, registerPayment, type KittingOverviewRow } from '../../api/client'

const ATT_CATEGORIES = ['客户资料', '方案', '报价', '合同', '技术协议', '其他']
const CLOSE_REASONS = ['价格', '交期', '技术不满足', '客户取消', '对手中标', '其他']
const SOURCES = ['老客户复购', '客户询价', '展会', '转介绍', '招标平台', '销售拜访', '其他']

const STAGE_ORDER = ['线索', '成交待立项', '执行中', '交付中', '质保', '已归档', '已关闭']


// 立项后才有的区块（成交前不显示，锚点条也不显示）

const DASH = <Typography.Text type="secondary">—</Typography.Text>

export default function ProjectDetailPage() {
  const { projectNo = '' } = useParams()
  const { message } = App.useApp()
  const nav = useNavigate()
  const go = useGoFrom()

  // 注意：useState 必须在 early-return 之前（否则 loading 分支与渲染分支 hooks 数量不一致）
  // ★ P3：分区进 URL（`?tab=`）；原 Collapse 的 lanes 状态退役
  const [tab, setTab] = useTab(PROJECT_SECTIONS.map((x) => x.key), defaultSectionKey(PROJECT_SECTIONS))
  const [detail, setDetail] = useState<Detail | null>(null)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [users, setUsers] = useState<{ id: number; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [attCategory, setAttCategory] = useState('客户资料')
  const [uploading, setUploading] = useState(false)
  const [shipRows, setShipRows] = useState<any[]>([])
  const [accRows, setAccRows] = useState<any[]>([])
  const [svcRows, setSvcRows] = useState<any[]>([])
  const [design, setDesign] = useState<DesignOverviewRow[]>([])
  const [kitting, setKitting] = useState<KittingOverviewRow[]>([])

  // 成交登记 / 关闭订单 / 联系人
  const [dealOpen, setDealOpen] = useState(false)
  const [dealInitial, setDealInitial] = useState<Record<string, unknown>>({})
  const [closeOpen, setCloseOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<ProjectContact | null>(null)
  const [dealForm] = Form.useForm()
  const [closeForm] = Form.useForm()
  const [contactForm] = Form.useForm<ContactIn>()
  // 回款登记
  const [receiveTarget, setReceiveTarget] = useState<{
    seq: number
    node_name: string
    unpaid: number
  } | null>(null)
  const [receiveForm] = Form.useForm()

  const load = useCallback(async () => {
    if (!projectNo) return
    setLoading(true)
    try {
      const d = await getProjectDetail(projectNo)
      setDetail(d)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
    try {
      setLogs(await listAuditLogs({ object_ref: projectNo }))
    } catch {
      setLogs([])
    }
    try {
      setDesign(await getDesignOverview(projectNo))
    } catch {
      setDesign([])
    }
    // ★ 齐套率需要 mfg:view —— 没权限的角色（销售/采购…）不要发这个请求，
    //   否则每次进项目详情都在控制台留两条 403 红字（2026-09-30 P2-6）。
    if (hasPerm('mfg:view')) {
      try {
        setKitting(await kittingOverview(projectNo))
      } catch {
        setKitting([])
      }
    } else {
      setKitting([])
    }
    // ★ 泳道④「交付与售后」摘要：复用各台现成接口，只读、失败不拦主流程（docs/12 §3.2）
    try {
      setShipRows((await listShipments({ project_no: projectNo })) as any[])
    } catch {
      setShipRows([])
    }
    try {
      setAccRows((await listAcceptances(projectNo)) as any[])
    } catch {
      setAccRows([])
    }
    try {
      const w: any = await serviceWorkbench(projectNo)
      setSvcRows(w?.orders ?? [])
    } catch {
      setSvcRows([])
    }
  }, [projectNo, message])

  useEffect(() => {
    void load()
    void (async () => {
      try {
        setUsers(await listUsers())
      } catch {
        /* 拿不到用户列表不影响 */
      }
    })()
  }, [load])

  const openReceive = (t: { seq: number; node_name: string; amount?: number | null; received_amount?: number | null }) => {
    const unpaid = Math.max(0, Number(t.amount ?? 0) - Number(t.received_amount ?? 0))
    // 预填交给 AppModal 的 initialValues（挂载时读取）——不再手写 setFieldsValue（R2-02）
    setReceiveTarget({ seq: t.seq, node_name: t.node_name, unpaid })
  }

  const doReceive = async () => {
    if (!receiveTarget || !projectNo) return
    let v
    try { v = await receiveForm.validateFields() } catch { return }
    setSaving(true)
    try {
      const r = await registerPayment(projectNo, receiveTarget.seq, {
        received_amount: v.received_amount,
        received_date: v.received_date?.format('YYYY-MM-DD'),
        remark: v.remark,
      })
      message.success(`已登记回款：${r.node_name}，本节点还欠 ¥${Number(r.unpaid).toLocaleString()}`)
      setReceiveTarget(null)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  /** 就地保存单个字段 */
  const save = async (field: string, value: unknown) => {
    await updateProject(projectNo, { [field]: value } as ProjectUpdate)
    await load()
  }

  const p = detail?.project
  // 阶段决定默认展开哪一段（线索/成交待立项→合同；执行中→执行；交付及以后→交付与售后）
  if (loading && !p) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin />
      </div>
    )
  }
  if (!p) return <Empty description="项目不存在" />

  const stepIndex = STAGE_ORDER.indexOf(p.stage)
  const goNext = (to: string) => nav(to)
  // ★ 「下一步」把人带到该去的**分区**（原来是把泳道展开并滚动；分区切换是瞬时的）
  const focusLane = (id: string) => setTab(id)
  const nextAction =
    p.stage === '线索'
      ? { label: '成交登记', run: () => openDeal() }
      : p.stage === '成交待立项'
        ? { label: '立项', run: () => goNext(`/projects/${projectNo}/initiate`) }
        : p.stage === '执行中'
          ? { label: '进入设计面', run: () => goNext(`/projects/${projectNo}/design/${design[0]?.equip_no ?? '01A'}`) }
          : p.stage === '交付中'
            ? { label: '去发运台', run: () => goNext('/delivery/shipping') }
            : p.stage === '质保'
              ? { label: '登记回款 / 质保金', run: () => focusLane('contract') }
              : null
  const hasAmount = true  // 金额是否可看由后端 scrub 决定（无权限时字段为 null，展示 —）


  // ---------------------------------------------------------------- 资料
  const doUpload = async (file: File) => {
    setUploading(true)
    try {
      await uploadAttachment(projectNo, attCategory, file)
      message.success(`《${file.name}》已上传`)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setUploading(false)
    }
  }

  const doPreview = async (att: Attachment) => {
    try {
      const r = await previewAttachment(projectNo, att)
      setPreview({ name: att.filename, kind: r.kind, url: r.url, text: r.text })
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  // ---------------------------------------------------------------- 成交/关闭
  const openDeal = () => {
    const terms = detail?.payment_terms.length
      ? detail.payment_terms.map((t) => ({
          node_name: t.node_name,
          percent: t.percent ? Number(t.percent) : undefined,
          condition: t.condition ?? undefined,
        }))
      : [
          { node_name: '预付款', percent: 30, condition: '合同签订后 7 日内' },
          { node_name: '发货款', percent: 40, condition: '设备出厂前' },
          { node_name: '验收款', percent: 20, condition: '客户验收签字后' },
          { node_name: '质保金', percent: 10, condition: '质保期满' },
        ]
    setDealInitial({
      period_start: p.period_start ? dayjs(p.period_start) : undefined,
      period_end: p.period_end ? dayjs(p.period_end) : undefined,
      amount: p.amount ?? undefined,
      amount_tax_incl: p.amount_tax_incl ?? true,
      contract_no_customer: p.contract_no_customer ?? undefined,
      warranty_months: p.warranty_months ?? 12,
      penalty_note: p.penalty_note ?? undefined,
      acceptance_standard: p.acceptance_standard ?? undefined,
      designated_brand: p.designated_brand ?? undefined,
      delivery_mode: p.delivery_mode ?? undefined,
      site_condition: p.site_condition ?? undefined,
      is_batch_delivery: p.is_batch_delivery ?? true,
      tech_agreement_frozen: p.tech_agreement_frozen ?? false,
      payment_terms: terms,
    })
    setDealOpen(true)
  }

  const submitDeal = async () => {
    let v
    try {
      v = await dealForm.validateFields()
    } catch {
      return // 校验未过（P-09）
    }
    setSaving(true)
    try {
      const r = await registerDeal(projectNo, {
        ...v,
        period_start: v.period_start ? v.period_start.format('YYYY-MM-DD') : null,
        period_end: v.period_end ? v.period_end.format('YYYY-MM-DD') : null,
      })
      message.success(`成交登记完成，付款节点 ${r.payment_terms} 条（合计 ¥${r.total.toLocaleString()}）`)
      setDealOpen(false)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const submitClose = async () => {
    // ★ 防御：入口已按 project:close 收口，这里再判一次（防将来新增入口绕过；M-05 教训）
    if (!hasPerm('project:close')) {
      message.error('没有权限：关闭订单归商务部')
      return
    }
    let v
    try { v = await closeForm.validateFields() } catch { return }
    setSaving(true)
    try {
      await closeProject(projectNo, v)
      message.success('订单已关闭')
      setCloseOpen(false)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const openContact = (c?: ProjectContact) => {
    // 预填交给 AppModal 的 initialValues（DealModals 根据 editingContact 计算）（R2-02）
    setEditingContact(c ?? null)
    setContactOpen(true)
  }

  const submitContact = async () => {
    let v
    try { v = await contactForm.validateFields() } catch { return }
    setSaving(true)
    try {
      if (editingContact) await updateContact(projectNo, editingContact.id, v)
      else await createContact(projectNo, v)
      message.success('联系人已保存')
      setContactOpen(false)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  // ---------------------------------------------------------------- 渲染
  // ── 卡点清单（概览区）：从各处状态汇总成"现在需要有人动手"的几件事 ────────
  //   为什么放概览：这些话原来散在 4 条泳道 + 各工作台里，用户得挨个点开找。
  const blocked: { text: string; tone: 'err' | 'warn'; tab?: string; to?: string }[] = []
  if (p.delivery_days_left != null && p.delivery_days_left < 0)
    blocked.push({ text: `合同交期已过 ${-p.delivery_days_left} 天`, tone: 'err', tab: 'exec' })
  if (p.opportunity_days_left != null && p.opportunity_days_left < 0)
    blocked.push({ text: `商机截止已过 ${-p.opportunity_days_left} 天`, tone: 'warn', tab: 'contract' })
  if (hasAmount) {
    const unpaid = (detail?.payment_terms ?? []).reduce(
      (a: number, x: any) => a + Math.max(0, (x.amount ?? 0) - (x.received_amount ?? 0)),
      0,
    )
    if (unpaid > 0)
      blocked.push({
        text: `未收款 ¥${Math.round(unpaid).toLocaleString()}${p.stage === '质保' || p.stage === '已归档' ? '（质保期）' : ''}`,
        tone: p.stage === '质保' || p.stage === '已归档' ? 'err' : 'warn',
        tab: 'contract',
      })
  }
  for (const k of kitting) {
    if ((k.kitting_rate ?? 1) < 1)
      blocked.push({
        text: `${k.equip_no} ${k.equip_name} 齐套 ${Math.round((k.kitting_rate ?? 0) * 100)}%（缺 ${k.total - k.arrived} 种）`,
        tone: 'warn',
        to: `/equipment/${projectNo}/${k.equip_no}`,
      })
  }
  const unpublished = design.reduce((a: number, d: any) => a + (d.unpublished ?? 0), 0)
  if (unpublished > 0)
    blocked.push({ text: `设计有 ${unpublished} 张图/条目未发布（未发布不进采购与排产）`, tone: 'warn', tab: 'exec' })
  const shortShip = shipRows.filter((s: any) =>
    (s.receipts ?? []).some((r: any) => ['缺件', '破损'].includes(r.result)),
  )
  if (shortShip.length)
    blocked.push({ text: `现场清点有缺/损（${shortShip.length} 批）`, tone: 'err', tab: 'delivery' })
  const openSvc = svcRows.filter((o: any) => !['已关闭', '已解决'].includes(o.status))
  if (openSvc.length)
    blocked.push({ text: `售后 ${openSvc.length} 单未关闭`, tone: 'err', tab: 'delivery' })
  if (!accRows.some((a: any) => a.status === '已通过') && p.stage === '交付中')
    blocked.push({ text: '客户验收尚未签字', tone: 'warn', tab: 'delivery' })

  return (
    <>
      <AttachmentPreviewModal state={preview} onClose={() => setPreview(null)} />

      {/* ============ 结论条：在哪 / 下一步 / 关键数字 / 风险（docs/12 §3.1①）============ */}
      <ProjectSummaryBar
        p={p}
        detail={detail}
        stepIndex={stepIndex}
        stageOrder={STAGE_ORDER}
        next={nextAction}
        nums={{
          // ★ 设备台数用后端计数（齐套数据按 mfg:view 收口，拿它当台数会让销售/商务看到「设备 0」）
          equipments: detail?.equipment_count ?? 0,
          kittingRate: kitting.length ? kitting.reduce((a, k) => a + (k.kitting_rate ?? 0), 0) / kitting.length : null,
          outstanding: hasAmount
            ? (detail?.payment_terms ?? []).reduce((a: number, x: any) => a + Math.max(0, (x.amount ?? 0) - (x.received_amount ?? 0)), 0)
            : null,
          shipments: shipRows.length,
          openService: svcRows.filter((o: any) => !['已关闭', '已解决'].includes(o.status)).length,
          accepted: accRows.some((a: any) => a.status === '已通过'),
        }}
        onClose={() => setCloseOpen(true)}
      />

      {/* ============ 分区：概览（卡点）/ 合同与商务 / 范围与资料 / 执行进度 / 交付与售后 / 操作记录
          原来这里是 4 条折叠泳道 —— 折叠与"往下滑"是同一枚硬币的两面（点开一条立刻 2–3 屏），
          改成横向切 + 结论条常驻（上面那条 ProjectSummaryBar 不随分区变）。============ */}
      <SectionNav
        tab={tab}
        onTab={setTab}
        emptyText="这一区还没有内容。"
        sections={[
          {
            key: 'overview',
            label: '概览',
            badge: blocked.length,
            children: (
              <Panel
                title="现在卡在这"
                sub={blocked.length ? `${blocked.length} 件事需要有人动手` : '没有卡点'}
                help="从各处状态自动汇总：交期 / 付款 / 齐套 / 设计发布 / 现场 / 售后。点「去处理」直达对应分区或工作台。"
                bodyStyle={{ padding: blocked.length ? 0 : undefined }}
              >
                {blocked.length === 0 ? (
                  <Status tone="ok">没有卡点 —— 交期、回款、齐套、设计发布、现场与售后都没有异常</Status>
                ) : (
                  blocked.map((b) => (
                    <QueueRow
                      key={b.text}
                      lead={<Chip tone={b.tone}>{b.tone === 'err' ? '需处理' : '留意'}</Chip>}
                      title={b.text}
                      actions={
                        <Button size="small" onClick={() => (b.tab ? setTab(b.tab) : go(b.to!))}>
                          去处理
                        </Button>
                      }
                    />
                  ))
                )}
              </Panel>
            ),
          },
          {
            key: 'basic',
            label: '基本信息',
            children: <BasicCard SOURCES={SOURCES} detail={detail} save={save} users={users} DASH={DASH} p={p} />,
          },
          {
            key: 'customer',
            label: '客户与联系人',
            children: <CustomerCard detail={detail} openContact={openContact} save={save} DASH={DASH} p={p} />,
          },
          {
            key: 'time',
            label: '时间与金额',
            children: <TimeCard save={save} DASH={DASH} p={p} />,
          },
          {
            key: 'deal',
            label: '成交与付款',
            children: (
              <>
                <DealCard detail={detail} doReceive={doReceive} message={message} openDeal={openDeal} openReceive={openReceive} receiveForm={receiveForm} receiveTarget={receiveTarget} save={save} saving={saving} setReceiveTarget={setReceiveTarget} DASH={DASH} p={p} />
                {/* ★ 成交后改付款计划的唯一入口（要商务总监审批，只改未收节点） */}
                <PaymentChangeCard
                  projectNo={projectNo}
                  terms={detail?.payment_terms ?? []}
                  amount={detail?.project?.amount ?? null}
                  onChanged={load}
                />
              </>
            ),
          },
          {
            key: 'scope',
            label: '范围与资料',
            children: (
              <>
                <RequireCard save={save} p={p} />
                <EquipmentsCard kitting={kitting} projectNo={projectNo} />
                <AttsCard ATT_CATEGORIES={ATT_CATEGORIES} attCategory={attCategory} detail={detail} doPreview={doPreview} doUpload={doUpload} loading={loading} setAttCategory={setAttCategory} uploading={uploading} projectNo={projectNo} />
              </>
            ),
          },
          ...(p.stage !== '线索' && p.stage !== '成交待立项'
            ? [
                {
                  key: 'exec',
                  label: '执行进度',
                  children: (
                    <>
                      <DesignProgressCard design={design} projectNo={projectNo} />
                      <InitiateCards load={load} projectNo={projectNo} users={users} />
                    </>
                  ),
                },
              ]
            : []),
          {
            key: 'delivery',
            label: '交付与售后',
            children: <DeliveryLane shipments={shipRows} acceptances={accRows} orders={svcRows} />,
          },
          {
            key: 'logs',
            label: '操作记录',
            badge: logs.length,
            children: <LogsCard detail={detail} logs={logs} />,
          },
        ]}
      />

      {/* ============ 成交登记 ============ */}
      <DealModals CLOSE_REASONS={CLOSE_REASONS} closeForm={closeForm} closeOpen={closeOpen} contactForm={contactForm} contactOpen={contactOpen} dealForm={dealForm} dealOpen={dealOpen} dealInitialValues={dealInitial} editingContact={editingContact} message={message} saving={saving} setCloseOpen={setCloseOpen} setContactOpen={setContactOpen} setDealOpen={setDealOpen} submitClose={submitClose} submitContact={submitContact} submitDeal={submitDeal} projectNo={projectNo} />
    </>
  )
}
