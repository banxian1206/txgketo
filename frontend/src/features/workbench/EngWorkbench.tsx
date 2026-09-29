import { App, Button, Card, Col, Empty, Row, Space, Spin, Table, Tabs, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

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
import { ENG_BOARD_STATE as STATE_COLOR } from '../../theme/status'
import { TASK_STATUS as TASK_STATUS_COLOR } from '../../theme/status'
import { T } from '../../theme/tokens'
import { ENG_TABS, filterTabs } from '../../configs/tabs'
import { useTab } from '../../hooks/useTab'

const PROFS = ['机械', '电气', '程序', '工艺']

/** 工程部工作台（06 卷 §3）：组员 / 经理 / 总监 三视角 */
export default function EngWorkbench() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const [me, setMe] = useState<WorkbenchMe | null>(null)
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

  const position = me?.user.position ?? ''
  const isLead = position === '经理' || position === '总监'
  const isDirector = position === '总监' || me?.user.roles.includes('ADMIN')

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
        <a onClick={() => r.equip_no && nav(`/projects/${r.project_no}/design/${r.equip_no}`)}>
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
          <Tag color={TASK_STATUS_COLOR[v] ?? 'default'}>{v}</Tag>
          {r.blocked && <Tag color="orange">等前置</Tag>}
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
    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    {
      title: '操作',
      key: 'action',
      width: 90,
      render: () => <a onClick={() => nav('/workbench/reviews')}>去处理</a>,
    },
  ]

  const equipColumns: ColumnsType<EngEquipment> = [
    {
      title: '项目 / 设备',
      key: 'equip',
      width: 200,
      render: (_: unknown, r) => (
        <a onClick={() => nav(`/projects/${r.project_no}/design/${r.equip_no}`)}>
          {r.project_no} {r.equip_no} {r.equip_name}
        </a>
      ),
    },
    ...PROFS.map((prof) => ({
      title: prof,
      key: prof,
      width: 110,
      render: (_: unknown, r: EngEquipment) => {
        const c = r.professions[prof]
        return (
          <Space size={2} direction="vertical">
            <Tag color={STATE_COLOR[c?.state] ?? 'default'}>{c?.state ?? '—'}</Tag>
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

  // ★ 台内页签：按权限过滤 + 状态进 URL（docs/10 P0）。
  //   「我组 / 部门看板」只给有审核权的角色（经理/总监），组员看到的是干净的一层。
  const visKeys = filterTabs(ENG_TABS).map((x) => x.key)
  const [tab, setTab] = useTab(visKeys, 'mine')

  return (
    <Spin spinning={loading}>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Typography.Title level={5} style={{ margin: 0 }}>
            工程部工作台
          </Typography.Title>
          <Tag color="blue">{position || '—'}</Tag>
          {me?.user.department && <Tag>{me.user.department.name}</Tag>}
          {me?.user.profession && <Tag>{me.user.profession}</Tag>}
          <Button size="small" onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      </Card>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'mine',
            label: `我的（${myTasks.length} 任务）`,
            children: (
              <>
                <Card size="small" title="我的任务" style={{ marginBottom: 12 }}>
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={myTasks}
                    columns={taskColumns}
                    pagination={false}
                    locale={{ emptyText: <Empty description="没有指派给我的任务" /> }}
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
                        locale={{ emptyText: <Empty description="没有待我改版的申请" /> }}
                        columns={[
                          { title: '申请号', dataIndex: 'cr_no', width: 100 },
                          { title: '对象', dataIndex: 'target_title' },
                          { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag>{v}</Tag> },
                        ]}
                      />
                    </Card>
                  </Col>
                </Row>
              </>
            ),
          },
          ...(isLead
            ? [
                {
                  key: 'team',
                  label: `我组（${teamTasks.length} 任务 / 待审 ${todoTickets.length}）`,
                  children: (
                    <>
                      <Card size="small" title="待我审核" style={{ marginBottom: 12 }}>
                        <Table
                          rowKey="id"
                          size="small"
                          dataSource={todoTickets}
                          columns={ticketColumns}
                          pagination={false}
                          locale={{ emptyText: <Empty description="没有待我审核的评审单" /> }}
                        />
                      </Card>
                      <Card size="small" title="组员任务进度">
                        <Table
                          rowKey="id"
                          size="small"
                          dataSource={teamTasks}
                          columns={taskColumns}
                          pagination={{ pageSize: 20, showSizeChanger: false }}
                        />
                      </Card>
                    </>
                  ),
                },
              ]
            : []),
          ...(isDirector
            ? [
                {
                  key: 'board',
                  label: '部门看板',
                  children: (
                    <>
                      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                        {[
                          { label: '设备总数', value: board?.summary.equipments ?? 0 },
                          { label: '全部专业已发布', value: board?.summary.all_released ?? 0 },
                          { label: '卡住设备', value: board?.summary.blocked ?? 0 },
                          { label: '待我终审', value: board?.summary.pending_reviews ?? 0, to: '/workbench/reviews' },
                          { label: '待我裁决改版', value: board?.summary.pending_changes ?? 0, to: '/workbench/changes' },
                          { label: '超期任务', value: board?.summary.overdue_tasks ?? 0 },
                        ].map((s) => (
                          <Col xs={12} sm={8} md={4} key={s.label}>
                            <Card
                              size="small"
                              hoverable={!!s.to}
                              onClick={() => s.to && nav(s.to)}
                              style={{ textAlign: 'center' }}
                            >
                              <div style={{ fontSize: 12, color: T.textSecondary }}>{s.label}</div>
                              <div style={{ fontSize: 20, fontWeight: 600, color: s.value ? T.brand : T.textDisabled }}>
                                {s.value}
                              </div>
                            </Card>
                          </Col>
                        ))}
                      </Row>

                      <Card size="small" title="设备设计进度（机械 / 电气 / 程序 / 工艺）" style={{ marginBottom: 12 }}>
                        <Table
                          rowKey={(r) => `${r.project_no}-${r.equip_no}`}
                          size="small"
                          dataSource={board?.equipments ?? []}
                          columns={equipColumns}
                          pagination={{ pageSize: 20, showSizeChanger: false }}
                        />
                      </Card>

                      <Row gutter={12}>
                        <Col xs={24} lg={12}>
                          <Card size="small" title="待我终审" style={{ marginBottom: 12 }}>
                            <Table
                              rowKey="id"
                              size="small"
                              dataSource={board?.pending_reviews ?? []}
                              pagination={false}
                              locale={{ emptyText: <Empty description="没有待终审的评审单" /> }}
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
                          </Card>
                        </Col>
                        <Col xs={24} lg={12}>
                          <Card size="small" title="待我裁决的改版" style={{ marginBottom: 12 }}>
                            <Table
                              rowKey="id"
                              size="small"
                              dataSource={board?.pending_changes ?? []}
                              pagination={false}
                              locale={{ emptyText: <Empty description="没有待裁决的改版申请" /> }}
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
                          </Card>
                        </Col>
                      </Row>

                      <Card size="small" title="超期任务">
                        <Table
                          rowKey="id"
                          size="small"
                          dataSource={board?.overdue_tasks ?? []}
                          pagination={false}
                          locale={{ emptyText: <Empty description="没有超期任务" /> }}
                          columns={[
                            { title: '任务号', dataIndex: 'task_no', width: 100 },
                            { title: '任务', dataIndex: 'title' },
                            { title: '专业', dataIndex: 'profession', width: 70 },
                            { title: '负责人', dataIndex: 'owner', width: 90 },
                            { title: '计划完成', dataIndex: 'plan_end', width: 110 },
                            { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag>{v}</Tag> },
                          ]}
                        />
                      </Card>
                    </>
                  ),
                },
              ]
            : []),
        ].filter((x) => visKeys.includes(x.key))}
      />
    </Spin>
  )
}
