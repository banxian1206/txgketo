import {
  App,
  Button,
  Card,
  Col,
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
  Tabs,
  Tag,
  Typography,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  acceptSiteIncoming,
  commissionArrive,
  commissionStart,
  finishCommission,
  errMsg,
  hasPerm,
  linkSiteIssue,
  listProjects,
  siteIncoming,
  sitePhotoUrl,
  siteWorkbench,
  uploadSitePhotos,
  type SiteCommissionRow,
  type SiteDailyRow,
  type SiteIncomingPending,
  type SiteIssueRow,
  type SiteSurveyRow,
  type SiteWorkbench,
} from '../api/client'
import AuthedImage from '../components/AuthedImage'
import MfgPhotoPicker from '../components/MfgPhotoPicker'

const ISSUE_COLOR: Record<string, string> = { 待处理: 'error', 已转变更: 'processing', 已闭环: 'success' }
const COMMISSION_COLOR: Record<string, string> = { 已申请: 'gold', 已到现场: 'processing', 已开始调试: 'success' }

/** 现场台（PC，S8）：给项目经理/现场负责人看整体 —— 手机端是现场的主终端。 */
export default function Site() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const canEdit = hasPerm('site:edit') || hasPerm('project:edit')
  const [projects, setProjects] = useState<{ project_no: string; project_name: string }[]>([])
  const [projectNo, setProjectNo] = useState<string | undefined>()
  const [wb, setWb] = useState<SiteWorkbench | null>(null)
  const [incoming, setIncoming] = useState<{ pending: SiteIncomingPending[]; done: SiteIncomingPending[] }>({ pending: [], done: [] })
  const [target, setTarget] = useState<SiteIncomingPending | null>(null)
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(
    async (pno?: string) => {
      try {
        const [w, inc] = await Promise.all([
          siteWorkbench(pno),
          pno ? siteIncoming(pno) : Promise.resolve({ pending: [], done: [] }),
        ])
        setWb(w)
        setIncoming(inc)
      } catch (e) {
        message.error(errMsg(e))
      }
    },
    [message],
  )

  useEffect(() => {
    listProjects()
      .then((rows) => setProjects(rows.map((p) => ({ project_no: p.project_no, project_name: p.project_name }))))
      .catch(() => undefined)
    void load()
  }, [load])

  const doIncoming = async () => {
    if (!target) return
    const v = await form.validateFields()
    if (!photos.length) {
      message.warning('到货清点要拍照')
      return
    }
    setSaving(true)
    try {
      await acceptSiteIncoming(target.receipt_id, {
        result: v.result,
        shortage_detail: (v.shortage ?? []).filter((s: { item?: string }) => s.item),
        photos,
        remark: v.remark,
      })
      message.success('现场清点完成')
      setTarget(null)
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const c = wb?.counts

  return (
    <Card
      title="现场安装（S8）"
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          勘测 → 来货清点（含直发）→ 每日汇报（拍照/录视频）→ 申请调试；现场问题一律走变更
        </Typography.Text>
      }
    >
      <Space style={{ marginBottom: 12 }}>
        <Select
          showSearch
          optionFilterProp="label"
          style={{ width: 300 }}
          placeholder="选项目"
          value={projectNo}
          onChange={(v: string | undefined) => { setProjectNo(v); void load(v) }}
          options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
        />
        {!canEdit && <Tag>只读</Tag>}
      </Space>

      {!projectNo && <Empty description="先选一个项目（现场日常用手机端 /m/site）" />}

      {projectNo && (
        <>
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={4}><Statistic title="已勘测" value={c?.surveyed ?? 0} /></Col>
            <Col span={4}><Statistic title="今日汇报" value={c?.daily_today ?? 0} /></Col>
            <Col span={4}><Statistic title="待处理问题" value={c?.open_issues ?? 0} valueStyle={{ color: c?.open_issues ? '#cf1322' : undefined }} /></Col>
            <Col span={4}><Statistic title="待派调试" value={c?.to_dispatch ?? 0} /></Col>
            <Col span={4}><Statistic title="调试中" value={c?.debugging ?? 0} /></Col>
          </Row>

          <Tabs
            items={[
              {
                key: 'incoming',
                label: `来货清点 (${incoming.pending.length})`,
                children: (
                  <Table<SiteIncomingPending>
                    rowKey="receipt_id"
                    size="small"
                    dataSource={incoming.pending}
                    pagination={false}
                    locale={{ emptyText: <Empty description="没有待清点的直发件" /> }}
                    columns={[
                      { title: '到货单', dataIndex: 'receipt_no', width: 130 },
                      { title: '物料', dataIndex: 'item_no', width: 160 },
                      { title: '数量', key: 'q', width: 100, render: (_: unknown, r) => `${r.qty} ${r.unit ?? ''}` },
                      { title: '到货日', dataIndex: 'receipt_date', width: 120 },
                      { title: '收货地点', dataIndex: 'deliver_to', width: 130 },
                      {
                        title: '操作',
                        key: 'a',
                        width: 100,
                        render: (_: unknown, r) =>
                          canEdit ? <a onClick={() => { setPhotos([]); form.resetFields(); form.setFieldsValue({ result: '齐', shortage: [] }); setTarget(r) }}>清点验收</a> : '—',
                      },
                    ]}
                  />
                ),
              },
              {
                key: 'daily',
                label: `每日汇报 (${wb?.dailies.length ?? 0})`,
                children: (
                  <Table<SiteDailyRow>
                    rowKey="id"
                    size="small"
                    dataSource={wb?.dailies ?? []}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    locale={{ emptyText: <Empty description="还没有汇报" /> }}
                    columns={[
                      { title: '日期', dataIndex: 'report_date', width: 110 },
                      { title: '阶段', dataIndex: 'stage', width: 100, render: (v: string) => <Tag color="processing">{v}</Tag> },
                      { title: '设备', dataIndex: 'equip_no', width: 80, render: (v: string | null) => v ?? '—' },
                      { title: '人数', dataIndex: 'people', width: 70, render: (v: number | null) => v ?? '—' },
                      { title: '完成了', dataIndex: 'done_items', render: (v: string[]) => v.join('；') },
                      { title: '问题', dataIndex: 'problem', render: (v: string | null) => v ?? '—' },
                      {
                        title: '照片 / 视频',
                        key: 'p',
                        width: 140,
                        render: (_: unknown, r: SiteDailyRow) => (
                          <Space wrap>
                            {r.photos.slice(0, 2).map((p) => <AuthedImage key={p} path={sitePhotoUrl(p)} size={32} />)}
                            <span style={{ fontSize: 12 }}>{r.photos.length} 图 · {r.videos.length} 视频</span>
                          </Space>
                        ),
                      },
                    ]}
                  />
                ),
              },
              {
                key: 'issues',
                label: `现场问题 (${wb?.issues.length ?? 0})`,
                children: (
                  <Table<SiteIssueRow>
                    rowKey="id"
                    size="small"
                    dataSource={wb?.issues ?? []}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    locale={{ emptyText: <Empty description="没有问题" /> }}
                    columns={[
                      { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag color={ISSUE_COLOR[v] ?? 'default'}>{v}</Tag> },
                      { title: '设备', dataIndex: 'equip_no', width: 80, render: (v: string | null) => v ?? '—' },
                      { title: '问题', dataIndex: 'title' },
                      { title: '说明', dataIndex: 'desc', render: (v: string | null) => v ?? '—' },
                      {
                        title: '操作',
                        key: 'a',
                        width: 160,
                        render: (_: unknown, r: SiteIssueRow) => (
                          <Space size={4}>
                            {canEdit && r.status === '待处理' && (
                              <>
                                <a onClick={() => void linkSiteIssue(r.id, { change_id: undefined }).then(() => void load(projectNo))}>转变更</a>
                                <a onClick={() => void linkSiteIssue(r.id, { close: true }).then(() => void load(projectNo))}>闭环</a>
                              </>
                            )}
                            {r.related_change_id && <a onClick={() => nav('/changes')}>看变更</a>}
                          </Space>
                        ),
                      },
                    ]}
                  />
                ),
              },
              {
                key: 'commission',
                label: `申请调试 (${wb?.commissions.length ?? 0})`,
                children: (
                  <Table<SiteCommissionRow>
                    rowKey="id"
                    size="small"
                    dataSource={wb?.commissions ?? []}
                    pagination={false}
                    locale={{ emptyText: <Empty description="还没申请调试" /> }}
                    columns={[
                      { title: '状态', dataIndex: 'status', width: 110, render: (v: string) => <Tag color={COMMISSION_COLOR[v] ?? 'default'}>{v}</Tag> },
                      { title: '申请时间', dataIndex: 'request_at', width: 150, render: (v: string | null) => v?.slice(0, 16).replace('T', ' ') ?? '—' },
                      { title: '派谁去', dataIndex: 'dispatch_to', width: 140, render: (v: string | null) => v ?? '—' },
                      { title: '计划到场', dataIndex: 'plan_date', width: 110, render: (v: string | null) => v ?? '—' },
                      { title: '实际到场', dataIndex: 'arrived_at', width: 150, render: (v: string | null) => v?.slice(0, 16).replace('T', ' ') ?? '—' },
                      {
                        title: '操作',
                        key: 'a',
                        width: 140,
                        render: (_: unknown, r: SiteCommissionRow) => (
                          <Space size={4}>
                            {canEdit && r.status === '已申请' && <a onClick={() => void commissionArrive(r.id).then(() => void load(projectNo))}>已到现场</a>}
                            {canEdit && r.status === '已到现场' && <a onClick={() => void commissionStart(r.id).then(() => void load(projectNo))}>开始调试</a>}
                            {canEdit && r.status === '已开始调试' && <a onClick={() => void finishCommission(r.id).then(() => void load(projectNo))}>调试完成</a>}
                          </Space>
                        ),
                      },
                    ]}
                  />
                ),
              },
              {
                key: 'survey',
                label: `勘测 (${wb?.surveys.length ?? 0})`,
                children: (
                  <Table<SiteSurveyRow>
                    rowKey="id"
                    size="small"
                    dataSource={wb?.surveys ?? []}
                    pagination={false}
                    locale={{ emptyText: <Empty description="还没勘测" /> }}
                    columns={[
                      { title: '约定入场', dataIndex: 'enter_date', width: 120, render: (v: string | null) => v ?? '待定' },
                      { title: '甲方现场', dataIndex: 'contact', width: 160, render: (v: string | null) => v ?? '—' },
                      { title: '承重', dataIndex: 'floor_load', width: 100, render: (v: string | null) => v ?? '—' },
                      { title: '通道', dataIndex: 'passage', width: 120, render: (v: string | null) => v ?? '—' },
                      { title: '电/气/网', key: 'e', render: (_: unknown, r: SiteSurveyRow) => `${r.power ?? '—'} / ${r.air ?? '—'} / ${r.network ?? '—'}` },
                      { title: '备注', dataIndex: 'remark', render: (v: string | null) => v ?? '—' },
                    ]}
                  />
                ),
              },
            ]}
          />
        </>
      )}

      <Modal
        open={!!target}
        title={`现场清点 · ${target?.item_no ?? ''}`}
        onCancel={() => setTarget(null)}
        onOk={() => void doIncoming()}
        confirmLoading={saving}
        okText="提交"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="result" label="清点结论" rules={[{ required: true }]}>
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="齐">齐</Radio.Button>
              <Radio.Button value="缺件">缺件</Radio.Button>
              <Radio.Button value="破损">破损</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.List name="shortage">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} wrap style={{ marginBottom: 6 }}>
                    <Form.Item name={[f.name, 'item']} style={{ marginBottom: 0 }}><Input placeholder="缺/损零件" style={{ width: 170 }} /></Form.Item>
                    <Form.Item name={[f.name, 'qty']} style={{ marginBottom: 0 }}><Input type="number" placeholder="数量" style={{ width: 90 }} /></Form.Item>
                    <Form.Item name={[f.name, 'reason']} style={{ marginBottom: 0 }}><Input placeholder="原因" style={{ width: 150 }} /></Form.Item>
                    <a onClick={() => remove(f.name)}>删</a>
                  </Space>
                ))}
                <Button type="dashed" block onClick={() => add()}>加一条缺件</Button>
              </>
            )}
          </Form.List>
          <Form.Item name="remark" label="备注" style={{ marginTop: 8 }}><Input /></Form.Item>
          <Form.Item label="照片（必须）" required>
            <MfgPhotoPicker projectNo={projectNo ?? ''} refNo="incoming" value={photos} onChange={setPhotos} upload={uploadSitePhotos} photoUrl={sitePhotoUrl} label="拍照" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
