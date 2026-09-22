import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Divider,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Timeline,
  Typography,
  Upload,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import AttachmentPreviewModal, { type PreviewState } from '../components/AttachmentPreviewModal'
import EditableField from '../components/EditableField'
import {
  EquipmentEditor,
  LongLeadEditor,
  MilestoneEditor,
  TeamEditor,
} from '../components/InitiationEditors'
import {
  closeProject,
  createContact,
  downloadAttachment,
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
  hasPerm,
  kittingOverview,
  registerPayment,
  type KittingOverviewRow,
} from '../api/client'

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
  const nav = useNavigate()
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
    const v = await receiveForm.validateFields()
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
    const v = await closeForm.validateFields()
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
    const v = await contactForm.validateFields()
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
      <Card style={{ marginBottom: 16 }} styles={{ body: { padding: '16px 20px' } }}>
        <Row align="middle" gutter={16}>
          <Col flex="auto">
            <Space size={8} wrap>
              <a onClick={() => nav('/projects')}>← 返回列表</a>
              <Typography.Text strong style={{ fontSize: 18 }}>
                {p.project_no}
              </Typography.Text>
              <Typography.Text style={{ fontSize: 16 }}>{p.project_name}</Typography.Text>
              {p.is_retrofit && <Tag color="orange">旧改</Tag>}
              <Tag color="blue">{p.stage}</Tag>
            </Space>
            <div style={{ marginTop: 6 }}>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                客户：{p.customer_name ?? '—'} · 销售：{detail?.sales_name ?? '—'}
                {p.opportunity_days_left !== null && p.opportunity_days_left !== undefined && (
                  <>
                    {' · '}
                    商机
                    {p.opportunity_days_left < 0
                      ? `已过期 ${-p.opportunity_days_left} 天`
                      : p.opportunity_days_left === 0
                        ? '今天到期'
                        : `还剩 ${p.opportunity_days_left} 天`}
                  </>
                )}
                {p.delivery_days_left !== null && p.delivery_days_left !== undefined && (
                  <>
                    {' · '}项目交期还剩 {p.delivery_days_left} 天
                  </>
                )}
              </Typography.Text>
            </div>
          </Col>
          <Col>
            <Space>
              {p.stage === '线索' && (
                <Button type="primary" onClick={openDeal}>
                  成交登记
                </Button>
              )}
              {p.stage === '成交待立项' && (
                <Button type="primary" onClick={() => nav(`/projects/${projectNo}/initiate`)}>
                  立项
                </Button>
              )}
              {p.stage !== '已关闭' && (
                <Dropdown
                  menu={{
                    items: [{ key: 'close', label: '关闭订单', danger: true }],
                    onClick: () => setCloseOpen(true),
                  }}
                >
                  <Button>更多 ▾</Button>
                </Dropdown>
              )}
            </Space>
          </Col>
        </Row>

        <Divider style={{ margin: '14px 0 10px' }} />
        <Steps
          size="small"
          current={stepIndex}
          items={STAGE_ORDER.map((s) => ({ title: s }))}
          status={p.stage === '已关闭' ? 'error' : 'process'}
        />
        <Space>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            💡 {NEXT_HINT[p.stage] ?? ''}
          </Typography.Text>
          {p.stage === '执行中' && design.length > 0 && (
            <Button
              type="link"
              size="small"
              onClick={() => nav(`/projects/${projectNo}/design/${design[0].equip_no}`)}
            >
              进入设计 →
            </Button>
          )}
        </Space>
      </Card>

      {/* ============ 吸顶锚点条（不占左右空间，内容更宽） ============ */}
      <div className="anchor-bar">
        {SECTIONS.filter(
          (sec) =>
            !AFTER_INITIATION.includes(sec.id) ||
            (p.stage !== '线索' && p.stage !== '成交待立项'),
        ).map((sec) => (
          <a
            key={sec.id}
            className={active === sec.id ? 'active' : ''}
            onClick={() => scrollTo(sec.id)}
          >
            {sec.label}
          </a>
        ))}
      </div>

      <Row>
        <Col flex="auto" style={{ minWidth: 0 }}>
          {/* ① 基本信息 */}
          <Card id="sec-basic" size="small" title="基本信息" style={{ marginBottom: 16 }}>
            <div className="ef-grid">
              <EditableField
                label="项目名称"
                value={p.project_name}
                onSave={(v) => save('project_name', v)}
              />
              <EditableField
                label="项目方式"
                value={p.deal_mode}
                type="select"
                options={[
                  { value: '投标', label: '投标' },
                  { value: '直签', label: '直接签合同' },
                ]}
                onSave={(v) => save('deal_mode', v)}
              />
              <EditableField
                label="线索来源"
                value={p.source}
                type="select"
                options={SOURCES.map((s) => ({ value: s, label: s }))}
                onSave={(v) => save('source', v)}
              />
              <EditableField
                label="销售负责人"
                value={p.sales_id}
                type="select"
                options={users.map((u) => ({ value: u.id, label: u.name }))}
                render={() => detail?.sales_name ?? DASH}
                onSave={(v) => save('sales_id', v)}
              />
              <EditableField
                label="项目描述"
                value={p.project_desc}
                type="textarea"
                wide
                onSave={(v) => save('project_desc', v)}
              />
              <EditableField
                label="风险标记"
                value={p.risk_note}
                wide
                render={(v) =>
                  v ? <Typography.Text type="danger">{String(v)}</Typography.Text> : DASH
                }
                onSave={(v) => save('risk_note', v)}
              />
            </div>
          </Card>

          {/* ② 客户与联系人 */}
          <Card
            id="sec-customer"
            size="small"
            title="客户与联系人"
            extra={
              <Button size="small" onClick={() => openContact()}>
                + 新增联系人
              </Button>
            }
            style={{ marginBottom: 16 }}
          >
            <div className="ef-grid">
              <EditableField
                label="客户名称"
                value={p.customer_name}
                onSave={(v) => save('customer_name', v)}
              />
              <EditableField
                label="项目地点"
                value={p.site_address}
                onSave={(v) => save('site_address', v)}
              />
            </div>
            <Table<ProjectContact>
              rowKey="id"
              size="small"
              style={{ marginTop: 12 }}
              pagination={false}
              dataSource={detail?.contacts ?? []}
              locale={{ emptyText: <Empty description="还没有登记联系人" /> }}
              columns={[
                {
                  title: '角色',
                  dataIndex: 'role_tag',
                  width: 110,
                  render: (v: string) => (v ? <Tag color="blue">{v}</Tag> : DASH),
                },
                { title: '姓名', dataIndex: 'name', width: 100 },
                { title: '职务', dataIndex: 'title' },
                { title: '电话', dataIndex: 'phone', width: 130 },
                { title: '微信', dataIndex: 'wechat', width: 120 },
                { title: '邮箱', dataIndex: 'email' },
                {
                  title: '',
                  key: 'action',
                  width: 60,
                  render: (_: unknown, r: ProjectContact) => (
                    <a onClick={() => openContact(r)}>编辑</a>
                  ),
                },
              ]}
            />
          </Card>

          {/* ③ 项目要求 */}
          <Card id="sec-require" size="small" title="项目要求" style={{ marginBottom: 16 }}>
            <div className="ef-grid">
              <EditableField
                label="客户产品类型"
                value={p.product_type}
                onSave={(v) => save('product_type', v)}
              />
              <EditableField
                label="要求节拍"
                value={p.required_cycle}
                onSave={(v) => save('required_cycle', v)}
              />
              <EditableField
                label="要求产能"
                value={p.required_capacity}
                onSave={(v) => save('required_capacity', v)}
              />
              <EditableField
                label="旧线改造"
                value={p.is_retrofit}
                type="switch"
                suffix="改造要停客户产线，现场窗口紧"
                onSave={(v) => save('is_retrofit', v)}
              />
            </div>
          </Card>

          {/* ④ 时间与金额 */}
          <Card
            id="sec-time"
            size="small"
            title="时间与金额"
            style={{ marginBottom: 16 }}
          >
            <div className="ef-grid">
              <EditableField
                label="商机截止"
                value={p.deadline}
                type="date"
                onSave={(v) => save('deadline', v)}
              />
              <div className="ef">
                <span className="ef-label">商机剩余</span>
                <span className="ef-value">
                  {p.opportunity_days_left === null || p.opportunity_days_left === undefined ? (
                    DASH
                  ) : p.opportunity_days_left < 0 ? (
                    <Tag color="red">已过期 {-p.opportunity_days_left} 天</Tag>
                  ) : p.opportunity_days_left === 0 ? (
                    <Tag color="red">今天到期</Tag>
                  ) : (
                    <Tag color={p.opportunity_days_left <= 3 ? 'red' : 'blue'}>
                      还剩 {p.opportunity_days_left} 天
                    </Tag>
                  )}
                </span>
              </div>
              <EditableField
                label="项目交期"
                value={p.delivery_days}
                type="number"
                suffix=" 天（签约后起算）"
                onSave={(v) => save('delivery_days', v)}
              />
              <div className="ef">
                <span className="ef-label">项目起止</span>
                <span className="ef-value">
                  {p.delivery_start && p.delivery_end ? (
                    `${p.delivery_start} → ${p.delivery_end}`
                  ) : (
                    <Typography.Text type="secondary">待签约</Typography.Text>
                  )}
                </span>
              </div>
              <EditableField
                label="预计签单"
                value={p.expect_sign_date}
                type="date"
                onSave={(v) => save('expect_sign_date', v)}
              />
              <EditableField
                label="预计金额"
                value={p.est_amount}
                type="money"
                onSave={(v) => save('est_amount', v)}
              />
              <EditableField
                label="履约保证金"
                value={p.performance_deposit}
                type="money"
                suffix="（我们交给对方）"
                onSave={(v) => save('performance_deposit', v)}
              />
              <EditableField
                label="保证金退还"
                value={p.performance_deposit_return_date}
                type="date"
                onSave={(v) => save('performance_deposit_return_date', v)}
              />
              <EditableField
                label="已退还"
                value={p.performance_deposit_returned}
                type="switch"
                onSave={(v) => save('performance_deposit_returned', v)}
              />
            </div>
          </Card>

          {/* ⑤ 成交信息 */}
          <Card id="sec-deal" size="small" title="成交信息" style={{ marginBottom: 16 }}>
            {p.stage === '线索' ? (
              <Space direction="vertical">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没成交登记" />
                <Button type="primary" size="small" onClick={openDeal}>
                  现在登记
                </Button>
              </Space>
            ) : (
              <>
                <div className="ef-grid">
                  <EditableField
                    label="合同金额"
                    value={p.amount}
                    type="money"
                    suffix={p.amount_tax_incl ? '（含税）' : '（不含税）'}
                    onSave={(v) => save('amount', v)}
                  />
                  <EditableField
                    label="合同签订日"
                    value={p.period_start}
                    type="date"
                    onSave={(v) => save('period_start', v)}
                  />
                  <EditableField
                    label="合同交期"
                    value={p.period_end}
                    type="date"
                    onSave={(v) => save('period_end', v)}
                  />
                  <EditableField
                    label="客户合同号"
                    value={p.contract_no_customer}
                    onSave={(v) => save('contract_no_customer', v)}
                  />
                  <EditableField
                    label="质保期"
                    value={p.warranty_months}
                    type="number"
                    suffix=" 个月（验收后起算）"
                    onSave={(v) => save('warranty_months', v)}
                  />
                  <div className="ef">
                    <span className="ef-label">质保金</span>
                    <span className="ef-value">
                      {p.warranty_amount ? (
                        <Space size={6}>
                          <span>¥{Number(p.warranty_amount).toLocaleString()}</span>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            （客户扣留，质保期满退回）
                          </Typography.Text>
                        </Space>
                      ) : (
                        DASH
                      )}
                    </span>
                  </div>
                  <EditableField
                    label="技术协议"
                    value={p.tech_agreement_frozen}
                    type="switch"
                    suffix="冻结后 = 设计基线、验收裁判"
                    onSave={(v) => save('tech_agreement_frozen', v)}
                  />
                  <EditableField
                    label="验收标准"
                    value={p.acceptance_standard}
                    wide
                    onSave={(v) => save('acceptance_standard', v)}
                  />
                  <EditableField
                    label="指定品牌"
                    value={p.designated_brand}
                    wide
                    suffix="指定件不能换供应商、不能合并采购"
                    onSave={(v) => save('designated_brand', v)}
                  />
                  <EditableField
                    label="违约条款"
                    value={p.penalty_note}
                    wide
                    onSave={(v) => save('penalty_note', v)}
                  />
                  <EditableField
                    label="交货方式"
                    value={p.delivery_mode}
                    onSave={(v) => save('delivery_mode', v)}
                  />
                  <EditableField
                    label="现场接收条件"
                    value={p.site_condition}
                    onSave={(v) => save('site_condition', v)}
                  />
                </div>
                <Divider orientation="left" plain style={{ marginTop: 8 }}>
                  付款方式（回款跟踪）
                </Divider>
                <Table
                  rowKey="seq"
                  size="small"
                  pagination={false}
                  dataSource={detail?.payment_terms ?? []}
                  locale={{ emptyText: <Empty description="没有登记付款节点" /> }}
                  columns={[
                    { title: '#', dataIndex: 'seq', width: 46 },
                    { title: '节点', dataIndex: 'node_name', width: 110 },
                    {
                      title: '比例',
                      dataIndex: 'percent',
                      width: 80,
                      align: 'right',
                      render: (v: number | null) => (v ? `${v}%` : '—'),
                    },
                    {
                      title: '金额',
                      dataIndex: 'amount',
                      width: 140,
                      align: 'right',
                      render: (v: number | null) => (v ? `¥${v.toLocaleString()}` : '—'),
                    },
                    { title: '触发条件', dataIndex: 'condition' },
                    {
                      title: '收款',
                      dataIndex: 'received_amount',
                      width: 110,
                      align: 'right',
                      render: (v: number | null) => (v ? `¥${v.toLocaleString()}` : <Tag>未收</Tag>),
                    },
                    {
                      title: '操作',
                      key: 'recv',
                      width: 100,
                      render: (_: unknown, t: { seq: number; node_name: string; amount?: number | null; received_amount?: number | null }) => {
                        const unpaid = Math.max(0, Number(t.amount ?? 0) - Number(t.received_amount ?? 0))
                        if (!hasPerm('payment:edit')) return <Typography.Text type="secondary">—</Typography.Text>
                        return unpaid > 0 ? (
                          <a onClick={() => openReceive(t)}>登记回款</a>
                        ) : (
                          <Tag color="success">已收齐</Tag>
                        )
                      },
                    },
                  ]}
                />

                <Modal
                  title={`登记回款：${receiveTarget?.node_name ?? ''}`}
                  open={!!receiveTarget}
                  onCancel={() => setReceiveTarget(null)}
                  onOk={() => void doReceive()}
                  confirmLoading={saving}
                  okText="登记"
                  destroyOnClose
                >
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                    这个节点还有未收 ¥{Number(receiveTarget?.unpaid ?? 0).toLocaleString()}；可多次登记，未收不超总额。
                  </Typography.Paragraph>
                  <Form form={receiveForm} layout="vertical" preserve={false}>
                    <Form.Item name="received_amount" label="本次实收金额" rules={[{ required: true, message: '填金额' }]}>
                      <InputNumber style={{ width: '100%' }} min={0.01} />
                    </Form.Item>
                    <Form.Item name="received_date" label="收款日期">
                      <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="remark" label="备注">
                      <Input placeholder="如：银行转账 / 承兑" />
                    </Form.Item>
                  </Form>
                </Modal>
              </>
            )}
          </Card>

          {p.stage !== '线索' && p.stage !== '成交待立项' && (
            <>
              <Card
                id="sec-design"
                size="small"
                title="设计进度（工程设计 · 设计 BOM + 材料 BOM）"
                style={{ marginBottom: 16 }}
              >
                <Table<DesignOverviewRow>
                  rowKey="equip_no"
                  size="small"
                  pagination={false}
                  dataSource={design}
                  locale={{ emptyText: <Empty description="还没有设备" /> }}
                  columns={[
                    {
                      title: '设备',
                      key: 'eq',
                      width: 180,
                      render: (_: unknown, r: DesignOverviewRow) => (
                        <Space size={6}>
                          <Typography.Text strong>{r.equip_no}</Typography.Text>
                          <span>{r.equip_name}</span>
                        </Space>
                      ),
                    },
                    {
                      title: '设计状态',
                      dataIndex: 'state',
                      width: 130,
                      render: (v: string) =>
                        v === 'BOM完整' ? (
                          <Tag color="success">BOM完整</Tag>
                        ) : v === '设计BOM已提交' ? (
                          <Tag color="gold">设计BOM已提交</Tag>
                        ) : v === '设计中' ? (
                          <Tag color="processing">设计中</Tag>
                        ) : (
                          <Tag>未开始</Tag>
                        ),
                    },
                    {
                      title: '进度',
                      key: 'p',
                      render: (_: unknown, r: DesignOverviewRow) => (
                        <Space size={12} style={{ fontSize: 12 }}>
                          <span>图 {r.drawings}</span>
                          <span>零件 {r.parts}</span>
                          {r.unpublished > 0 && <Tag color="blue">{r.unpublished} 张待发布</Tag>}
                          {r.parts_without_material > 0 && (
                            <Tag color="orange">{r.parts_without_material} 个缺材料</Tag>
                          )}
                        </Space>
                      ),
                    },
                    {
                      title: '操作',
                      key: 'a',
                      width: 200,
                      render: (_: unknown, r: DesignOverviewRow) => (
                        <Space size="middle">
                          <Button
                            type="primary"
                            size="small"
                            onClick={() => nav(`/projects/${projectNo}/design/${r.equip_no}`)}
                          >
                            进入设计
                          </Button>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            出图 / BOM
                          </Typography.Text>
                        </Space>
                      ),
                    },
                  ]}
                />
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 0' }}>
                  设计师也可以从左侧「我的任务」进入自己的设计任务；这里给项目经理看总体进度。
                </Typography.Paragraph>
              </Card>

              <Card
                id="sec-kitting"
                size="small"
                title="齐套率（装配 · 只展示，不设门槛）"
                style={{ marginBottom: 16 }}
                extra={<a onClick={() => nav('/assembly')}>装配 / 厂内调试</a>}
              >
                <Table<KittingOverviewRow>
                  rowKey="equip_no"
                  size="small"
                  pagination={false}
                  dataSource={kitting}
                  locale={{ emptyText: <Empty description="还没有设备" /> }}
                  columns={[
                    {
                      title: '设备',
                      key: 'eq',
                      width: 180,
                      render: (_: unknown, r: KittingOverviewRow) => (
                        <Space size={6}>
                          <Typography.Text strong>{r.equip_no}</Typography.Text>
                          <span>{r.equip_name}</span>
                        </Space>
                      ),
                    },
                    {
                      title: '齐套率',
                      key: 'rate',
                      width: 280,
                      render: (_: unknown, r: KittingOverviewRow) => (
                        <Progress
                          size="small"
                          percent={Math.round((r.kitting_rate ?? 0) * 100)}
                          strokeColor={r.kitting_rate >= 1 ? '#52c41a' : r.kitting_rate >= 0.6 ? '#1677ff' : '#faad14'}
                        />
                      ),
                    },
                    {
                      title: '到位',
                      key: 'd',
                      render: (_: unknown, r: KittingOverviewRow) =>
                        `${r.arrived}/${r.total} 种 · 数量 ${r.arrived_qty}/${r.total_qty}`,
                    },
                  ]}
                />
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 0' }}>
                  齐套率只做展示：装配随时能开工（56%、78% 都行），不设 100% 门槛。自制件已转运、外协件合格、采购件已到货/入库、库存够，就算到位。
                </Typography.Paragraph>
              </Card>

              <Card
                id="sec-equipment"
                size="small"
                title="设备清单（任务分配）"
                style={{ marginBottom: 16 }}
                extra={
                  <Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      点设备名右边「设计」进设计工作面（出图 / BOM）
                    </Typography.Text>
                    <a onClick={() => nav(`/projects/${projectNo}/initiate`)}>去立项页维护</a>
                  </Space>
                }
              >
                <EquipmentEditor projectNo={projectNo} onChanged={load} />
              </Card>

              <Card id="sec-milestone" size="small" title="节点计划" style={{ marginBottom: 16 }}>
                <MilestoneEditor projectNo={projectNo} users={users} onChanged={load} />
              </Card>

              <Card
                id="sec-longlead"
                size="small"
                title="长周期采购"
                style={{ marginBottom: 16 }}
              >
                <LongLeadEditor projectNo={projectNo} onChanged={load} />
              </Card>

              <Card id="sec-team" size="small" title="项目团队" style={{ marginBottom: 16 }}>
                <TeamEditor projectNo={projectNo} users={users} onChanged={load} />
              </Card>
            </>
          )}

          {/* ⑥ 资料包 */}
          <Card
            id="sec-atts"
            size="small"
            title={`资料包（${detail?.attachments.length ?? 0}）`}
            style={{ marginBottom: 16 }}
            extra={
              <Space>
                <Select
                  size="small"
                  style={{ width: 110 }}
                  value={attCategory}
                  onChange={setAttCategory}
                  options={ATT_CATEGORIES.map((c) => ({ value: c, label: c }))}
                />
                <Upload
                  multiple
                  showUploadList={false}
                  disabled={uploading}
                  beforeUpload={(file) => {
                    void doUpload(file as unknown as File)
                    return false
                  }}
                >
                  <Button size="small" type="primary" loading={uploading}>
                    上传
                  </Button>
                </Upload>
              </Space>
            }
          >
            <Table<Attachment>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail?.attachments ?? []}
              locale={{ emptyText: <Empty description="还没有资料" /> }}
              columns={[
                {
                  title: '分类',
                  dataIndex: 'category',
                  width: 100,
                  render: (v: string) => <Tag>{v}</Tag>,
                },
                { title: '文件名', dataIndex: 'filename' },
                {
                  title: '大小',
                  dataIndex: 'size',
                  width: 90,
                  render: (v: number | null) =>
                    v ? `${Math.max(1, Math.round(v / 1024))} KB` : '—',
                },
                {
                  title: '上传时间',
                  dataIndex: 'uploaded_at',
                  width: 150,
                  render: (v: string) => (v ? v.replace('T', ' ').slice(0, 16) : '—'),
                },
                {
                  title: '操作',
                  key: 'action',
                  width: 120,
                  render: (_: unknown, r: Attachment) => (
                    <Space size="middle">
                      <a onClick={() => void doPreview(r)}>预览</a>
                      <a onClick={() => void downloadAttachment(projectNo, r)}>下载</a>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>

          {/* ⑦ 操作记录 */}
          <Card id="sec-logs" size="small" title={`操作记录（${logs.length}）`}>
            {logs.length ? (
              <Timeline
                items={logs.map((l) => {
                  const changes = l.detail?.changes ?? []
                  return {
                    children: (
                      <>
                        <div>{l.summary ?? l.action}</div>
                        {changes.length > 0 && (
                          <div style={{ marginTop: 4 }}>
                            {changes.map((c, i) => (
                              <div key={i} style={{ fontSize: 12 }}>
                                <Typography.Text type="secondary">{c.label}：</Typography.Text>
                                <Typography.Text delete type="secondary">
                                  {c.old}
                                </Typography.Text>
                                <Typography.Text type="secondary"> → </Typography.Text>
                                <Typography.Text strong>{c.new}</Typography.Text>
                              </div>
                            ))}
                          </div>
                        )}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {l.created_at.replace('T', ' ').slice(0, 16)} · {l.username}
                        </Typography.Text>
                      </>
                    ),
                  }
                })}
              />
            ) : (
              <Empty description="还没有操作记录" />
            )}
          </Card>
        </Col>
      </Row>

      {/* ============ 成交登记 ============ */}
      <Modal
        title={`成交登记 · ${projectNo}`}
        open={dealOpen}
        width={900}
        onCancel={() => setDealOpen(false)}
        onOk={() => void submitDeal()}
        confirmLoading={saving}
        okText="确认成交"
        destroyOnClose
        styles={{ body: { maxHeight: '68vh', overflowY: 'auto', paddingRight: 8 } }}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          登记后阶段变为「成交待立项」；所有字段都会记入操作记录（旧值 → 新值）
        </Typography.Paragraph>
        <Form form={dealForm} layout="vertical" preserve={false}>
          <Row gutter={12}>
            <Col span={6}>
              <Form.Item name="period_start" label="合同签订日" rules={[{ required: true, message: '必填' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="period_end" label="合同交期" rules={[{ required: true, message: '必填' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="amount" label="合同金额（元）" rules={[{ required: true, message: '必填' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={100000} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="warranty_months" label="质保期（月）" rules={[{ required: true, message: '必填' }]}>
                <InputNumber style={{ width: '100%' }} min={0} addonAfter="月" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="contract_no_customer" label="客户合同号">
                <Input placeholder="选填" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="acceptance_standard" label="验收标准">
                <Input placeholder="如：节拍 22 秒/台，连续运行 72 小时" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="designated_brand" label="甲方指定品牌 / 供应商">
                <Input placeholder="如：PLC 指定西门子；机器人指定 ABB" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="delivery_mode" label="交货方式与地点">
                <Input placeholder="厂内提货 / 送货到厂 / 到场安装" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="site_condition" label="客户现场接收条件">
                <Input placeholder="水电气 / 地坪 / 通道 / 进场时间窗" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="penalty_note" label="交期与违约条款">
                <Input placeholder="如：逾期每天按合同额 0.5‰ 计罚" />
              </Form.Item>
            </Col>
          </Row>
          <Divider orientation="left" plain>
            付款方式（比例合计应为 100%）
          </Divider>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
            质保金 = 节点名含「质保」的那一条（客户从货款里扣留、质保期满才付给我们），系统自动带出
          </Typography.Paragraph>
          <Form.List
            name="payment_terms"
            rules={[
              {
                validator: async (_, value) => {
                  if (!value || value.length === 0) throw new Error('至少登记 1 个付款节点')
                  const first = value[0] ?? {}
                  if (!first.node_name) throw new Error('第 1 个付款节点的节点名必填')
                },
              },
            ]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field) => (
                  <Row key={field.key} gutter={8} align="middle">
                    <Col span={6}>
                      <Form.Item
                        name={[field.name, 'node_name']}
                        style={{ marginBottom: 0 }}
                        rules={field.name === 0 ? [{ required: true, message: '填节点名' }] : undefined}
                      >
                        <Input placeholder="节点名，如 预付款" />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item name={[field.name, 'percent']}>
                        <InputNumber style={{ width: '100%' }} min={0} max={100} addonAfter="%" />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name={[field.name, 'condition']}>
                        <Input placeholder="触发条件" />
                      </Form.Item>
                    </Col>
                    <Col span={2}>
                      <a onClick={() => remove(field.name)}>删除</a>
                    </Col>
                  </Row>
                ))}
                <Button type="dashed" onClick={() => add()} block>
                  + 添加付款节点
                </Button>
                <Form.ErrorList errors={errors} />
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* ============ 关闭订单 ============ */}
      <Modal
        title={`关闭订单 · ${projectNo}`}
        open={closeOpen}
        width={520}
        onCancel={() => setCloseOpen(false)}
        onOk={() => void submitClose()}
        confirmLoading={saving}
        okText="确认关闭"
        okButtonProps={{ danger: true }}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          关闭后阶段变为「已关闭」，不可再推进
        </Typography.Paragraph>
        <Form form={closeForm} layout="vertical" preserve={false}>
          <Form.Item
            name="close_reason"
            label="关闭原因"
            rules={[{ required: true, message: '请选择关闭原因' }]}
          >
            <Select options={CLOSE_REASONS.map((r) => ({ value: r, label: r }))} />
          </Form.Item>
          <Form.Item name="close_note" label="备注">
            <Input.TextArea rows={2} placeholder="如：客户预算砍了 30%，本轮放弃" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ============ 联系人 ============ */}
      <Modal
        title={editingContact ? `编辑联系人 · ${editingContact.name}` : '新增联系人'}
        open={contactOpen}
        width={560}
        onCancel={() => setContactOpen(false)}
        onOk={() => void submitContact()}
        confirmLoading={saving}
        okText="保存"
        destroyOnClose
      >
        <Form form={contactForm} layout="vertical" preserve={false}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="role_tag" label="角色">
                <Select
                  allowClear
                  options={[
                    { value: '技术对接人', label: '技术对接人' },
                    { value: '采购', label: '采购' },
                    { value: '决策人', label: '决策人' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="title" label="职务">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="电话">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="wechat" label="微信">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="email" label="邮箱">
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  )
}
