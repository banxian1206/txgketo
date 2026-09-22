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
  Table,
  Typography,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'

import {
  createStdItem,
  errMsg,
  getStdItem,
  listLibraryCategories,
  listStdItems,
  updateStdItem,
  type SpecFieldDef,
  type StdCategoryInfo,
  type StdClassInfo,
  type StdItem,
} from '../api/client'

/**
 * 标准库（01 卷 §5）：三层 → 类别 → 品类 → 型号
 * 编码不含规格，但规格必须完整（按品类规格模板逐字段校验）
 */
export default function Library() {
  const { message } = App.useApp()
  const [cats, setCats] = useState<StdCategoryInfo[]>([])
  const [activeClass, setActiveClass] = useState<StdClassInfo | null>(null)
  const [items, setItems] = useState<StdItem[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<StdItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const loadCats = useCallback(async () => {
    try {
      const data = await listLibraryCategories()
      setCats(data)
      const first = data.find((c) => c.classes.length)?.classes[0] ?? null
      setActiveClass((prev) => prev ?? first)
    } catch (e) {
      message.error(errMsg(e))
    }
  }, [message])

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      setItems(
        await listStdItems({
          class_code: activeClass?.code,
          q: q || undefined,
        }),
      )
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [activeClass, q, message])

  useEffect(() => {
    void loadCats()
  }, [loadCats])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ unit: '件' })
    setOpen(true)
  }

  const openEdit = async (item: StdItem) => {
    try {
      const full = await getStdItem(item.item_no)
      setEditing(full)
      const v: Record<string, unknown> = { unit: full.unit }
      for (const f of activeClass?.spec_template ?? []) {
        const val = full.spec?.[f.code]
        if (val !== undefined && val !== null) v[`spec_${f.code}`] = val
      }
      form.resetFields()
      form.setFieldsValue(v)
      setOpen(true)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const submit = async () => {
    const v = await form.validateFields()
    const template = activeClass?.spec_template ?? []
    const spec: Record<string, unknown> = {}
    let brand: string | undefined
    let mfrModel: string | undefined
    for (const f of template) {
      const val = v[`spec_${f.code}`]
      if (val !== undefined && val !== null && val !== '') spec[f.code] = val
      if (f.code === 'brand') brand = val as string
      if (f.code === 'model') mfrModel = val as string
    }
    setSaving(true)
    try {
      if (editing) {
        await updateStdItem(editing.item_no, { unit: v.unit, spec, brand, mfr_model: mfrModel })
        message.success(`已更新 ${editing.item_no}`)
      } else {
        const created = await createStdItem({
          std_class_code: activeClass!.code,
          spec,
          unit: v.unit,
          brand,
          mfr_model: mfrModel,
        })
        message.success(`已建码：${created.item_no}（${created.display_name}）`)
      }
      setOpen(false)
      await Promise.all([loadItems(), loadCats()])
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const renderField = (f: SpecFieldDef) => {
    const rules = f.required ? [{ required: true, message: `请填${f.name}` }] : []
    if (f.type === 'enum') {
      return (
        <Form.Item key={f.code} name={`spec_${f.code}`} label={f.name} rules={rules}>
          <Select
            allowClear
            showSearch
            options={(f.options ?? []).map((o) => ({ value: o, label: o }))}
          />
        </Form.Item>
      )
    }
    if (f.type === 'number') {
      return (
        <Form.Item key={f.code} name={`spec_${f.code}`} label={f.name} rules={rules}>
          <InputNumber style={{ width: '100%' }} suffix={f.unit} />
        </Form.Item>
      )
    }
    return (
      <Form.Item key={f.code} name={`spec_${f.code}`} label={f.name} rules={rules}>
        <Input placeholder={f.unit} />
      </Form.Item>
    )
  }

  return (
    <Row gutter={16}>
      {/* 左侧：类别 → 品类 */}
      <Col flex="210px">
        <Card size="small" title="类别 / 品类" styles={{ body: { padding: 8 } }}>
          {cats.map((c) => (
            <div key={c.code} style={{ marginBottom: 8 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {c.code} {c.name}
              </Typography.Text>
              <div style={{ marginTop: 2 }}>
                {c.classes.map((k) => (
                  <a
                    key={k.code}
                    className={`lib-class${activeClass?.code === k.code ? ' active' : ''}`}
                    onClick={() => setActiveClass(k)}
                  >
                    {k.name}
                    <span style={{ color: '#bbb', marginLeft: 6 }}>{k.item_count ?? 0}</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </Card>
      </Col>

      {/* 右侧：该品类下的型号 */}
      <Col flex="auto" style={{ minWidth: 0 }}>
        <Card
          size="small"
          title={
            activeClass
              ? `${activeClass.name}（${activeClass.code}）· ${activeClass.category_name ?? ''}`
              : '物料'
          }
          extra={
            <Space>
              <Input.Search
                allowClear
                placeholder="搜编码 / 品名 / 规格 / 品牌"
                style={{ width: 240 }}
                onSearch={(v) => setQ(v)}
              />
              <Button type="primary" disabled={!activeClass} onClick={openCreate}>
                新建物料
              </Button>
            </Space>
          }
        >
          <Table<StdItem>
            rowKey="item_no"
            size="small"
            loading={loading}
            dataSource={items}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            locale={{ emptyText: <Empty description="这个品类下还没有物料" /> }}
            columns={[
              {
                title: '编码',
                dataIndex: 'item_no',
                width: 130,
                render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
              },
              {
                title: '品名（自动生成）',
                dataIndex: 'display_name',
                render: (v: string) => <span className="row-title">{v}</span>,
              },
              { title: '单位', dataIndex: 'unit', width: 70 },
              {
                title: '品牌',
                dataIndex: 'brand',
                width: 100,
                render: (v: string | null) => v || '—',
              },
              {
                title: '操作',
                key: 'a',
                width: 80,
                render: (_: unknown, r: StdItem) => <a onClick={() => void openEdit(r)}>编辑</a>,
              },
            ]}
          />
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
            编码不含规格，但规格必须写全 —— 采购就是照规格买。同品类同规格同品牌不允许重复建码。
          </Typography.Paragraph>
        </Card>
      </Col>

      {/* 新建物料：按品类规格模板动态生成表单 */}
      <Modal
        title={editing ? `编辑物料 · ${editing.item_no}` : `新建物料 · ${activeClass?.name ?? ''}`}
        open={open}
        width={720}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        confirmLoading={saving}
        okText={editing ? '保存' : '建码'}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {editing
            ? '改规格/品牌/型号/单位（编码不变）；留空即清空该字段'
            : `编码由系统自动发（${activeClass?.category_code}-${activeClass?.code}-0001 形式）；规格按品类模板逐字段填写，缺一项都存不了`}
        </Typography.Paragraph>
        <Form form={form} layout="vertical" preserve={false}>
          <Row gutter={12}>
            {(activeClass?.spec_template ?? []).map((f) => (
              <Col span={f.type === 'text' ? 12 : 8} key={f.code}>
                {renderField(f)}
              </Col>
            ))}
            <Col span={8}>
              <Form.Item name="unit" label="单位" rules={[{ required: true, message: '请填单位' }]}>
                <Input placeholder="根 / 台 / 件 / 米" />
              </Form.Item>
            </Col>
          </Row>
          {!activeClass?.spec_template?.length && (
            <Empty description="这个品类还没配规格模板" />
          )}
        </Form>
      </Modal>
    </Row>
  )
}
