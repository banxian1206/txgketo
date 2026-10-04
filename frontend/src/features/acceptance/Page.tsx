import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'

import {
  acceptanceWorkbench,
  applyAcceptance,
  confirmAcceptance,
  errMsg,
  hasPerm,
  signAcceptanceDoc,
  uploadAcceptanceDocs,
  type AcceptanceRow,
  type AcceptanceWorkbench,
} from '../../api/client'
import { SelectProject } from '../../components/fields'
import { CodeNo } from '../../components/ui/Primitives'
import { acceptanceDocUrl } from '../../api/client'
import { useUrlState } from '../../hooks/useUrlState'
import { readSession } from '../../contexts/session'
import { ACCEPTANCE_STATUS as ACC_COLOR } from '../../theme/status'
import { T } from '../../theme/tokens'

const DOC_TYPES = ['技术协议', '图纸清单', '检验报告', '调试记录', '操作手册', '备件清单', '培训记录', '验收单', '其他']

const API = import.meta.env.VITE_API_BASE ?? '/api/v1'

/** 验收与质保（S10）：调试完成 → 申请验收 → 资料包 → 客户确认 → 自动质保。 */
export default function AcceptancePage() {
  const { message } = App.useApp()
  const canEdit = hasPerm('acceptance:edit')

  const [wb, setWb] = useState<AcceptanceWorkbench | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<AcceptanceRow | null>(null)
  const [docTarget, setDocTarget] = useState<AcceptanceRow | null>(null)
  const [docType, setDocType] = useState('检验报告')
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  // ★ F11（2026-10-04 走查核实）：签字类动作 = 法律性数据，列表必须能按项目收口（筛选进 URL，刷新/返航不丢）
  const [q, setQ] = useUrlState({ project: undefined })
  const filterNo = q.project || ''

  const load = useCallback(async () => {
    try {
      setWb(await acceptanceWorkbench(filterNo || undefined))
    } catch (e) {
      message.error(errMsg(e))
    }
  }, [message, filterNo])

  useEffect(() => {
    void load()
  }, [load])

  const doApply = async () => {
    let v
    try { v = await form.validateFields() } catch { return }
    setSaving(true)
    try {
      await applyAcceptance({ project_no: v.project_no, remark: v.remark })
      message.success('已申请客户验收')
      setApplyOpen(false)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const doConfirm = async () => {
    if (!confirmTarget) return
    let v
    try { v = await form.validateFields() } catch { return }
    setSaving(true)
    try {
      const r = await confirmAcceptance(confirmTarget.id, {
        result: v.result,
        signed_by: v.signed_by,
        accepted_at: v.accepted_at?.format('YYYY-MM-DD'),
        remark: v.remark,
      })
      message.success(v.result === '通过' ? `验收通过 → 质保期 ${r.warranty_start} ~ ${r.warranty_end}` : '已记录未通过')
      setConfirmTarget(null)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const doUpload = async () => {
    if (!docTarget) return
    if (!files.length) {
      message.warning('先选文件')
      return
    }
    setSaving(true)
    try {
      await uploadAcceptanceDocs(docTarget.id, docType, files)
      message.success('资料包已上传')
      setFiles([])
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  /** 直接下载（带鉴权）：fetch → blob 另存 */
  const openDoc = async (docId: number, filename: string) => {
    try {
      // 重构 1.3：token 从单一 session 读（原散读 'txgk_token'）
      const token = readSession()?.token
      const res = await fetch(`${API}${acceptanceDocUrl(docId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const c = wb?.counts

  return (
    <Card
      title="验收与质保（S10）"
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          调试完成 → 申请客户验收 → 上传资料包 → 客户签字确认 → ★ 自动进入质保期
        </Typography.Text>
      }
    >
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={4}><Statistic title="待验收" value={c?.pending ?? 0} valueStyle={{ color: c?.pending ? T.goldText : undefined }} /></Col>
        <Col span={4}><Statistic title="已通过" value={c?.passed ?? 0} /></Col>
        <Col span={4}><Statistic title="未通过" value={c?.rejected ?? 0} /></Col>
        {/* ★ F11：项目筛选（签字不能跨项目误操作） */}
        <Col span={7}>
          <SelectProject
            allowClear
            className="w-full"
            placeholder="按项目筛选（默认全部项目）"
            value={filterNo || undefined}
            onChange={(v: string | undefined) => setQ({ project: v || undefined })}
          />
        </Col>
        <Col span={5} style={{ textAlign: 'right' }}>
          <Button type="primary" disabled={!canEdit} onClick={() => setApplyOpen(true)}>
            申请客户验收
          </Button>
        </Col>
      </Row>
      {!filterNo && (
        <Typography.Paragraph type="warning" style={{ fontSize: 12, marginTop: -6 }}>
          当前是全部项目混排 —— 签字前请逐行核对项目号，或选上方筛选收到一个项目。
        </Typography.Paragraph>
      )}

      <Table<AcceptanceRow>
        rowKey="id"
        size="small"
        dataSource={wb?.acceptances ?? []}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        locale={{ emptyText: <Empty description="还没有验收单" /> }}
        columns={[
          {
            title: '项目',
            key: 'p',
            width: 200,
            // ★ F11：项目号等宽强标识 —— 签字是对这个项目的法律动作，不能看错行
            render: (_: unknown, r: AcceptanceRow) => (
              <Space size={6}>
                <CodeNo>{r.project_no}</CodeNo>
                <Typography.Text type="secondary" className="hint-inline">{r.project_name ?? ''}</Typography.Text>
              </Space>
            ),
          },
          { title: '申请时间', dataIndex: 'applied_at', width: 150, render: (v: string | null) => v?.slice(0, 16).replace('T', ' ') ?? '—' },
          { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={ACC_COLOR[v] ?? 'default'}>{v}</Tag> },
          {
            title: '资料包',
            key: 'docs',
            width: 130,
            render: (_: unknown, r: AcceptanceRow) => `${r.doc_count} 个（已签 ${r.signed_count}）`,
          },
          { title: '客户签字', dataIndex: 'signed_by', width: 130, render: (v: string | null) => v ?? '—' },
          {
            title: '质保期',
            key: 'w',
            width: 200,
            render: (_: unknown, r: AcceptanceRow) =>
              r.warranty_start ? `${r.warranty_start} ~ ${r.warranty_end}（${r.warranty_months} 个月）` : '—',
          },
          {
            title: '操作',
            key: 'a',
            width: 220,
            render: (_: unknown, r: AcceptanceRow) => (
              <Space size={4} wrap>
                {canEdit && <a onClick={() => setConfirmTarget(r)}>客户确认</a>}
                {canEdit && <a onClick={() => { setDocTarget(r); setFiles([]); setDocType('检验报告') }}>资料包</a>}
              </Space>
            ),
          },
        ]}
      />

      <Typography.Title level={5} style={{ marginTop: 16 }}>质保到期提醒（60 天内，同时提醒质保金可退）</Typography.Title>
      <Table
        rowKey="project_no"
        size="small"
        dataSource={wb?.warranty_watch ?? []}
        pagination={false}
        locale={{ emptyText: <Empty description="60 天内没有到期的质保" /> }}
        columns={[
          { title: '项目', key: 'p', render: (_: unknown, r) => `${r.project_no} ${r.project_name ?? ''}` },
          { title: '质保起', dataIndex: 'warranty_start', width: 120 },
          { title: '质保止', dataIndex: 'warranty_end', width: 120 },
          { title: '还剩', dataIndex: 'days_left', width: 90, render: (v: number | null) => (v == null ? '—' : `${v} 天`) },
          {
            title: '质保金',
            dataIndex: 'warranty_amount',
            width: 120,
            align: 'right',
            render: (v: number | null) => (v == null ? '—' : `¥${v.toLocaleString()}`),
          },
          { title: '提示', key: 't', render: () => '质保到期 → 找客户退质保金 / 续签维保' },
        ]}
      />

      {/* 申请验收 */}
      <Modal open={applyOpen} title="申请客户验收" onCancel={() => setApplyOpen(false)} onOk={() => void doApply()} confirmLoading={saving} okText="申请" destroyOnHidden>
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="project_no" label="项目号" rules={[{ required: true, message: '选项目' }]}>
            <SelectProject />
          </Form.Item>
          <Form.Item name="remark" label="说明"><Input placeholder="现场调试完成，具备验收条件" /></Form.Item>
        </Form>
      </Modal>

      {/* 客户确认 */}
      <Modal open={!!confirmTarget} title={`客户确认验收 · ${confirmTarget?.project_no ?? ''}`} onCancel={() => setConfirmTarget(null)} onOk={() => void doConfirm()} confirmLoading={saving} okText="确认" destroyOnHidden>
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="result" label="验收结论" rules={[{ required: true }]}>
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="通过">通过</Radio.Button>
              <Radio.Button value="不通过">不通过</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="signed_by" label="客户签字人" rules={[{ required: true, message: '验收通过必须记录客户签字人' }]}><Input placeholder="如 客户 张工" /></Form.Item>
          <Form.Item name="accepted_at" label="验收日期" initialValue={dayjs()}><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            通过后：质保期 = 验收日 + 合同质保月数，项目阶段自动进入「质保」。
          </Typography.Text>
        </Form>
      </Modal>

      {/* 资料包 */}
      <Modal open={!!docTarget} title={`验收资料包 · ${docTarget?.project_no ?? ''}`} onCancel={() => setDocTarget(null)} footer={null} width={640} destroyOnHidden>
        <Space style={{ marginBottom: 10 }}>
          <Select style={{ width: 140 }} value={docType} onChange={setDocType} options={DOC_TYPES.map((d) => ({ value: d, label: d }))} />
          <Upload multiple beforeUpload={() => false} fileList={files.map((f, i) => ({ uid: String(i), name: f.name }))} onChange={(info) => setFiles(info.fileList.map((f) => f.originFileObj as File).filter(Boolean))}>
            <Button icon={<UploadOutlined />}>选文件</Button>
          </Upload>
          <Button type="primary" loading={saving} onClick={() => void doUpload()}>上传</Button>
        </Space>
        <Table
          rowKey="id"
          size="small"
          dataSource={docTarget?.documents ?? []}
          pagination={false}
          locale={{ emptyText: <Empty description="还没上传资料" /> }}
          columns={[
            { title: '类型', dataIndex: 'doc_type', width: 110 },
            { title: '文件', dataIndex: 'filename', render: (v: string, r) => <a onClick={() => void openDoc(r.id, v)}>{v}</a> },
            {
              title: '已签',
              dataIndex: 'is_signed',
              width: 90,
              render: (v: boolean, r) =>
                v ? <Tag color="success">已签</Tag> : canEdit ? <a onClick={() => void signAcceptanceDoc(r.id).then(() => void load())}>标记已签</a> : <Tag>未签</Tag>,
            },
          ]}
        />
      </Modal>
    </Card>
  )
}
