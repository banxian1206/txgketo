import { hasPerm } from '../../api/user'
import ProjectSummaryBar from '../../components/project/ProjectSummaryBar'
import DeliveryLane from '../../components/project/DeliveryLane'
import BasicCard from '../../components/project/BasicCard'
import CustomerCard from '../../components/project/CustomerCard'
import RequireCard from '../../components/project/RequireCard'
import TimeCard from '../../components/project/TimeCard'
import DealCard from '../../components/project/DealCard'
import DesignProgressCard from '../../components/project/DesignProgressCard'
import EquipmentsCard from '../../components/project/EquipmentsCard'
import InitiateCards from '../../components/project/InitiateCards'
import AttsCard from '../../components/project/AttsCard'
import LogsCard from '../../components/project/LogsCard'
import DealModals from '../../components/project/DealModals'
import {
  App,
  Collapse,
  Empty,
  Form,
  Spin,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { listShipments } from '../../api/shipping'
import { listAcceptances } from '../../api/acceptance'
import { serviceWorkbench } from '../../api/service'
import AttachmentPreviewModal, { type PreviewState } from '../../components/AttachmentPreviewModal'
import {
  closeProject,
  createContact,
  errMsg,
  getDesignOverview,
  getProjectDetail,
  listAuditLogs,
  listUsers,
  previewAttachment,
  registerDeal,
  updateContact,
  updateProject,
  uploadAttachment,
  type Attachment,
  type AuditLog,
  type ContactIn,
  type ProjectContact,
  type DesignOverviewRow,
  type ProjectDetail as Detail,
  type ProjectUpdate,
  kittingOverview,
  registerPayment,
  type KittingOverviewRow,
} from '../../api/client'

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

  // 注意：useState 必须在 early-return 之前（否则 loading 分支与渲染分支 hooks 数量不一致）
  const [lanes, setLanes] = useState<string[]>(['contract'])
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
    try {
      setKitting(await kittingOverview(projectNo))
    } catch {
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
  // ★ 放在 early-return 之前：hooks 每次渲染的顺序必须一致（踩过：放后面直接白屏）
  const stageRef = useRef('')
  useEffect(() => {
    const st = p?.stage ?? ''
    if (!st || stageRef.current === st) return
    stageRef.current = st
    setLanes(st === '线索' || st === '成交待立项' ? ['contract'] : st === '执行中' ? ['exec'] : ['delivery'])
  }, [p?.stage])

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
  // ★ 受控泳道：「下一步」按钮要能真的把人带到该去的那一段（原来质保的按钮点了是自跳）
  const focusLane = (id: string) => {
    setLanes((cur) => (cur.includes(id) ? cur : [...cur, id]))
    window.setTimeout(() => {
      document.querySelector(`.lane-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }
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
          equipments: kitting.length,
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

      {/* ============ 四条泳道 + 操作记录（原来 12 张卡平铺 9 屏 → 折叠成 4 组）============ */}
      <Collapse
        ghost
        activeKey={lanes}
        onChange={(k) => setLanes(Array.isArray(k) ? (k as string[]) : [k as string])}
        items={[
          {
            key: 'contract',
            className: 'lane-contract',
            label: <b>合同与商务</b>,
            children: (
              <>
                <BasicCard SOURCES={SOURCES} detail={detail} save={save} users={users} DASH={DASH} p={p} />
                <CustomerCard detail={detail} openContact={openContact} save={save} DASH={DASH} p={p} />
                <TimeCard save={save} DASH={DASH} p={p} />
                <DealCard detail={detail} doReceive={doReceive} message={message} openDeal={openDeal} openReceive={openReceive} receiveForm={receiveForm} receiveTarget={receiveTarget} save={save} saving={saving} setReceiveTarget={setReceiveTarget} DASH={DASH} p={p} />
              </>
            ),
          },
          {
            key: 'scope',
            className: 'lane-scope',
            label: <b>范围与资料</b>,
            children: (
              <>
                <RequireCard save={save} p={p} />
                <EquipmentsCard kitting={kitting} />
                <AttsCard ATT_CATEGORIES={ATT_CATEGORIES} attCategory={attCategory} detail={detail} doPreview={doPreview} doUpload={doUpload} loading={loading} setAttCategory={setAttCategory} uploading={uploading} projectNo={projectNo} />
              </>
            ),
          },
          ...(p.stage !== '线索' && p.stage !== '成交待立项'
            ? [
                {
                  key: 'exec',
                  className: 'lane-exec',
                  label: <b>执行进度</b>,
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
            className: 'lane-delivery',
            label: <b>交付与售后</b>,
            children: <DeliveryLane shipments={shipRows} acceptances={accRows} orders={svcRows} />,
          },
          {
            key: 'logs',
            className: 'lane-logs',
            label: <b>操作记录（{logs.length}）</b>,
            children: <LogsCard detail={detail} logs={logs} />,
          },
        ]}
      />

      {/* ============ 成交登记 ============ */}
      <DealModals CLOSE_REASONS={CLOSE_REASONS} closeForm={closeForm} closeOpen={closeOpen} contactForm={contactForm} contactOpen={contactOpen} dealForm={dealForm} dealOpen={dealOpen} dealInitialValues={dealInitial} editingContact={editingContact} message={message} saving={saving} setCloseOpen={setCloseOpen} setContactOpen={setContactOpen} setDealOpen={setDealOpen} submitClose={submitClose} submitContact={submitContact} submitDeal={submitDeal} projectNo={projectNo} />
    </>
  )
}
