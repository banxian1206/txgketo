import { App, Alert, Card, Col, Empty, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd'
import { useState } from 'react'

import {
  errMsg,
  priceReference,
  recommendSuppliers,
  searchItems,
  type ItemLite,
  type PriceReference,
  type QuoteRow,
  type RecommendResult,
} from '../api/client'

const money = (v?: number | null) => (v == null ? '—' : `¥${Number(v).toLocaleString()}`)
const date = (v?: string | null) => (v ? v.slice(0, 10) : '—')

/** 价格参考 / 推荐供应商：查一个物料，看历史成交价 + 报价 + 推荐供应商。 */
export default function PriceReferencePanel() {
  const { message } = App.useApp()
  const [options, setOptions] = useState<ItemLite[]>([])
  const [itemNo, setItemNo] = useState<string | undefined>()
  const [price, setPrice] = useState<PriceReference | null>(null)
  const [reco, setReco] = useState<RecommendResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSearch = (q: string) => {
    searchItems(q)
      .then(setOptions)
      .catch(() => undefined)
  }

  const pick = async (no?: string) => {
    setItemNo(no)
    setPrice(null)
    setReco(null)
    setErr(null)
    if (!no) return
    setLoading(true)
    try {
      const [p, r] = await Promise.all([
        priceReference(no),
        recommendSuppliers(no).catch(() => null),
      ])
      setPrice(p)
      setReco(r)
    } catch (e) {
      setErr(errMsg(e))
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {err && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="看不了价格参考"
          description={err}
        />
      )}
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          showSearch
          filterOption={false}
          style={{ width: 420 }}
          placeholder="输编码 / 品名 / 规格 / 品牌 搜物料"
          value={itemNo}
          onSearch={onSearch}
          onChange={(v: string | undefined) => void pick(v)}
          options={options.map((i) => ({
            value: i.item_no,
            label: `${i.item_no} ${i.display_name}${i.spec_text ? ` · ${i.spec_text}` : ''}`,
          }))}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          看这个物料的历史成交价、最低/最高/均价，以及系统推荐的供应商。
        </Typography.Text>
      </Space>

      {!itemNo && <Empty description="先搜一个物料" />}

      {price && (
        <>
          <Card size="small" style={{ marginBottom: 12 }}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              {price.item_no} {price.display_name}
              {price.spec_text ? <Typography.Text type="secondary"> · {price.spec_text}</Typography.Text> : null}
            </Typography.Title>
            <Row gutter={16}>
              <Col span={4}>
                <Statistic title="最近成交价" value={money(price.stats.last_price)} />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {price.stats.last_supplier ?? '—'} · {date(price.stats.last_date)}
                </Typography.Text>
              </Col>
              <Col span={4}>
                <Statistic title="最低价" value={money(price.stats.min_price)} />
              </Col>
              <Col span={4}>
                <Statistic title="最高价" value={money(price.stats.max_price)} />
              </Col>
              <Col span={4}>
                <Statistic title="均价" value={money(price.stats.avg_price)} />
              </Col>
              <Col span={4}>
                <Statistic title="成交次数" value={price.stats.deal_count} suffix="次" />
              </Col>
              <Col span={4}>
                <Statistic title="报价条数" value={price.stats.quote_count} suffix="条" />
              </Col>
            </Row>
          </Card>

          <Card size="small" title="成交历史（真买过的价）" style={{ marginBottom: 12 }}>
            <Table<QuoteRow>
              rowKey="id"
              size="small"
              loading={loading}
              dataSource={price.deals}
              pagination={false}
              locale={{ emptyText: <Empty description="还没有成交记录" /> }}
              columns={[
                { title: '日期', dataIndex: 'quote_date', width: 110, render: date },
                { title: '供应商', dataIndex: 'supplier_name', width: 200, render: (v: string | null) => v ?? '—' },
                { title: '单价', dataIndex: 'price', width: 120, align: 'right', render: money },
                { title: '单位', dataIndex: 'unit', width: 70, render: (v: string | null) => v ?? '—' },
                { title: '来源', dataIndex: 'source', render: (v: string | null) => v ?? '—' },
              ]}
            />
          </Card>

          {price.ordered.length > 0 && (
            <Card size="small" title="本项目/其他项目实际下单价" style={{ marginBottom: 12 }}>
              <Table
                rowKey={(r) => `${r.project_no}-${r.ordered_at ?? ''}`}
                size="small"
                dataSource={price.ordered}
                pagination={false}
                columns={[
                  { title: '项目', dataIndex: 'project_no', width: 150 },
                  { title: '供应商', dataIndex: 'supplier_name', width: 200, render: (v: string | null) => v ?? '—' },
                  { title: '数量', dataIndex: 'qty', width: 90, align: 'right', render: (v: number | null) => (v == null ? '—' : v) },
                  { title: '单价', dataIndex: 'unit_price', width: 120, align: 'right', render: money },
                  { title: '下单日', dataIndex: 'ordered_at', render: date },
                ]}
              />
            </Card>
          )}

          <Card size="small" title="供应商报价" style={{ marginBottom: 12 }}>
            <Table<QuoteRow>
              rowKey="id"
              size="small"
              dataSource={price.quotes}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              locale={{ emptyText: <Empty description="还没有报价" /> }}
              columns={[
                { title: '日期', dataIndex: 'quote_date', width: 110, render: date },
                { title: '供应商', dataIndex: 'supplier_name', width: 200, render: (v: string | null) => v ?? '—' },
                { title: '报价', dataIndex: 'price', width: 120, align: 'right', render: money },
                { title: '类型', dataIndex: 'price_type', width: 90, render: (v: string) => <Tag>{v}</Tag> },
                { title: '交期(天)', dataIndex: 'lead_days', width: 90, align: 'right', render: (v: number | null) => v ?? '—' },
                { title: '有效期', dataIndex: 'valid_until', width: 110, render: date },
              ]}
            />
          </Card>

          <Card size="small" title="推荐供应商">
            {reco && reco.recommendations.length > 0 ? (
              <Table
                rowKey="supplier_id"
                size="small"
                dataSource={reco.recommendations}
                pagination={false}
                columns={[
                  { title: '供应商', dataIndex: 'name', width: 220, render: (v: string, r) => (
                    <>
                      {v} <Tag color={r.match_level === '优选' ? 'green' : r.match_level === '备选' ? 'blue' : 'default'}>{r.match_level}</Tag>
                    </>
                  ) },
                  { title: '评分', dataIndex: 'score', width: 80, align: 'right' },
                  { title: '参考价', dataIndex: 'price_hint', width: 120, align: 'right', render: money },
                  { title: '交期(天)', dataIndex: 'lead_days', width: 90, align: 'right', render: (v: number | null, r) => (
                    <>{v ?? '—'}{r.late ? <Tag color="red" style={{ marginLeft: 4 }}>赶不上</Tag> : null}</>
                  ) },
                  { title: '理由', dataIndex: 'reasons', render: (v: string[]) => v.join('；') },
                ]}
              />
            ) : (
              <Empty description={reco?.note ?? '没有推荐供应商'} />
            )}
          </Card>
        </>
      )}
    </>
  )
}
