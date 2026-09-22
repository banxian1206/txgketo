import {
  App,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Progress,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  debugAssembly,
  errMsg,
  finishAssembly,
  getKitting,
  hasPerm,
  kittingOverview,
  listAssemblyRecords,
  listProjects,
  startAssembly,
  type AssemblyRecordRow,
  type KittingLine,
  type KittingOverviewRow,
  type KittingResult,
} from '../api/client'
import AuthedImage from '../components/AuthedImage'
import MfgPhotoPicker from '../components/MfgPhotoPicker'
import { mfgPhotoUrl } from '../api/client'
import { ASSEMBLY_STATUS as STATUS_COLOR } from '../theme/status'
import { T } from '../theme/tokens'

const rateColor = (r: number) => (r >= 1 ? T.success : r >= 0.6 ? T.brand : T.warning)

export default function Assembly() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const canEdit = hasPerm('mfg:edit')

  const [projects, setProjects] = useState<{ project_no: string; project_name: string }[]>([])
  const [projectNo, setProjectNo] = useState<string | undefined>()
  const [overview, setOverview] = useState<KittingOverviewRow[]>([])
  const [detail, setDetail] = useState<{ equip_no: string; data: KittingResult } | null>(null)
  const [records, setRecords] = useState<AssemblyRecordRow[]>([])
  const [loading, setLoading] = useState(false)

  // 弹窗
  const [startTarget, setStartTarget] = useState<{ equip_no: string; rate: number } | null>(null)
  const [debugTarget, setDebugTarget] = useState<AssemblyRecordRow | null>(null)
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  // ★ 预填在弹窗挂载后执行（P-03）
  useEffect(() => {
    if (!startTarget) return
    form.resetFields()
    form.setFieldsValue({ sub_assembly: '整机装配' })
  }, [startTarget, form])
  useEffect(() => {
    if (!debugTarget) return
    form.resetFields()
    form.setFieldsValue({ result: '合格' })
  }, [debugTarget, form])

  const load = useCallback(
    async (pno?: string) => {
      setLoading(true)
      try {
        const [ov, recs] = await Promise.all([
          pno ? kittingOverview(pno) : Promise.resolve([]),
          listAssemblyRecords(pno ? { project_no: pno } : {}),
        ])
        setOverview(ov)
        setRecords(recs)
      } catch (e) {
        message.error(errMsg(e))
      } finally {
        setLoading(false)
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

  const pickProject = (pno?: string) => {
    setProjectNo(pno)
    setDetail(null)
    void load(pno)
  }

  const openDetail = async (equipNo: string) => {
    if (!projectNo) return
    try {
      setDetail({ equip_no: equipNo, data: await getKitting(projectNo, equipNo) })
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const doStart = async () => {
    if (!startTarget || !projectNo) return
    const v = await form.validateFields()
    setSaving(true)
    try {
      await startAssembly({
        project_no: projectNo,
        equip_no: startTarget.equip_no,
        sub_assembly: v.sub_assembly,
        photos,
        remark: v.remark || undefined,
      })
      message.success('已开始装配（齐套率只是记录，随时可开工）')
      setStartTarget(null)
      setPhotos([])
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const doFinish = async (r: AssemblyRecordRow) => {
    try {
      await finishAssembly(r.id, {})
      message.success('装配完成')
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const openDebug = (r: AssemblyRecordRow) => {
    setPhotos([])
    setDebugTarget(r)
  }

  const doDebug = async () => {
    if (!debugTarget) return
    const v = await form.validateFields()
    setSaving(true)
    try {
      await debugAssembly(debugTarget.id, { result: v.result, note: v.note, photos })
      message.success('厂内调试已记录')
      setDebugTarget(null)
      setPhotos([])
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card
      title="装配 · 齐套率（S6）"
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          齐套率只做展示：装配随时能开工（56%、78% 都行），系统不设 100% 门槛
        </Typography.Text>
      }
    >
      <Space style={{ marginBottom: 12 }}>
        <Select
          showSearch
          optionFilterProp="label"
          style={{ width: 300 }}
          placeholder="选项目看齐套率"
          value={projectNo}
          onChange={(v: string | undefined) => pickProject(v)}
          options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          齐套率 = 到位零件种数 / 全部零件种数（自制件已转运、外协合格、采购件已到/入库、库存够）
        </Typography.Text>
      </Space>

      {!projectNo && <Empty description="先选一个项目" />}

      {projectNo && (
        <Row gutter={12} style={{ marginBottom: 16 }}>
          {overview.length === 0 && <Empty description="这个项目还没有设备" />}
          {overview.map((o) => (
            <Col span={8} key={o.equip_no} style={{ marginBottom: 12 }}>
              <Card
                size="small"
                title={
                  <span>
                    {o.equip_no} {o.equip_name}
                  </span>
                }
                extra={
                  <Space size={4}>
                    <a onClick={() => void openDetail(o.equip_no)}>明细</a>
                    {canEdit && (
                      <a onClick={() => { setPhotos([]); setStartTarget({ equip_no: o.equip_no, rate: o.kitting_rate }) }}>
                        开始装配
                      </a>
                    )}
                  </Space>
                }
              >
                <Progress
                  percent={Math.round((o.kitting_rate ?? 0) * 100)}
                  strokeColor={rateColor(o.kitting_rate ?? 0)}
                  format={(p) => `${p}%`}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  到位 {o.arrived}/{o.total} 种 · 数量 {o.arrived_qty}/{o.total_qty}
                </Typography.Text>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {detail && (
        <Card
          size="small"
          style={{ marginBottom: 16 }}
          title={`${detail.data.project_no} / ${detail.data.equip_no} 齐套明细 —— ${Math.round(detail.data.kitting_rate * 100)}%（到位 ${detail.data.arrived}/${detail.data.total} 种）`}
          extra={<a onClick={() => setDetail(null)}>收起</a>}
        >
          <Table<KittingLine>
            rowKey="ref"
            size="small"
            pagination={false}
            dataSource={detail.data.lines}
            columns={[
              { title: '零件 / 物料', dataIndex: 'ref', width: 220 },
              { title: '名称', dataIndex: 'name', render: (v: string | null) => v ?? '—' },
              { title: '类型', key: 'kind', width: 100, render: (_: unknown, r: KittingLine) => <Tag>{r.kind}</Tag> },
              { title: '来源', dataIndex: 'source', width: 70 },
              { title: '需求', key: 'qty', width: 90, align: 'right' as const, render: (_: unknown, r: KittingLine) => `${r.qty} ${r.unit ?? ''}` },
              {
                title: '到位',
                key: 'ready',
                width: 160,
                render: (_: unknown, r: KittingLine) =>
                  r.ready ? <Tag color="success">✅ {r.state}</Tag> : <Tag color="error">缺 · {r.state}</Tag>,
              },
            ]}
          />
        </Card>
      )}

      <Typography.Title level={5}>装配 / 厂内调试记录</Typography.Title>
      <Table<AssemblyRecordRow>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={records}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        locale={{ emptyText: <Empty description="还没有装配记录" /> }}
        columns={[
          {
            title: '项目 / 设备',
            key: 'pe',
            width: 160,
            render: (_: unknown, r: AssemblyRecordRow) => (
              <a onClick={() => nav(`/projects/${r.project_no}`)}>
                {r.project_no} · {r.equip_no}
              </a>
            ),
          },
          { title: '形态', dataIndex: 'sub_assembly', width: 100 },
          {
            title: '开工齐套率',
            dataIndex: 'kitting_rate',
            width: 120,
            render: (v: number) => <Tag color={rateColor(v)}>{Math.round(v * 100)}%</Tag>,
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (v: string) => <Tag color={STATUS_COLOR[v] ?? 'default'}>{v}</Tag>,
          },
          { title: '装配照片', key: 'ph', width: 140, render: (_: unknown, r: AssemblyRecordRow) => (
            <Space wrap>
              {r.photos.slice(0, 3).map((p) => <AuthedImage key={p} path={mfgPhotoUrl(p)} size={36} />)}
            </Space>
          ) },
          {
            title: '厂内调试',
            key: 'dbg',
            width: 160,
            render: (_: unknown, r: AssemblyRecordRow) =>
              r.debug_result ? (
                <Tag color={r.debug_result === '合格' ? 'success' : 'error'}>
                  {r.debug_result} {r.debug_note ? `· ${r.debug_note}` : ''}
                </Tag>
              ) : (
                '—'
              ),
          },
          {
            title: '操作',
            key: 'a',
            width: 170,
            render: (_: unknown, r: AssemblyRecordRow) => (
              <Space size={4}>
                {canEdit && r.status === '装配中' && <a onClick={() => void doFinish(r)}>装配完成</a>}
                {canEdit && (r.status === '已装配' || r.status === '调试中') && (
                  <a onClick={() => openDebug(r)}>厂内调试</a>
                )}
              </Space>
            ),
          },
        ]}
      />

      {/* 开始装配 */}
      <Modal
        open={!!startTarget}
        title={`开始装配 · ${startTarget?.equip_no ?? ''}`}
        onCancel={() => setStartTarget(null)}
        onOk={() => void doStart()}
        confirmLoading={saving}
        okText="开始装配"
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          当前齐套率 <b>{Math.round((startTarget?.rate ?? 0) * 100)}%</b> —— 系统**不看齐套率**，到了多少都能开工，
          开工时把这个数字记录在装配履历里，方便回头看。
        </Typography.Paragraph>
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="sub_assembly" label="装配形态" rules={[{ required: true }]}>
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="整机装配">整机装配</Radio.Button>
              <Radio.Button value="组件预装">组件预装</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input placeholder="如 先装框架、缺件后补" />
          </Form.Item>
          <Form.Item label="装配照片">
            <MfgPhotoPicker
              projectNo={projectNo ?? ''}
              refNo={`${startTarget?.equip_no ?? ''}-assembly`}
              value={photos}
              onChange={setPhotos}
              label="拍照（可后补）"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 厂内调试 */}
      <Modal
        open={!!debugTarget}
        title={`厂内调试 · ${debugTarget?.project_no ?? ''} / ${debugTarget?.equip_no ?? ''}`}
        onCancel={() => setDebugTarget(null)}
        onOk={() => void doDebug()}
        confirmLoading={saving}
        okText="记录"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="result" label="调试结果" rules={[{ required: true }]}>
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="合格">合格</Radio.Button>
              <Radio.Button value="有问题">有问题</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="note" label="说明（单机调试 / 联调）">
            <Input.TextArea rows={2} placeholder="如 单机调试 OK，联调待现场" />
          </Form.Item>
          <Form.Item label="调试照片">
            <MfgPhotoPicker
              projectNo={debugTarget?.project_no ?? ''}
              refNo={`${debugTarget?.equip_no ?? ''}-debug`}
              value={photos}
              onChange={setPhotos}
              label="拍照（可后补）"
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
