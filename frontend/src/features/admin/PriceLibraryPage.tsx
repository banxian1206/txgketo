import { App, Button, Input, Space, Table, Tooltip, Upload } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  errMsg,
  importPurchaseHistory,
  listLibraryCategories,
  priceLibraryByItem,
  priceLibraryItems,
  priceLibraryStats,
  type ImportHistoryResult,
  type PriceLibraryByItem,
  type PriceLibraryItem,
  type PriceLibraryItems,
  type PriceLibraryQuery,
  type PriceLibraryStats,
  type StdCategoryInfo,
} from '../../api/client'
import { hasPerm } from '../../api/user'
import { Code, Empty, Metrics, PageHead, Panel, Status, type MetricItem } from '../../components/ds'
import StdCategoryNav from '../../components/library/StdCategoryNav'
import { useGoFrom } from '../../hooks/useFrom'

/**
 * 价格库（基础数据 → 价格库）—— 2026-10-07 客户口径
 *
 * 「价格参考」原来塞在采购台里，同时管**查价**（下单时干活）与**导入**（改公司级主数据），
 * 页签名还叫「参考」，名不副实。这页只做**数据管理**：导入 + 浏览 + 数据健康度。
 * 干活时查价仍在采购台（`priceReference` / `recommend`），两者指向同一张 `supplier_quote`。
 *
 * 三个设计点：
 *  ① 首屏给**健康度**而不是「导入了多少条」—— 导了 5.6 万条但只有 664 个料能比价，
 *     后者才是这批数据真正的价值（首屏的指标可以直接点，点了就筛出来）。
 *  ② 台账**一行一个物料**（不是一条报价）：12,431 个物料逐条翻不动。
 *  ③ 比价阈值不写死在前端（接口带 `thresholds`），与推荐服务共用一套。
 */
const PAGE = 20

function money(v?: number | null) {
  if (v === null || v === undefined) return '—'
  return `¥${v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

export default function PriceLibraryPage() {
  const { message } = App.useApp()
  const go = useGoFrom()

  const [cats, setCats] = useState<StdCategoryInfo[]>([])
  const [classCode, setClassCode] = useState<string | undefined>()
  const [catCode, setCatCode] = useState<string | undefined>()
  const [q, setQ] = useState('')
  const [gap, setGap] = useState<'' | 'only_single' | 'only_never'>('')
  const [page, setPage] = useState(1)

  const [stats, setStats] = useState<PriceLibraryStats | null>(null)
  const [data, setData] = useState<PriceLibraryItems | null>(null)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<PriceLibraryByItem | null>(null)
  const [imp, setImp] = useState<ImportHistoryResult | null>(null)
  const [importing, setImporting] = useState(false)

  const canImport = hasPerm('price:import')

  const query: PriceLibraryQuery = useMemo(
    () => ({ q: q || undefined, class_code: classCode, category_code: catCode }),
    [q, classCode, catCode],
  )

  useEffect(() => {
    listLibraryCategories()
      .then(setCats)
      .catch(() => setCats([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, d] = await Promise.all([
        priceLibraryStats(query),
        priceLibraryItems({ ...query, ...(gap ? { [gap]: true } : {}), limit: PAGE, offset: (page - 1) * PAGE }),
      ])
      setStats(s)
      setData(d)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [query, gap, page, message])

  useEffect(() => {
    void load()
  }, [load])

  const openItem = useCallback(
    async (itemNo: string) => {
      try {
        setDetail(await priceLibraryByItem(itemNo))
      } catch (e) {
        message.error(errMsg(e))
      }
    },
    [message],
  )

  const doImport = async (file: File) => {
    setImporting(true)
    try {
      const r = await importPurchaseHistory(file)
      setImp(r)
      message.success(`导入完成：新增 ${r.imported} 条，跳过 ${r.skipped_duplicate} 条`)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setImporting(false)
    }
    return false
  }

  // ★ 首屏给「这批数据能干什么用」，而不是「导了多少条」——
  //   指标本身就是入口（点了就筛出来），不是装饰数字。
  const metrics: MetricItem[] = stats
    ? [
        {
          key: 'recommendable',
          label: '可放心推荐',
          value: stats.recommendable_items,
          unit: '个料',
          note: `≥${stats.thresholds.recommendable} 家供过`,
          lead: true,
          tone: 'ok',
          title: '点开：这些料下单时能多家比价',
        },
        {
          key: 'comparable',
          label: '可比价',
          value: stats.comparable_items,
          unit: '个料',
          note: `≥${stats.thresholds.comparable} 家供过`,
          tone: 'warn',
          onClick: () => {
            setGap('')
            setPage(1)
          },
        },
        {
          key: 'single',
          label: '只有一家',
          value: stats.single_supplier_items,
          unit: '个料',
          note: '选不了价',
          tone: 'err',
          onClick: () => {
            setGap('only_single')
            setPage(1)
          },
        },
        {
          key: 'never',
          label: '从未有价',
          value: stats.never_priced_items,
          unit: '个料',
          note: '标准库里有、价格库没有',
          onClick: () => {
            setGap('only_never')
            setPage(1)
          },
        },
        {
          key: 'quotes',
          label: '价格记录',
          value: stats.quote_count,
          unit: '条',
          note: `${stats.date_from ?? '—'} → ${stats.date_to ?? '—'}`,
        },
        {
          key: 'suppliers',
          label: '供应商',
          value: stats.supplier_count,
          unit: '家',
          note: `供过 ${stats.priced_item_count} 个料`,
        },
      ]
    : []

  return (
    <div className="ds-page">
      <PageHead
        crumb={
          <>
            <button type="button" className="project-back" onClick={() => go('/library')}>
              ← 返回标准库
            </button>
            <span style={{ color: 'var(--ds-line2)', margin: '0 8px' }}>/</span>
            <span>基础数据</span>
          </>
        }
        title="价格库"
        sub="历史采购价（成交价）的台账与导入 —— 下单时查价仍在采购台「价格参考」"
        actions={
          <>
            {gap && (
              <Button size="small" onClick={() => setGap('')}>
                清除筛选：{gap === 'only_single' ? '只有一家' : '从未有价'}
              </Button>
            )}
            <Button size="small" onClick={() => void load()}>
              刷新
            </Button>
          </>
        }
      />

      <Metrics items={metrics} />

      <Space align="start" size={12} style={{ display: 'flex', marginBottom: 12 }}>
        {/* ★ 2026-10-07「两页统一标准」：左栏换成与标准库**共用**的 StdCategoryNav
            —— 以前这里又手写了一棵 139 品类的树，跟标准库那棵长得一样却各改各的。 */}
        <StdCategoryNav cats={cats} classCode={classCode} categoryCode={catCode} onPick={(c, k) => { setClassCode(c); setCatCode(k); setPage(1) }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {canImport && (
            <Panel title="导入历史采购价（Excel / CSV → 价格库）">
              <Upload
                accept=".xlsx,.csv"
                showUploadList={false}
                beforeUpload={(f) => void doImport(f as File)}
              >
                <Button type="primary" loading={importing}>
                  选择文件导入
                </Button>
              </Upload>
              <div style={{ fontSize: 12, color: 'var(--ds-ink3)', marginTop: 8 }}>
                表头：物料 / 供应商 / 单价 / 数量 / 日期（含税可选）· 物料供应商不在库会自动建 · 同一份重复导入不会翻倍
              </div>
              {imp && (
                <div style={{ marginTop: 10, fontSize: 13 }}>
                  <div>
                    新增 <b>{imp.imported}</b> 条 · 跳过重复 <b>{imp.skipped_duplicate}</b> 条
                    {imp.warning_count ? ` · 问题 ${imp.warning_count} 行` : ''}
                  </div>
                  {imp.created_items.length > 0 && (
                    <div>自动新建物料：{imp.created_items.slice(0, 5).join('、')}</div>
                  )}
                  {imp.created_suppliers.length > 0 && (
                    <div>自动新建供应商：{imp.created_suppliers.slice(0, 5).join('、')}</div>
                  )}
                  {imp.warnings.length > 0 && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ cursor: 'pointer' }}>问题行 {imp.warning_count} 行</summary>
                      <div style={{ maxHeight: 160, overflowY: 'auto', marginTop: 4 }}>
                        {imp.warnings.slice(0, 60).map((w, i) => (
                          <div key={i}>{w}</div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </Panel>
          )}

          <Panel
            title="价格台账（按物料聚合）"
            extra={
              <Space>
                <Input.Search
                  allowClear
                  placeholder="搜编码 / 品名 / 规格 / 品牌"
                  style={{ width: 220 }}
                  onSearch={(v) => {
                    setQ(v)
                    setPage(1)
                  }}
                />
                <span style={{ fontSize: 12, color: 'var(--ds-ink3)' }}>共 {data?.total ?? 0} 个料</span>
              </Space>
            }
          >
            <Table<PriceLibraryItem>
              rowKey="item_no"
              size="small"
              loading={loading}
              dataSource={data?.items ?? []}
              pagination={{
                current: page,
                pageSize: PAGE,
                total: data?.total ?? 0,
                showSizeChanger: false,
                onChange: (p) => setPage(p),
              }}
              locale={{ emptyText: <Empty text="没有价格记录" /> }}
              columns={[
                {
                  title: '物料',
                  key: 'item_no',
                  width: 132,
                  // ★ 图号不许折行（§3.1：编号是扫读的，折成两行就废）
                  render: (_, r) => (
                    <a onClick={() => void openItem(r.item_no)} style={{ whiteSpace: 'nowrap' }}>
                      <Code>{r.item_no}</Code>
                    </a>
                  ),
                },
                // ★ 与标准库同一套列（2026-10-07「两页统一标准」）：品名单独一列、
                //   **规格单独一列** —— 规格才是区分同名的字段（钢材 2517 条里品名只有 139 种）。
                { title: '品名', dataIndex: 'display_name', width: 200, ellipsis: true },
                {
                  title: '规格 · 型号',
                  key: 'spec',
                  render: (_, r) =>
                    r.spec_text ? (
                      <Tooltip title={r.spec_text}>
                        <span className="std-spec">{r.spec_text}</span>
                      </Tooltip>
                    ) : (
                      <span className="std-spec miss">未填规格</span>
                    ),
                },
                { title: '成交笔数', dataIndex: 'quote_count', width: 90 },
                {
                  title: '供应商数',
                  dataIndex: 'supplier_count',
                  width: 110,
                  render: (n: number, r) =>
                    r.recommendable ? (
                      <Status tone="ok">{n} 家</Status>
                    ) : r.comparable ? (
                      <Status tone="warn">{n} 家</Status>
                    ) : (
                      <Status tone="err">{n} 家</Status>
                    ),
                },
                { title: '均价', key: 'avg', width: 110, align: 'right', render: (_, r) => money(r.avg_price) },
                { title: '最近价', key: 'last', width: 110, align: 'right', render: (_, r) => money(r.last_price) },
                { title: '最近日期', dataIndex: 'last_date', width: 110 },
              ]}
              expandable={{
                expandedRowRender: (r) =>
                  detail?.item_no === r.item_no ? (
                    <div>
                      {detail.quotes.length === 0 && <Empty text="没有报价明细" />}
                      {detail.quotes.map((qt) => (
                        <div key={qt.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--ds-line)' }}>
                          <b>{qt.supplier_name}</b> · {money(qt.price)}
                          {qt.tax_incl ? '（含税）' : '（不含税）'} · {qt.quote_date} · {qt.price_type}
                          {qt.source ? ` · 来源 ${qt.source}` : ''}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span style={{ color: 'var(--ds-ink4)' }}>点物料名看明细</span>
                  ),
              }}
            />
          </Panel>

          <div style={{ fontSize: 12, color: 'var(--ds-ink3)', marginTop: 8 }}>
            「可放心推荐」= 有 ≥{stats?.thresholds.recommendable ?? 3} 家供过（与下单时的供应商推荐同一套阈值）。
            {stats && stats.no_spec_item_count > 0 && (
              <Tooltip title="这些料没有规格文本，下单时容易拿错">
                <span style={{ color: 'var(--ds-warn)', marginLeft: 12 }}>
                  {stats.no_spec_item_count} 个料没有规格文本
                </span>
              </Tooltip>
            )}
          </div>
        </div>
      </Space>
    </div>
  )
}
