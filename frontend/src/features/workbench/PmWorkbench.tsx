import { App, Button, Progress, Space, Spin, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'

import { errMsg, pmBoard, workbenchMe, type PmBoard, type PmProjectRow, type WorkbenchMe } from '../../api/client'
import AcceptancePage from '../acceptance/Page'
import { Chip, Empty, Panel, Status } from '../../components/ds'
import WorkbenchPage from '../../components/domain/WorkbenchPage'
import { PM_BOARD } from '../../configs/boards'
import { PROJECT_STAGE as STAGE_COLOR, toneOf } from '../../theme/status'
import { useGoFrom } from '../../hooks/useFrom'

/**
 * 项目经理台（06 卷 §3）：我项目的全链进度（设计 → 采购 → 到货/入库）+ 风险/待办。
 *
 * ★ docs/15 台骨架：台头 → 结论条 → 流程条 → 体。
 *   原来由本组件先画页签条、再看板页画标题 → **页签条跑到标题之上**（九个台里唯一一个）。
 *   现在台头/结论条/流程条由 `WorkbenchPage` 一次渲染，看板只作为「体」。
 *   只剩一个可见页签时（PM 默认只有「看板」）不画条 —— 与其它台一致。
 */
export default function PmWorkbench() {
  const { message } = App.useApp()
  // ★ docs/11：跳去别的域时带上 ?from= （来源台/来源页），回来还在原来那一层
  const go = useGoFrom()
  const [, setMe] = useState<WorkbenchMe | null>(null)
  const [data, setData] = useState<PmBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [who, board] = await Promise.all([workbenchMe(), pmBoard()])
      setMe(who)
      setData(board)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message])
  useEffect(() => {
    void load()
  }, [load])
  const s = data?.summary

  const columns: ColumnsType<PmProjectRow> = [
    {
      title: '项目',
      key: 'project',
      width: 220,
      render: (_: unknown, r: PmProjectRow) => (
        <button type="button" className="project-entry" onClick={() => go(`/projects/${r.project_no}`)}>
          {r.project_no} {r.project_name}
        </button>
      ),
    },
    {
      title: '阶段',
      dataIndex: 'stage',
      width: 100,
      render: (v: string) => <Status tone={toneOf(STAGE_COLOR[v])}>{v}</Status>,
    },
    {
      title: '设计进度',
      key: 'design',
      width: 190,
      render: (_: unknown, r: PmProjectRow) => (
        <Space size={8}>
          <Progress
            aria-label="设计进度"
            style={{ width: 90 }}
            percent={r.design_total ? Math.round((r.design_done / r.design_total) * 100) : 0}
            size="small"
            status={r.design_total && r.design_done === r.design_total ? 'success' : 'active'}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已发布 {r.design_done}/{r.design_total}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '采购 / 到货',
      key: 'purchase',
      width: 190,
      render: (_: unknown, r: PmProjectRow) => (
        <Space size={4} wrap>
          <Chip tone={toneOf(r.purchase.to_purchase ? 'gold' : 'default')}>待采购 {r.purchase.to_purchase}</Chip>
          <Chip tone={toneOf(r.purchase.in_transit ? 'processing' : 'default')}>在途 {r.purchase.in_transit}</Chip>
          <Chip tone={toneOf(r.purchase.stored ? 'success' : 'default')}>已入库 {r.purchase.stored}</Chip>
        </Space>
      ),
    },
    {
      title: '风险',
      key: 'risks',
      render: (_: unknown, r: PmProjectRow) =>
        r.risks.length ? (
          <Space size={4} wrap>
            {r.risks.map((x) => (
              <Chip key={x} tone="err">
                {x}
              </Chip>
            ))}
          </Space>
        ) : (
          <Chip tone="ok">正常</Chip>
        ),
    },
  ]

  return (
    <Spin spinning={loading}>
      {/* ★ docs/15 台骨架四件套：台头 → 结论条 → 流程条（注册表驱动）→ 体 */}
      <WorkbenchPage
        board={PM_BOARD}
        sub={
          // ★ 方向 2 ①：异常优先（风险 / 超期），没事才说“几个项目 · 缺几项料”
          (s?.at_risk ?? 0) > 0 || (s?.overdue_tasks ?? 0) > 0
            ? `${(s?.at_risk ?? 0) > 0 ? `${s?.at_risk} 个项目有风险` : ''}${(s?.at_risk ?? 0) > 0 && (s?.overdue_tasks ?? 0) > 0 ? ' · ' : ''}${(s?.overdue_tasks ?? 0) > 0 ? `${s?.overdue_tasks} 项任务超期` : ''}`
            : `我负责 ${s?.projects ?? 0} 个项目 · 缺料 ${s?.shortage ?? 0} 项`
        }
        help="这里看全链进度与风险；具体动作去对应的工作台（设计 / 采购 / 仓库 / 车间 / 发运）。"
        actions={
          <>
            {/* ★ 精调（2026-10-05）：台头 actions 只留**能按下去的动作**。
                 原来这里摆的是“缺货 3 种 / 到货超期 N / 有风险 N”这类**纯计数**——
                 而结论条里已经有同一个数（而且**可点**，点了直接切到那个队列）。
                 同一批数在一个页上出现两次，是“看着毛”的头号来源（实测 5 个台都有）。 */}
            <Button size="small" onClick={() => void load()}>
              刷新
            </Button>
            <Button size="small" onClick={() => go('/projects')}>
              商机 / 项目
            </Button>
          </>
        }
        counts={{ board: s?.projects ?? 0 }}
        metrics={[
          // ★ 方向 2 ② 主角指认：PM 台主角 = **缺料（待采购）**：PM 天天盯的就是“缺什么、谁在买”，它一动就卡整个交期。（ds `MetricItem.lead`）
          { key: 'r', label: '有风险项目', value: s?.at_risk ?? 0, unit: '个', tone: s?.at_risk ? 'err' : undefined, note: '交期 / 缺料 / 卡点', dimZero: true, to: '?tab=board' },
          { key: 'ot', label: '超期任务', value: s?.overdue_tasks ?? 0, unit: '项', tone: s?.overdue_tasks ? 'err' : undefined, dimZero: true, to: '?tab=board' },
          { key: 'sh', label: '缺料（待采购）', value: s?.shortage ?? 0, unit: '项', tone: s?.shortage ? 'warn' : undefined, dimZero: true, to: '?tab=board', lead: true },
          { key: 'it', label: '在途采购', value: s?.in_transit ?? 0, unit: '项', dimZero: true, to: '?tab=board' },
          { key: 'p', label: '我负责的项目', value: s?.projects ?? 0, unit: '个', dimZero: true, to: '?tab=board' },
        ]}
      >
        {(t) =>
          t === 'acceptance' ? (
            <AcceptancePage />
          ) : (
            <Panel title="我负责的项目" sub="全链进度：设计 → 采购 → 制造 → 装配 → 发运 → 现场 → 验收">
              <Table
                rowKey="project_no"
                size="small"
                dataSource={data?.projects ?? []}
                columns={columns}
                scroll={{ x: 880 }}
                pagination={{ pageSize: 10, showSizeChanger: true }}
                // ★ 走查 2026-10-05：漏写 emptyText → 空时露 antd 灰插图 + 「暂无数据」
                //   （护栏 SHELL-台骨架四件套 的「每张表都要说空话」当场抓到的）
                locale={{ emptyText: <Empty text="我负责的项目都还没立项 —— 商机成交后会自动出现在这里。" /> }}
              />
            </Panel>
          )
        }
      </WorkbenchPage>
    </Spin>
  )
}
