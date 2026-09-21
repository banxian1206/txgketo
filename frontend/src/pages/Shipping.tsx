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
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'

import {
  arriveShipment,
  createShipment,
  departShipment,
  errMsg,
  hasPerm,
  listProjects,
  listShipments,
  loadShipment,
  packShipment,
  receiptShipment,
  shipPhotoUrl,
  toShip,
  uploadShipPhotos,
  type ShipmentRow,
  type ToShipRow,
} from '../api/client'
import AuthedImage from '../components/AuthedImage'
import MfgPhotoPicker from '../components/MfgPhotoPicker'

const SHIP_COLOR: Record<string, string> = {
  已指令: 'default',
  打包中: 'processing',
  已装车: 'cyan',
  在途: 'gold',
  已到货: 'blue',
  已签收: 'success',
}

type ModalKind = 'instruct' | 'pack' | 'load' | 'receipt'

export default function Shipping() {
  const { message } = App.useApp()
  const canEdit = hasPerm('ship:edit')

  const [projects, setProjects] = useState<{ project_no: string; project_name: string }[]>([])
  const [projectNo, setProjectNo] = useState<string | undefined>()
  const [toShipRows, setToShipRows] = useState<ToShipRow[]>([])
  const [selectedEquips, setSelectedEquips] = useState<string[]>([])
  const [shipments, setShipments] = useState<ShipmentRow[]>([])
  const [loading, setLoading] = useState(false)

  const [modal, setModal] = useState<{ kind: ModalKind; ship?: ShipmentRow } | null>(null)
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const [detail, setDetail] = useState<ShipmentRow | null>(null)

  const load = useCallback(
    async (pno?: string) => {
      setLoading(true)
      try {
        const [ts, list] = await Promise.all([
          pno ? toShip(pno) : Promise.resolve([]),
          listShipments(pno ? { project_no: pno } : {}),
        ])
        setToShipRows(ts)
        setShipments(list)
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
    setSelectedEquips([])
    setDetail(null)
    void load(pno)
  }

  const openModal = (kind: ModalKind, ship?: ShipmentRow) => {
    setPhotos([])
    form.resetFields()
    if (kind === 'instruct') form.setFieldsValue({ plan_ship_date: dayjs() })
    if (kind === 'pack' && ship) {
      form.setFieldsValue({
        items: ship.lines.map((l) => ({ equip_no: l.equip_no, part_item_no: '', qty: 1, disassembled: false })),
      })
    }
    if (kind === 'load' && ship) {
      form.setFieldsValue({ vehicle: ship.vehicle, driver: ship.driver, plate_no: ship.plate_no })
    }
    if (kind === 'receipt') form.setFieldsValue({ result: '齐', shortage: [] })
    setModal({ kind, ship })
  }

  const submit = async () => {
    if (!modal) return
    const v = await form.validateFields()
    setSaving(true)
    try {
      if (modal.kind === 'instruct') {
        if (!projectNo) return
        const r = await createShipment({
          project_no: projectNo,
          equip_nos: selectedEquips,
          plan_ship_date: v.plan_ship_date?.format('YYYY-MM-DD'),
          remark: v.remark,
        })
        message.success(`已下达发货指令 ${r.shipment_no}`)
        setSelectedEquips([])
        await load(projectNo)
      } else if (modal.kind === 'pack' && modal.ship) {
        const items = (v.items ?? []).filter((i: { part_item_no?: string }) => i.part_item_no)
        if (items.length === 0) {
          message.warning('至少填一件装箱内容')
          setSaving(false)
          return
        }
        await packShipment(modal.ship.id, items)
        message.success('装箱清单已保存')
        await load(projectNo)
      } else if (modal.kind === 'load' && modal.ship) {
        await loadShipment(modal.ship.id, { ...v, photos })
        message.success('已装车')
        await load(projectNo)
      } else if (modal.kind === 'receipt' && modal.ship) {
        if (photos.length === 0) {
          message.warning('到货验收要拍照')
          setSaving(false)
          return
        }
        await receiptShipment(modal.ship.id, {
          result: v.result,
          shortage_detail: (v.shortage ?? []).filter((s: { item?: string }) => s.item),
          photos,
          remark: v.remark,
        })
        message.success('现场到货验收已记录')
        await load(projectNo)
      }
      setModal(null)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const doDepart = async (s: ShipmentRow) => {
    try {
      await departShipment(s.id, {})
      message.success('已发运（在途）')
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const doArrive = async (s: ShipmentRow) => {
    try {
      await arriveShipment(s.id)
      message.success('已登记到货')
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const counts = {
    open: shipments.filter((s) => ['已指令', '打包中', '已装车', '在途', '已到货'].includes(s.status)).length,
    transit: shipments.filter((s) => s.status === '在途').length,
    signed: shipments.filter((s) => s.status === '已签收').length,
  }

  const canSelect = (r: ToShipRow) => !r.in_open_shipment

  return (
    <Card
      title="发运（S7）"
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          项目经理勾选本次要发的设备 → 打包 → 装车（拍照）→ 发运（分批）→ 现场到货验收
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
          onChange={(v: string | undefined) => pickProject(v)}
          options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
        />
        {!canEdit && <Tag>只读（需要 ship:edit 才能下发货指令）</Tag>}
      </Space>

      {!projectNo && <Empty description="先选一个项目" />}

      {projectNo && (
        <>
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={4}><Statistic title="未完成批次" value={counts.open} /></Col>
            <Col span={4}><Statistic title="在途" value={counts.transit} valueStyle={{ color: counts.transit ? '#d48806' : undefined }} /></Col>
            <Col span={4}><Statistic title="已签收" value={counts.signed} /></Col>
          </Row>

          <Card size="small" title="待发设备（本次要发哪几台）" style={{ marginBottom: 12 }}>
            <Table<ToShipRow>
              rowKey="equip_no"
              size="small"
              loading={loading}
              dataSource={toShipRows}
              pagination={false}
              locale={{ emptyText: <Empty description="这个项目还没有设备" /> }}
              rowSelection={{
                selectedRowKeys: selectedEquips,
                onChange: (keys) => setSelectedEquips(keys as string[]),
                getCheckboxProps: (r) => ({ disabled: !canSelect(r) }),
              }}
              columns={[
                { title: '设备', key: 'eq', width: 180, render: (_: unknown, r: ToShipRow) => `${r.equip_no} ${r.equip_name}` },
                {
                  title: '装配状态',
                  dataIndex: 'assembly_status',
                  width: 120,
                  render: (v: string | null) => (v ? <Tag color={v === '调试完成' ? 'success' : 'processing'}>{v}</Tag> : <Tag>未装配</Tag>),
                },
                {
                  title: '齐套率',
                  dataIndex: 'kitting_rate',
                  width: 100,
                  render: (v: number) => `${Math.round(v * 100)}%`,
                },
                {
                  title: '能否发',
                  key: 'ready',
                  width: 120,
                  render: (_: unknown, r: ToShipRow) =>
                    r.in_open_shipment ? <Tag color="orange">已在发运批次</Tag> : r.ready ? <Tag color="success">可发</Tag> : <Tag>未装配完成</Tag>,
                },
              ]}
            />
            <Space style={{ marginTop: 10 }}>
              <Button
                type="primary"
                disabled={!canEdit || selectedEquips.length === 0}
                onClick={() => openModal('instruct')}
              >
                下达发货指令（{selectedEquips.length} 台）
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                一次发货指令 = 一个发运批次；可以分批发（先发 01A，下次再发 02A）。
              </Typography.Text>
            </Space>
          </Card>

          <Typography.Title level={5}>发运批次</Typography.Title>
          <Table<ShipmentRow>
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={shipments}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            locale={{ emptyText: <Empty description="还没有发货指令" /> }}
            columns={[
              { title: '发运单号', dataIndex: 'shipment_no', width: 120, render: (v: string, r) => <a onClick={() => setDetail(r)}>{v}</a> },
              {
                title: '本次设备',
                key: 'lines',
                render: (_: unknown, r: ShipmentRow) => r.lines.map((l) => l.equip_no).join('、'),
              },
              { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag color={SHIP_COLOR[v] ?? 'default'}>{v}</Tag> },
              { title: '车牌 / 司机', key: 'v', width: 180, render: (_: unknown, r: ShipmentRow) => `${r.plate_no ?? ''} ${r.driver ?? ''}` || '—' },
              { title: '装箱', key: 'pk', width: 80, render: (_: unknown, r: ShipmentRow) => `${r.packing.length} 件` },
              {
                title: '操作',
                key: 'a',
                width: 260,
                render: (_: unknown, r: ShipmentRow) => (
                  <Space size={4} wrap>
                    {canEdit && ['已指令', '打包中'].includes(r.status) && <a onClick={() => openModal('pack', r)}>装箱</a>}
                    {canEdit && ['已指令', '打包中', '已装车'].includes(r.status) && <a onClick={() => openModal('load', r)}>装车</a>}
                    {canEdit && ['已装车', '打包中'].includes(r.status) && <a onClick={() => void doDepart(r)}>发运</a>}
                    {canEdit && r.status === '在途' && <a onClick={() => void doArrive(r)}>登记到货</a>}
                    {canEdit && ['已到货', '在途'].includes(r.status) && <a onClick={() => openModal('receipt', r)}>现场验收</a>}
                    <a onClick={() => setDetail(r)}>详情</a>
                  </Space>
                ),
              },
            ]}
          />
        </>
      )}

      {/* 弹窗 */}
      <Modal
        open={!!modal}
        title={
          modal?.kind === 'instruct'
            ? `下达发货指令（${selectedEquips.join('、')}）`
            : modal?.kind === 'pack'
              ? `装箱清单 · ${modal?.ship?.shipment_no ?? ''}`
              : modal?.kind === 'load'
                ? `装车 · ${modal?.ship?.shipment_no ?? ''}`
                : `现场到货验收 · ${modal?.ship?.shipment_no ?? ''}`
        }
        onCancel={() => setModal(null)}
        onOk={() => void submit()}
        confirmLoading={saving}
        okText="提交"
        width={modal?.kind === 'pack' ? 760 : 520}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          {modal?.kind === 'instruct' && (
            <>
              <Form.Item name="plan_ship_date" label="计划发货日期">
                <DatePicker style={{ width: 200 }} />
              </Form.Item>
              <Form.Item name="remark" label="备注">
                <Input placeholder="如 本次只发 01A、02A" />
              </Form.Item>
            </>
          )}

          {modal?.kind === 'pack' && (
            <>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                打包含拆解（大件拆不拆看车的大小，由打包师傅定）—— 不拆成两个流程，直接列清箱号/重量/尺寸。
              </Typography.Paragraph>
              <Form.List name="items">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map((f) => (
                      <Space key={f.key} align="baseline" wrap style={{ marginBottom: 4 }}>
                        <Form.Item name={[f.name, 'equip_no']} style={{ marginBottom: 0 }}>
                          <Select
                            placeholder="设备"
                            style={{ width: 100 }}
                            options={(modal.ship?.lines ?? []).map((l) => ({ value: l.equip_no, label: l.equip_no }))}
                          />
                        </Form.Item>
                        <Form.Item name={[f.name, 'part_item_no']} style={{ marginBottom: 0 }}>
                          <Input placeholder="零件/物料号" style={{ width: 190 }} />
                        </Form.Item>
                        <Form.Item name={[f.name, 'part_name']} style={{ marginBottom: 0 }}>
                          <Input placeholder="名称" style={{ width: 120 }} />
                        </Form.Item>
                        <Form.Item name={[f.name, 'qty']} style={{ marginBottom: 0 }}>
                          <InputNumber placeholder="数量" min={0} style={{ width: 80 }} />
                        </Form.Item>
                        <Form.Item name={[f.name, 'package_no']} style={{ marginBottom: 0 }}>
                          <Input placeholder="箱号" style={{ width: 80 }} />
                        </Form.Item>
                        <Form.Item name={[f.name, 'weight']} style={{ marginBottom: 0 }}>
                          <InputNumber placeholder="kg" min={0} style={{ width: 80 }} />
                        </Form.Item>
                        <Form.Item name={[f.name, 'size']} style={{ marginBottom: 0 }}>
                          <Input placeholder="长x宽x高" style={{ width: 130 }} />
                        </Form.Item>
                        <Form.Item name={[f.name, 'disassembled']} valuePropName="checked" style={{ marginBottom: 0 }}>
                          <Switch checkedChildren="拆解" unCheckedChildren="整装" />
                        </Form.Item>
                        <MinusCircleOutlined onClick={() => remove(f.name)} />
                      </Space>
                    ))}
                    <Button type="dashed" onClick={() => add({ qty: 1, disassembled: false })} icon={<PlusOutlined />}>
                      加一行
                    </Button>
                  </>
                )}
              </Form.List>
            </>
          )}

          {modal?.kind === 'load' && (
            <>
              <Space style={{ display: 'flex' }} size="middle" align="start">
                <Form.Item name="vehicle" label="车辆">
                  <Input style={{ width: 160 }} placeholder="如 17.5 米平板" />
                </Form.Item>
                <Form.Item name="plate_no" label="车牌">
                  <Input style={{ width: 130 }} />
                </Form.Item>
                <Form.Item name="driver" label="司机 / 电话">
                  <Input style={{ width: 160 }} />
                </Form.Item>
              </Space>
              <Form.Item label="装车照片（必须）" required>
                <MfgPhotoPicker
                  projectNo={modal.ship?.project_no ?? ''}
                  refNo={modal.ship?.shipment_no ?? ''}
                  value={photos}
                  onChange={setPhotos}
                  upload={uploadShipPhotos}
                  photoUrl={shipPhotoUrl}
                  label="拍照"
                />
              </Form.Item>
            </>
          )}

          {modal?.kind === 'receipt' && (
            <>
              <Form.Item name="result" label="到货验收结论" rules={[{ required: true }]}>
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
                      <Space key={f.key} align="baseline" wrap style={{ marginBottom: 4 }}>
                        <Form.Item name={[f.name, 'equip_no']} style={{ marginBottom: 0 }}>
                          <Input placeholder="设备" style={{ width: 80 }} />
                        </Form.Item>
                        <Form.Item name={[f.name, 'item']} style={{ marginBottom: 0 }}>
                          <Input placeholder="缺/损的零件" style={{ width: 190 }} />
                        </Form.Item>
                        <Form.Item name={[f.name, 'qty']} style={{ marginBottom: 0 }}>
                          <InputNumber placeholder="数量" min={0} style={{ width: 80 }} />
                        </Form.Item>
                        <Form.Item name={[f.name, 'reason']} style={{ marginBottom: 0 }}>
                          <Input placeholder="原因" style={{ width: 150 }} />
                        </Form.Item>
                        <MinusCircleOutlined onClick={() => remove(f.name)} />
                      </Space>
                    ))}
                    <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />}>
                      加一条缺件
                    </Button>
                  </>
                )}
              </Form.List>
              <Form.Item name="remark" label="备注" style={{ marginTop: 10 }}>
                <Input placeholder="如 少 2 个标准件，已联系补发" />
              </Form.Item>
              <Form.Item label="到货照片（必须）" required>
                <MfgPhotoPicker
                  projectNo={modal.ship?.project_no ?? ''}
                  refNo={modal.ship?.shipment_no ?? ''}
                  value={photos}
                  onChange={setPhotos}
                  upload={uploadShipPhotos}
                  photoUrl={shipPhotoUrl}
                  label="拍照"
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      {/* 详情 */}
      <Drawer width={560} open={!!detail} onClose={() => setDetail(null)} title={detail?.shipment_no ?? ''}>
        {detail && (
          <>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="项目">{detail.project_no}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={SHIP_COLOR[detail.status] ?? 'default'}>{detail.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="本次设备">{detail.lines.map((l) => l.equip_no).join('、')}</Descriptions.Item>
              <Descriptions.Item label="车辆">{detail.vehicle ?? '—'} {detail.plate_no ?? ''} {detail.driver ?? ''}</Descriptions.Item>
              <Descriptions.Item label="指令 / 发运 / 到货">
                {detail.instruct_at?.slice(0, 16).replace('T', ' ') ?? '—'} / {detail.depart_at?.slice(0, 16).replace('T', ' ') ?? '—'} / {detail.arrive_at?.slice(0, 16).replace('T', ' ') ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="备注">{detail.remark ?? '—'}</Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5} style={{ marginTop: 16 }}>装箱清单（{detail.packing.length}）</Typography.Title>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.packing}
              locale={{ emptyText: <Empty description="还没装箱" /> }}
              columns={[
                { title: '设备', dataIndex: 'equip_no', width: 70 },
                { title: '零件', dataIndex: 'part_item_no', width: 180 },
                { title: '数量', dataIndex: 'qty', width: 60, align: 'right' },
                { title: '箱号', dataIndex: 'package_no', width: 70 },
                { title: '重量', dataIndex: 'weight', width: 70, align: 'right', render: (v: number | null) => (v == null ? '—' : `${v}kg`) },
                { title: '尺寸', dataIndex: 'size', width: 120 },
                { title: '拆解', dataIndex: 'disassembled', width: 60, render: (v: boolean) => (v ? '拆' : '整') },
              ]}
            />

            <Typography.Title level={5} style={{ marginTop: 16 }}>现场到货验收</Typography.Title>
            {detail.receipts.length === 0 && <Empty description="还没到货验收" />}
            {detail.receipts.map((r) => (
              <Card key={r.id} size="small" style={{ marginBottom: 8 }}>
                <Tag color={r.result === '齐' ? 'success' : 'error'}>{r.result}</Tag>
                {r.remark}
                {r.shortage_detail.length > 0 && (
                  <div style={{ fontSize: 12, color: '#cf1322', marginTop: 4 }}>
                    缺/损：{r.shortage_detail.map((s) => `${s.equip_no ?? ''} ${s.item ?? ''} x${s.qty ?? 0}`).join('；')}
                  </div>
                )}
                <Space wrap style={{ marginTop: 6 }}>
                  {r.photos.map((p) => (
                    <a key={p} href={shipPhotoUrl(p)} target="_blank" rel="noreferrer">
                      <AuthedImage path={shipPhotoUrl(p)} size={56} />
                    </a>
                  ))}
                </Space>
              </Card>
            ))}

            {detail.photos.length > 0 && (
              <>
                <Typography.Title level={5} style={{ marginTop: 16 }}>装车 / 发运照片</Typography.Title>
                <Space wrap>
                  {detail.photos.map((p) => (
                    <a key={p} href={shipPhotoUrl(p)} target="_blank" rel="noreferrer">
                      <AuthedImage path={shipPhotoUrl(p)} size={56} />
                    </a>
                  ))}
                </Space>
              </>
            )}
          </>
        )}
      </Drawer>
    </Card>
  )
}
