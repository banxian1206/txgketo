import {
  Alert,
  App,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  errMsg,
  mergeOrder,
  recommendSuppliers,
  type PurchasePoolGroup,
} from '../api/client'
import { SelectSupplier } from './fields'
import { T } from '../theme/tokens'

interface MergeLine {
  request_id: number
  item_no: string
  display_name: string
  spec_text?: string | null
  unit?: string | null
  project_no: string | null
  project_name?: string | null
  equip_no?: string | null
  qty: number
  unit_price?: number | null
  need_date?: string | null
  lead_days?: number | null
}

/** 推荐供应商（多个物料时按供应商归并：分数取最高，价格/交期按物料各记一份） */
interface RecoRow {
  supplier_id: number
  name: string
  score: number
  late: boolean
  reasons: string[]
  prices: Record<string, number | null | undefined>
  leads: Record<string, number | null | undefined>
}

function buildLines(groups: PurchasePoolGroup[]): MergeLine[] {
  const out: MergeLine[] = []
  groups.forEach((g) =>
    g.requests.forEach((r) =>
      out.push({
        request_id: r.id,
        item_no: g.item_no,
        display_name: g.display_name,
        spec_text: g.spec_text,
        unit: g.unit,
        project_no: r.project_no,
        project_name: r.project_name,
        equip_no: r.equip_no,
        qty: r.qty,
        unit_price: null,
        need_date: r.need_date,
        lead_days: r.lead_days,
      }),
    ),
  )
  return out
}

/**
 * 合并下单弹窗（00 卷 §3.1②）
 * 把采购池里勾中的若干条需求合并成一张采购单，下给同一个供应商：
 * 推荐供应商 + 合并后总量/单价 + 收货地点/地址（直发现场必填）。
 */
export default function MergeOrderModal({
  open,
  groups,
  onCancel,
  onDone,
}: {
  open: boolean
  groups: PurchasePoolGroup[]
  onCancel: () => void
  onDone: () => void
}) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const deliverTo = Form.useWatch('deliver_to', form)
  const [lines, setLines] = useState<MergeLine[]>([])
  const [recos, setRecos] = useState<RecoRow[]>([])
  const [recoNote, setRecoNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const init = useCallback(async () => {
    setLines(buildLines(groups))
    form.resetFields()
    form.setFieldsValue({
      supplier_id: undefined,
      po_no: undefined,
      ordered_at: dayjs(),
      expected_date: undefined,
      deliver_to: '公司仓库',
      deliver_address: undefined,
      remark: undefined,
    })
    setRecos([])
    setRecoNote(null)
    // 按选中的物料分别取推荐，再按供应商归并
    const uniq = [...new Map(groups.map((g) => [g.item_no, g])).values()]
    const notes: string[] = []
    try {
      const results = await Promise.all(
        uniq.map((g) =>
          recommendSuppliers(g.item_no, g.earliest_need ?? undefined).catch(() => null),
        ),
      )
      const map = new Map<number, RecoRow>()
      results.forEach((res, i) => {
        if (!res) return
        const itemNo = uniq[i].item_no
        if (res.note) notes.push(res.note)
        res.recommendations.forEach((r) => {
          const cur: RecoRow = map.get(r.supplier_id) ?? {
            supplier_id: r.supplier_id,
            name: r.name,
            score: 0,
            late: false,
            reasons: [],
            prices: {},
            leads: {},
          }
          cur.score = Math.max(cur.score, r.score)
          cur.late = cur.late || r.late
          r.reasons.forEach((x) => {
            if (!cur.reasons.includes(x)) cur.reasons.push(x)
          })
          cur.prices[itemNo] = r.price_hint
          cur.leads[itemNo] = r.lead_days
          map.set(r.supplier_id, cur)
        })
      })
      setRecos([...map.values()].sort((a, b) => b.score - a.score).slice(0, 5))
      setRecoNote(notes[0] ?? null)
    } catch {
      setRecos([])
    }
  }, [form, groups])

  useEffect(() => {
    if (open) void init()
    // 只在打开时初始化：打开期间不跟着父组件重渲染反复重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const setLine = (id: number, patch: Partial<MergeLine>) =>
    setLines((prev) => prev.map((l) => (l.request_id === id ? { ...l, ...patch } : l)))

  const removeLine = (id: number) => setLines((prev) => prev.filter((l) => l.request_id !== id))

  const pickReco = (r: RecoRow) => {
    form.setFieldsValue({ supplier_id: r.supplier_id })
    // 参考价只填空白，别覆盖采购员自己填的
    setLines((prev) =>
      prev.map((l) => {
        if (l.unit_price) return l
        const p = r.prices[l.item_no]
        return p ? { ...l, unit_price: p } : l
      }),
    )
  }

  const shortName = (itemNo: string) => {
    const n = lines.find((l) => l.item_no === itemNo)?.display_name ?? itemNo
    return n.length > 14 ? `${n.slice(0, 14)}…` : n
  }

  const itemKinds = useMemo(() => new Set(lines.map((l) => l.item_no)).size, [lines])
  const totalAmount = useMemo(
    () => lines.reduce((s, l) => s + (l.unit_price ? l.unit_price * l.qty : 0), 0),
    [lines],
  )
  const unpriced = lines.filter((l) => !l.unit_price).length
  // ★ 预计到货日（客户口径 O3-A）：不填时系统要拿「下单日 + 采购周期」逐条推算；
  //   只要有一条需求没周期，就推不出来 → 此时必须手填（到货跟踪/超期预警的凭据）
  const noLead = lines.filter((l) => !l.lead_days).length
  const today = dayjs().format('YYYY-MM-DD')

  const submit = async () => {
    let v: {
      supplier_id: number
      po_no?: string
      ordered_at: dayjs.Dayjs
      expected_date?: dayjs.Dayjs
      deliver_to: string
      deliver_address?: string
      remark?: string
    }
    try {
      v = await form.validateFields()
    } catch {
      return
    }
    if (lines.length === 0) {
      message.warning('至少留一条需求')
      return
    }
    setSaving(true)
    try {
      const res = await mergeOrder({
        supplier_id: v.supplier_id,
        ordered_at: v.ordered_at.format('YYYY-MM-DD'),
        expected_date: v.expected_date ? v.expected_date.format('YYYY-MM-DD') : undefined,
        deliver_to: v.deliver_to,
        deliver_address: v.deliver_to === '直发客户现场' ? v.deliver_address : undefined,
        po_no: v.po_no || undefined,
        remark: v.remark || undefined,
        lines: lines.map((l) => ({
          request_id: l.request_id,
          qty: l.qty,
          unit_price: l.unit_price ?? undefined,
        })),
      })
      message.success(
        `已合并下单 ${res.po_no} → ${res.supplier}：${res.count} 条需求` +
          (res.total > 0 ? `，合计 ¥${res.total.toLocaleString()}` : ''),
      )
      onDone()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={lines.length > 1 ? `合并下单（${lines.length} 条需求 → 一张采购单）` : '采购下单'}
      open={open}
      width={1000}
      onCancel={onCancel}
      onOk={() => void submit()}
      confirmLoading={saving}
      okText="确认合并下单"
      okButtonProps={{ disabled: lines.length === 0 }}
      forceRender
      styles={{ body: { maxHeight: 'calc(100vh - 230px)', overflowY: 'auto', paddingRight: 8 } }}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0 }}>
        把下面 {lines.length} 条需求（{itemKinds} 种物料）合并成一张采购单下给同一个供应商，共用采购单号。
        数量和单价可以直接改；不想合的条目删掉即可。
      </Typography.Paragraph>

      <Table<MergeLine>
        rowKey="request_id"
        size="small"
        pagination={false}
        dataSource={lines}
        scroll={{ x: 887 }}
        locale={{ emptyText: '没有可下单的需求（都删掉了）' }}
        columns={[
          {
            title: '物料',
            key: 'item',
            width: 230,
            render: (_: unknown, l) => (
              <>
                <b>{l.display_name}</b>
                <div style={{ fontSize: 12, color: T.textSecondary }}>
                  {l.item_no}
                  {l.spec_text ? ` · ${l.spec_text}` : ''}
                </div>
              </>
            ),
          },
          {
            title: '项目 / 设备',
            key: 'project',
            width: 160,
            render: (_: unknown, l) => (
              <>
                <div>{l.project_no}</div>
                {(l.project_name || l.equip_no) && (
                  <div style={{ fontSize: 12, color: T.textSecondary }}>
                    {l.project_name ?? ''}
                    {l.equip_no ? `${l.project_name ? ' · ' : ''}${l.equip_no}` : ''}
                  </div>
                )}
              </>
            ),
          },
          {
            title: '需要到货',
            dataIndex: 'need_date',
            width: 110,
            render: (v: string | null, l) => (
              <>
                <Space size={4}>
                  <span>{v ?? '—'}</span>
                  {v && v < today && <Tag color="red">赶不上</Tag>}
                </Space>
                {l.lead_days ? (
                  <div style={{ fontSize: 12, color: T.textSecondary }}>周期 {l.lead_days} 天</div>
                ) : null}
              </>
            ),
          },
          {
            title: '数量',
            dataIndex: 'qty',
            width: 120,
            render: (v: number, l) => (
              <InputNumber
                size="small"
                style={{ width: '100%' }}
                min={0.001}
                value={v}
                suffix={l.unit ?? undefined}
                onChange={(x) => setLine(l.request_id, { qty: Number(x) || 0 })}
              />
            ),
          },
          {
            title: '单价',
            dataIndex: 'unit_price',
            width: 120,
            render: (v: number | null | undefined, l) => (
              <InputNumber
                size="small"
                style={{ width: '100%' }}
                min={0}
                value={v ?? undefined}
                placeholder="可不填"
                addonBefore="¥"
                onChange={(x) => setLine(l.request_id, { unit_price: x == null ? null : Number(x) })}
              />
            ),
          },
          {
            title: '小计',
            key: 'amount',
            width: 95,
            align: 'right',
            render: (_: unknown, l) =>
              l.unit_price ? `¥${(l.unit_price * l.qty).toLocaleString()}` : '—',
          },
          {
            title: '',
            key: 'op',
            width: 52,
            render: (_: unknown, l) => (
              <Button type="link" size="small" danger onClick={() => removeLine(l.request_id)}>
                移除
              </Button>
            ),
          },
        ]}
      />

      <Space size="large" style={{ marginTop: 12 }}>
        <Typography.Text>
          共 <b>{lines.length}</b> 条需求 · <b>{itemKinds}</b> 种物料
        </Typography.Text>
        <Typography.Text>
          下单合计：<b>¥{totalAmount.toLocaleString()}</b>
          {unpriced > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              　（{unpriced} 条未填单价，只下单不记价）
            </Typography.Text>
          )}
        </Typography.Text>
      </Space>

      {recos.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            推荐供应商（按选中的物料分别推荐；点「选用」自动带出参考价，不会覆盖你填过的单价）
          </Typography.Text>
          <Table<RecoRow>
            rowKey="supplier_id"
            size="small"
            pagination={false}
            dataSource={recos}
            columns={[
              {
                title: '匹配',
                dataIndex: 'score',
                width: 76,
                render: (v: number) => <Tag color="blue">{v} 分</Tag>,
              },
              {
                title: '供应商',
                dataIndex: 'name',
                width: 190,
                render: (v: string, r) => (
                  <Space size={4}>
                    <b>{v}</b>
                    {r.late && <Tag color="red">赶不上</Tag>}
                  </Space>
                ),
              },
              {
                title: '参考价（按物料）',
                key: 'prices',
                render: (_: unknown, r) => (
                  <>
                    {Object.entries(r.prices)
                      .filter(([, p]) => p)
                      .map(([item, p]) => (
                        <Tag key={item}>
                          {shortName(item)} ¥{p?.toLocaleString()}
                        </Tag>
                      ))}
                    {Object.entries(r.leads)
                      .filter(([, d]) => d)
                      .map(([item, d]) => (
                        <Tag key={item} color={undefined}>
                          {shortName(item)} 交期 {d} 天
                        </Tag>
                      ))}
                  </>
                ),
              },
              {
                title: '理由',
                dataIndex: 'reasons',
                render: (v: string[]) => (
                  <span style={{ fontSize: 12, color: T.textSecondary }}>{v.join(' · ')}</span>
                ),
              },
              {
                title: '',
                key: 'op',
                width: 64,
                render: (_: unknown, r) => (
                  <Button type="link" size="small" onClick={() => pickReco(r)}>
                    选用
                  </Button>
                ),
              },
            ]}
          />
          {recoNote && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {recoNote}
            </Typography.Text>
          )}
        </div>
      )}

      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Space style={{ display: 'flex' }} size="middle" align="start">
          <Form.Item
            name="supplier_id"
            label="供应商"
            style={{ minWidth: 280 }}
            rules={[{ required: true, message: '请选供应商' }]}
          >
            <SelectSupplier />
          </Form.Item>
          <Form.Item
            name="po_no"
            label="采购单号"
            style={{ minWidth: 190 }}
            tooltip="和供应商谈好的单号；不填就自动发号 PO+年份+序号"
          >
            <Input placeholder="不填自动发号" />
          </Form.Item>
          <Form.Item
            name="ordered_at"
            label="下单日期"
            style={{ minWidth: 170 }}
            rules={[{ required: true, message: '请填下单日期' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Space>

        <Space style={{ display: 'flex' }} size="middle" align="start">
          <Form.Item
            name="expected_date"
            label="预计到货日期"
            style={{ minWidth: 190 }}
            tooltip={noLead ? `${noLead} 条需求没填采购周期，推不出来 —— 这一格必填` : '不填则按各条需求自己的采购周期自动推算'}
            rules={[
              noLead
                ? {
                    required: true,
                    message: `${noLead} 条需求无采购周期，必须填预计到货日期（催货/超期预警以它为凭）`,
                  }
                : {},
            ]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="deliver_to"
            label="收货地点"
            style={{ minWidth: 230 }}
            rules={[{ required: true }]}
            tooltip="收货地点下单时就定：到仓库的由仓库验收，直发现场的由现场验收"
          >
            <Select
              options={[
                { value: '公司仓库', label: '公司仓库（仓库验收）' },
                { value: '直发客户现场', label: '直发客户现场（现场验收）' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="deliver_address"
            label="送货地址"
            style={{ minWidth: 300 }}
            rules={
              deliverTo === '直发客户现场'
                ? [{ required: true, message: '直发客户现场必须填送货地址' }]
                : []
            }
          >
            <Input
              placeholder={
                deliverTo === '直发客户现场' ? '客户现场详细地址' : '到公司仓库可不填'
              }
              disabled={deliverTo !== '直发客户现场'}
            />
          </Form.Item>
        </Space>

        <Form.Item name="remark" label="备注" style={{ marginBottom: 0 }}>
          <Input.TextArea rows={2} placeholder="如：让供应商分两车送 / 谈好的价格条件" />
        </Form.Item>
      </Form>

      {lines.length > 1 && (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 12 }}
          message="合并下单会把这几条需求绑到同一个采购单号上，到货后按到货单分别验收。"
        />
      )}
    </Modal>
  )
}
