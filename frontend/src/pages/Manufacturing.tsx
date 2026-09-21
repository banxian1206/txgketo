import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
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
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  acceptOutsource,
  acceptProdOrder,
  dispatchProdOrder,
  errMsg,
  generateProdOrders,
  hasPerm,
  listEquipment,
  listProjects,
  mfgPhotoUrl,
  prodWorkbench,
  returnOutsource,
  sendOutsource,
  startProdOrder,
  transferProdOrder,
  type MfgWorkbench,
  type OutsourceRow,
  type ProdOrderRow,
} from '../api/client'
import MfgPhotoPicker from '../components/MfgPhotoPicker'
import AuthedImage from '../components/AuthedImage'

const STATUS_COLOR: Record<string, string> = {
  待领料: 'default',
  已派工: 'processing',
  制造中: 'processing',
  完工待验收: 'gold',
  已转运: 'success',
  返工: 'error',
}
const OS_COLOR: Record<string, string> = {
  待发出: 'default',
  外协中: 'processing',
  回厂待检: 'gold',
  合格: 'success',
  已取消: 'default',
}
const TEAMS = ['下料', '机加', '焊接', '钣金', '喷涂']

type ActionKind = 'dispatch' | 'accept' | 'transfer' | 'os-send' | 'os-accept'

export default function Manufacturing() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const canEdit = hasPerm('mfg:edit')

  const [wb, setWb] = useState<MfgWorkbench | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('wait')

  // 生成排产
  const [genProject, setGenProject] = useState<string | undefined>()
  const [genEquip, setGenEquip] = useState<string | undefined>()
  const [projects, setProjects] = useState<{ project_no: string; project_name: string }[]>([])
  const [equips, setEquips] = useState<{ equip_no: string; equip_name: string }[]>([])
  const [genLoading, setGenLoading] = useState(false)

  // 动作弹窗
  const [action, setAction] = useState<{ kind: ActionKind; order?: ProdOrderRow; os?: OutsourceRow } | null>(
    null,
  )
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  // 详情
  const [detail, setDetail] = useState<ProdOrderRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setWb(await prodWorkbench())
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
    listProjects()
      .then((rows) => setProjects(rows.map((p) => ({ project_no: p.project_no, project_name: p.project_name }))))
      .catch(() => undefined)
  }, [load])

  const onGenProject = async (no?: string) => {
    setGenProject(no)
    setGenEquip(undefined)
    setEquips([])
    if (!no) return
    try {
      setEquips(await listEquipment(no))
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const doGenerate = async () => {
    if (!genProject || !genEquip) return
    setGenLoading(true)
    try {
      const r = await generateProdOrders(genProject, genEquip, { plan_days: 2 })
      if (r.order_count + r.outsource_count === 0) message.info('这台设备没有新的自制件/外协件需要排产')
      else message.success(`已排产：自制件 ${r.order_count} 个、外协件 ${r.outsource_count} 个`)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setGenLoading(false)
    }
  }

  const openAction = (kind: ActionKind, order?: ProdOrderRow, os?: OutsourceRow) => {
    setPhotos([])
    form.resetFields()
    if (kind === 'dispatch') form.setFieldsValue({ step_name: '下料', material_item_no: order?.material_item_no })
    if (kind === 'accept') form.setFieldsValue({ result: '合格' })
    if (kind === 'transfer') form.setFieldsValue({ transfer_to: '装配区' })
    if (kind === 'os-send') form.setFieldsValue({ material_supplied: true, sent_at: dayjs(), due_date: dayjs().add(7, 'day') })
    if (kind === 'os-accept') form.setFieldsValue({ result: '合格' })
    setAction({ kind, order, os })
  }

  const submitAction = async () => {
    if (!action) return
    const v = await form.validateFields()
    if (photos.length === 0) {
      message.warning('这一动作要拍照留痕')
      return
    }
    setSaving(true)
    try {
      if (action.kind === 'dispatch' && action.order) {
        await dispatchProdOrder(action.order.id, {
          step_name: v.step_name,
          material_item_no: v.material_item_no || undefined,
          material_qty: v.material_qty || undefined,
          issued_to: v.issued_to || undefined,
          photos,
          remark: v.remark || undefined,
        })
        message.success('已下发（原材料 + 图纸，已拍照）')
      } else if (action.kind === 'accept' && action.order) {
        if (v.result !== '合格' && !(v.reason || '').trim()) {
          message.warning('不合格/返工必须写明原因')
          setSaving(false)
          return
        }
        await acceptProdOrder(action.order.id, { result: v.result, reason: v.reason, photos })
        message.success(v.result === '合格' ? '验收合格 → 可转运' : '已标记返工')
      } else if (action.kind === 'transfer' && action.order) {
        await transferProdOrder(action.order.id, { transfer_to: v.transfer_to, photos })
        message.success('已转运装配区（已拍照）')
      } else if (action.kind === 'os-send' && action.os) {
        await sendOutsource(action.os.id, {
          supplier_name: v.supplier_name || undefined,
          sent_at: v.sent_at?.format('YYYY-MM-DD'),
          due_date: v.due_date?.format('YYYY-MM-DD'),
          material_supplied: v.material_supplied,
          photos,
          remark: v.remark || undefined,
        })
        message.success('外协已发出')
      } else if (action.kind === 'os-accept' && action.os) {
        await acceptOutsource(action.os.id, { result: v.result, reason: v.reason, photos })
        message.success('外协验收完成')
      }
      setAction(null)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const doStart = async (o: ProdOrderRow) => {
    try {
      await startProdOrder(o.id)
      message.success('已开工')
      await load()
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const doReturn = async (o: OutsourceRow) => {
    try {
      await returnOutsource(o.id, {})
      message.success('已登记回厂待检')
      await load()
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const canGo = hasPerm('mfg:view')

  const orderColumns = (kind: 'wait' | 'running' | 'transfer' | 'rework') => [
    {
      title: '单号',
      dataIndex: 'order_no',
      width: 110,
      render: (v: string, r: ProdOrderRow) => <a onClick={() => setDetail(r)}>{v}</a>,
    },
    {
      title: '项目 / 设备',
      key: 'pe',
      width: 150,
      render: (_: unknown, r: ProdOrderRow) => (
        <a onClick={() => nav(`/projects/${r.project_no}`)}>
          {r.project_no} · {r.equip_no ?? ''}
        </a>
      ),
    },
    {
      title: '零件（图号）',
      key: 'item',
      render: (_: unknown, r: ProdOrderRow) => (
        <>
          <div>{r.item_no}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.item_name ?? ''}
          </Typography.Text>
        </>
      ),
    },
    { title: '数量', key: 'qty', width: 90, align: 'right' as const, render: (_: unknown, r: ProdOrderRow) => `${r.qty} ${r.unit}` },
    {
      title: '计划完成',
      dataIndex: 'plan_end',
      width: 120,
      render: (v: string | null, r: ProdOrderRow) => (
        <Space size={4}>
          {v ?? '—'}
          {r.overdue && <Tag color="red">超期</Tag>}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: string) => <Tag color={STATUS_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: '操作',
      key: 'a',
      width: 200,
      render: (_: unknown, r: ProdOrderRow) => (
        <Space size={4} wrap>
          {kind === 'wait' && canEdit && <a onClick={() => openAction('dispatch', r)}>下发</a>}
          {kind === 'running' && canEdit && r.status === '已派工' && <a onClick={() => void doStart(r)}>开工</a>}
          {kind === 'running' && canEdit && <a onClick={() => openAction('accept', r)}>验收</a>}
          {kind === 'transfer' && canEdit && <a onClick={() => openAction('transfer', r)}>转运</a>}
          {kind === 'rework' && canEdit && <a onClick={() => openAction('dispatch', r)}>重新下发</a>}
          <a onClick={() => setDetail(r)}>详情</a>
        </Space>
      ),
    },
  ]

  const osColumns = [
    { title: '单号', dataIndex: 'outsource_no', width: 110 },
    {
      title: '项目 / 设备',
      key: 'pe',
      width: 150,
      render: (_: unknown, r: OutsourceRow) => `${r.project_no} · ${r.equip_no ?? ''}`,
    },
    {
      title: '零件（图号）',
      key: 'item',
      render: (_: unknown, r: OutsourceRow) => (
        <>
          <div>{r.item_no}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.item_name ?? ''}
          </Typography.Text>
        </>
      ),
    },
    { title: '数量', dataIndex: 'qty', width: 80, align: 'right' as const },
    { title: '供应商', dataIndex: 'supplier_name', width: 150, render: (v: string | null) => v ?? '—' },
    { title: '交期', dataIndex: 'due_date', width: 110, render: (v: string | null) => v ?? '—' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Tag color={OS_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: '操作',
      key: 'a',
      width: 160,
      render: (_: unknown, r: OutsourceRow) => (
        <Space size={4}>
          {canEdit && r.status === '待发出' && <a onClick={() => openAction('os-send', undefined, r)}>发出</a>}
          {canEdit && r.status === '外协中' && <a onClick={() => void doReturn(r)}>回厂</a>}
          {canEdit && r.status === '回厂待检' && <a onClick={() => openAction('os-accept', undefined, r)}>验收</a>}
        </Space>
      ),
    },
  ]

  const c = wb?.counts

  return (
    <Card
      title="制造（S5）"
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          只管两头：下发（原材料 + 图纸，拍照）→ 到期验收（拍照）→ 转运装配区（拍照）
        </Typography.Text>
      }
    >
      {!canGo && <Empty description="没有查看制造任务的权限（找管理员开 mfg:view）" />}

      {canGo && (
        <>
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={3}><Statistic title="待下发" value={c?.wait ?? 0} /></Col>
            <Col span={3}><Statistic title="在制" value={c?.running ?? 0} /></Col>
            <Col span={3}><Statistic title="待转运" value={c?.to_transfer ?? 0} valueStyle={{ color: c?.to_transfer ? '#d48806' : undefined }} /></Col>
            <Col span={3}><Statistic title="返工" value={c?.rework ?? 0} valueStyle={{ color: c?.rework ? '#cf1322' : undefined }} /></Col>
            <Col span={3}><Statistic title="超期" value={c?.overdue ?? 0} valueStyle={{ color: c?.overdue ? '#cf1322' : undefined }} /></Col>
            <Col span={3}><Statistic title="外协在途" value={c?.outsource ?? 0} /></Col>
            <Col span={3}><Statistic title="已转运" value={c?.transferred ?? 0} /></Col>
          </Row>

          <Card size="small" title="生成排产单（按设备）" style={{ marginBottom: 12 }}>
            <Space wrap>
              <Select
                showSearch
                optionFilterProp="label"
                style={{ width: 240 }}
                placeholder="项目"
                value={genProject}
                onChange={(v: string | undefined) => void onGenProject(v)}
                options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
              />
              <Select
                showSearch
                optionFilterProp="label"
                style={{ width: 200 }}
                placeholder="设备"
                value={genEquip}
                onChange={setGenEquip}
                options={equips.map((e) => ({ value: e.equip_no, label: `${e.equip_no} ${e.equip_name}` }))}
              />
              <Button type="primary" disabled={!canEdit || !genProject || !genEquip} loading={genLoading} onClick={() => void doGenerate()}>
                生成排产单
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                按这台设备**已发布**的图纸展开：自制件 → 排产单，外协件 → 外协任务（重复生成不会重复建）。
              </Typography.Text>
            </Space>
          </Card>

          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: 'wait',
                label: `待下发 (${wb?.wait.length ?? 0})`,
                children: (
                  <Table<ProdOrderRow> rowKey="id" size="small" loading={loading} dataSource={wb?.wait ?? []} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: <Empty description="没有待下发的排产单" /> }} columns={orderColumns('wait')} />
                ),
              },
              {
                key: 'running',
                label: `在制 / 待验收 (${wb?.running.length ?? 0})`,
                children: (
                  <Table<ProdOrderRow> rowKey="id" size="small" loading={loading} dataSource={wb?.running ?? []} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: <Empty description="没有在制的零件" /> }} columns={orderColumns('running')} />
                ),
              },
              {
                key: 'transfer',
                label: `待转运 (${wb?.to_transfer.length ?? 0})`,
                children: (
                  <Table<ProdOrderRow> rowKey="id" size="small" loading={loading} dataSource={wb?.to_transfer ?? []} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: <Empty description="没有待转运的零件" /> }} columns={orderColumns('transfer')} />
                ),
              },
              {
                key: 'rework',
                label: `返工 (${wb?.rework.length ?? 0})`,
                children: (
                  <Table<ProdOrderRow> rowKey="id" size="small" loading={loading} dataSource={wb?.rework ?? []} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: <Empty description="没有返工件" /> }} columns={orderColumns('rework')} />
                ),
              },
              {
                key: 'outsource',
                label: `外协 (${wb?.outsource.length ?? 0})`,
                children: (
                  <Table<OutsourceRow> rowKey="id" size="small" loading={loading} dataSource={wb?.outsource ?? []} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: <Empty description="没有外协任务" /> }} columns={osColumns} />
                ),
              },
            ]}
          />
        </>
      )}

      {/* 动作弹窗 */}
      <Modal
        open={!!action}
        title={
          action?.kind === 'dispatch'
            ? `下发到工序 · ${action?.order?.item_no ?? ''}`
            : action?.kind === 'accept'
              ? `到期验收 · ${action?.order?.item_no ?? ''}`
              : action?.kind === 'transfer'
                ? `转运 · ${action?.order?.item_no ?? ''}`
                : action?.kind === 'os-send'
                  ? `外协发出 · ${action?.os?.item_no ?? ''}`
                  : `外协验收 · ${action?.os?.item_no ?? ''}`
        }
        onCancel={() => setAction(null)}
        onOk={() => void submitAction()}
        confirmLoading={saving}
        okText="提交"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          {action?.kind === 'dispatch' && (
            <>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                下发内容：**原材料 + 图纸**（图纸版本以发布版为准），拍照确认已交到工序。
              </Typography.Paragraph>
              <Space style={{ display: 'flex' }} size="middle" align="start">
                <Form.Item name="step_name" label="第一道工序" rules={[{ required: true }]}>
                  <Select style={{ width: 160 }} options={TEAMS.map((t) => ({ value: t, label: t }))} />
                </Form.Item>
                <Form.Item name="issued_to" label="交到（班组/人）">
                  <Input style={{ width: 160 }} placeholder="如 下料班" />
                </Form.Item>
              </Space>
              <Space style={{ display: 'flex' }} size="middle" align="start">
                <Form.Item name="material_item_no" label="原材料（型号级）">
                  <Input style={{ width: 220 }} placeholder="如 YL-FT-0001" />
                </Form.Item>
                <Form.Item name="material_qty" label="数量">
                  <InputNumber style={{ width: 120 }} min={0} />
                </Form.Item>
              </Space>
            </>
          )}

          {action?.kind === 'accept' && (
            <>
              <Form.Item name="result" label="验收结论" rules={[{ required: true }]}>
                <Radio.Group optionType="button" buttonStyle="solid">
                  <Radio.Button value="合格">合格</Radio.Button>
                  <Radio.Button value="不合格">不合格</Radio.Button>
                  <Radio.Button value="返工">返工</Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Form.Item name="reason" label="原因 / 说明">
                <Input.TextArea rows={2} placeholder="不合格或返工时写原因" />
              </Form.Item>
            </>
          )}

          {action?.kind === 'transfer' && (
            <Form.Item name="transfer_to" label="转运到" rules={[{ required: true }]}>
              <Select style={{ width: 200 }} options={['装配区', '半成品区', '待发区'].map((t) => ({ value: t, label: t }))} />
            </Form.Item>
          )}

          {action?.kind === 'os-send' && (
            <>
              <Space style={{ display: 'flex' }} size="middle" align="start">
                <Form.Item name="supplier_name" label="外协供应商">
                  <Input style={{ width: 200 }} placeholder="供应商名" />
                </Form.Item>
                <Form.Item name="material_supplied" label="供料方式">
                  <Radio.Group>
                    <Radio value={true}>我方供料</Radio>
                    <Radio value={false}>外协供料</Radio>
                  </Radio.Group>
                </Form.Item>
              </Space>
              <Space style={{ display: 'flex' }} size="middle" align="start">
                <Form.Item name="sent_at" label="发出日期">
                  <DatePicker style={{ width: 160 }} />
                </Form.Item>
                <Form.Item name="due_date" label="约定交期">
                  <DatePicker style={{ width: 160 }} />
                </Form.Item>
              </Space>
            </>
          )}

          {action?.kind === 'os-accept' && (
            <>
              <Form.Item name="result" label="验收结论" rules={[{ required: true }]}>
                <Radio.Group optionType="button" buttonStyle="solid">
                  <Radio.Button value="合格">合格</Radio.Button>
                  <Radio.Button value="不合格">不合格</Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Form.Item name="reason" label="原因 / 说明">
                <Input.TextArea rows={2} />
              </Form.Item>
            </>
          )}

          {action && (
            <Form.Item label="拍照留痕（必须）" required>
              <MfgPhotoPicker
                projectNo={action.order?.project_no ?? action.os?.project_no ?? ''}
                refNo={action.order?.order_no ?? action.os?.outsource_no ?? ''}
                value={photos}
                onChange={setPhotos}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* 详情 */}
      <Drawer
        width={560}
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `排产单 ${detail.order_no}` : ''}
      >
        {detail && (
          <>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="项目 / 设备">{detail.project_no} · {detail.equip_no ?? ''}</Descriptions.Item>
              <Descriptions.Item label="零件">{detail.item_no} {detail.item_name ?? ''}</Descriptions.Item>
              <Descriptions.Item label="数量">{detail.qty} {detail.unit}</Descriptions.Item>
              <Descriptions.Item label="计划">{detail.plan_start ?? '—'} ~ {detail.plan_end ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={STATUS_COLOR[detail.status] ?? 'default'}>{detail.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="原材料">{detail.material_item_no ?? '—'}</Descriptions.Item>
            </Descriptions>
            <Typography.Title level={5} style={{ marginTop: 16 }}>下发记录</Typography.Title>
            {(detail.tasks ?? []).length === 0 && <Empty description="还没下发" />}
            {(detail.tasks ?? []).map((t) => (
              <Card key={t.id} size="small" style={{ marginBottom: 8 }}>
                <div>
                  {t.step_name} · {t.issued_to ?? '—'} · 图纸 {t.drawing_no} {t.drawing_version ?? ''}
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  原材料 {t.material_item_no ?? '—'} · {t.issued_at?.slice(0, 16).replace('T', ' ') ?? ''}
                </Typography.Text>
                <Space wrap style={{ marginTop: 6 }}>
                  {t.photos.map((p) => (
                    <a key={p} href={mfgPhotoUrl(p)} target="_blank" rel="noreferrer">
                      <AuthedImage path={mfgPhotoUrl(p)} size={56} />
                    </a>
                  ))}
                </Space>
              </Card>
            ))}
            <Typography.Title level={5} style={{ marginTop: 16 }}>验收 / 转运</Typography.Title>
            {(detail.acceptances ?? []).length === 0 && <Empty description="还没验收" />}
            {(detail.acceptances ?? []).map((a) => (
              <Card key={a.id} size="small" style={{ marginBottom: 8 }}>
                <Tag color={a.result === '合格' ? 'success' : 'error'}>{a.result}</Tag>
                {a.reason}
                <div style={{ fontSize: 12, color: '#888' }}>
                  {a.accepted_at?.slice(0, 16).replace('T', ' ') ?? ''}
                  {a.transfer_at ? ` · 已转运 ${a.transfer_to}（${a.transfer_at.slice(0, 16).replace('T', ' ')}）` : ''}
                </div>
                <Space wrap style={{ marginTop: 6 }}>
                  {[...a.photos, ...a.transfer_photos].map((p) => (
                    <a key={p} href={mfgPhotoUrl(p)} target="_blank" rel="noreferrer">
                      <AuthedImage path={mfgPhotoUrl(p)} size={56} />
                    </a>
                  ))}
                </Space>
              </Card>
            ))}
          </>
        )}
      </Drawer>
    </Card>
  )
}
