import { Breadcrumb, Button, Card, Dropdown, Space, Steps, Tag, Typography } from 'antd'
import { Link } from 'react-router-dom'

import { hasPerm } from '../../api/user'
import { CodeNo, Muted, NumCell } from '../ui/Primitives'
import { useBack, useGoFrom } from '../../hooks/useFrom'
import { FS, T } from '../../theme/tokens'
import { PROJECT_STAGE as STAGE_COLOR } from '../../theme/status'

/**
 * 详情页「结论条」（docs/12 §3.1 ①）—— 替代原来那张只有标题+步骤条的 header。
 *
 * 为什么：原详情页首屏是 14 张等权重卡里的第 1 张（基本信息，三个空值 —），
 * 用户打开一个项目，第一眼看到的不是「它现在怎么样、我下一步做什么」，而是数据库字段。
 * 结论条固定回答四件事：**在哪 / 下一步(可点) / 关键数字 / 有没有风险**。
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

  // 下一步文案就是动作名（可点）。原来的 NEXT_HINT 是一句「读」的说明，用户读完还得自己找按钮。

  const risks: string[] = []
  if (p.delivery_days_left !== null && p.delivery_days_left !== undefined && p.delivery_days_left < 0)
    risks.push(`项目交期已过 ${-p.delivery_days_left} 天`)
  if (p.opportunity_days_left !== null && p.opportunity_days_left !== undefined && p.opportunity_days_left < 0)
    risks.push(`商机截止已过 ${-p.opportunity_days_left} 天`)
  if (nums.outstanding !== null && nums.outstanding > 0 && (p.stage === '质保' || p.stage === '已归档'))
    risks.push('质保期仍有未收款节点')

  const stat = (label: string, v: React.ReactNode) => (
    <Space size={4} key={label}>
      <Muted>{label}</Muted>
      <span style={{ fontSize: FS.sm, fontWeight: 600 }}>{v}</span>
    </Space>
  )

  return (
    <Card
      size="small"
      style={{ marginBottom: 12, position: 'sticky', top: 8, zIndex: 5 }}
      styles={{ body: { padding: '12px 16px' } }}
    >
      <Breadcrumb
        style={{ marginBottom: 6, fontSize: FS.xs }}
        items={[
          { title: <Link to="/projects">项目</Link> },
          { title: <span>{p.project_no}</span> },
        ]}
      />
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
          <Space size={8} wrap>
            <a onClick={() => (back.hasFrom ? go(back.to) : go('/projects'))}>{back.label}</a>
            <CodeNo style={{ fontSize: FS.xl, fontWeight: 600 }}>{p.project_no}</CodeNo>
            <Typography.Text style={{ fontSize: FS.xl }}>{p.project_name}</Typography.Text>
            {p.is_retrofit && <Tag color="orange">旧改</Tag>}
            <Tag color={STAGE_COLOR[p.stage] ?? 'blue'}>{p.stage}</Tag>
          </Space>
          <div style={{ marginTop: 6 }}>
            <Space size={14} wrap>
              {stat('设备', nums.equipments)}
              {nums.kittingRate !== null && stat('齐套', `${Math.round(nums.kittingRate * 100)}%`)}
              {nums.outstanding !== null &&
                stat('未收', <NumCell value={nums.outstanding > 0 ? `¥${Math.round(nums.outstanding).toLocaleString()}` : '¥0'} strong />)}
              {stat('发运批次', nums.shipments)}
              {nums.openService > 0 && stat('售后工单', nums.openService)}
              {stat('客户', p.customer_name ?? detail?.customer_name ?? '—')}
            </Space>
          </div>
          {risks.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <Typography.Text style={{ fontSize: FS.sm, color: T.error }}>⚠ {risks.join(' · ')}</Typography.Text>
            </div>
          )}
        </div>
        <Space align="start">
          {next && p.stage !== '已关闭' && p.stage !== '已归档' && (
            <Button type="primary" onClick={next.run}>
              {next.label}
            </Button>
          )}
          {p.stage !== '已关闭' && hasPerm('project:close') && (
            <Dropdown menu={{ items: [{ key: 'close', label: '关闭订单', danger: true }], onClick: onClose }}>
              <Button>更多 ▾</Button>
            </Dropdown>
          )}
        </Space>
      </div>
      <Steps
        size="small"
        current={stepIndex}
        style={{ marginTop: 10 }}
        items={stageOrder.map((s) => ({ title: s }))}
        status={p.stage === '已关闭' ? 'error' : 'process'}
      />
    </Card>
  )
}
