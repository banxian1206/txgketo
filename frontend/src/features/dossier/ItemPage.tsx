import { App, Button, Spin, Table } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { Chip, Code, Empty, NA, PageHead, Panel, QueueRow, Status, type Tone } from '../../components/ds'
import SectionNav from '../../components/ds/SectionNav'
import { ITEM_SECTIONS, defaultSectionKey } from '../../configs/sections'
import { useTab } from '../../hooks/useTab'
import { itemDossier, timeline, type ItemDossier, type TimelineRow } from '../../api/client'
import { errMsg } from '../../api/http'
import { useBack, useGoFrom } from '../../hooks/useFrom'
import { toneOf } from '../../theme/status'

/**
 * ★ 件档案（R2 · 2026-10-04）—— 一个图号 / 物料号的一生。
 *
 * 00 卷 §2.1 对售后承诺过「这台设备全部历史都在」，对采购/仓库承诺过「知道**哪台设备的哪个件**还没到」，
 * 但系统里从来没有一个地方按「件」把这些串起来：图纸在设计面、需求在采购台、领料在仓库台、
 * 排产在车间台、发运在发运台、现场问题在现场台、售后在售后台 —— 点一次要换六个地方。
 *
 * 这个页面把**同一个 `item_no` 的全部单据与状态**按发生顺序收在一屏，回答三件事：
 *   ① 它现在在哪、卡在谁手上（`blocked`）
 *   ② 它的一生（设计 → 需求 → 采购 → 到货 → 库存/领料 → 排产/外协 → 装配 → 发运 → 现场 → 售后）
 *   ③ 谁改过它（时间线 = audit_log）
 *
 * 铁律 2：图号 = 物料号 → 图号与物料号共用这一张页（后端同一个端点）。
 */
export default function ItemDossierPage() {
  const { itemNo = '' } = useParams()
  const { message } = App.useApp()
  const go = useGoFrom()
  const back = useBack('/projects', '← 返回')
  const [d, setD] = useState<ItemDossier | null>(null)
  const [tl, setTl] = useState<TimelineRow[]>([])
  // ★ P2：分区进 URL（`?tab=`）
  const [tab, setTab] = useTab(ITEM_SECTIONS.map((x) => x.key), defaultSectionKey(ITEM_SECTIONS))
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!itemNo) return
    setLoading(true)
    try {
      setD(await itemDossier(itemNo))
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
    try {
      setTl((await timeline(itemNo, 50)).items)
    } catch {
      setTl([])
    }
  }, [itemNo, message])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin />
      </div>
    )
  }
  if (!d) {
    return <Empty text={`没有这个物料 / 图号：${itemNo}`} />
  }

  const c = d.counts

  // ── 分区内容（只搬位置，一行不删）──────────────────────────────────────
  const secStructure = (
    <>
{/* ① 结构：父件 / 子件 / 材料 */}
      {(d.parents.length > 0 || d.children.length > 0 || d.bom_rows.length > 0) && (
        <Panel title="结构" sub="它在整机里的位置（图号自带层次：父级由层次码推导）" bodyStyle={{ padding: 0 }}>
          {d.parents.map((p) => (
            <QueueRow
              key={p.drawing_no}
              lead={<Chip>父件</Chip>}
              title={p.title ?? p.drawing_no}
              meta={<Code>{p.drawing_no}</Code>}
              onClick={() => go(`/items/${p.drawing_no}`)}
            />
          ))}
          {d.children.map((ch) => (
            <QueueRow
              key={ch.drawing_no}
              lead={<Chip>子件</Chip>}
              title={ch.title ?? ch.drawing_no}
              meta={<><Code>{ch.drawing_no}</Code> · ×{ch.qty}</>}
              cells={[{ text: <Status tone={toneOf(DO_STATUS[ch.status])}>{ch.status}</Status> }]}
              onClick={() => go(`/items/${ch.drawing_no}`)}
            />
          ))}
          {d.bom_rows.map((b, i) => (
            <QueueRow
              key={`${b.parent_ref}-${i}`}
              lead={<Chip>{b.kind === 'MATERIAL' ? '材料' : '标准件'}</Chip>}
              title={<>挂在 <Code>{b.parent_ref}</Code> 下</>}
              meta={`用量 ×${b.qty}${b.superseded ? ' · 已被改版替代' : ''}`}
              cells={[{ text: b.superseded ? '已替代' : b.status, tone: b.superseded ? 'idle' : (toneOf(DO_STATUS[b.status]) as Tone) }]}
              onClick={() => go(`/items/${b.parent_ref}`)}
            />
          ))}
        </Panel>
      )}
    </>
  )
  const secPurchase = (
    <>
{/* ② 采购：需求 → 采购单 → 到货 */}
      <Panel
        title="采购与到货"
        sub={c.requests ? `${c.requests} 条需求 · ${c.receipts} 张到货单` : '没有采购记录'}
        help="一条需求（进池/下单/在途/验收）→ 采购单 → 到货单（分批）→ 入库库位。直发的货在「现场已验收」。"
        bodyStyle={{ padding: c.requests ? '16px 0 0' : undefined }}
      >
        {!c.requests && !c.receipts && <Empty text="这个件没有采购记录（库存件 / 自制件都可能没有）。" />}
        {!!c.requests && (
          <Table
            rowKey="id"
            size="small"
            pagination={{ pageSize: 10, showSizeChanger: false }}
            dataSource={d.requests}
            columns={[
              { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Status tone={toneOf(REQ_TONE[v])}>{v}</Status> },
              { title: '采购单', dataIndex: 'po_no', width: 120, render: (v: string | null) => (v ? <Code>{v}</Code> : NA) },
              { title: '数量', dataIndex: 'qty', width: 90, render: (v: number, r) => <span className="ds-num">{v} {r.unit ?? ''}</span> },
              { title: '供应商', dataIndex: 'supplier', width: 130, render: (v: string | null) => v || NA },
              { title: '单价', dataIndex: 'unit_price', width: 100, render: (v: number | null) => (v == null ? NA : <span className="ds-num">¥{v.toLocaleString()}</span>) },
              { title: '需要 / 预计', key: 'd', width: 190, render: (_: unknown, r) => <><Code>{r.need_date ?? '—'}</Code> → <Code>{r.expected_date ?? '—'}</Code></> },
              { title: '收货', dataIndex: 'deliver_to', width: 110, render: (v: string | null) => v || NA },
              { title: '来源', dataIndex: 'source', width: 90, render: (v: string | null) => v || NA },
              { title: '零件归属', dataIndex: 'part_no', width: 200, render: (v: string | null) => (v ? <a onClick={() => go(`/items/${v}`)}><Code>{v}</Code></a> : NA) },
            ]}
          />
        )}
        {!!d.receipts.length && (
          <div style={{ marginTop: 12 }}>
            <div className="ds-q-group"><span className="bar" />到货单（{d.receipts.length}）</div>
            {d.receipts.map((g) => (
              <QueueRow
                key={g.receipt_no}
                lead={<Code>{g.receipt_no}</Code>}
                title={`${g.qty} ${g.unit ?? ''}`}
                meta={<>{g.receipt_date ?? ''}{g.location ? ` · 库位 ${g.location}` : ''}{g.photos ? ` · 照片 ${g.photos} 张` : ''}{g.inspect_note ? ` · ${g.inspect_note}` : ''}</>}
                cells={[{ text: <Status tone={toneOf(RECEIPT_TONE[g.status])}>{g.status}</Status> }]}
              />
            ))}
          </div>
        )}
      </Panel>
    </>
  )
  const secStock = (
    <>
{/* ③ 库存与领料 */}
      {(d.stock.length > 0 || d.issues.length > 0) && (
        <Panel title="库存与领料" sub="现在还有多少、被哪张领料单领走" bodyStyle={{ padding: 0 }}>
          {d.stock.map((s, i) => (
            <QueueRow
              key={`st-${i}`}
              lead={<Chip tone="ok">库存</Chip>}
              title={`现存 ${s.qty_on_hand}${s.qty_locked ? ` · 已备料占用 ${s.qty_locked}` : ''}`}
              meta={s.batch_no ? `批次 ${s.batch_no}` : undefined}
            />
          ))}
          {d.issues.map((ln, i) => (
            <QueueRow
              key={`mi-${i}`}
              lead={<Code>{ln.issue_no}</Code>}
              title={`应领 ${ln.qty_required} · 已备 ${ln.qty_picked} · 已领 ${ln.qty_issued}`}
              meta={<>{ln.project_no} {ln.equip_no ?? ''}{ln.for_part ? <> · 给零件 <Code>{ln.for_part}</Code></> : null}{ln.issued_to ? ` · 领料人 ${ln.issued_to}` : ''}</>}
              cells={[{ text: <Status tone={ln.shortage ? 'warn' : toneOf(ISSUE_TONE[ln.status])}>{ln.shortage ? `${ln.status}（缺料）` : ln.status}</Status> }]}
            />
          ))}
        </Panel>
      )}
    </>
  )
  const secMfg = (
    <>
{/* ④ 制造与外协 */}
      {(d.prod_orders.length > 0 || d.outsource.length > 0 || d.prod_tasks.length > 0) && (
        <Panel title="制造与外协" sub="排产单、按哪版图干活、发出去加工" bodyStyle={{ padding: 0 }}>
          {d.prod_orders.map((o) => (
            <QueueRow
              key={o.order_no}
              lead={<Code>{o.order_no}</Code>}
              title={`${o.qty} 件${o.team ? ` · ${o.team}` : ''}`}
              meta={<>计划 {o.plan_start ?? '—'} → {o.plan_end ?? '—'}{o.project_no ? ` · ${o.project_no} ${o.equip_no ?? ''}` : ''}</>}
              cells={[{ text: <Status tone={o.overdue ? 'err' : toneOf(PROD_TONE[o.status])}>{o.overdue ? `${o.status}（超期）` : o.status}</Status> }]}
            />
          ))}
          {d.prod_tasks.map((t, i) => (
            <QueueRow
              key={`pt-${i}`}
              lead={<Chip>派工</Chip>}
              title={`${t.step_name}${t.issued_to ? ` → ${t.issued_to}` : ''}`}
              meta={<>{t.drawing_no ? <>按 <Code>{t.drawing_no}</Code> {t.drawing_version}</> : ''}{t.material_item_no ? ` · 料 ${t.material_item_no} ×${t.material_qty ?? ''}` : ''}{t.photos ? ` · 照片 ${t.photos}` : ''}</>}
              onClick={t.drawing_no ? () => go(`/items/${t.drawing_no}`) : undefined}
            />
          ))}
          {d.outsource.map((o) => (
            <QueueRow
              key={o.outsource_no}
              lead={<Code>{o.outsource_no}</Code>}
              title={`${o.qty} 件${o.supplier ? ` · ${o.supplier}` : ''}`}
              meta={<>发出 {o.sent_at ?? '—'} · 约定回厂 {o.due_date ?? '—'}{o.returned_at ? ` · 已回厂 ${o.returned_at}` : ''}{o.material_supplied ? ' · 我方供料' : ''}</>}
              cells={[{ text: <Status tone={toneOf(OS_TONE[o.status])}>{o.status}</Status> }]}
            />
          ))}
        </Panel>
      )}
    </>
  )
  const secDelivery = (
    <>
{/* ⑤ 装配 / 发运 / 现场 / 售后 */}
      {(d.assembly.length > 0 || d.shipments.length > 0 || d.site_issues.length > 0 || d.spare_parts.length > 0) && (
        <Panel title="装配 → 发运 → 现场 → 售后" sub="这个件到了客户那边之后的记录" bodyStyle={{ padding: 0 }}>
          {d.assembly.map((a, i) => (
            <QueueRow
              key={`as-${i}`}
              lead={<Chip>装配</Chip>}
              title={`${a.equip_no} · ${a.sub_assembly}`}
              meta={<>开工齐套 {Math.round((a.kitting_rate ?? 0) * 100)}%{a.assembled_at ? ` · ${a.assembled_at.slice(0, 10)}` : ''}{a.assembled_by ? ` · ${a.assembled_by}` : ''}{a.debug_result ? ` · 调试 ${a.debug_result}` : ''}</>}
              cells={[{ text: <Status tone={toneOf(ASSY_TONE[a.status])}>{a.status}</Status> }]}
            />
          ))}
          {d.shipments.map((s, i) => (
            <QueueRow
              key={`sh-${i}`}
              lead={<Code>{s.shipment_no}</Code>}
              title={`${s.kind} ×${s.qty}`}
              meta={<>{s.equip_no}{s.shipped_at ? ` · 已发 ${s.shipped_at.slice(0, 10)}` : ''}{s.check_result ? ` · 现场清点：${s.check_result}${s.check_note ? `（${s.check_note}）` : ''}` : ''}</>}
              cells={[{ text: <Status tone={s.shipped ? 'ok' : 'idle'}>{s.shipped ? '已发' : '未发'}</Status>, tone: s.check_result === '缺' || s.check_result === '损' ? 'err' : undefined }]}
            />
          ))}
          {d.site_issues.map((s, i) => (
            <QueueRow
              key={`si-${i}`}
              lead={<Chip>现场问题</Chip>}
              title={s.title}
              meta={<>{s.project_no} {s.equip_no ?? ''}{s.desc ? ` · ${s.desc}` : ''}</>}
              cells={[{ text: <Status tone={toneOf(SITE_ISSUE_TONE[s.status])}>{s.status}</Status> }]}
            />
          ))}
          {d.spare_parts.map((sp, i) => (
            <QueueRow
              key={`sp-${i}`}
              lead={<Chip>备件</Chip>}
              title={`装机 ${sp.qty_installed} · 备件库 ${sp.qty_stock}`}
              meta={<>{sp.project_no} {sp.equip_no ?? ''} · 安全库存 {sp.min_qty}</>}
              cells={[{ text: sp.qty_stock < sp.min_qty ? <Status tone="warn">低于安全库存</Status> : <Status tone="ok">充足</Status> }]}
            />
          ))}
        </Panel>
      )}
    </>
  )
  const secChange = (
    <>
{/* ⑥ 改版 */}
      {!!d.changes.length && (
        <Panel title="改版记录" sub="一切改动都是变更（客户原则）" bodyStyle={{ padding: 0 }}>
          {d.changes.map((cr) => (
            <QueueRow
              key={cr.cr_no}
              lead={<Code>{cr.cr_no}</Code>}
              title={cr.reason ?? '改版申请'}
              meta={<>{cr.target_type} {cr.target_ref}{cr.target_version ? ` · ${cr.target_version}` : ''}{cr.applicant ? ` · 申请人 ${cr.applicant}` : ''}{cr.decided_by ? ` · 裁决 ${cr.decided_by}` : ''}</>}
              cells={[{ text: <Status tone={toneOf(CR_TONE[cr.status])}>{cr.status}</Status> }]}
            />
          ))}
        </Panel>
      )}
    </>
  )
  const secTimeline = (
    <>
{/* ⑦ 时间线：谁在什么时候改过它 */}
      <Panel title="时间线" sub={`${tl.length} 条操作记录（以审计日志为准）`} bodyStyle={{ padding: tl.length ? '4px 16px 12px' : undefined }}>
        {tl.length === 0 ? (
          <Empty text="还没有操作记录。" />
        ) : (
          <div className="ds-tl">
            {tl.slice(0, 30).map((r) => (
              <div className={`ds-tl-i${r.action.includes('delete') ? ' is-err' : ''}`} key={r.id}>
                <span className="pt" />
                <div>
                  <div className="tx">
                    <b>{r.who ?? '系统'}</b> {r.summary ?? r.action}
                  </div>
                  <div className="tm">{r.at ? r.at.replace('T', ' ').slice(0, 16) : ''} · {r.action} · {r.object_type ?? ''}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div style={{ marginTop: 16 }}>
        <Button onClick={() => void load()}>刷新</Button>
      </div>
    </>
  )

  return (
    <div className="ds-page">
      <PageHead
        crumb={
          <>
            <a onClick={() => go(back.hasFrom ? back.to : '/projects')}>{back.label}</a>
          </>
        }
        title={d.display_name}
        sub={
          <>
            <Code>{d.item_no}</Code>
            {d.spec_text ? ` · ${d.spec_text}` : ''}
            {d.brand ? ` · ${d.brand}` : ''}
            {d.project_no ? ` · ${d.project_no} ${d.equip_no ?? ''}` : ''}
          </>
        }
        help="一个件的一生：设计 → 需求 → 采购 → 到货/入库 → 领料 → 排产/外协 → 装配 → 发运 → 现场 → 售后。图号 = 物料号，共用这一页。"
        actions={
          <>
            {/* ★ 入口（2026-10-05）：件的"上一级"是设备 —— 双向可达，避免点进一个件回不去 */}
            {d.project_no && d.equip_no && (
              <Button
                size="small"
                onClick={() => go(`/equipment/${d.project_no}/${d.equip_no}`)}
                title="看这台设备的一生"
              >
                所在设备 {d.equip_no}
              </Button>
            )}
            {d.project_no && (
              <Button size="small" onClick={() => go(`/projects/${d.project_no}`)}>
                所属项目
              </Button>
            )}
            <Chip>{d.kind}</Chip>
            {d.source_type && <Chip>{d.source_type}</Chip>}
            {d.drawings[0]?.status && <Status tone={toneOf(DO_STATUS[d.drawings[0].status])}>{d.drawings[0].status}</Status>}
          </>
        }
      />

      {/* ── 常驻区（切分区不动）：结论条 = 现在卡在这 ─────────────────────
          这是设计/采购/PM 最想知道的一句，切到任何分区都该看得见 */}
{/* 结论条：卡点（这是设计/采购/PM 最想知道的一句） */}
      {d.blocked.length > 0 ? (
        <div className="ds-panel" style={{ marginBottom: 16 }}>
          <div className="ds-panel-h">
            <h3>现在卡在这</h3>
            <span className="sub">按单据追下去就能找到人</span>
          </div>
          <div className="ds-panel-b">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {d.blocked.map((b) => (
                <Chip key={b} tone="err">{b}</Chip>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="ds-panel" style={{ marginBottom: 16 }}>
          <div className="ds-panel-b">
            <Status tone="ok">没有卡点 —— 这个件当前没有未完成的采购 / 排产 / 外协 / 现场 / 售后事项</Status>
          </div>
        </div>
      )}

      {/* ── 分区：一页多区、横向切（docs/14）── */}
      <SectionNav
        tab={tab}
        onTab={setTab}
        emptyText="这个件在这一环还没有记录。"
        sections={[
          { key: 'overview', label: '概览', badge: d.blocked.length, children: secStructure },
          { key: 'purchase', label: '采购与到货', badge: d.counts.requests, children: secPurchase },
          { key: 'stock', label: '库存与领料', badge: d.stock.length + d.issues.length, children: secStock },
          { key: 'mfg', label: '制造与外协', badge: d.prod_orders.length + d.outsource.length, children: secMfg },
          { key: 'delivery', label: '交付与售后', badge: d.shipments.length, children: secDelivery },
          { key: 'change', label: '改版与时间线', badge: d.changes.length, children: <>{secChange}{secTimeline}</> },
        ]}
      />
    </div>
  )
}


/* ── 状态色 → A 的 tone（沿用 theme/status 的预设名，一处翻译）── */
const DO_STATUS: Record<string, string> = {
  草稿: 'default', 审核中: 'processing', 已发布: 'success', 已作废: 'default', 已冻结: 'success',
}
const REQ_TONE: Record<string, string> = {
  待采购: 'default', 在途: 'processing', 部分到货: 'processing', 待入库: 'gold',
  已入库: 'success', 现场已验收: 'success', 不合格: 'error', 已退货: 'default', 已取消: 'default',
  现场待验收: 'gold',
}
const RECEIPT_TONE: Record<string, string> = {
  待入库: 'processing', 已入库: 'success', 现场已验收: 'success', 不合格: 'error', 已换货: 'gold', 已退货: 'default', 现场待验收: 'gold',
}
const ISSUE_TONE: Record<string, string> = { 待备料: 'gold', 已备料: 'processing', 部分领料: 'gold', 已领走: 'success', 已取消: 'default' }
const PROD_TONE: Record<string, string> = { 待领料: 'default', 已派工: 'processing', 制造中: 'processing', 完工待验收: 'gold', 已转运: 'success', 返工: 'error' }
const OS_TONE: Record<string, string> = { 待发出: 'default', 外协中: 'processing', 回厂待检: 'gold', 合格: 'success', 已取消: 'default' }
const ASSY_TONE: Record<string, string> = { 装配中: 'processing', 已装配: 'gold', 调试中: 'gold', 调试完成: 'success' }
const SITE_ISSUE_TONE: Record<string, string> = { 待处理: 'error', 已转变更: 'processing', 已闭环: 'success' }
const CR_TONE: Record<string, string> = { 待裁决: 'processing', 已批准: 'processing', 已否决: 'error', 已下发: 'gold', 已完成: 'success', 已归档: 'default' }
