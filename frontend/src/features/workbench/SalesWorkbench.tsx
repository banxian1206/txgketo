import { App, Button, Spin, Table } from 'antd'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { errMsg, salesBoard, workbenchMe, type SalesBoard, type WorkbenchMe } from '../../api/client'
import { Chip, Code, Panel, Status } from '../../components/ds'
import QueueBoard from '../../components/ds/QueueBoard'
import WorkbenchPage from '../../components/domain/WorkbenchPage'
import { SALES_BOARD } from '../../configs/boards'
import { Muted } from '../../components/ui/Primitives'
import { PROJECT_STAGE as STAGE_COLOR, toneOf } from '../../theme/status'
import { useGoFrom } from '../../hooks/useFrom'
/** 商务部工作台（06 卷 §3）：我的商机 → 成交待立项 → 执行中 + 回款 */
export default function SalesWorkbench() {
  const { message } = App.useApp()
  // ★ docs/11：跳去别的域时带上 ?from= （来源台/来源页），回来还在原来那一层
  const go = useGoFrom()
  const [, setMe] = useState<WorkbenchMe | null>(null)
  const [data, setData] = useState<SalesBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [who, board] = await Promise.all([workbenchMe(), salesBoard()])
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

  // 体：按页签 key 取（顺序 / 标题 / 徽标 / 可见性全来自注册表 SALES_BOARD；key 与旧分区逐字一致）
  const partsOf: Record<string, ReactNode> = {
    projects: (
      <>
        <Panel title="我的商机 / 项目" sub="点任意一行进项目详情（签约、立项、回款登记都在那里做）">
          <Table
            rowKey="project_no"
            size="small"
            dataSource={data?.projects ?? []}
            pagination={{ pageSize: 10, showSizeChanger: true }}
            onRow={(r) => ({ onClick: () => go(`/projects/${r.project_no}`), style: { cursor: 'pointer' } })}
            columns={[
              { title: '项目号', dataIndex: 'project_no', width: 110 },
              { title: '项目名称', dataIndex: 'project_name' },
              { title: '阶段', dataIndex: 'stage', width: 110, render: (v: string) => <Status tone={toneOf(STAGE_COLOR[v])}>{v}</Status> },
              {
                title: '商机截止',
                dataIndex: 'deadline',
                width: 130,
                render: (v: string | null, r) =>
                  v ? (
                    <>
                      {v} {r.overdue_follow && <Chip tone="err">已过期</Chip>}
                    </>
                  ) : (
                    '—'
                  ),
              },
              { title: '合同金额', dataIndex: 'amount', width: 130, align: 'right', render: (v: number) => (v ? `¥${v.toLocaleString()}` : '—') },
              { title: '未回款', dataIndex: 'unpaid', width: 130, align: 'right', render: (v: number) => (v ? `¥${v.toLocaleString()}` : '—') },
            ]}
          />
        </Panel>
      </>
    ),
    payments: (
      <>
        <QueueBoard
          search={<Muted>按节点催款：逾期 = 预计收款日已过还没收。回款登记在项目详情「合同与商务」里做。</Muted>}
          emptyText="没有待回款的节点。"
          items={(data?.payments ?? []).map((r) => ({
            key: `${r.project_no}-${r.seq ?? r.node_name}`,
            lead: <Code>{r.project_no}</Code>,
            title: r.node_name,
            meta: `应回 ¥${(r.amount ?? 0).toLocaleString()} · 未回 ¥${(r.unpaid ?? 0).toLocaleString()}`,
            cells: [
              r.expect_date
                ? { text: <>{r.expect_date}{r.overdue ? <Chip tone="err">逾期</Chip> : null}</>, title: '预计收款日' }
                : { text: '未定', title: '预计收款日' },
            ],
            onClick: () => go(`/projects/${r.project_no}`),
          }))}
        />
      </>
    ),
  }

  return (
    <Spin spinning={loading}>
      <div className="ds-page">
      {/* ★ docs/15 台骨架四件套：台头 → 结论条 → 流程条（注册表驱动）→ 体 */}
      <WorkbenchPage
        board={SALES_BOARD}
        sub={
          // ★ 方向 2 ①：只说现状 + 异常（异常在前）。原来把结论条的 5 个数摊开成一句着不住的话。
          (s?.payments_overdue ?? 0) > 0
            ? `有 ${s?.payments_overdue} 个回款节点已逾期`
            : (s?.payments_due ?? 0) > 0
              ? `有 ${s?.payments_due} 个回款节点到期`
              : `我负责 ${s?.my_leads ?? 0} 条线索 · ${s?.executing ?? 0} 个在执行 / 交付 · ${s?.warranty ?? 0} 个在质保`
        }
        help="这里只看我负责的商机与回款。签约、立项、回款登记都在项目详情里做。"
        actions={
          <>
            {/* ★ 精调（2026-10-05）：台头 actions 只留**能按下去的动作**。
                 原来这里摆的是“缺货 3 种 / 到货超期 N / 有风险 N”这类**纯计数**——
                 而结论条里已经有同一个数（而且**可点**，点了直接切到那个队列）。
                 同一批数在一个页上出现两次，是“看着毛”的头号来源（实测 5 个台都有）。 */}
            <Button size="small" onClick={() => void load()}>
              刷新
            </Button>
            <Button size="small" type="primary" onClick={() => go('/projects/new')}>
              新建商机
            </Button>
          </>
        }
        counts={{ projects: data?.projects?.length ?? 0, payments: data?.payments?.length ?? 0 }}
        metrics={[
          // ★ 方向 2 ② 主角指认：商务部台主角 = **待回款节点**：回款是商务的命门，也是唯一“今天不做就往后拖”的事。（ds `MetricItem.lead`）
          { key: 'overdue', label: '回款逾期', value: s?.payments_overdue ?? 0, unit: '个', tone: s?.payments_overdue ? 'err' : undefined, dimZero: true, to: '?tab=payments' },
          { key: 'follow', label: '跟进超期', value: s?.overdue_followup ?? 0, unit: '个', tone: s?.overdue_followup ? 'warn' : undefined, dimZero: true, to: '?tab=projects' },
          { key: 'pay', label: '待回款节点', value: s?.payments_due ?? 0, unit: '个', dimZero: true, to: '?tab=payments', lead: true },
          { key: 'initiate', label: '待立项', value: s?.to_initiate ?? 0, unit: '个', dimZero: true, to: '?tab=projects' },
          { key: 'leads', label: '商机（线索）', value: s?.my_leads ?? 0, unit: '条', dimZero: true, to: '?tab=projects' },
        ]}
      >
        {(t) => partsOf[t]}
      </WorkbenchPage>
      </div>
    </Spin>
  )
}
