import { Button, Dropdown } from 'antd'
import { Link } from 'react-router-dom'
import { hasPerm } from '../../api/user'
import { Chip, Metrics, PageHead, Rail, Status, type MetricItem } from '../ds'
import { useBack, useGoFrom } from '../../hooks/useFrom'
import { PROJECT_STAGE as STAGE_COLOR, toneOf } from '../../theme/status'

/**
 * 详情页「结论条」（docs/12 §3.1 ①；方案 A「纸面」2026-10-04 重做）。
 *
 * 固定回答四件事：**在哪 / 下一步(可点) / 关键数字 / 有没有风险**。
 * A 版的三个变化：
 *   ① antd `Steps` → `Rail`（生命周期轨道：段可读、当前段高亮、终态/在途一眼看出）
 *   ② 一行 `Space` 拼的关键数字 → `Metrics`（等宽数字、右对齐、可点下钻）
 *   ③ 风险从「一行红字」→ `Chip`（只在真异常时才上色）
 *
 * ⚠ 护栏依赖（别删）：
 *   · 首屏必须有 **一个 antd `<Chip>` 且它就是阶段**（e2e:ui 用 `document.querySelector('.ant-tag')`
 *     判终态豁免）→ 所以阶段 Tag 放在**最前面**，`旧改` 之类排在它后面。
 *   · 下一步按钮文案必须是动作名（成交登记 / 立项 / 进入设计 / 去发运 / 登记回款）
 */
export interface SummaryNumbers {
  equipments: number
  kittingRate: number | null
  outstanding: number | null
  shipments: number
  openService: number
  accepted: boolean
}

export default function ProjectSummaryBar({
  p,
  detail,
  stepIndex,
  stageOrder,
  nums,
  next,
  onClose,
}: {
  p: Record<string, never> | any
  detail: any
  stepIndex: number
  stageOrder: string[]
  nums: SummaryNumbers
  /** 下一步动作由页面算好传进来（泳道在页面手里，bar 只管展示与触发） */
  next: { label: string; run: () => void } | null
  onClose: () => void
}) {
  const back = useBack('/projects', '← 返回列表')
  const go = useGoFrom()

  const risks: string[] = []
  if (p.delivery_days_left !== null && p.delivery_days_left !== undefined && p.delivery_days_left < 0)
    risks.push(`交期已过 ${-p.delivery_days_left} 天`)
  if (p.opportunity_days_left !== null && p.opportunity_days_left !== undefined && p.opportunity_days_left < 0)
    risks.push(`商机截止已过 ${-p.opportunity_days_left} 天`)
  if (nums.outstanding !== null && nums.outstanding > 0 && (p.stage === '质保' || p.stage === '已归档'))
    risks.push('质保期仍有未收款节点')
  if (!nums.accepted && p.stage === '交付中') risks.push('客户验收尚未签字')

  // 关键数字：只放**有值**的（未收为 null = 无权限，不显示；0 元也不占位）
  const items: MetricItem[] = [
    { key: 'equip', label: '设备', value: nums.equipments, unit: '台' },
    ...(nums.kittingRate !== null
      ? [{
          key: 'kit',
          label: '齐套率',
          value: `${Math.round(nums.kittingRate * 100)}%`,
          tone: (nums.kittingRate >= 1 ? 'ok' : nums.kittingRate < 0.6 ? 'warn' : undefined) as MetricItem['tone'],
          note: nums.kittingRate >= 1 ? '全部到位' : '未齐（可随时开装）',
        }]
      : []),
    ...(nums.outstanding !== null && nums.outstanding > 0
      ? [{
          key: 'money',
          label: '未收',
          value: `¥${Math.round(nums.outstanding).toLocaleString()}`,
          tone: 'err' as const,
          note: p.stage === '质保' || p.stage === '已归档' ? '质保期仍有未收款节点' : '按付款节点统计',
        }]
      : []),
    { key: 'ship', label: '发运批次', value: nums.shipments, unit: '批' },
    ...(nums.openService > 0
      ? [{ key: 'svc', label: '售后工单', value: nums.openService, unit: '单', tone: 'run' as const, note: '未关闭' }]
      : []),
    { key: 'cust', label: '客户', value: p.customer_name ?? detail?.customer_name ?? '—', text: true },
  ]

  const terminal = p.stage === '已关闭' || p.stage === '已归档'
  const railSegments = stageOrder.map((s, i) => ({
    key: s,
    name: s,
    value: terminal && i > stepIndex ? '—' : i < stepIndex ? '已完成' : i === stepIndex ? '进行中' : '未开始',
    state: (i < stepIndex ? 'done' : i === stepIndex ? (p.stage === '已关闭' ? 'block' : 'now') : undefined) as
      | 'done'
      | 'now'
      | 'block'
      | undefined,
  }))

  return (
    <>
      <PageHead
        crumb={
          <>
            {/* ★ docs/11：从台里点进来必须能回原台（护栏 NAV-返回口是来源台 盯着 —— 文案要以「← 返回」开头） */}
            <button type="button" className="project-back" onClick={() => go(back.hasFrom ? back.to : '/projects')}>{back.label}</button>
            <span style={{ color: 'var(--ds-line2)', margin: '0 8px' }}>/</span>
            <Link to="/projects">项目</Link> / <span className="ds-code cur">{p.project_no}</span>
          </>
        }
        title={
          <>
            {p.project_name}
            {/* ★ 阶段 Tag 必须是页面上**第一个** .ant-tag（e2e 据此判终态） */}
            <Chip tone={toneOf(STAGE_COLOR[p.stage] ?? 'blue')} style={{ marginInlineEnd: 6 }}>
              {p.stage}
            </Chip>
            {p.is_retrofit && <Chip tone="warn">旧线改造</Chip>}
          </>
        }
        sub={
          <>
            <span className="ds-code">{p.project_no}</span>
            {p.customer_name ? ` · ${p.customer_name}` : ''}
            {risks.length > 0 ? '' : ' · 无风险项'}
          </>
        }
        actions={
          <>
            {risks.length > 0 && <Chip tone="err">⚠ {risks.join(' · ')}</Chip>}
            {next && !terminal && (
              <Button type="primary" onClick={next.run}>
                {next.label}
              </Button>
            )}
            {p.stage !== '已关闭' && hasPerm('project:close') && (
              <Dropdown menu={{ items: [{ key: 'close', label: '关闭订单', danger: true }], onClick: onClose }}>
                <Button>更多 ▾</Button>
              </Dropdown>
            )}
          </>
        }
      />

      <Metrics items={items} />

      <div className="ds-panel" style={{ marginBottom: 16 }}>
        <div className="ds-panel-h">
          <h3>生命周期</h3>
          <span className="sub">点一段看该阶段的内容</span>
          <div className="act">
            <Status tone={toneOf(STAGE_COLOR[p.stage])}>
              {terminal ? '已结束' : `第 ${stepIndex + 1} / ${stageOrder.length} 段`}
            </Status>
          </div>
        </div>
        <Rail segments={railSegments} />
      </div>
    </>
  )
}
