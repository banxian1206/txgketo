import {
  App,
  Button,
  Card,
  DatePicker,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Rate,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'

import {
  addSupplierCatalog,
  addSupplierQuote,
  createSupplier,
  errMsg,
  listLibraryCategories,
  listSupplierCatalog,
  removeSupplierCatalog,
  listSupplierQuotes,
  listSuppliers,
  listStdItems,
  updateSupplier,
  type CatalogRow,
  type QuoteRow,
  type StdCategoryInfo,
  type StdItem,
  type SupplierRow,
} from '../api/client'

const KINDS = ['原材料', '标准件', '机加工', '外协', '电气', '气动', '其他']

/** 供应商主数据 + 报价维护（采购砍价的依据） */
export default function Suppliers() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<SupplierRow[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<SupplierRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  // 报价抽屉
  const [quoteFor, setQuoteFor] = useState<SupplierRow | null>(null)
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [items, setItems] = useState<StdItem[]>([])
  const [quoteForm] = Form.useForm()
  const [catalog, setCatalog] = useState<CatalogRow[]>([])
  const [cats, setCats] = useState<StdCategoryInfo[]>([])
  const [catForm] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listSuppliers({ q: q || undefined }))
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [q, message])

  useEffect(() => {
    void load()
  }, [load])

  const openForm = (row?: SupplierRow) => {
    setEditing(row ?? null)
    form.resetFields()
    if (row) form.setFieldsValue(row)
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      if (editing) await updateSupplier(editing.id, v)
      else await createSupplier(v)
      message.success('已保存')
      setOpen(false)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const openQuotes = async (row: SupplierRow) => {
    setQuoteFor(row)
    setQuotes([])
    quoteForm.resetFields()
    try {
      const [qs, its, cg, cs] = await Promise.all([
        listSupplierQuotes(row.id),
        listStdItems({ limit: 100 }),
        listSupplierCatalog(row.id),
        listLibraryCategories(),
      ])
      setQuotes(qs)
      setItems(its)
      setCatalog(cg)
      setCats(cs)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const submitQuote = async () => {
    if (!quoteFor) return
    const v = await quoteForm.validateFields()
    setSaving(true)
    try {
      await addSupplierQuote(quoteFor.id, {
        ...v,
        quote_date: v.quote_date.format('YYYY-MM-DD'),
      })
      message.success('报价已登记')
      quoteForm.resetFields()
      setQuotes(await listSupplierQuotes(quoteFor.id))
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card
        title="供应商"
        extra={
          <Space>
            <Input.Search
              allowClear
              placeholder="搜名称 / 编号 / 联系人"
              style={{ width: 220 }}
              onSearch={setQ}
            />
            <Button type="primary" onClick={() => openForm()}>
              + 新增供应商
            </Button>
          </Space>
        }
      >
        <Table<SupplierRow>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={rows}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="还没有供应商" /> }}
          columns={[
            {
              title: '编号',
              dataIndex: 'code',
              width: 90,
              render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
            },
            { title: '名称', dataIndex: 'name' },
            {
              title: '主营',
              dataIndex: 'kind',
              width: 100,
              render: (v: string) => (v ? <Tag>{v}</Tag> : '—'),
            },
            { title: '联系人', dataIndex: 'contact_name', width: 100 },
            { title: '电话', dataIndex: 'phone', width: 130 },
            { title: '账期', dataIndex: 'payment_terms', width: 120 },
            {
              title: '评价',
              dataIndex: 'rating',
              width: 130,
              render: (v: number) => (v ? <Rate disabled count={5} value={v} style={{ fontSize: 12 }} /> : '—'),
            },
            {
              title: '价格记录',
              key: 'q',
              width: 140,
              render: (_: unknown, r: SupplierRow) => (
                <a onClick={() => void openQuotes(r)}>
                  报价 {r.quote_count ?? 0} · 成交 {r.deal_count ?? 0}
                </a>
              ),
            },
            {
              title: '',
              key: 'e',
              width: 60,
              render: (_: unknown, r: SupplierRow) => <a onClick={() => openForm(r)}>编辑</a>,
            },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
          报价维护起来，采购员下单前就能看到「上次多少钱、哪家便宜、这次涨没涨」——才好砍价。
        </Typography.Paragraph>
      </Card>

      {/* 新增/编辑供应商 */}
      <Modal
        title={editing ? `编辑供应商 · ${editing.name}` : '新增供应商'}
        open={open}
        width={680}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        confirmLoading={saving}
        okText="保存"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Space style={{ display: 'flex' }} size="middle">
            <Form.Item name="name" label="名称" rules={[{ required: true, message: '请填名称' }]} style={{ minWidth: 300 }}>
              <Input placeholder="如：ABB（上海）" />
            </Form.Item>
            <Form.Item name="kind" label="主营类别" style={{ minWidth: 150 }}>
              <Select allowClear options={KINDS.map((k) => ({ value: k, label: k }))} />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex' }} size="middle">
            <Form.Item name="contact_name" label="联系人" style={{ minWidth: 140 }}>
              <Input />
            </Form.Item>
            <Form.Item name="phone" label="电话" style={{ minWidth: 170 }}>
              <Input />
            </Form.Item>
            <Form.Item name="email" label="邮箱" style={{ minWidth: 200 }}>
              <Input />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex' }} size="middle">
            <Form.Item name="payment_terms" label="账期" style={{ minWidth: 160 }}>
              <Input placeholder="如：月结 30 天" />
            </Form.Item>
            <Form.Item name="tax_rate" label="税率 %" style={{ minWidth: 110 }}>
              <InputNumber style={{ width: '100%' }} min={0} max={100} />
            </Form.Item>
            <Form.Item name="rating" label="评价" style={{ minWidth: 160 }}>
              <Rate />
            </Form.Item>
          </Space>
          <Form.Item name="address" label="地址">
            <Input />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 报价抽屉 */}
      <Drawer
        title={quoteFor ? `价格记录 · ${quoteFor.name}` : '价格记录'}
        width={860}
        open={!!quoteFor}
        onClose={() => setQuoteFor(null)}
        destroyOnClose
      >
        <Card
          size="small"
          title="能供什么（采购推荐的依据）"
          style={{ marginBottom: 16 }}
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              只填「原材料」这种大类是匹配不到「方通」的 —— 要选到品类
            </Typography.Text>
          }
        >
          <Form form={catForm} layout="inline" preserve={false} style={{ marginBottom: 12, rowGap: 8 }}>
            <Form.Item
              name="std_class_code"
              rules={[{ required: true, message: '选品类' }]}
              style={{ minWidth: 200 }}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选品类（如 方通 / 直线导轨）"
                options={cats.flatMap((c) =>
                  c.classes.map((k) => ({ value: k.code, label: `${c.name} / ${k.name}` })),
                )}
              />
            </Form.Item>
            <Form.Item name="price" style={{ minWidth: 120 }}>
              <InputNumber style={{ width: '100%' }} min={0} placeholder="常规价" />
            </Form.Item>
            <Form.Item name="lead_days" style={{ minWidth: 110 }}>
              <InputNumber style={{ width: '100%' }} min={0} placeholder="交期(天)" />
            </Form.Item>
            <Form.Item name="is_preferred" valuePropName="checked">
              <Checkbox>首选</Checkbox>
            </Form.Item>
            <Button
              type="primary"
              loading={saving}
              onClick={async () => {
                if (!quoteFor) return
                const v = await catForm.validateFields()
                setSaving(true)
                try {
                  await addSupplierCatalog(quoteFor.id, v)
                  message.success('已加入供货范围')
                  catForm.resetFields()
                  setCatalog(await listSupplierCatalog(quoteFor.id))
                  await load()
                } catch (e) {
                  message.error(errMsg(e))
                } finally {
                  setSaving(false)
                }
              }}
            >
              加入
            </Button>
          </Form>
          <Table<CatalogRow>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={catalog}
            locale={{ emptyText: <Empty description="还没声明能供什么（这样采购推荐匹配不到这家）" /> }}
            columns={[
              {
                title: '能供',
                key: 's',
                render: (_: unknown, r: CatalogRow) =>
                  r.item_no ? (
                    <Space size={4}>
                      <Tag color="blue">型号</Tag>
                      {r.item_name ?? r.item_no}
                    </Space>
                  ) : (
                    <Space size={4}>
                      <Tag>品类</Tag>
                      {r.std_class_name}
                    </Space>
                  ),
              },
              {
                title: '常规价',
                dataIndex: 'price',
                width: 110,
                render: (v: number | null) => (v ? `¥${v.toLocaleString()}` : '—'),
              },
              {
                title: '交期',
                dataIndex: 'lead_days',
                width: 90,
                render: (v: number | null) => (v ? `${v} 天` : '—'),
              },
              {
                title: '首选',
                dataIndex: 'is_preferred',
                width: 80,
                render: (v: boolean) => (v ? <Tag color="gold">首选</Tag> : '—'),
              },
              {
                title: '',
                key: 'd',
                width: 60,
                render: (_: unknown, r: CatalogRow) => (
                  <a
                    onClick={() =>
                      void removeSupplierCatalog(r.id)
                        .then(async () => {
                          if (quoteFor) setCatalog(await listSupplierCatalog(quoteFor.id))
                          await load()
                        })
                        .catch((e: unknown) => message.error(errMsg(e)))
                    }
                  >
                    移除
                  </a>
                ),
              },
            ]}
          />
        </Card>

        <Card size="small" title="登记一条报价 / 成交价" style={{ marginBottom: 16 }}>
          <Form form={quoteForm} layout="vertical" preserve={false}>
            <Space style={{ display: 'flex' }} size="middle" wrap>
              <Form.Item
                name="item_no"
                label="标准库物料"
                rules={[{ required: true, message: '请选物料' }]}
                style={{ minWidth: 340 }}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="输入编码 / 品名 / 规格 搜索"
                  options={items.map((i) => ({ value: i.item_no, label: `${i.item_no} ${i.display_name}` }))}
                />
              </Form.Item>
              <Form.Item name="price" label="价格（元）" rules={[{ required: true }]} style={{ minWidth: 140 }}>
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
              <Form.Item name="lead_days" label="交期（天）" style={{ minWidth: 120 }}>
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
              <Form.Item name="price_type" label="类型" initialValue="报价" style={{ minWidth: 110 }}>
                <Select
                  options={[
                    { value: '报价', label: '供应商报价' },
                    { value: '成交', label: '实际成交' },
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="quote_date"
                label="日期"
                initialValue={dayjs()}
                rules={[{ required: true }]}
                style={{ minWidth: 150 }}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="source" label="来源" style={{ minWidth: 150 }}>
                <Input placeholder="采购单号 / 手工" />
              </Form.Item>
            </Space>
            <Button type="primary" loading={saving} onClick={() => void submitQuote()}>
              登记
            </Button>
          </Form>
        </Card>

        <Table<QuoteRow>
          rowKey="id"
          size="small"
          pagination={{ pageSize: 15, showSizeChanger: false }}
          dataSource={quotes}
          locale={{ emptyText: <Empty description="还没有价格记录" /> }}
          columns={[
            {
              title: '物料',
              dataIndex: 'item_name',
              render: (v: string, r: QuoteRow) => (
                <Space direction="vertical" size={0}>
                  <span>{v}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {r.item_no}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: '价格',
              dataIndex: 'price',
              width: 120,
              align: 'right',
              render: (v: number) => `¥${v.toLocaleString()}`,
            },
            { title: '交期', dataIndex: 'lead_days', width: 80, render: (v: number | null) => (v ? `${v} 天` : '—') },
            {
              title: '类型',
              dataIndex: 'price_type',
              width: 90,
              render: (v: string) => (v === '成交' ? <Tag color="green">成交</Tag> : <Tag>报价</Tag>),
            },
            { title: '日期', dataIndex: 'quote_date', width: 110 },
            { title: '来源', dataIndex: 'source', width: 130, render: (v: string | null) => v || '—' },
          ]}
        />
      </Drawer>
    </>
  )
}
