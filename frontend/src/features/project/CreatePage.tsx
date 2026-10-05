import { App, Button, Card, Space, Typography, Upload, Form } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useBack, useGoFrom } from '../../hooks/useFrom'
import SectionNav from '../../components/ds/SectionNav'
import { CREATE_SECTIONS, defaultSectionKey } from '../../configs/sections'
import { useTab } from '../../hooks/useTab'
import ProjectFormFields, {
  type ProjectFormValues,
} from '../../components/ProjectFormFields'
import { createProject, errMsg, listProjects, listUsers, nextProjectNo, uploadAttachment, type Project, type ProjectCreate } from '../../api/client'

/**
 * 新建商机（独立页面）。
 * 字段分 6 组：基本信息 · 客户信息 · 项目要求 · 时间与金额 · 接收到的资料 · 商务跟进
 */
export default function ProjectCreate() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const go = useGoFrom()
  // ★ 来源优先：从某个工作台点进来（?from=）时，「取消」回那个台；没有来源才退回项目列表 / 新建商机成功后进【新商机详情】（来源继续透传给详情的返回口）
  const back = useBack('/projects', '← 返回列表')
  const [form] = Form.useForm<ProjectFormValues>()
  const [users, setUsers] = useState<{ id: number; name: string }[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [previewNo, setPreviewNo] = useState('')
  const [files, setFiles] = useState<UploadFile[]>([])
  // ★ P4：步骤（分区）进 URL
  const [tab, setTab] = useTab(CREATE_SECTIONS.map((x) => x.key), defaultSectionKey(CREATE_SECTIONS))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    form.setFieldsValue({ is_retrofit: false })
    void (async () => {
      try {
        const [p, u, no] = await Promise.all([listProjects(), listUsers(), nextProjectNo()])
        setProjects(p)
        setUsers(u)
        setPreviewNo(no)
      } catch (e) {
        message.error(errMsg(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * ★ 分区模式下的必填项**看不见** → 提交失败时跳到第一个出错的区。
   * 用 antd 返回的 `errorFields`（字段名 → 分区）而不是查 DOM：DOM 上的 `has-error`
   * 是**异步**才挂上去的，catch 那一刻往往还没有（第一版这么写，P-09 断言就抓到了）。
   */
  // ★ 字段 → 分区（**按 ProjectFormFields 里各组的实际内容**核对过，别再凭直觉写）：
  //   踩过一次：把 customer_name 当成"基本"，实际它在 ② 客户信息里 → 提交错误跳错区。
  // ★ 字段 → 分区：**由 ProjectFormFields 里各 Group 的实际字段自动核对生成**。
  //   为什么强调这点：我手写过两次都错（customer_name 当"基本"、deadline 当"项目要求"），
  //   而它只影响"提交失败跳到哪一步"，错了用户在错的那步看不到错 —— 属于最难发现的一类 bug。
  const FIELD_SECTION: Record<string, string> = {
    'contacts': 'customer',
    'contacts.name': 'customer',
    'contacts.phone': 'customer',
    'project_name': 'basic',
    'deal_mode': 'basic',
    'source': 'basic',
    'project_desc': 'basic',
    'customer_name': 'customer',
    'site_address': 'require',
    'product_type': 'require',
    'required_cycle': 'require',
    'required_capacity': 'require',
    'is_retrofit': 'require',
    'deadline': 'time',
    'delivery_days': 'time',
    'expect_sign_date': 'time',
    'est_amount': 'time',
    'performance_deposit': 'time',
    'performance_deposit_return_date': 'time',
    'performance_deposit_returned': 'time',
    'received_docs': 'atts',
    'sales_id': 'follow',
    'competitor': 'follow',
    'related_project_no': 'follow',
    'risk_note': 'follow',
    'amount': 'follow',
    'amount_tax_incl': 'follow',
    'period_start': 'follow',
    'period_end': 'follow',
    'warranty_months': 'follow',
    'contract_no_customer': 'follow',
    'tech_agreement_frozen': 'follow',
  }
  const tabRef = useRef(tab)
  tabRef.current = tab
  const jumpToFirstError = (errorFields?: { name: (string | number)[] }[]) => {
    // ① 字段级错误：按映射**确定性**跳（errorFields 的顺序就是出现顺序）
    for (const f of errorFields ?? []) {
      const key = f.name.map(String).join('.')
      const sec = FIELD_SECTION[key] ?? FIELD_SECTION[String(f.name[0])]
      if (sec) { setTab(sec); return }
    }
    // ② 兜底：**列表级错误**（如"至少要有一个客户方联系人"）不进 errorFields ——
    //   等一帧后找"含错误、但被藏起来的分区"跳过去。
    //   ★ 但**当前区已经有错时不要跳**：用户正看着第一处错误，跳走反而找不着
    //     （第一版没判这条，一提交就把人从①甩到②，写链 fill 立刻超时）。
    window.setTimeout(() => {
      const cur = document.querySelector(`[data-section="${tabRef.current}"]`)
      if (cur?.querySelector('.ant-form-item-explain-error, .ant-form-item-has-error')) return
      const secs = Array.from(document.querySelectorAll('[data-section]'))
      const hit = secs.find(
        (el) =>
          (el as HTMLElement).style.display === 'none' &&
          el.querySelector('.ant-form-item-explain-error, .ant-form-item-has-error'),
      )
      const key = hit?.getAttribute('data-section')
      if (key) setTab(key)
    }, 60)
  }

  const submit = async () => {
    let v
    try {
      v = await form.validateFields()
    } catch (err) {
      // 校验未过：antd 已标红（P-09：必须接住，不抛未捕获异常）。
      // ★ 分区模式下还要**跳到第一个出错的区** —— 否则错在隐藏的那一步里，用户看不见。
      const ef = (err as { errorFields?: { name: (string | number)[] }[] })?.errorFields
      jumpToFirstError(ef)
      return
    }
    const body: ProjectCreate = {
      customer_name: v.customer_name,
      project_name: v.project_name,
      contacts: (v.contacts ?? []).filter((c) => c?.name),
      received_docs: v.received_docs ?? [],
      project_desc: v.project_desc,
      deadline: v.deadline ? v.deadline.format('YYYY-MM-DD') : undefined,
      delivery_days: v.delivery_days,
      deal_mode: v.deal_mode,
      source: v.source,
      site_address: v.site_address,
      is_retrofit: v.is_retrofit ?? false,
      product_type: v.product_type,
      required_cycle: v.required_cycle,
      required_capacity: v.required_capacity,
      est_amount: v.est_amount,
      expect_sign_date: v.expect_sign_date ? v.expect_sign_date.format('YYYY-MM-DD') : undefined,
      competitor: v.competitor,
      related_project_no: v.related_project_no || undefined,
      risk_note: v.risk_note,
      sales_id: v.sales_id,
      performance_deposit: v.performance_deposit,
      performance_deposit_return_date: v.performance_deposit_return_date
        ? v.performance_deposit_return_date.format('YYYY-MM-DD')
        : undefined,
      performance_deposit_returned: v.performance_deposit_returned ?? false,
    }
    setSaving(true)
    try {
      const created = await createProject(body)
      let uploaded = 0
      for (const f of files) {
        if (f.originFileObj) {
          await uploadAttachment(created.project_no, '客户资料', f.originFileObj as File)
          uploaded += 1
        }
      }
      message.success(
        `商机已建立，编号 ${created.project_no}${uploaded ? ` · 已挂 ${uploaded} 份资料` : ''}`,
      )
      // ★ Q1=A：建完直接进新商机详情（下一步就是成交登记）；go() 会把来源（来源工作台）继续带给详情页
      go(`/projects/${created.project_no}`)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ds-page">
      {/* ── 常驻区：标题 + 自动发号提示 + 取消/建立商机（原来跟着表单滚到底）── */}
      <div className="ds-panel" style={{ marginBottom: 16 }}>
      <Card
        title={
          <Space size={12}>
            <span>新建商机</span>
            {previewNo && (
              <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
                系统将自动发号 <Typography.Text strong>{previewNo}</Typography.Text>
                （此号即订单号、合同号、项目号，一生不变）
              </Typography.Text>
            )}
          </Space>
        }
        extra={
          <Space>
            <Button onClick={() => nav(back.to)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void submit()}>
              建立商机
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" preserve={false}>
          {/* ── 分区条（= 步骤导航，P4）：① 基本信息 … ⑥ 商务跟进 ──────────
              表单页的分区要**只藏不卸**（antd Form 字段卸载就丢值），所以用 barOnly +
              `activeSection`：所有组都在 DOM 里，只显示当前那一步。 */}
          <SectionNav
            barOnly
            tab={tab}
            onTab={setTab}
            sections={CREATE_SECTIONS.map((x) => ({ key: x.key, label: x.label }))}
          />
          <ProjectFormFields
            activeSection={tab}
            users={users}
            projects={projects}
            withContacts
            docsExtra={
              <Form.Item label="资料文件（客户需求书 / 图纸 / 招标文件…）" style={{ marginBottom: 0 }}>
                <Upload
                  multiple
                  fileList={files}
                  beforeUpload={() => false}
                  onChange={({ fileList }) => setFiles(fileList)}
                  onRemove={(f) => {
                    setFiles((prev) => prev.filter((x) => x.uid !== f.uid))
                    return true
                  }}
                >
                  <Button>+ 选择文件（可多选）</Button>
                </Upload>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  建立商机后这些文件会自动挂到它下面
                </Typography.Text>
              </Form.Item>
            }
          />

          {/* 滚到底也不用滚回顶部才敢提交 */}
          <div className="form-actions">
            <Button onClick={() => nav(back.to)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void submit()}>
              建立商机
            </Button>
          </div>
        </Form>
      </Card>
    </div>
    </div>
  )
}
