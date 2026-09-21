import { App, Button, Card, Empty, Space, Table, Tabs, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import PurchaseActions from '../components/PurchaseActions'
import {
  errMsg,
  listMyTasks,
  listPurchaseRequests,
  updateTask,
  type PurchaseRequestItem,
  type TaskItem,
} from '../api/client'

const STATUS_COLOR: Record<string, string> = {
  待开始: 'default',
  进行中: 'processing',
  已完成: 'success',
  已取消: 'default',
}

const TYPE_COLOR: Record<string, string> = {
  设计: 'blue',
  采购: 'gold',
  制造: 'purple',
  装配: 'cyan',
  调试: 'orange',
  现场: 'magenta',
}

/** 我的任务（工作台）：设计师看到设计任务，采购员看到采购任务 */
export default function MyTasks() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const [rows, setRows] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('未完成')
  const [purchases, setPurchases] = useState<PurchaseRequestItem[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tasks, mine] = await Promise.all([listMyTasks(), listMyTasks()])
      setRows(tasks)
      // 采购任务对应的采购需求（拿状态做正确的操作按钮）
      const projects = [...new Set(mine.filter((t) => t.task_type === '采购').map((t) => t.project_no))]
      const lists = await Promise.all(projects.map((p) => listPurchaseRequests(p)))
      setPurchases(lists.flat())
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const filtered =
    tab === '未完成'
      ? rows.filter((r) => r.status === '待开始' || r.status === '进行中')
      : tab === '全部'
        ? rows
        : rows.filter((r) => r.status === tab)

  const setStatus = async (id: number, status: string) => {
    try {
      await updateTask(id, { status })
      message.success(`任务已${status === '已完成' ? '完成' : '更新'}`)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  return (
    <Card
      title="我的任务"
      extra={<Button onClick={() => void load()}>刷新</Button>}
    >
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: '未完成', label: `未完成 (${rows.filter((r) => r.status !== '已完成' && r.status !== '已取消').length})` },
          { key: '待开始', label: '待开始' },
          { key: '进行中', label: '进行中' },
          { key: '已完成', label: '已完成' },
          { key: '全部', label: '全部' },
        ]}
      />
      <Table<TaskItem>
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={filtered}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        locale={{ emptyText: <Empty description="没有指派给你的任务" /> }}
        columns={[
          {
            title: '任务号',
            dataIndex: 'task_no',
            width: 100,
            render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
          },
          {
            title: '类型',
            dataIndex: 'task_type',
            width: 90,
            render: (v: string, r) => (
              <Space size={4}>
                <Tag color={TYPE_COLOR[v] ?? 'default'}>{v}</Tag>
                {r.profession && r.profession !== '采购' && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {r.profession}
                  </Typography.Text>
                )}
              </Space>
            ),
          },
          { title: '任务', dataIndex: 'title' },
          {
            title: '项目',
            dataIndex: 'project_no',
            width: 200,
            render: (v: string, r) => (
              <a onClick={() => nav(`/projects/${v}`)}>
                {v} {r.project_name ?? ''}
              </a>
            ),
          },
          {
            title: '计划',
            key: 'plan',
            width: 190,
            render: (_: unknown, r: TaskItem) =>
              r.plan_start || r.plan_end ? (
                <Typography.Text style={{ fontSize: 12 }}>
                  {r.plan_start ?? '—'} → {r.plan_end ?? '—'}
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (v: string) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>,
          },
          {
            title: '操作',
            key: 'action',
            width: 240,
            render: (_: unknown, r: TaskItem) => (
              <Space size="middle">
                {r.task_type === '设计' && r.equip_no && (
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => nav(`/projects/${r.project_no}/design/${r.equip_no}`)}
                  >
                    去设计
                  </Button>
                )}
                {r.task_type === '采购' &&
                  (() => {
                    const pr = purchases.find(
                      (x) => x.project_no === r.project_no && x.item_no === r.ref_no,
                    )
                    if (!pr) return null
                    return <PurchaseActions row={pr} onDone={() => void load()} />
                  })()}
                {r.task_type !== '采购' && r.status === '待开始' && (
                  <a onClick={() => void setStatus(r.id, '进行中')}>开始</a>
                )}
                {r.task_type !== '采购' && r.status !== '已完成' && (
                  <a onClick={() => void setStatus(r.id, '已完成')}>完成</a>
                )}
                {r.status === '已完成' && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {r.done_at ? r.done_at.slice(5, 16).replace('T', ' ') : ''}
                  </Typography.Text>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
        任务在「立项」时自动生成并指派：每台设备 × 专业（机械/电气/程序/工艺）→ 设计任务；
        每个长周期件 → 采购任务。谁负责哪个专业，取决于项目团队里的任命。
      </Typography.Paragraph>
    </Card>
  )
}
