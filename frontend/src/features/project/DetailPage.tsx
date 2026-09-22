import ProjectHeader from '../../components/project/ProjectHeader'
import ProjectAnchorBar from '../../components/project/ProjectAnchorBar'
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
  Col,
  Empty,
  Form,
  Row,
  Spin,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

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

const STAGE_ORDER = ['线索', '成交待立项', '执行中', '交付中', '质保', '已关闭']

const NEXT_HINT: Record<string, string> = {
  线索: '下一步：成交登记（登记项目周期 / 合同金额 / 付款方式），或者关闭订单',
  成交待立项: '下一步：立项 —— 分配设备（01A / 02A…）、定节点时间、下长周期采购',
  执行中: '下一步：工程设计 —— 出图并产出设计 BOM，工艺部补材料 BOM',
  交付中: '下一步：现场安装与调试 —— 每日汇报、到货验收',
  质保: '质保期管理中：到期提醒收取质保金，之后关闭项目',
  已关闭: '项目已关闭',
}

// 立项后才有的区块（成交前不显示，锚点条也不显示）
const AFTER_INITIATION = ['design', 'equipment', 'milestone', 'longlead', 'team']

const SECTIONS = [
  { id: 'basic', label: '基本信息' },
  { id: 'customer', label: '客户与联系人' },
  { id: 'require', label: '项目要求' },
  { id: 'time', label: '时间与金额' },
  { id: 'deal', label: '成交信息' },
  { id: 'design', label: '设计进度' },
  { id: 'equipment', label: '设备清单' },
  { id: 'milestone', label: '节点计划' },
  { id: 'longlead', label: '长周期采购' },
  { id: 'team', label: '项目团队' },
  { id: 'atts', label: '资料包' },
  { id: 'logs', label: '操作记录' },
]

const DASH = <Typography.Text type="secondary">—</Typography.Text>

export default function ProjectDetailPage() {
  const { projectNo = '' } = useParams()
  const { message } = App.useApp()

  const [detail, setDetail] = useState<Detail | null>(null)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [users, setUsers] = useState<{ id: number; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [attCategory, setAttCategory] = useState('客户资料')
  const [uploading, setUploading] = useState(false)
  const [active, setActive] = useState('basic')
  const [design, setDesign] = useState<DesignOverviewRow[]>([])
  const [kitting, setKitting] = useState<KittingOverviewRow[]>([])

  // 成交登记 / 关闭订单 / 联系人
  const [dealOpen, setDealOpen] = useState(false)
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
    setReceiveTarget({ seq: t.seq, node_name: t.node_name, unpaid })
    receiveForm.setFieldsValue({ received_amount: unpaid || undefined, received_date: dayjs() })
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

  /** 滚动时高亮当前区块（吸顶锚点条用） */
  useEffect(() => {
    const onScroll = () => {
      let cur = SECTIONS[0].id
      for (const sec of SECTIONS) {
        const el = document.getElementById(`sec-${sec.id}`)
        if (el && el.getBoundingClientRect().top <= 130) cur = sec.id
      }
      setActive(cur)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [loading])

  /** 就地保存单个字段 */
  const save = async (field: string, value: unknown) => {
    await updateProject(projectNo, { [field]: value } as ProjectUpdate)
    await load()
  }

  const p = detail?.project

  if (loading && !p) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin />
      </div>
    )
  }
  if (!p) return <Empty description="项目不存在" />

  const stepIndex = STAGE_ORDER.indexOf(p.stage)

  const scrollTo = (id: string) => {
    const el = document.getElementById(`sec-${id}`)
    if (!el) return
    const y = el.getBoundingClientRect().top + window.scrollY - 64 // 给吸顶条留出位置
    window.scrollTo({ top: y, behavior: 'smooth' })
    setActive(id)
  }

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
    dealForm.setFieldsValue({
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
    setEditingContact(c ?? null)
    if (c) {
      contactForm.setFieldsValue({
        name: c.name,
        title: c.title ?? undefined,
        phone: c.phone ?? undefined,
        wechat: c.wechat ?? undefined,
        email: c.email ?? undefined,
        role_tag: c.role_tag ?? undefined,
      })
    } else {
      contactForm.resetFields()
    }
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

      {/* ============ 顶部：标题 + 操作 ============ */}
      <ProjectHeader NEXT_HINT={NEXT_HINT} STAGE_ORDER={STAGE_ORDER} design={design} detail={detail} openDeal={openDeal} setCloseOpen={setCloseOpen} stepIndex={stepIndex} p={p} projectNo={projectNo} />

      <ProjectAnchorBar AFTER_INITIATION={AFTER_INITIATION} SECTIONS={SECTIONS} active={active} scrollTo={scrollTo} p={p} />
      <Row>
        <Col flex="auto" style={{ minWidth: 0 }}>
          {/* ① 基本信息 */}
      <BasicCard SOURCES={SOURCES} detail={detail} save={save} users={users} DASH={DASH} p={p} />

          {/* ② 客户与联系人 */}
      <CustomerCard detail={detail} openContact={openContact} save={save} DASH={DASH} p={p} />

          {/* ③ 项目要求 */}
      <RequireCard save={save} p={p} />

          {/* ④ 时间与金额 */}
      <TimeCard save={save} DASH={DASH} p={p} />

          {/* ⑤ 成交信息 */}
      <DealCard detail={detail} doReceive={doReceive} message={message} openDeal={openDeal} openReceive={openReceive} receiveForm={receiveForm} receiveTarget={receiveTarget} save={save} saving={saving} setReceiveTarget={setReceiveTarget} DASH={DASH} p={p} />

          {p.stage !== '线索' && p.stage !== '成交待立项' && (
            <>
      <DesignProgressCard design={design} projectNo={projectNo} />

      <EquipmentsCard kitting={kitting} />

      <InitiateCards load={load} projectNo={projectNo} users={users} />
            </>
          )}

          {/* ⑥ 资料包 */}
      <AttsCard ATT_CATEGORIES={ATT_CATEGORIES} attCategory={attCategory} detail={detail} doPreview={doPreview} doUpload={doUpload} loading={loading} setAttCategory={setAttCategory} uploading={uploading} projectNo={projectNo} />

          {/* ⑦ 操作记录 */}
      <LogsCard detail={detail} logs={logs} />
        </Col>
      </Row>

      {/* ============ 成交登记 ============ */}
      <DealModals CLOSE_REASONS={CLOSE_REASONS} closeForm={closeForm} closeOpen={closeOpen} contactForm={contactForm} contactOpen={contactOpen} dealForm={dealForm} dealOpen={dealOpen} editingContact={editingContact} message={message} saving={saving} setCloseOpen={setCloseOpen} setContactOpen={setContactOpen} setDealOpen={setDealOpen} submitClose={submitClose} submitContact={submitContact} submitDeal={submitDeal} projectNo={projectNo} />
    </>
  )
}
