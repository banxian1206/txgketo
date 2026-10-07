import { Alert, App, Button, Card, Descriptions, Typography, Upload, Form } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useBack, useGoFrom } from '../../hooks/useFrom'
import SectionNav from '../../components/ds/SectionNav'
import { CREATE_SECTIONS, defaultSectionKey } from '../../configs/sections'
import { useTab } from '../../hooks/useTab'
import type { ProjectFormValues } from '../../components/ProjectFormFields'
import OpportunityCreateFields, { OPPORTUNITY_FIELD_SECTION } from '../../components/OpportunityCreateFields'
import { createProject, errMsg, listProjects, listUsers, nextProjectNo, uploadAttachment, type Project, type ProjectCreate } from '../../api/client'

/**
 * 新建商机（独立页面）。
 * 按销售建立商机的顺序组织三步，必填业务规则不变。
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
  const savingRef = useRef(false)
  const [saveError, setSaveError] = useState('')
  const values = Form.useWatch([], form) as Partial<ProjectFormValues> | undefined
  const sectionIndex = CREATE_SECTIONS.findIndex((section) => section.key === tab)
  const lastSection = sectionIndex === CREATE_SECTIONS.length - 1

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
  // 字段映射来自新建字段组件，按实际分区生成并由静态护栏核对。
  const FIELD_SECTION = OPPORTUNITY_FIELD_SECTION
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
    if (savingRef.current) return
    setSaveError('')
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
    if (savingRef.current) return
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
    savingRef.current = true
    setSaving(true)
    try {
      const created = await createProject(body)
      let uploaded = 0
      const failed: string[] = []
      for (const f of files) {
        if (!f.originFileObj) continue
        try {
          await uploadAttachment(created.project_no, '客户资料', f.originFileObj as File)
          uploaded += 1
        } catch { failed.push(f.name) }
      }
      if (failed.length) {
        // 项目已创建，上传失败不能留在新建页诱导重复创建。
        message.warning(`商机 ${created.project_no} 已建立；${failed.length} 份资料上传失败，请在详情的资料区补传：${failed.join('、')}`, 10)
      } else {
        message.success(`商机已建立，编号 ${created.project_no}${uploaded ? ` · 已挂 ${uploaded} 份资料` : ''}`)
      }
      // 建完进入商机详情继续跟进；go() 透传来源工作台。
      go(`/projects/${created.project_no}`)
    } catch (e) {
      setSaveError(errMsg(e))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className="ds-page opportunity-create">
      {/* 标题只标识当前页面；步骤与提交操作统一放在表单底部。 */}
      <div className="ds-panel" style={{ marginBottom: 16 }}>
      <Card title="新建商机">
        {previewNo && (
          <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
            编号预览 <Typography.Text strong>{previewNo}</Typography.Text>，实际编号以建立成功为准。成交与立项后沿用同一编号。
          </Typography.Paragraph>
        )}
        <Typography.Paragraph type="secondary">先建立商机与客户需求，成交后再登记合同和安排项目经理。本页尚未保存，切换分区会保留已填内容。</Typography.Paragraph>
        {saveError && <Alert type="error" showIcon message="商机建立失败" description={saveError} style={{ marginBottom: 16 }} />}
        <Form form={form} layout="vertical" preserve={false} disabled={saving}>
          {/* ── 三步导航：商机与联系 → 需求与时间 → 资料与商务 ──────────
              表单页的分区要**只藏不卸**（antd Form 字段卸载就丢值），所以用 barOnly +
              `activeSection`：所有组都在 DOM 里，只显示当前那一步。 */}
          <SectionNav
            barOnly
            tab={tab}
            onTab={(key) => { if (!saving) setTab(key) }}
            sections={CREATE_SECTIONS.map((x) => ({ key: x.key, label: x.label }))}
          />
          <Typography.Paragraph type="secondary" className="create-step-hint">
            第 {sectionIndex + 1} / {CREATE_SECTIONS.length} 步 · 带 * 的字段是建立商机所需信息，其余可以后续补充。
          </Typography.Paragraph>
          <OpportunityCreateFields
            activeSection={tab}
            users={users}
            projects={projects}
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

          {lastSection && (
            <div className="create-review" data-testid="create-review">
              <Typography.Title level={5}>建立前核对</Typography.Title>
              <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
                { key: 'project', label: '商机名称', children: values?.project_name || '未填写' },
                { key: 'customer', label: '客户名称', children: values?.customer_name || '未填写' },
                { key: 'contact', label: '首位联系人', children: values?.contacts?.[0]?.name || '未填写' },
                { key: 'phone', label: '联系人电话', children: values?.contacts?.[0]?.phone || '未填写' },
                { key: 'site', label: '项目地点', children: values?.site_address || '未填写' },
                { key: 'deadline', label: '商机截止', children: values?.deadline?.format('YYYY-MM-DD') || '未填写' },
                { key: 'sales', label: '销售负责人', children: users.find((u) => u.id === values?.sales_id)?.name || '未选择' },
                { key: 'files', label: '待上传资料', children: `${files.length} 份` },
              ]} />
              <Typography.Text type="secondary">填写内容尚未保存；点击“建立商机”后统一校验并提交。</Typography.Text>
            </div>
          )}
          {/* 分区导航只切换视图，不提交、不卸载字段。 */}
          <div className="form-actions">
            <Button disabled={saving} onClick={() => nav(back.to)}>取消</Button>
            {sectionIndex > 0 && <Button disabled={saving} onClick={() => setTab(CREATE_SECTIONS[sectionIndex - 1].key)}>上一项</Button>}
            {lastSection ? (
              <Button type="primary" loading={saving} onClick={() => void submit()}>建立商机</Button>
            ) : (
              <Button type="primary" disabled={saving} onClick={() => setTab(CREATE_SECTIONS[sectionIndex + 1].key)}>
                下一项：{CREATE_SECTIONS[sectionIndex + 1].label.replace(/^[①②③④⑤⑥]\s*/, '')}
              </Button>
            )}
          </div>
        </Form>
      </Card>
    </div>
    </div>
  )
}
