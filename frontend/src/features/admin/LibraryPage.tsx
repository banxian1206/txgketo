import { useUrlState } from '../../hooks/useUrlState'
import { App, Button, Card, Col, Drawer, Empty, Form, Grid, Input, InputNumber, Row, Segmented, Select, Space, Table, Tooltip, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { createStdItem, errMsg, getStdItem, listLibraryCategories, listStdItemsPaged, updateStdItem, type SpecFieldDef, type StdCategoryInfo, type StdItem, type StdItemPaged } from '../../api/client'
import AppModal from '../../components/AppModal'
import StdCategoryNav from '../../components/library/StdCategoryNav'

/**
 * 标准库（01 卷 §5）：三层 → 类别 → 品类 → 型号
 * 编码不含规格，但规格必须完整（按品类规格模板逐字段校验）
 */
const PAGE = 20

export default function Library() {
  const { message } = App.useApp()
  const screens = Grid.useBreakpoint()
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [cats, setCats] = useState<StdCategoryInfo[]>([])
  const [items, setItems] = useState<StdItemPaged[]>([])
  // ★ P3：搜索词进 URL（/library?q=方通 可分享、刷新不丢）
  // ★ 2026-10-07「两页统一标准」：搜索词、分页、搜索范围全进 URL（可分享/刷新不丢）
  const [libState, setLibState] = useUrlState({ q: undefined, page: undefined, scope: undefined, class: undefined })
  const q = libState.q ?? ''
  const page = Number(libState.page ?? 1) || 1
  const allClasses = libState.scope === 'all'
  const activeClass = useMemo(() => {
    const classes = cats.flatMap((c) => c.classes)
    if (libState.class === 'all') return null
    return classes.find((k) => k.code === libState.class) ?? classes.find((k) => (k.item_count ?? 0) > 0) ?? classes[0] ?? null
  }, [cats, libState.class])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [initial, setInitial] = useState<Record<string, unknown>>({})
  const [editing, setEditing] = useState<StdItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const loadCats = useCallback(async () => {
    try {
      const data = await listLibraryCategories()
      setCats(data)
    } catch (e) {
      message.error(errMsg(e))
    }
  }, [message])

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const d = await listStdItemsPaged({
        // ★ 搜索范围显式化：默认搜「当前品类」，勾了「全库」才跨品类
        class_code: allClasses ? undefined : (activeClass?.code ?? undefined),
        q: q || undefined,
        all_classes: allClasses || undefined,
        limit: PAGE,
        offset: (page - 1) * PAGE,
      })
      setItems(d.items)
      setTotal(d.total)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [activeClass, q, page, allClasses, message])

  useEffect(() => {
    void loadCats()
  }, [loadCats])

  useEffect(() => {
    // ⚠ cats 还没到就先别查：否则会先发两次「全部物料」（默认品类未定的空态），
    //   实测 3 次请求里 2 次是白跑的。
    if (!cats.length) return
    void loadItems()
  }, [cats.length, loadItems])

  const openCreate = () => {
    setEditing(null)
    setInitial({ unit: '件' })
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
      setInitial(v)
      setOpen(true)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const submit = async () => {
    let v
    try { v = await form.validateFields() } catch { return }
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

  const categoryNav = (
        <StdCategoryNav
          cats={cats}
          categorySelectsItems={false}
          classCode={activeClass?.code}
          onPick={(k) => {
            setLibState({ class: k ?? 'all', scope: undefined, page: undefined })
            setCategoryOpen(false)
          }}
        />
  )
  return (
    <div className="library-page">
      {/* 左侧：类别 → 品类（与价格库**共用**同一组件，2026-10-07「两页统一标准」） */}
      <div className="library-category">
        {screens.lg ? categoryNav : <Button onClick={() => setCategoryOpen(true)}>选择分类 · {activeClass?.name ?? '全部物料'}</Button>}
      </div>

      {/* 右侧：该品类下的型号 */}
      <div className="library-items">
        <Card
          className="engineering-list"
          size="small"
          title={allClasses || !activeClass ? '全部物料' : `${activeClass.name} · 物料清单`}
        >
          <p className="library-intro">先选择分类，再按物料名称、规格或编码查找；跨分类查找请选择“全库”。</p>
          <div className="library-toolbar">
            <Space wrap>
              {/* ★ 搜索范围显式化（docs/17 第 4 条）：切到「钢材」后搜「电机」没结果时，
                  人要能看出「这是当前品类内没有」，而不是以为全库没有。 */}
              {activeClass ? <Segmented
                size="small"
                value={allClasses ? 'all' : 'class'}
                onChange={(v) =>
                  setLibState({ scope: v === 'all' ? 'all' : undefined, page: undefined })
                }
                options={[
                  { value: 'class', label: activeClass ? `${activeClass.name}内` : '当前品类' },
                  { value: 'all', label: '全库' },
                ]}
              /> : <span>搜索全部物料</span>}
              <Input.Search
                allowClear
                placeholder={allClasses ? '搜全库' : `在「${activeClass?.name ?? '当前品类'}」内搜`}
                style={{ width: 220 }}
                onSearch={(v: string) => setLibState({ q: v || undefined, page: undefined })}
                defaultValue={q}
              />
              <Button type="primary" disabled={!activeClass} onClick={openCreate}>
                新建物料
              </Button>
            </Space>
          </div>
          <Table<StdItem>
            scroll={{ x: 1000 }}
            rowKey="item_no"
            size="small"
            loading={loading}
            dataSource={items}
            // ★ 真服务端分页（2026-10-07）：以前后端最多返回 200、前端切 10 条/页 →
            //   钢材 2517 条「翻不到底」（只有 5 页的假象）。现在 total 来自后端。
            pagination={{
              current: page,
              pageSize: PAGE,
              total,
              showSizeChanger: false,
              onChange: (p: number) => setLibState({ page: p === 1 ? undefined : String(p) }),
            }}
            locale={{
              emptyText: (
                <Empty
                  description={
                    q
                      ? allClasses
                        ? `全库没有匹配「${q}」的物料`
                        : `「${activeClass?.name ?? '当前品类'}」内没有匹配「${q}」的物料 —— 试试右上角切「全库」`
                      : '这个品类下还没有物料'
                  }
                />
              ),
            }}
            columns={[
              {
                title: '编码',
                dataIndex: 'item_no',
                width: 130,
                render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
              },
              {
                // ★ 2026-10-07「两页统一标准」：**品名与规格同格**（品名在上、规格在下）。
                //   理由不是省列，是**规格才是区分同名的字段** —— 实测钢材 2517 条：
                //   品名只有 139 种（25 个「45#链轮」）、规格有 2315 种。
                //   以前只显示品名，同名的一整页长得一模一样，只能逐个点开。
                title: '品名 · 规格',
                key: 'name',
                render: (_: unknown, r: StdItem) => {
                  const spec = r.spec_text || r.mfr_model
                  return (
                    <>
                      <span className="row-title">{r.display_name}</span>
                      {spec ? (
                        <Tooltip title={spec}>
                          <span className="std-spec">{spec}</span>
                        </Tooltip>
                      ) : (
                        <span className="std-spec miss">未填规格</span>
                      )}
                    </>
                  )
                },
              },
              { title: '单位', dataIndex: 'unit', width: 60 },
              {
                // ★ 品牌为空就**不画这一格**（实测 2517 条里 2509 条为空 = 99.7%），
                //   以前它占着 100px 什么都不说。
                title: '品牌',
                dataIndex: 'brand',
                width: 96,
                render: (v: string | null) => (v ? v : <span style={{ color: 'var(--ds-ink4)' }}>—</span>),
              },
              {
                // ★ 价格可用性进列表（与价格库同一口径）：选料时当场知道能不能自动推荐供应商
                title: '价格',
                key: 'price',
                width: 120,
                render: (_: unknown, r: StdItemPaged) =>
                  (r.quote_count ?? 0) > 0 ? (
                    <span title={`${r.quote_count} 条历史价 · ${r.supplier_count} 家供过`}>
                      ¥{r.last_price ?? '—'}
                      {r.recommendable ? ' ·可推荐' : r.comparable ? ' ·可比价' : ' ·仅一家'}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--ds-ink4)' }}>无历史价</span>
                  ),
              },
              {
                title: '操作',
                key: 'a',
                width: 80,
                render: (_: unknown, r: StdItem) => <button type="button" className="project-entry" onClick={() => void openEdit(r)}>编辑</button>,
              },
            ]}
          />

        </Card>
      </div>

      {/* 新建物料：按品类规格模板动态生成表单 */}
      <AppModal
        className="engineering-modal"
        title={editing ? `编辑物料 · ${editing.item_no}` : `新建物料 · ${activeClass?.name ?? ''}`}
        open={open}
        width={720}
        onClose={() => setOpen(false)}
        onOk={() => void submit()}
        loading={saving}
        okText={editing ? '保存' : '建码'}
        form={form}
        initialValues={initial}
        subtitle={
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            {editing
              ? '改规格/品牌/型号/单位（编码不变）；留空即清空该字段'
              : `编码由系统自动发（${activeClass?.category_code}-${activeClass?.code}-0001 形式）；规格按品类模板逐字段填写，缺一项都存不了`}
          </Typography.Paragraph>
        }
      >
          <Row gutter={12}>
            {(activeClass?.spec_template ?? []).map((f) => (
              <Col xs={24} sm={f.type === 'text' ? 12 : 8} key={f.code}>
                {renderField(f)}
              </Col>
            ))}
            <Col xs={24} sm={8}>
              <Form.Item name="unit" label="单位" rules={[{ required: true, message: '请填单位' }]}>
                <Input placeholder="根 / 台 / 件 / 米" />
              </Form.Item>
            </Col>
          </Row>
          {!activeClass?.spec_template?.length && (
            <Empty description="这个品类还没配规格模板" />
          )}
      </AppModal>
      <Drawer title="选择物料分类" open={categoryOpen} onClose={() => setCategoryOpen(false)} width={320}>{categoryNav}</Drawer>
    </div>
  )
}
