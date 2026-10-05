import { App, Button, Spin } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { Chip, Code, Empty, NA, PageHead, Panel, QueueRow, Rail, Status, TimelineItem } from '../../components/ds'
import SectionNav from '../../components/ds/SectionNav'
import { EQUIPMENT_SECTIONS, defaultSectionKey } from '../../configs/sections'
import { useTab } from '../../hooks/useTab'
import { equipmentDossier, timeline, type EquipmentDossier, type TimelineRow } from '../../api/client'
import { errMsg } from '../../api/http'
import { useBack, useGoFrom } from '../../hooks/useFrom'
import { toneOf } from '../../theme/status'

/**
 * ★ 设备档案（R2 · 2026-10-04）—— 这台设备从设计到售后的全部历史。
 *
 * 这是 00 卷 §2.1 对**售后**的原话承诺：
 * 「对售后：扫设备二维码，这台设备全部历史（图纸版本/装配人/检验/发运/现场改动/维修）都在。」
 * （客户已定**不做二维码**，但"这个视图"本身仍然该存在 —— 售后今天要翻发运台+现场台+售后台三处。）
 *
 * 与"设计面"的分工（别互相抄）：
 *   · 设计面 = **在结构上干活**（建图、挂 BOM、提评审）→ 只属于设计这个环节
 *   · 设备档案 = **看这台设备的一生**（只读汇总 + 一键跳去对应台干活）
 */
export default function EquipmentDossierPage() {
  const { projectNo = '', equipNo = '' } = useParams()
  const { message } = App.useApp()
  const go = useGoFrom()
  const back = useBack(`/projects/${projectNo}`, '← 返回项目')
  const [d, setD] = useState<EquipmentDossier | null>(null)
  const [tl, setTl] = useState<TimelineRow[]>([])
  const [loading, setLoading] = useState(true)
  // ★ P2：页面分区进 URL（`?tab=`）—— 刷新/收藏/通知深链都在；默认区不写进 URL
  const [tab, setTab] = useTab(EQUIPMENT_SECTIONS.map((x) => x.key), defaultSectionKey(EQUIPMENT_SECTIONS))

  const load = useCallback(async () => {
    if (!projectNo || !equipNo) return
    setLoading(true)
    try {
      setD(await equipmentDossier(projectNo, equipNo))
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
    try {
      setTl((await timeline(equipNo, 60)).items)
    } catch {
      setTl([])
    }
  }, [projectNo, equipNo, message])

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
  if (!d) return <Empty text={`没有这台设备：${projectNo} ${equipNo}`} />

  const k = d.kitting
  const whole = d.assembly.find((a) => a.sub_assembly === '整机装配')
  const debugDone = d.assembly.some((a) => a.status === '调试完成')
  const shipped = d.shipments.length > 0
  const signed = d.shipments.some((s) => s.signed_at) || d.site_dailies.length > 0
  const serviced = d.service_orders.length > 0
  const rail = ([
    { key: 'design', name: '设计', value: `${Object.values(d.drawing_summary).reduce((a, b) => a + b, 0)} 张图`, state: d.bom_complete ? 'done' : 'now', onClick: () => go(`/projects/${projectNo}/design/${equipNo}`) },
    { key: 'kit', name: '齐套', value: k ? `${Math.round(k.rate * 100)}%` : '—', state: k && k.rate >= 1 ? 'done' : 'now' },
    { key: 'mfg', name: '制造', value: `${d.prod_orders.length} 张排产`, state: d.prod_orders.length && d.prod_orders.every((o) => o.status === '已转运') ? 'done' : 'now' },
    { key: 'assy', name: '装配', value: whole?.status ?? '未开始', state: whole && ['已装配', '调试中', '调试完成'].includes(whole.status) ? 'done' : 'now' },
    { key: 'ship', name: '发运', value: shipped ? `${d.shipments.length} 批` : '未发运', state: shipped ? 'done' : undefined },
    { key: 'site', name: '现场', value: d.site_dailies.length ? `${d.site_dailies.length} 次日汇报` : '未进场', state: d.site_dailies.length ? 'done' : undefined },
    { key: 'svc', name: '售后', value: serviced ? `${d.service_orders.length} 单` : '无工单', state: serviced ? 'now' : undefined },
  ] as const)

  // ── 分区内容（只搬位置，一行不删）──────────────────────────────────────
  const secOverview = (
    <>
{/* 生命周期轨道：这段可点，段里显示"到哪一步了" */}
      <div className="ds-panel" style={{ marginBottom: 16 }}>
        <div className="ds-panel-h">
          <h3>生命周期</h3>
          <span className="sub">点「设计」进设计面；其余段是只读汇总</span>
        </div>
        <Rail segments={rail} />
      </div>

{/* 缺件（齐套明细里的未到位项）—— 采购/仓库最常问的一句 */}
      {!!k?.missing?.length && (
        <Panel title={`还缺 ${k.missing.length} 项`} sub="齐套口径：自制件已转运 / 外协合格 / 采购已到或库存够" bodyStyle={{ padding: 0 }}>
          {k.missing.map((m) => (
            <QueueRow
              key={m.ref}
              lead={<Chip tone="err">{m.state ?? '未到'}</Chip>}
              title={m.name ?? m.ref}
              meta={<><Code>{m.ref}</Code> · 需要 {m.qty ?? '—'}</>}
              onClick={() => go(`/items/${m.ref}`)}
            />
          ))}
        </Panel>
      )}
    </>
  )
  const secDrawing = (
    <>
{/* 图纸与关键件 */}
      <Panel
        title="图纸与关键件"
        sub={`${d.drawings.length} 个自制 / 定制 / 外协件${d.root_drawing_no ? ` · 总装图 ${d.root_drawing_no}` : ''}`}
        help="图号 = 物料号：点任一图号看这个件的采购/领料/排产/发运/售后全链。"
        bodyStyle={{ padding: 0 }}
      >
        {d.drawings.length === 0 && <Empty text="还没有图纸。" />}
        {d.drawings.map((dr) => (
          <QueueRow
            key={dr.drawing_no}
            lead={<Code to={`/items/${dr.drawing_no}`}>{dr.drawing_no}</Code>}
            title={dr.title ?? dr.drawing_no}
            meta={<>{dr.source_type ?? ''} · ×{dr.qty} {dr.unit ?? ''}{dr.owner ? ` · 设计 ${dr.owner}` : ''}{dr.has_current_file ? '' : ' · 无文件'}</>}
            cells={[
              { text: dr.version ?? NA },
              { text: <Status tone={toneOf(DO_STATUS[dr.status])}>{dr.status}</Status> },
            ]}
          />
        ))}
      </Panel>
    </>
  )
  const secMfg = (
    <>
{/* 制造 / 外协 */}
      {(d.prod_orders.length > 0 || d.outsource.length > 0) && (
        <Panel title="制造与外协" sub="排产进度与外协回厂" bodyStyle={{ padding: 0 }} extra={
          <Button size="small" onClick={() => go('/workbench/shop/mfg')}>去车间台</Button>
        }>
          {d.prod_orders.map((o) => (
            <QueueRow
              key={o.order_no}
              lead={<Code>{o.order_no}</Code>}
              title={o.item_name ?? o.item_no}
              meta={<>{o.team ?? ''} · 计划完工 {o.plan_end ?? '—'}</>}
              cells={[{ text: <Status tone={toneOf(PROD_TONE[o.status])}>{o.status}</Status> }]}
              onClick={() => go(`/items/${o.item_no}`)}
            />
          ))}
          {d.outsource.map((o) => (
            <QueueRow
              key={o.outsource_no}
              lead={<Code>{o.outsource_no}</Code>}
              title={`${o.item_name ?? o.item_no}${o.supplier ? ` · ${o.supplier}` : ''}`}
              meta={<>约定回厂 {o.due_date ?? '—'}</>}
              cells={[{ text: <Status tone={toneOf(OS_TONE[o.status])}>{o.status}</Status> }]}
              onClick={() => go(`/items/${o.item_no}`)}
            />
          ))}
        </Panel>
      )}
    </>
  )
  const secAssy = (
    <>
{/* 装配与厂内调试 */}
      {!!d.assembly.length && (
        <Panel title="装配与厂内调试" sub="整机装配 / 组件预装分开记（大件的两段式）" bodyStyle={{ padding: 0 }}>
          {d.assembly.map((a) => (
            <QueueRow
              key={a.id}
              lead={<Chip tone={a.sub_assembly === '整机装配' ? 'acc' : undefined}>{a.sub_assembly}</Chip>}
              title={`开工齐套 ${Math.round((a.kitting_rate ?? 0) * 100)}%${a.assembled_by ? ` · ${a.assembled_by}` : ''}`}
              meta={
                <>
                  {a.assembled_at ? `装配完成 ${a.assembled_at.slice(0, 10)}` : '装配中'}
                  {a.debug_result ? ` · 厂内调试 ${a.debug_result}${a.debug_note ? `（${a.debug_note}）` : ''}` : ''}
                  {a.unassembled?.length ? ` · 未装 ${a.unassembled.length} 项` : ''}
                  {a.photos ? ` · 照片 ${a.photos}` : ''}
                </>
              }
              cells={[{ text: <Status tone={toneOf(ASSY_TONE[a.status])}>{a.status}</Status> }]}
            />
          ))}
        </Panel>
      )}
    </>
  )
  const secShip = (
    <>
{/* 发运与现场清点 */}
      {!!d.shipments.length && (
        <Panel title="发运与现场清点" sub="每批发了多少项、现场点出多少缺/损" bodyStyle={{ padding: 0 }} extra={
          <Button size="small" onClick={() => go('/delivery/shipping')}>去发运台</Button>
        }>
          {d.shipments.map((s) => (
            <QueueRow
              key={s.shipment_no}
              lead={<Code>{s.shipment_no}</Code>}
              title={`已发 ${s.shipped}/${s.items} 项${s.short ? ` · 现场缺/损 ${s.short}` : ''}`}
              meta={
                <>
                  {s.plan_ship_date ? `发货日 ${s.plan_ship_date}` : ''}
                  {s.depart_at ? ` · 发运 ${s.depart_at.slice(0, 10)}` : ''}
                  {s.arrive_at ? ` · 到货 ${s.arrive_at.slice(0, 10)}` : ''}
                  {s.signed_at ? ` · 签收 ${s.signed_at.slice(0, 10)}` : ''}
                  {s.checked ? ` · 已清点 ${s.checked} 项` : ''}
                </>
              }
              cells={[{ text: <Status tone={toneOf(SHIP_TONE[s.status])}>{s.status}</Status> }]}
            />
          ))}
        </Panel>
      )}
    </>
  )
  const secSite = (
    <>
{/* 现场：勘测 / 日报 / 问题 / 调试 */}
      {(d.site_surveys.length > 0 || d.site_dailies.length > 0 || d.site_issues.length > 0 || d.site_commissions.length > 0) && (
        <Panel title="现场" sub="进场条件、每日汇报、现场问题、调试申请" bodyStyle={{ padding: 0 }} extra={
          <Button size="small" onClick={() => go('/delivery/site')}>去现场台</Button>
        }>
          {d.site_surveys.map((s, i) => (
            <QueueRow
              key={`sv-${i}`}
              lead={<Chip>勘测</Chip>}
              title={`约定入场 ${s.enter_date ?? '待定'}`}
              meta={<>{s.contact ? `甲方 ${s.contact}` : ''}{s.floor_load ? ` · 承重 ${s.floor_load}` : ''}{s.passage ? ` · 通道 ${s.passage}` : ''}{s.power ? ` · 电 ${s.power}` : ''}</>}
            />
          ))}
          {d.site_commissions.map((c, i) => (
            <QueueRow
              key={`cm-${i}`}
              lead={<Chip>调试</Chip>}
              title={`${c.status}${c.dispatch_to ? ` · ${c.dispatch_to}` : ''}`}
              meta={<>计划到场 {c.plan_date ?? '—'}{c.arrived_at ? ` · 实际到场 ${c.arrived_at.slice(0, 10)}` : ''}</>}
              cells={[{ text: <Status tone={toneOf(COMMISSION_TONE[c.status])}>{c.status}</Status> }]}
            />
          ))}
          {d.site_issues.map((s, i) => (
            <QueueRow
              key={`is-${i}`}
              lead={<Chip>现场问题</Chip>}
              title={s.title}
              meta={s.desc ?? ''}
              cells={[{ text: <Status tone={toneOf(SITE_ISSUE_TONE[s.status])}>{s.status}</Status> }]}
            />
          ))}
          {d.site_dailies.map((x, i) => (
            <QueueRow
              key={`dl-${i}`}
              lead={<Chip>{x.stage}</Chip>}
              title={`${x.report_date ?? ''}${x.people != null ? ` · 现场 ${x.people} 人` : ''}`}
              meta={<>{x.done} 项完成{x.photos ? ` · 照片 ${x.photos}` : ''}{x.videos ? ` · 视频 ${x.videos}` : ''}{x.problem ? ` · 问题：${x.problem}` : ''}</>}
              cells={[{ text: x.problem ? <Status tone="err">有问题</Status> : <Status tone="ok">正常</Status> }]}
            />
          ))}
        </Panel>
      )}
    </>
  )
  const secSvc = (
    <>
{/* 售后 */}
      <Panel
        title="售后与质保"
        sub={d.service_orders.length ? `${d.service_orders.length} 张工单` : '没有服务工单'}
        bodyStyle={{ padding: d.service_orders.length ? 0 : undefined }}
        extra={<Button size="small" onClick={() => go('/delivery/service')}>去售后台</Button>}
      >
        {d.service_orders.length === 0 ? (
          <Empty text="这台设备还没有报修记录。客户报修后工单会出现在这里（自动判定在保 / 过保）。" />
        ) : (
          d.service_orders.map((o) => (
            <QueueRow
              key={o.so_no}
              lead={<Code>{o.so_no}</Code>}
              title={o.fault ?? '（无故障描述）'}
              meta={<>{o.in_warranty ? '在保' : '过保'}{o.dispatched_to ? ` · 派 ${o.dispatched_to}` : ''}{o.reported_at ? ` · 报修 ${o.reported_at.slice(0, 10)}` : ''}{o.fixed_at ? ` · 完成 ${o.fixed_at.slice(0, 10)}` : ''}{o.labor_hours ? ` · 工时 ${o.labor_hours}h` : ''}{o.customer_sign ? ` · 客户签字 ${o.customer_sign}` : ''}</>}
              cells={[{ text: <Status tone={toneOf(SO_TONE[o.status])}>{o.status}</Status> }]}
            />
          ))
        )}
      </Panel>
    </>
  )
  const secTimeline = (
    <>
{/* 时间线 */}
      <Panel title="时间线" sub={`${tl.length} 条 · 以审计日志为准（谁改了这台设备的什么）`}>
        {tl.length === 0 ? (
          <Empty text="还没有操作记录。" />
        ) : (
          <div className="ds-tl">
            {tl.slice(0, 30).map((r) => (
              <TimelineItem key={r.id} tone={r.action.includes('delete') ? 'err' : undefined} title={<><b>{r.who ?? '系统'}</b> {r.summary ?? r.action}</>} time={<>{r.at ? r.at.replace('T', ' ').slice(0, 16) : ''} · {r.action}</>} />
            ))}
          </div>
        )}
      </Panel>
    </>
  )

  return (
    <div className="ds-page">
      <PageHead
        crumb={
          <>
            <a onClick={() => go(back.hasFrom ? back.to : `/projects/${projectNo}`)}>{back.label}</a>
            <span style={{ color: 'var(--ds-line2)', margin: '0 8px' }}>/</span>
            <Code to={`/projects/${projectNo}`}>{projectNo}</Code> / <Code>{equipNo}</Code>
          </>
        }
        title={d.equip_name}
        sub={
          <>
            {d.project_name ?? projectNo}
            {d.kind ? ` · ${d.kind}` : ''}
            {d.model ? ` · 型号 ${d.model}` : ''}
            {d.line_no ? ` · 线体 ${d.line_no}` : ''}
          </>
        }
        help="这台设备的一生（只读汇总）：设计 → 齐套 → 制造 → 装配调试 → 发运 → 现场 → 售后。要干活请点进对应的工作台。"
        actions={
          <>
            {d.bom_complete ? <Chip tone="ok">BOM 完整</Chip> : <Chip tone="warn">BOM 未完整</Chip>}
            <Button size="small" onClick={() => go(`/projects/${projectNo}/design/${equipNo}`)}>
              进设计面
            </Button>
            <Button size="small" onClick={() => void load()}>
              刷新
            </Button>
          </>
        }
      />
      {/* ── 常驻区（切分区不动）：关键数字 + 卡点 ─────────────────────────
          跨区对比靠它：切到「发运」也还看得到齐套率与卡点，不会"看了一区忘了全局" */}
{/* 关键数字 + 卡点一句话 */}
      <div className="ds-panel" style={{ marginBottom: 16 }}>
        <div className="ds-panel-b">
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span><span className="ds-sub">齐套率</span> <b className="ds-num" style={{ fontSize: 20 }}>{k ? `${Math.round(k.rate * 100)}%` : '—'}</b> <span className="ds-sub">{k ? `${k.arrived}/${k.total} 种` : ''}</span></span>
            <span><span className="ds-sub">图纸</span> <b className="ds-num" style={{ fontSize: 20 }}>{Object.values(d.drawing_summary).reduce((a, b) => a + b, 0)}</b> <span className="ds-sub">{Object.entries(d.drawing_summary).map(([s, n]) => `${s} ${n}`).join(' · ')}</span></span>
            <span><span className="ds-sub">排产</span> <b className="ds-num" style={{ fontSize: 20 }}>{d.prod_orders.length}</b></span>
            <span><span className="ds-sub">外协</span> <b className="ds-num" style={{ fontSize: 20 }}>{d.outsource.length}</b></span>
            <span><span className="ds-sub">发运</span> <b className="ds-num" style={{ fontSize: 20 }}>{d.shipments.length}</b></span>
            <span><span className="ds-sub">售后</span> <b className="ds-num" style={{ fontSize: 20 }}>{d.service_orders.length}</b></span>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {d.blocked.length === 0 ? (
              <Status tone="ok">没有卡点{debugDone ? ' · 厂内调试已完成' : ''}{signed ? ' · 现场在推进' : ''}</Status>
            ) : (
              d.blocked.map((b) => <Chip key={b} tone="err">{b}</Chip>)
            )}
          </div>
        </div>
      </div>

      {/* ── 分区：一页多区、横向切（docs/14）。内容一块没删，只改了摆放 ── */}
      <SectionNav
        tab={tab}
        onTab={setTab}
        emptyText="这一区还没有记录。"
        sections={[
          { key: 'overview', label: '概览', badge: k?.missing?.length, children: secOverview },
          { key: 'drawing', label: '图纸', badge: d.drawings.length, children: secDrawing },
          { key: 'mfg', label: '制造', badge: d.prod_orders.length + d.outsource.length, children: secMfg },
          { key: 'assy', label: '装配', badge: d.assembly.length, children: secAssy },
          { key: 'ship', label: '发运', badge: d.shipments.length, children: secShip },
          { key: 'site', label: '现场', badge: d.site_dailies.length + d.site_issues.length, children: secSite },
          { key: 'svc', label: '售后', badge: d.service_orders.length, children: secSvc },
          { key: 'timeline', label: '时间线', children: secTimeline },
        ]}
      />
    </div>
  )
}
const DO_STATUS: Record<string, string> = { 草稿: 'default', 审核中: 'processing', 已发布: 'success', 已作废: 'default' }
const PROD_TONE: Record<string, string> = { 待领料: 'default', 已派工: 'processing', 制造中: 'processing', 完工待验收: 'gold', 已转运: 'success', 返工: 'error' }
const OS_TONE: Record<string, string> = { 待发出: 'default', 外协中: 'processing', 回厂待检: 'gold', 合格: 'success', 已取消: 'default' }
const ASSY_TONE: Record<string, string> = { 装配中: 'processing', 已装配: 'gold', 调试中: 'gold', 调试完成: 'success' }
const SHIP_TONE: Record<string, string> = { 已指令: 'default', 发货中: 'processing', 已装车: 'cyan', 在途: 'processing', 已到货: 'blue', 已签收: 'success' }
const SITE_ISSUE_TONE: Record<string, string> = { 待处理: 'error', 已转变更: 'processing', 已闭环: 'success' }
const COMMISSION_TONE: Record<string, string> = { 已申请: 'gold', 已到现场: 'processing', 已开始调试: 'processing', 调试完成: 'success' }
const SO_TONE: Record<string, string> = { 待受理: 'error', 已派工: 'processing', 已到场: 'gold', 待客户签字: 'cyan', 已关闭: 'success' }
