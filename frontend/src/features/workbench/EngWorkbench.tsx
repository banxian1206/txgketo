import { App, Button, Card, Col, Row, Space, Spin, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { Empty as DsEmpty, Metrics, Panel, Status } from '../../components/ds'

import {
  engBoard,
  errMsg,
  listChangeRequests,
  listMyTasks,
  listReviewTickets,
  workbenchMe,
  type ChangeRequestRow,
  type EngBoard,
  type EngEquipment,
  type ReviewTicketBrief,
  type TaskItem,
  type WorkbenchMe,
} from '../../api/client'
import { ENG_BOARD_STATE as STATE_COLOR, toneOf } from '../../theme/status'
import { TASK_STATUS as TASK_STATUS_COLOR } from '../../theme/status'
import { useGoFrom } from '../../hooks/useFrom'

const PROFS = ['机械', '电气', '程序', '工艺']

import WorkbenchPage from '../../components/domain/WorkbenchPage'
import { ENG_BOARD } from '../../configs/boards'

/** 工程部工作台（06 卷 §3）：组员 / 经理 / 总监 三视角 */
export default function EngWorkbench() {
  const { message } = App.useApp()
  // ★ docs/11：跳去别的域时带上 ?from= （来源台/来源页），回来还在原来那一层
  const go = useGoFrom()
  const [, setMe] = useState<WorkbenchMe | null>(null)
  const [board, setBoard] = useState<EngBoard | null>(null)
  const [myTasks, setMyTasks] = useState<TaskItem[]>([])
  const [teamTasks, setTeamTasks] = useState<TaskItem[]>([])
  const [mineTickets, setMineTickets] = useState<ReviewTicketBrief[]>([])
  const [todoTickets, setTodoTickets] = useState<ReviewTicketBrief[]>([])
  const [myChanges, setMyChanges] = useState<ChangeRequestRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [who, bd, mt, tt, mkt, tkt, mc] = await Promise.all([
        workbenchMe(),
        engBoard(),
        listMyTasks(undefined, 'mine'),
        listMyTasks(undefined, 'team'),
        listReviewTickets('mine'),
        listReviewTickets('todo'),
        listChangeRequests('todo'),
      ])
      setMe(who)
      setBoard(bd)
      setMyTasks(mt)
      setTeamTasks(tt)
      setMineTickets(mkt)
      setTodoTickets(tkt)
      setMyChanges(mc)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  // ★ docs/15：页签可见性交给注册表（ENG_TABS 的权限码），**不再用 position 猜岗位**
  //   —— 后端 /my-tasks?scope=team 与 /workbench/eng/board 本来就只要登录，
  //   用岗位裁是"看得见的活别人点不到"的老病（M-04）。

  const taskColumns: ColumnsType<TaskItem> = [
    { title: '任务号', dataIndex: 'task_no', width: 100 },
    {
      title: '专业',
      dataIndex: 'profession',
      width: 70,
      render: (v: string | null) => v ?? '—',
    },
    { title: '任务', dataIndex: 'title' },
    {
      title: '设备',
      key: 'equip',
      width: 150,
      render: (_: unknown, r) => (
        <a onClick={() => r.equip_no && go(`/projects/${r.project_no}/design/${r.equip_no}`)}>
          {r.project_no} {r.equip_no ?? ''}
        </a>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: string, r) => (
        <Space size={4}>
          <Status tone={toneOf(TASK_STATUS_COLOR[v])}>{v}</Status>
          {r.blocked && <Status tone="warn">等前置</Status>}
        </Space>
      ),
    },
    {
      title: '计划',
      key: 'plan',
      width: 170,
      render: (_: unknown, r) =>
        r.plan_start || r.plan_end ? `${r.plan_start ?? '—'} → ${r.plan_end ?? '—'}` : '—',
    },
    { title: '负责人', dataIndex: 'owner_name', width: 90, render: (v: string | null) => v ?? '—' },
  ]

  const ticketColumns: ColumnsType<ReviewTicketBrief> = [
    { title: '评审单', dataIndex: 'ticket_no', width: 100 },
    {
      title: '设备',
      key: 'equip',
      width: 160,
      render: (_: unknown, r) => `${r.project_no} ${r.equip_no ?? ''}`,
    },
    { title: '专业', dataIndex: 'profession', width: 70, render: (v: string | null) => v ?? '—' },
    { title: '提交人', dataIndex: 'submitter_name', width: 90, render: (v: string | null) => v ?? '—' },
    { title: '轮次', dataIndex: 'current_round', width: 70, render: (v: number) => `第 ${v} 轮` },
    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Status>{v}</Status> },
    {
      title: '操作',
      key: 'action',
      width: 90,
      render: () => <a onClick={() => go('/workbench/reviews')}>去处理</a>,
    },
  ]

  const equipColumns: ColumnsType<EngEquipment> = [
    {
      title: '项目 / 设备',
      key: 'equip',
      width: 200,
      render: (_: unknown, r) => (
        <a onClick={() => go(`/projects/${r.project_no}/design/${r.equip_no}`)}>
          {r.project_no} {r.equip_no} {r.equip_name}
        </a>
      ),
    },
    ...PROFS.map((prof) => ({
      title: prof,
      key: prof,
      width: 130,
      render: (_: unknown, r: EngEquipment) => {
        const c = r.professions[prof]
        return (
          <Space size={2} direction="vertical">
            {/* ★ 精调（2026-10-05）：原来是 `<Tag color>` 彩色药丸 —— 全站“彩色 Tag 收敛”那轮
                （docs/14 R5）漏了这个文件。规范只认一种画法：**圆点 + 文字**（ds.Status），
                彩色只留给「异常/当前」。一屏 4 个专业 × N 台设备 = 一片药丸 → 处处最高权重 = 没有权重。 */}
            <Status tone={toneOf(STATE_COLOR[c?.state])}>{c?.state ?? '—'}</Status>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {c?.owner ?? ''} {c?.overdue ? '·超期' : ''}
            </Typography.Text>
          </Space>
        )
      },
    })),
    {
      title: '卡住',
      key: 'blocked',
      render: (_: unknown, r) =>
        r.blocked.length ? (
          <Typography.Text type="danger" style={{ fontSize: 12 }}>
            {r.blocked.join('；')}
          </Typography.Text>
        ) : (
          '—'
        ),
    },
  ]


  // 体：按页签 key 取（顺序 / 标题 / 徽标 / 可见性全来自注册表 ENG_BOARD）
  const partsOf: Record<string, ReactNode> = {
    mine: (
      <>
        <Card size="small" title="我的任务" style={{ marginBottom: 12 }}>
          <Table
            rowKey="id"
            size="small"
            dataSource={myTasks}
            columns={taskColumns}
            pagination={false}
            // ★ docs/15：工程台是**看板**（看进度/卡点），动手的地方是「我的任务」页 ——
            //   点任意一行直接过去，别让人自己猜去哪儿干（这一列过去只有"设备"能点）
            onRow={() => ({ onClick: () => go('/workbench/tasks'), style: { cursor: 'pointer' } })}
            locale={{ emptyText: <DsEmpty text="没有指派给我的任务" /> }}
          />
        </Card>
        <Row gutter={12}>
          <Col xs={24} lg={12}>
            <Card size="small" title="我提交的评审单">
              <Table
                rowKey="id"
                size="small"
                dataSource={mineTickets}
                columns={ticketColumns}
                pagination={false}
                // ★ 走查 2026-10-05：这张表**漏了 emptyText** → 空的时候露出 antd 默认灰插图 +
                //   「暂无数据」，而右邻「待我改版」是人话 → 同一屏两种语言（docs/15：antd 默认空态 0 处）
                locale={{ emptyText: <DsEmpty text="没有我提交的评审单 —— 提交后会出现在这里。" /> }}
                onRow={() => ({ onClick: () => go('/workbench/reviews'), style: { cursor: 'pointer' } })}
              />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card size="small" title="待我改版">
              <Table
                rowKey="id"
                size="small"
                dataSource={myChanges}
                pagination={false}
                locale={{ emptyText: <DsEmpty text="没有待我改版的申请" /> }}
                columns={[
                  { title: '申请号', dataIndex: 'cr_no', width: 100 },
                  { title: '对象', dataIndex: 'target_title' },
                  { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Status>{v}</Status> },
                ]}
              />
            </Card>
          </Col>
        </Row>
      </>

    ),
    team: (
            <>
              <Card size="small" title="待我审核" style={{ marginBottom: 12 }}>
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={todoTickets}
                  columns={ticketColumns}
                  pagination={false}
                  locale={{ emptyText: <DsEmpty text="没有待我审核的评审单" /> }}
                />
              </Card>
              <Card size="small" title="组员任务进度">
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={teamTasks}
                  columns={taskColumns}
                  pagination={{ pageSize: 10, showSizeChanger: true }}
                  locale={{ emptyText: <DsEmpty text="组员还没有任务。" /> }}
                />
              </Card>
            </>
          
    ),
    board: (
            <>
              {/* ★ 精调（2026-10-05）：这里原来是一堵 **6 张数字卡墙**（Card + 12px 标签 + 20px 数字）。
                  两个问题：① **数字卡墙**这个形制在方案 A 里已经被“一行指标条”取代（docs/14 R0）；
                  ② 其中 4 个数（卡住设备 / 待我终审 / 待我裁决改版 / 超期任务）**台头结论条里已经有了**，
                  在同一个台里再摆一遍 = 同一批数说两遍。
                  所以只留“部门看板自己才有的”两个进度数，交给 `Metrics`（带发布率进度）。 */}
              <Metrics
                items={[
                  {
                    key: 'released',
                    label: '四专业全部已发布',
                    value: board?.summary.all_released ?? 0,
                    unit: `台 / 共 ${board?.summary.equipments ?? 0} 台`,
                    note: '发完才算能采购 / 能排产',
                    dimZero: true,
                    lead: true,
                  },
                  {
                    key: 'blocked',
                    label: '卡住设备',
                    value: board?.summary.blocked ?? 0,
                    unit: '台',
                    note: '有专业没发布 / 有任务超期',
                    tone: (board?.summary.blocked ?? 0) > 0 ? 'err' : undefined,
                    dimZero: true,
                  },
                ]}
              />

              <Panel title="设备设计进度（机械 / 电气 / 程序 / 工艺）">
                <Table
                  rowKey={(r) => `${r.project_no}-${r.equip_no}`}
                  size="small"
                  dataSource={board?.equipments ?? []}
                  columns={equipColumns}
                  pagination={{ pageSize: 10, showSizeChanger: true }}
                  locale={{ emptyText: <DsEmpty text="还没有设备 —— 立项时建了设备才会出现在这里。" /> }}
                />
              </Panel>

              <Row gutter={12}>
                <Col xs={24} lg={12}>
                  <Panel title="待我终审">
                    <Table
                      rowKey="id"
                      size="small"
                      dataSource={board?.pending_reviews ?? []}
                      pagination={false}
                      locale={{ emptyText: <DsEmpty text="没有待终审的评审单" /> }}
                      columns={[
                        { title: '评审单', dataIndex: 'ticket_no' },
                        {
                          title: '设备',
                          key: 'e',
                          render: (_: unknown, r) => `${r.project_no} ${r.equip_no ?? ''}`,
                        },
                        { title: '专业', dataIndex: 'profession' },
                        { title: '提交人', dataIndex: 'submitter' },
                      ]}
                    />
                  </Panel>
                </Col>
                <Col xs={24} lg={12}>
                  <Panel title="待我裁决的改版">
                    <Table
                      rowKey="id"
                      size="small"
                      dataSource={board?.pending_changes ?? []}
                      pagination={false}
                      locale={{ emptyText: <DsEmpty text="没有待裁决的改版申请" /> }}
                      columns={[
                        { title: '申请号', dataIndex: 'cr_no' },
                        { title: '对象', dataIndex: 'target_ref' },
                        {
                          title: '设备',
                          key: 'e',
                          render: (_: unknown, r) => `${r.project_no} ${r.equip_no ?? ''}`,
                        },
                        { title: '问题', dataIndex: 'reason', ellipsis: true },
                      ]}
                    />
                  </Panel>
                </Col>
              </Row>

              <Panel title="超期任务">
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={board?.overdue_tasks ?? []}
                  pagination={false}
                  locale={{ emptyText: <DsEmpty text="没有超期任务" /> }}
                  columns={[
                    // ★ 精调（2026-10-05）：原来只有首列和尾列有 width，中间“任务”列自适应 →
                    //   antd 把剩余宽度全给它，而任务文字很短 → **中间裂开一大片空白**（“毛”）。
                    //   给每列都定宽，空白就只会留在末尾（那是正常的右留白）。
                    { title: '任务号', dataIndex: 'task_no', width: 110 },
                    { title: '任务', dataIndex: 'title', width: 320 },
                    { title: '专业', dataIndex: 'profession', width: 80 },
                    { title: '负责人', dataIndex: 'owner', width: 100 },
                    { title: '计划完成', dataIndex: 'plan_end', width: 120 },
                    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Status>{v}</Status> },
                  ]}
                />
              </Panel>
            </>
          
    ),
  }

  return (
    <Spin spinning={loading}>
      <div className="ds-page">
      {/* ★ docs/15 台骨架四件套：台头 → 结论条 → 流程条（注册表驱动）→ 体 */}
      <WorkbenchPage
        board={ENG_BOARD}
        sub={
          // ★ 方向 2 ①：原来 sub 写的是 40 字的流程叙述（“设计任务 → 提交评审 → 经理一级审 → …”），
          //   第一屏就是一段要读的话；现在 sub 只报现状 + 异常，全文进 ? 气泡。
          (board?.summary.pending_reviews ?? 0) > 0 || (board?.summary.pending_changes ?? 0) > 0
            ? `待审 ${board?.summary.pending_reviews ?? 0} 张${(board?.summary.pending_changes ?? 0) > 0 ? ` · 待裁决改版 ${board?.summary.pending_changes} 张` : ''}`
            : (board?.summary.blocked ?? 0) > 0
              ? `没有等你审的单 · ${board?.summary.blocked} 台设备卡住`
              : `本部门 ${board?.summary.equipments ?? 0} 台设备 · 没有等你审的单`
        }
        help="设计任务 → 提交评审 → 经理一级审 → 总监二级审 → 发布（冻结，自动触发采购）；改版走 ECN，不能私下改图。上面的数字可点，点了切到对应队列。"
        actions={
          <Button size="small" onClick={() => void load()}>
            刷新
          </Button>
        }
        counts={{
          mine: myTasks.length,
          team: teamTasks.length,
          board: board?.summary.blocked ?? 0,
        }}
        metrics={[
          // ★ 方向 2 ② 主角指认：工程台主角 = **待我审 / 待终审**：审一张单会解开一串任务，而自己的任务是并行的一堆。（ds `MetricItem.lead`）
          { key: 'mine', label: '我的任务', value: myTasks.length, unit: '项', tone: myTasks.length ? 'warn' : undefined, dimZero: true, to: '?tab=mine' },
          { key: 'blocked', label: '卡住的任务', value: myTasks.filter((t) => t.blocked).length, unit: '项', tone: 'err', dimZero: true, to: '?tab=mine' },
          { key: 'review', label: '待我审 / 待终审', value: board?.summary.pending_reviews ?? 0, unit: '张', tone: (board?.summary.pending_reviews ?? 0) > 0 ? 'warn' : undefined, dimZero: true, to: '?tab=team', lead: true },
          { key: 'change', label: '待我裁决改版', value: board?.summary.pending_changes ?? 0, unit: '张', tone: (board?.summary.pending_changes ?? 0) > 0 ? 'warn' : undefined, dimZero: true, to: '?tab=team' },
          { key: 'equip', label: '卡住设备', value: board?.summary.blocked ?? 0, unit: '台', tone: (board?.summary.blocked ?? 0) > 0 ? 'err' : undefined, dimZero: true, to: '?tab=board' },
        ]}
      >
        {(t) => partsOf[t]}
      </WorkbenchPage>
      </div>
    </Spin>
  )
}
