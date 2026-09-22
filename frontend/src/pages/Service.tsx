import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
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

import {
  arriveServiceOrder,
  createServiceOrder,
  createSparePart,
  dispatchServiceOrder,
  errMsg,
  fixServiceOrder,
  hasPerm,
  listSparePartMoves,
  listSpareParts,
  moveSparePart,
  servicePhotoUrl,
  serviceWorkbench,
  signServiceOrder,
  uploadServicePhotos,
  type ServiceOrderRow,
  type ServiceWorkbench,
  type SparePartRow,
} from '../api/client'
import MfgPhotoPicker from '../components/MfgPhotoPicker'
import { SelectEquipment, SelectProject } from '../components/fields'
import { SERVICE_ORDER_STATUS as SO_COLOR } from '../theme/status'
import { T } from '../theme/tokens'

type Kind = 'create' | 'dispatch' | 'fix' | 'sign' | 'part' | 'move'

/** 售后台（S11）：报修受理 → 派工 → 到场 → 处理（备件更换）→ 客户签字 → 关闭。 */
export default function Service() {
  const { message } = App.useApp()
  const canEdit = hasPerm('service:edit')

  const [wb, setWb] = useState<ServiceWorkbench | null>(null)
  const [parts, setParts] = useState<SparePartRow[]>([])
  const [moves, setMoves] = useState<Record<number, { move_type: string; qty: number; moved_at?: string | null }[]>>({})
  const [tab, setTab] = useState('orders')

  const [modal, setModal] = useState<{ kind: Kind; order?: ServiceOrderRow; part?: SparePartRow } | null>(null)
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  // 字段组件联动：设备按已选项目过滤（重构 1.4，原手填 equip_no）
  const watchProject = Form.useWatch('project_no', form)

  const load = useCallback(async () => {
    try {
      const [w, p] = await Promise.all([serviceWorkbench(), listSpareParts()])
      setWb(w)
      setParts(p)
    } catch (e) {
      message.error(errMsg(e))
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const open = (kind: Kind, order?: ServiceOrderRow, part?: SparePartRow) => {
    setPhotos([])
    form.resetFields()
    if (kind === 'move' && part) form.setFieldsValue({ part_id: part.id, move_type: '领出', qty: 1 })
    setModal({ kind, order, part })
  }

  const submit = async () => {
    if (!modal) return
    const v = await form.validateFields()
    setSaving(true)
    try {
      if (modal.kind === 'create') {
        const r = await createServiceOrder(v)
        message.success(`已建工单 ${r.so_no}（${r.in_warranty ? '在保' : '过保'}）`)
      } else if (modal.kind === 'dispatch' && modal.order) {
        await dispatchServiceOrder(modal.order.id, v.dispatched_to)
        message.success('已派工')
      } else if (modal.kind === 'fix' && modal.order) {
        await fixServiceOrder(modal.order.id, { solution: v.solution, labor_hours: v.labor_hours, photos, remark: v.remark })
        message.success('处理完成，待客户签字')
      } else if (modal.kind === 'sign' && modal.order) {
        await signServiceOrder(modal.order.id, v.customer_sign)
        message.success('客户签字，工单关闭')
      } else if (modal.kind === 'part') {
        await createSparePart(v)
        message.success('备件已建账')
      } else if (modal.kind === 'move') {
        await moveSparePart({
          part_id: v.part_id,
          move_type: v.move_type,
          qty: v.qty,
          service_order_id: v.service_order_id || undefined,
          issued_to: v.issued_to || undefined,
          remark: v.remark,
        })
        message.success('收发已记录')
      }
      setModal(null)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const loadMoves = async (partId: number) => {
    try {
      const rows = await listSparePartMoves(partId)
      setMoves((m) => ({ ...m, [partId]: rows }))
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const c = wb?.counts
  const partOptions = parts.map((p) => ({ value: p.id, label: `${p.item_no} ${p.item_name ?? ''}（库存 ${p.qty_stock}）` }))

  return (
    <Card
      title="售后（S11）"
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          报修受理 → 派工 → 到场 → 处理（备件更换）→ 客户签字 → 关闭；报修自动判定在保 / 过保
        </Typography.Text>
      }
    >
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={4}><Statistic title="未关闭工单" value={c?.open ?? 0} /></Col>
        <Col span={4}><Statistic title="待受理" value={c?.wait ?? 0} valueStyle={{ color: c?.wait ? T.error : undefined }} /></Col>
        <Col span={4}><Statistic title="处理中" value={c?.in_progress ?? 0} /></Col>
        <Col span={4}><Statistic title="待客户签字" value={c?.to_sign ?? 0} /></Col>
        <Col span={4}><Statistic title="已关闭" value={c?.closed ?? 0} /></Col>
        <Col span={4}><Statistic title="备件低库存" value={c?.low_parts ?? 0} valueStyle={{ color: c?.low_parts ? T.error : undefined }} /></Col>
      </Row>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'orders',
            label: `服务工单 (${wb?.orders.length ?? 0})`,
            children: (
              <>
                <Space style={{ marginBottom: 10 }}>
                  <Button type="primary" disabled={!canEdit} onClick={() => open('create')}>报修（新建工单）</Button>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>报修时自动判定这台设备是否还在质保期内。</Typography.Text>
                </Space>
                <Table<ServiceOrderRow>
                  rowKey="id"
                  size="small"
                  dataSource={wb?.orders ?? []}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  locale={{ emptyText: <Empty description="还没有服务工单" /> }}
                  columns={[
                    { title: '工单号', dataIndex: 'so_no', width: 110 },
                    {
                      title: '项目 / 设备',
                      key: 'pe',
                      width: 170,
                      render: (_: unknown, r: ServiceOrderRow) => `${r.project_no}${r.equip_no ? ` · ${r.equip_no}` : ''}`,
                    },
                    { title: '故障', dataIndex: 'fault', render: (v: string | null) => v ?? '—' },
                    {
                      title: '质保',
                      dataIndex: 'in_warranty',
                      width: 80,
                      render: (v: boolean | null) =>
                        v == null ? '—' : v ? <Tag color="success">在保</Tag> : <Tag color="red">过保</Tag>,
                    },
                    { title: '状态', dataIndex: 'status', width: 110, render: (v: string) => <Tag color={SO_COLOR[v] ?? 'default'}>{v}</Tag> },
                    { title: '处理人', dataIndex: 'dispatched_to', width: 100, render: (v: string | null) => v ?? '—' },
                    {
                      title: '操作',
                      key: 'a',
                      width: 220,
                      render: (_: unknown, r: ServiceOrderRow) => (
                        <Space size={4} wrap>
                          {canEdit && r.status === '待受理' && <a onClick={() => open('dispatch', r)}>派工</a>}
                          {canEdit && r.status === '已派工' && (
                            <a onClick={() => void arriveServiceOrder(r.id).then(() => void load()).catch((e) => message.error(errMsg(e)))}>到场</a>
                          )}
                          {canEdit && r.status === '已到场' && <a onClick={() => open('fix', r)}>处理完成</a>}
                          {canEdit && r.status === '待客户签字' && <a onClick={() => open('sign', r)}>客户签字</a>}
                        </Space>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'parts',
            label: `备件 (${parts.length})`,
            children: (
              <>
                <Space style={{ marginBottom: 10 }}>
                  <Button type="primary" disabled={!canEdit} onClick={() => open('part')}>备件建账</Button>
                  <Button disabled={!canEdit || parts.length === 0} onClick={() => open('move')}>备件收发（领出/退回/补货）</Button>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>领出可关联服务工单；低于安全库存会标红。</Typography.Text>
                </Space>
                <Table<SparePartRow>
                  rowKey="id"
                  size="small"
                  dataSource={parts}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  locale={{ emptyText: <Empty description="还没有备件" /> }}
                  columns={[
                    { title: '物料', dataIndex: 'item_no', width: 180 },
                    { title: '名称', dataIndex: 'item_name', render: (v: string | null) => v ?? '—' },
                    { title: '项目 / 设备', key: 'pe', width: 160, render: (_: unknown, r: SparePartRow) => `${r.project_no ?? ''}${r.equip_no ? ` · ${r.equip_no}` : ''}` || '通用' },
                    {
                      title: '备件库存',
                      dataIndex: 'qty_stock',
                      width: 110,
                      align: 'right',
                      render: (v: number, r: SparePartRow) =>
                        r.min_qty != null && v < r.min_qty ? <Tag color="red">{v}（低于 {r.min_qty}）</Tag> : v,
                    },
                    { title: '装机数', dataIndex: 'qty_installed', width: 90, align: 'right' },
                    {
                      title: '收发记录',
                      key: 'm',
                      width: 120,
                      render: (_: unknown, r: SparePartRow) =>
                        moves[r.id] ? (
                          <span style={{ fontSize: 12 }}>
                            {moves[r.id].slice(0, 3).map((m, i) => (
                              <div key={i}>{m.move_type} ×{m.qty}</div>
                            ))}
                          </span>
                        ) : (
                          <a onClick={() => void loadMoves(r.id)}>查看</a>
                        ),
                    },
                  ]}
                />
              </>
            ),
          },
        ]}
      />

      <Modal
        open={!!modal}
        title={
          modal?.kind === 'create' ? '报修（新建服务工单）'
            : modal?.kind === 'dispatch' ? `派工 · ${modal.order?.so_no ?? ''}`
              : modal?.kind === 'fix' ? `处理完成 · ${modal.order?.so_no ?? ''}`
                : modal?.kind === 'sign' ? `客户签字 · ${modal.order?.so_no ?? ''}`
                  : modal?.kind === 'part' ? '备件建账' : '备件收发'
        }
        onCancel={() => setModal(null)}
        onOk={() => void submit()}
        confirmLoading={saving}
        okText="提交"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          {modal?.kind === 'create' && (
            <>
              <Form.Item name="project_no" label="项目号" rules={[{ required: true, message: '选项目' }]}>
                <SelectProject />
              </Form.Item>
              <Form.Item name="equip_no" label="设备号（可选）">
                <SelectEquipment projectNo={watchProject} />
              </Form.Item>
              <Form.Item name="fault" label="故障描述" rules={[{ required: true, message: '必填：出了什么问题' }]}><Input.TextArea rows={2} /></Form.Item>
            </>
          )}
          {modal?.kind === 'dispatch' && (
            <Form.Item name="dispatched_to" label="派谁去修" rules={[{ required: true }]}><Input placeholder="如 李工 138xxxx" /></Form.Item>
          )}
          {modal?.kind === 'fix' && (
            <>
              <Form.Item name="solution" label="处理方案" rules={[{ required: true }]}><Input.TextArea rows={2} placeholder="如 更换电磁阀 + 调整气路" /></Form.Item>
              <Form.Item name="labor_hours" label="工时（小时）"><InputNumber min={0} style={{ width: 140 }} /></Form.Item>
              <Form.Item name="remark" label="备注"><Input /></Form.Item>
              <Form.Item label="现场照片">
                <MfgPhotoPicker
                  projectNo={modal.order?.project_no ?? ''} refNo={modal.order?.so_no ?? ''} value={photos} onChange={setPhotos}
                  upload={uploadServicePhotos} photoUrl={servicePhotoUrl} label="拍照"
                />
              </Form.Item>
            </>
          )}
          {modal?.kind === 'sign' && (
            <Form.Item name="customer_sign" label="客户签字人" rules={[{ required: true }]}><Input placeholder="如 客户 王经理" /></Form.Item>
          )}
          {modal?.kind === 'part' && (
            <>
              <Form.Item name="item_no" label="物料号" rules={[{ required: true }]}><Input placeholder="标准库物料号 / 图号" /></Form.Item>
              <Form.Item name="item_name" label="名称"><Input /></Form.Item>
              <Space>
                <Form.Item name="project_no" label="项目（可选）"><Input style={{ width: 140 }} /></Form.Item>
                <Form.Item name="equip_no" label="设备（可选）"><Input style={{ width: 100 }} /></Form.Item>
              </Space>
              <Space>
                <Form.Item name="qty_stock" label="备件库存"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
                <Form.Item name="qty_installed" label="装机数"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
                <Form.Item name="min_qty" label="安全库存"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
              </Space>
            </>
          )}
          {modal?.kind === 'move' && (
            <>
              <Form.Item name="part_id" label="备件" rules={[{ required: true }]}>
                <Select options={partOptions} placeholder="选备件" showSearch optionFilterProp="label" />
              </Form.Item>
              <Space>
                <Form.Item name="move_type" label="类型" rules={[{ required: true }]}>
                  <Select style={{ width: 110 }} options={['领出', '退回', '补货'].map((t) => ({ value: t, label: t }))} />
                </Form.Item>
                <Form.Item name="qty" label="数量" rules={[{ required: true }]}><InputNumber min={0.01} style={{ width: 110 }} /></Form.Item>
                <Form.Item name="issued_to" label="领给谁"><Input style={{ width: 130 }} /></Form.Item>
              </Space>
              <Form.Item name="service_order_id" label="关联服务工单（可选）">
                <Select
                  allowClear
                  placeholder="选工单"
                  options={(wb?.orders ?? []).map((o) => ({ value: o.id, label: `${o.so_no} ${o.project_no}` }))}
                  showSearch
                  optionFilterProp="label"
                />
              </Form.Item>
              <Form.Item name="remark" label="备注"><Input /></Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </Card>
  )
}
