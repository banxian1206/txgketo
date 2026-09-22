import {
  App,
  Button,
  Card,
  Space,
  Typography,
  Upload,
  Form,
} from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import ProjectFormFields, {
  type ProjectFormValues,
} from '../../components/ProjectFormFields'
import {
  createProject,
  errMsg,
  listProjects,
  listUsers,
  nextProjectNo,
  uploadAttachment,
  type Project,
  type ProjectCreate,
} from '../../api/client'

/**
 * 新建商机（独立页面）。
 * 字段分 6 组：基本信息 · 客户信息 · 项目要求 · 时间与金额 · 接收到的资料 · 商务跟进
 */
export default function ProjectCreate() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const [form] = Form.useForm<ProjectFormValues>()
  const [users, setUsers] = useState<{ id: number; name: string }[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [previewNo, setPreviewNo] = useState('')
  const [files, setFiles] = useState<UploadFile[]>([])
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

  const submit = async () => {
    let v
    try {
      v = await form.validateFields()
    } catch {
      return // 校验未过：antd 已标红 / 列表级错误已渲染，不抛未捕获异常（P-09）
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
      nav('/projects')
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
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
            <Button onClick={() => nav('/projects')}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void submit()}>
              建立商机
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" preserve={false}>
          <ProjectFormFields
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
            <Button onClick={() => nav('/projects')}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void submit()}>
              建立商机
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  )
}
