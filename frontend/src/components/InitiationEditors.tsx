import { App, Button, DatePicker, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Typography } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import { Chip } from '../components/ds'

import { useGoFrom } from '../hooks/useFrom'

import AppModal from './AppModal'

import { addEquipment, addMilestone, clearMilestones, errMsg, listEquipment, listMembers, removeMember, listMilestones, listPurchaseRequests, removeEquipment, removeMilestone, removePurchaseRequest, saveMember, updateEquipment, updateMilestone, addPurchaseRequest, updatePurchaseRequest, listStdItems, type EquipmentItem, type StdItem, type MilestoneItem, type ProjectMember, type PurchaseRequestItem } from '../api/client'
import { LONGLEAD_STATUS as STATUS_COLOR, toneOf } from '../theme/status'

const PROJECT_ROLES = [
  '项目经理',
  '技术负责人',
  '机械负责人',
  '电气负责人',
  '程序负责人',
  '工艺负责人',
  '采购负责人',
  '生产负责人',
  '装配负责人',
  '测试负责人',
  '现场负责人',
  '售后负责人',
]

const EQUIPMENT_KINDS = ['单机', '工位', '线体']
const MILESTONE_STATUS = ['未开始', '进行中', '已完成', '延期']

interface Props {
  projectNo: string
  users: { id: number; name: string }[]
  /** 变更后通知外面刷新（比如立项前的完成度检查） */
  onChanged?: () => void
}

/** ① 项目团队：11 个项目角色，每个角色选一个人（换人留痕） */
export function TeamEditor({ projectNo, users, onChanged }: Props) {
  const { message } = App.useApp()
  const [rows, setRows] = useState<ProjectMember[]>([])
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await listMembers(projectNo))
    } catch (e) {
      message.error(errMsg(e))
    }
  }, [projectNo, message])

  useEffect(() => {
    void load()
  }, [load])

  const pick = async (role: string, userId?: number) => {
    setSaving(role)
    try {
      if (userId) {
        await saveMember(projectNo, userId, role)
      } else {
        // 清空选择 = 解绑该角色（后端 DELETE /members/{id}）
        const found = rows.find((x) => x.project_role === role)
        if (!found?.id) return
        await removeMember(projectNo, found.id)
      }
      await load()
      onChanged?.()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(null)
    }
  }

  return (
    <>
    <Typography.Paragraph type="secondary">选择人员后立即保存；同一个人可在不同项目担任不同角色。</Typography.Paragraph>
    <Table
      rowKey="project_role"
      scroll={{ x: 360 }}
      size="small"
      pagination={false}
      dataSource={PROJECT_ROLES.map((r) => {
        const found = rows.find((x) => x.project_role === r)
        return {
          ...(found ?? { id: 0, user_id: 0, project_role: r, remark: null }),
          project_role: r,
        }
      })}
      columns={[
        { title: '项目角色', dataIndex: 'project_role', width: 140 },
        {
          title: '人',
          dataIndex: 'user_id',
          render: (v: number, r: ProjectMember & { project_role: string }) => (
            <Select
              size="small"
              aria-label="任命项目成员"
              style={{ width: 180 }}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="未任命"
              value={v || undefined}
              loading={saving === r.project_role}
              options={users.map((u) => ({ value: u.id, label: u.name }))}
              onChange={(nv) => void pick(r.project_role, nv as number | undefined)}
            />
          ),
        },
      ]}
    />
    </>
  )
}

/** ② 设备清单：设备号由系统自动发（01A，同型第二台 01B） */
export function EquipmentEditor({ projectNo, onChanged }: Omit<Props, 'users'>) {
  const { message } = App.useApp()
  // ★ 来源优先：立项页「设计」跳设备设计面时带上来源（台→项目→立项→设计面，返回口仍能回最初的台）
  const go = useGoFrom()
  const [rows, setRows] = useState<EquipmentItem[]>([])
  const [open, setOpen] = useState(false)
  const [sameAs, setSameAs] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    try {
      setRows(await listEquipment(projectNo))
    } catch (e) {
      message.error(errMsg(e))
    }
  }, [projectNo, message])

  useEffect(() => {
    void load()
  }, [load])

  const openAdd = (same?: string) => {
    // ★ F14（2026-10-04）：不在**打开前**调 resetFields —— destroyOnHidden 下弹窗未挂载，
    //   对未连接的实例动手就是 console 警告（“useForm is not connected…”）；
    //   destroyOnHidden + preserve={false} 每次打开都是干净新实例，本来就不需要 reset。
    setSameAs(same)
    setOpen(true)
  }

  const submit = async () => {
    let v
    try { v = await form.validateFields() } catch { return }
    setSaving(true)
    try {
      const created = await addEquipment(projectNo, { ...v, same_as: sameAs })
      message.success(`已新增设备 ${created.equip_no}（${created.equip_name}）`)
      setOpen(false)
      await load()
      onChanged?.()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const editField = async (row: EquipmentItem, field: string, value: string) => {
    try {
      await updateEquipment(projectNo, row.id, { [field]: value })
      await load()
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" size="small" onClick={() => openAdd()}>
          + 新增设备
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          设备号由系统自动发（01A、02A…；同型第二台自动 01B）
        </Typography.Text>
      </Space>
      <Table<EquipmentItem>
        rowKey="id"
        scroll={{ x: 680 }}
        size="small"
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: <Empty description="还没有设备" /> }}
        columns={[
          {
            title: '设备号',
            dataIndex: 'equip_no',
            width: 90,
            render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
          },
          {
            title: '设备名称',
            dataIndex: 'equip_name',
            render: (v: string, r) => (
              <Space size={6}>
                <Typography.Text editable={{ onChange: (nv) => void editField(r, 'equip_name', nv) }}>
                  {v}
                </Typography.Text>
                <a onClick={() => go(`/projects/${projectNo}/design/${r.equip_no}`)}>设计</a>
              </Space>
            ),
          },
          {
            title: '类型',
            dataIndex: 'kind',
            width: 110,
            render: (v: string, r) => (
              <Select
                size="small"
                style={{ width: 90 }}
                allowClear
                value={v ?? undefined}
                options={EQUIPMENT_KINDS.map((k) => ({ value: k, label: k }))}
                onChange={(nv) => void editField(r, 'kind', (nv as string) ?? '')}
              />
            ),
          },
          {
            title: '型号',
            dataIndex: 'model',
            render: (v: string | null, r) => (
              <Typography.Text
                editable={{ onChange: (nv) => void editField(r, 'model', nv) }}
                type={v ? undefined : 'secondary'}
              >
                {v ?? '点这里填'}
              </Typography.Text>
            ),
          },
          {
            title: 'BOM',
            dataIndex: 'bom_complete',
            width: 100,
            render: (v: boolean) =>
              v ? <Chip tone="ok">完整</Chip> : <Chip>待设计</Chip>,
          },
          {
            title: '操作',
            key: 'action',
            width: 170,
            render: (_: unknown, r: EquipmentItem) => (
              <Space size="middle">
                <a onClick={() => openAdd(r.equip_no)} title="再要一台一样的">
                  同型再来一台
                </a>
                <Popconfirm
                  title={`删除设备 ${r.equip_no}？`}
                  onConfirm={() =>
                    void removeEquipment(projectNo, r.id)
                      .then(load)
                      .then(() => onChanged?.())
                      .catch((e) => message.error(errMsg(e)))
                  }
                >
                  <a>删除</a>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={sameAs ? `同型再来一台（参照 ${sameAs}）` : '新增设备'}
        open={open}
        width={520}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        confirmLoading={saving}
        okText="确定"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="equip_name"
            label="设备名称"
            rules={[{ required: true, message: '请填设备名称（如 升降机 / 点胶机 / 皮带线）' }]}
          >
            <Input placeholder="如：升降机" />
          </Form.Item>
          <Form.Item name="kind" label="类型">
            <Select
              allowClear
              options={EQUIPMENT_KINDS.map((k) => ({ value: k, label: k }))}
            />
          </Form.Item>
          <Form.Item name="model" label="型号">
            <Input placeholder="如：TX-NS-LFT-01" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

/** ③ 节点计划：每个节点的时间段（立项时定下来） */
export function MilestoneEditor({ projectNo, users, onChanged }: Props) {
  const { message } = App.useApp()
  const [rows, setRows] = useState<MilestoneItem[]>([])

  const load = useCallback(async () => {
    try {
      setRows(await listMilestones(projectNo))
    } catch (e) {
      message.error(errMsg(e))
    }
  }, [projectNo, message])

  useEffect(() => {
    void load()
  }, [load])

  const patch = async (id: number, body: Record<string, unknown>) => {
    try {
      await updateMilestone(projectNo, id, body)
      await load()
      onChanged?.()
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const [addOpen, setAddOpen] = useState(false)
  const [addSaving, setAddSaving] = useState(false)
  const [addForm] = Form.useForm()

  const submitAdd = async () => {
    let v
    try { v = await addForm.validateFields() } catch { return }
    setAddSaving(true)
    try {
      await addMilestone(projectNo, {
        name: v.name,
        plan_start: v.plan_start ? v.plan_start.format('YYYY-MM-DD') : null,
        plan_end: v.plan_end ? v.plan_end.format('YYYY-MM-DD') : null,
        owner_id: v.owner_id ?? null,
        remark: v.remark ?? null,
      })
      message.success('已新增节点')
      setAddOpen(false)
      await load()
      onChanged?.()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setAddSaving(false)
    }
  }

  const doClear = async () => {
    try {
      await clearMilestones(projectNo)
      message.success('已清空节点计划')
      await load()
      onChanged?.()
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  return (
    <>
      <Space style={{ marginBottom: 8, width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <Button
            size="small"
            type="primary"
            onClick={() => {
              // ★ F14：同上 —— destroyOnHidden 的新实例不需要开前 reset
              setAddOpen(true)
            }}
          >
            新增节点
          </Button>
          <Popconfirm title="清空全部节点计划？" onConfirm={() => void doClear()}>
            <Button size="small" danger disabled={!rows.length}>
              清空
            </Button>
          </Popconfirm>
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          可手动增删；也可在项目详情「生成节点计划」按标准模板生成
        </Typography.Text>
      </Space>
      <Table<MilestoneItem>
      rowKey="id"
      scroll={{ x: 800 }}
      size="small"
      pagination={false}
      dataSource={rows}
      locale={{ emptyText: <Empty description="还没有节点计划" /> }}
      columns={[
        { title: '#', dataIndex: 'seq', width: 46 },
        { title: '节点', dataIndex: 'name', width: 150 },
        {
          title: '计划开始',
          dataIndex: 'plan_start',
          width: 140,
          render: (v: string | null, r) => (
            <DatePicker
              size="small"
              style={{ width: 120 }}
              value={v ? dayjs(v) : null}
              onChange={(d) => void patch(r.id, { plan_start: d ? d.format('YYYY-MM-DD') : null })}
            />
          ),
        },
        {
          title: '计划结束',
          dataIndex: 'plan_end',
          width: 140,
          render: (v: string | null, r) => (
            <DatePicker
              size="small"
              style={{ width: 120 }}
              value={v ? dayjs(v) : null}
              onChange={(d) => void patch(r.id, { plan_end: d ? d.format('YYYY-MM-DD') : null })}
            />
          ),
        },
        {
          title: '负责人',
          dataIndex: 'owner_id',
          width: 140,
          render: (v: number | null, r) => (
            <Select
              size="small"
              style={{ width: 120 }}
              allowClear
              showSearch
              optionFilterProp="label"
              value={v ?? undefined}
              options={users.map((u) => ({ value: u.id, label: u.name }))}
              onChange={(nv) => void patch(r.id, { owner_id: nv ?? null })}
            />
          ),
        },
        {
          title: '状态',
          dataIndex: 'status',
          width: 110,
          render: (v: string, r) => (
            <Select
              size="small"
              style={{ width: 100 }}
              value={v}
              options={MILESTONE_STATUS.map((s) => ({
                value: s,
                label: <Chip tone={toneOf(STATUS_COLOR[s])}>{s}</Chip>,
              }))}
              onChange={(nv) => void patch(r.id, { status: nv })}
            />
          ),
        },
        {
          title: '',
          key: 'action',
          width: 50,
          render: (_: unknown, r: MilestoneItem) => (
            <Popconfirm
              title={`删除节点「${r.name}」？`}
              onConfirm={() =>
                void removeMilestone(projectNo, r.id)
                  .then(load)
                  .then(() => onChanged?.())
                  .catch((e) => message.error(errMsg(e)))
              }
            >
              <a>删除</a>
            </Popconfirm>
          ),
        },
      ]}
      />
      <Modal
        title="新增节点"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => void submitAdd()}
        confirmLoading={addSaving}
        okText="新增"
        destroyOnHidden
      >
        <Form form={addForm} layout="vertical">
          <Form.Item name="name" label="节点名称" rules={[{ required: true, message: '请填节点名称' }]}>
            <Input placeholder="如：设计完成 / 到货 / 装配完成" />
          </Form.Item>
          <Space size="middle">
            <Form.Item name="plan_start" label="计划开始">
              <DatePicker />
            </Form.Item>
            <Form.Item name="plan_end" label="计划结束">
              <DatePicker />
            </Form.Item>
          </Space>
          <Form.Item name="owner_id" label="负责人">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={users.map((u) => ({ value: u.id, label: u.name }))}
            />
          </Form.Item>
          <Form.Item name="remark" label="说明">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

/** ④ 长周期采购：登记进采购池，由采购优先下单（不再系统自动下单） */
export function LongLeadEditor({ projectNo, onChanged }: Omit<Props, 'users'>) {
  const { message } = App.useApp()
  const [rows, setRows] = useState<PurchaseRequestItem[]>([])
  const [open, setOpen] = useState(false)
  const [initial, setInitial] = useState<Record<string, unknown>>({})
  const [editing, setEditing] = useState<PurchaseRequestItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    try {
      setRows(await listPurchaseRequests(projectNo))
    } catch (e) {
      message.error(errMsg(e))
    }
  }, [projectNo, message])

  useEffect(() => {
    void load()
  }, [load])

  const openForm = (row?: PurchaseRequestItem) => {
    setEditing(row ?? null)
    if (row) {
      setInitial({
        item_no: row.item_no,
        qty: row.qty,
        unit: row.unit,
        lead_days: row.lead_days,
        supplier_name: row.supplier_name,
        need_date: row.need_date ? dayjs(row.need_date) : undefined,
        remark: row.remark,
      })
    } else {
      setInitial({})
    }
    setOpen(true)
  }

  const submit = async () => {
    let v
    try { v = await form.validateFields() } catch { return }
    const body = {
      ...v,
      need_date: v.need_date ? v.need_date.format('YYYY-MM-DD') : null,
    }
    setSaving(true)
    try {
      if (editing) await updatePurchaseRequest(projectNo, editing.id, body)
      else await addPurchaseRequest(projectNo, body)
      message.success('已保存')
      setOpen(false)
      await load()
      onChanged?.()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" size="small" onClick={() => openForm()}>
          + 登记长周期件
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          这类件不备货、周期长（如 ABB 机器人 2 个月）—— 登记后进采购池，请采购优先下单
        </Typography.Text>
      </Space>
      <Table<PurchaseRequestItem>
        rowKey="id"
        scroll={{ x: 1040 }}
        size="small"
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: <Empty description="还没有长周期采购件" /> }}
        columns={[
          {
            title: '物料（标准库）',
            dataIndex: 'item_name',
            render: (v: string, r: PurchaseRequestItem) => (
              <Space direction="vertical" size={0}>
                <span>{v}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.item_no}
                  {r.spec_text ? ` · ${r.spec_text}` : ''}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: '数量',
            dataIndex: 'qty',
            width: 90,
            render: (v: number | null, r) => (v ? `${v} ${r.unit ?? ''}` : '—'),
          },
          {
            title: '周期',
            dataIndex: 'lead_days',
            width: 80,
            render: (v: number | null) => (v ? `${v} 天` : '—'),
          },
          { title: '供应商', dataIndex: 'supplier_name', width: 110 },
          { title: '下单', dataIndex: 'ordered_at', width: 110 },
          {
            title: '预计到货',
            dataIndex: 'expected_date',
            width: 110,
            render: (v: string | null, r) => (
              <Space size={4}>
                <span>{v ?? '—'}</span>
                {v && r.need_date && v > r.need_date && <Chip tone="err">晚于需求</Chip>}
              </Space>
            ),
          },
          { title: '需要到货', dataIndex: 'need_date', width: 110 },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (v: string) => <Chip tone={toneOf(STATUS_COLOR[v])}>{v}</Chip>,
          },
          {
            title: '',
            key: 'action',
            width: 90,
            render: (_: unknown, r: PurchaseRequestItem) => (
              <Space size="middle">
                <a onClick={() => openForm(r)}>编辑</a>
                {(r.status === '待采购' || r.status === '已取消') && (
                  <Popconfirm
                    title="删除？"
                    onConfirm={() =>
                      void removePurchaseRequest(projectNo, r.id)
                        .then(load)
                        .then(() => onChanged?.())
                        .catch((e) => message.error(errMsg(e)))
                    }
                  >
                    <a>删除</a>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <AppModal
        title={editing ? `编辑 · ${editing.item_name}` : '登记长周期件'}
        open={open}
        width={640}
        onClose={() => setOpen(false)}
        onOk={() => void submit()}
        loading={saving}
        okText="保存"
        form={form}
        initialValues={initial}
      >
          <Form.Item
            name="item_no"
            label="标准库物料"
            rules={[{ required: true, message: '请从标准库里选一个物料' }]}
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                库里没有？
                <a onClick={() => window.open('/library', '_blank')}> 去标准库新建 </a>
                （标准库是全公司共用的，建一次以后都能选）
              </Typography.Text>
            }
          >
            <StdItemSelect placeholder="输入编码 / 品名 / 规格 / 品牌搜索" />
          </Form.Item>
          <Space style={{ display: 'flex' }} size="middle">
            <Form.Item name="qty" label="数量" style={{ minWidth: 120 }} rules={[{ required: true, message: '填数量' }]}>
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="unit" label="单位" style={{ minWidth: 90 }}>
              <Input placeholder="台 / 套" />
            </Form.Item>
            <Form.Item
              name="lead_days"
              label="采购周期（天）"
              tooltip="采购下单后，预计到货 = 下单日期 + 采购周期"
              style={{ minWidth: 140 }}
              rules={[{ required: true, message: '填周期' }]}
            >
              <InputNumber style={{ width: '100%' }} min={0} suffix="天" />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex' }} size="middle">
            <Form.Item name="supplier_name" label="建议供应商" style={{ minWidth: 200 }}>
              <Input placeholder="选填，如：ABB（采购下单时最终确定）" />
            </Form.Item>
            <Form.Item name="need_date" label="需要到货" style={{ minWidth: 170 }} rules={[{ required: true, message: '填需要到货日' }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
      </AppModal>
    </>
  )
}

/** 标准库物料选择器：搜索编码 / 品名 / 规格 / 品牌 */
function StdItemSelect({
  value,
  onChange,
  placeholder,
}: {
  value?: string
  onChange?: (v?: string) => void
  placeholder?: string
}) {
  const [rows, setRows] = useState<StdItem[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true)
      listStdItems({ q: q || undefined, limit: 50 })
        .then(setRows)
        .catch(() => setRows([]))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  // 已选中的物料如果不在当前搜索结果里，补一条进去（否则只显示编码）
  const options = rows.map((i) => ({
    value: i.item_no,
    label: `${i.item_no} ${i.display_name}`,
  }))
  if (value && !rows.some((i) => i.item_no === value)) {
    options.unshift({ value, label: value })
  }

  return (
    <Select
      showSearch
      allowClear
      value={value}
      placeholder={placeholder}
      aria-label={placeholder ?? '搜索标准库物料'}
      loading={loading}
      optionFilterProp="label"
      filterOption={false}
      onSearch={setQ}
      onChange={(v) => onChange?.(v as string | undefined)}
      options={options}
      style={{ width: '100%' }}
      // ★ 空库/没搜到时给条出路（P2-9）：原来只显示“暂无数据”，
      //   全新系统里项目经理不知道“长周期件必须先有标准库型号”这层依赖。
      notFoundContent={
        <Typography.Text type="secondary">
          {q ? `没搜到「${q}」—— ` : '标准库里还没有物料 —— '}
          先到 <a onClick={() => window.open('/library', '_blank')}>基础数据 → 标准库</a> 建码（工艺/采购建）
        </Typography.Text>
      }
    />
  )
}
