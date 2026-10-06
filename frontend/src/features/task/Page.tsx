import { App, Button, Card, Modal, Segmented, Select, Space, Table, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import PurchaseActions from '../../components/PurchaseActions'
import { errMsg, listMyTasks, listPurchaseRequests, listUsers, me, splitTask, updateTask, type PurchaseRequestItem, type TaskItem, type User, type UserRow } from '../../api/client'
import { hasPerm } from '../../api/user'
import { TASK_STATUS as STATUS_COLOR, toneOf } from '../../theme/status'
import { TASK_TYPE as TYPE_COLOR } from '../../theme/status'
import { TASK_TABS, TASK_GROUPS } from '../../configs/tabs'
import { useTab } from '../../hooks/useTab'
import WorkbenchTabs from '../../components/ds/WorkbenchTabs'
import { useGoFrom } from '../../hooks/useFrom'
import { Status, Chip, Empty } from '../../components/ds'
/** 我的任务（工作台）：我的任务 / 我组任务（经理，05 卷 §2.2） */
export default function MyTasks() {
  const { message } = App.useApp()
  // ★ docs/11：跳去别的域时带上 ?from= （来源台/来源页），回来还在原来那一层
  const go = useGoFrom()
  const [rows, setRows] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(false)
  // ★ 重整 P0：状态页签状态进 URL（?tab=），刷新/分享不丢
  const visKeys = TASK_TABS.map((x) => x.key)
  const [tab, setTab] = useTab(visKeys, '未完成')
  const [scope, setScope] = useState<'mine' | 'team'>('mine')
  const [profile, setProfile] = useState<User | null>(null)
  const [purchases, setPurchases] = useState<PurchaseRequestItem[]>([])
  const [members, setMembers] = useState<UserRow[]>([])
  const [splitTarget, setSplitTarget] = useState<TaskItem | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [splitting, setSplitting] = useState(false)
  const isLead =
    ['经理', '组长', '设计组长', '主管'].includes(profile?.position ?? '') ||
    ['总监', '部门负责人', '工程总监'].includes(profile?.position ?? '')
  /** ★ M-04/M-05：与后端 `tasks._can_act_on_task` 同一口径 ——
   * 「能不能动**这张**任务」而不是看有没有 `project:edit`。
   * 不是负责人却看得到「开始/完成」→ 点了必 403（铁律：前端必须反映后端门禁）。 */
  const canActOn = (r: TaskItem) =>
    hasPerm('project:edit') ||
    (profile?.id != null && r.owner_id === profile.id) ||
    (['经理', '组长', '设计组长', '主管'].includes(profile?.position ?? '') &&
      !!profile?.profession &&
      profile.profession === r.profession) ||
    profile?.position === '总监'
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tasks, mine, who] = await Promise.all([
        listMyTasks(undefined, scope),
        listMyTasks(),
        me(),
      ])
      setRows(tasks)
      setProfile(who)
      // 采购任务对应的采购需求（拿状态做正确的操作按钮）—— 只对我自己的采购任务
      const projects = [...new Set(mine.filter((t) => t.task_type === '采购').map((t) => t.project_no))]
      const lists = await Promise.all(projects.map((p) => listPurchaseRequests(p)))
      setPurchases(lists.flat())
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message, scope])
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
  const openSplit = async (task: TaskItem) => {
    setSplitTarget(task)
    setSelected([])
    try {
      const users = await listUsers()
      setMembers(
        users.filter(
          (u) => u.is_active && u.profession === task.profession && (u.position === '组员' || u.position === '成员'),
        ),
      )
    } catch (e) {
      message.error(errMsg(e))
    }
  }
  const doSplit = async () => {
    if (!splitTarget || !selected.length) return
    setSplitting(true)
    try {
      await splitTask(
        splitTarget.id,
        selected.map((id) => ({ owner_id: id })),
      )
      message.success(`已拆给 ${selected.length} 位组员`)
      setSplitTarget(null)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSplitting(false)
    }
  }
  const columns: ColumnsType<TaskItem> = [
    {
      title: '任务号',
      dataIndex: 'task_no',
      width: 100,
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    {
      title: '类型',
      dataIndex: 'task_type',
      width: 96,
      render: (v: string, r) => (
        <Space size={4}>
          <Status tone={toneOf(TYPE_COLOR[v])}>{v}</Status>
          {r.profession && r.profession !== '采购' && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {r.profession}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    ...(scope === 'team'
      ? ([
          {
            title: '负责人',
            dataIndex: 'owner_name',
            width: 100,
            render: (v: string | null | undefined) =>
              v ?? <Typography.Text type="warning">未指派</Typography.Text>,
          },
        ] as ColumnsType<TaskItem>)
      : []),
    {
      title: '任务',
      dataIndex: 'title',
      render: (v: string, r) => (
        <Space size={4}>
          {v}
          {r.parent_task_id ? <Chip tone="run">子任务</Chip> : null}
        </Space>
      ),
    },
    {
      title: '项目',
      dataIndex: 'project_no',
      width: 180,
      render: (v: string, r) => (
        <a onClick={() => go(`/projects/${v}`)}>
          {v} {r.project_name ?? ''}
        </a>
      ),
    },
    {
      title: '计划',
      key: 'plan',
      width: 170,
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
      width: 130,
      render: (v: string, r) => (
        <Space size={4}>
          <Chip tone={toneOf(STATUS_COLOR[v])}>{v}</Chip>
          {r.blocked && (
            <Tooltip title={r.blocked_reason ?? '等待前置'}>
              <Chip tone="warn">等前置</Chip>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 280,
      render: (_: unknown, r: TaskItem) => (
        <Space size="middle">
          {r.task_type === '设计' && r.equip_no && (
            <Button
              type="primary"
              size="small"
              onClick={() => go(`/projects/${r.project_no}/design/${r.equip_no}`)}
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
          {r.task_type !== '采购' &&
            r.status === '待开始' &&
            (r.blocked ? (
              <Tooltip title={r.blocked_reason ?? '等待前置'}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  等前置
                </Typography.Text>
              </Tooltip>
            ) : canActOn(r) ? (
              <a onClick={() => void setStatus(r.id, '进行中')}>开始</a>
            ) : null)}
          {r.task_type !== '采购' && r.status !== '已完成' && canActOn(r) && (
            <a onClick={() => void setStatus(r.id, '已完成')}>完成</a>
          )}
          {isLead &&
            r.task_type === '设计' &&
            !r.parent_task_id &&
            r.status !== '已完成' &&
            r.owner_id === profile?.id && <a onClick={() => void openSplit(r)}>拆分派工</a>}
          {r.status === '已完成' && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {r.done_at ? r.done_at.slice(5, 16).replace('T', ' ') : ''}
            </Typography.Text>
          )}
        </Space>
      ),
    },
  ]
  return (
    <Card
      title={
        <>
          我的任务{' '}
          <Tooltip title="任务在「立项」时生成：每台设备 × 专业 → 设计任务，直接派给各专业经理，经理再拆给组员；工艺挂在机械之后，机械首次发布即可开工。">
            <span className="ds-help">?</span>
          </Tooltip>
        </>
      }
      extra={
        <Space>
          {isLead && (
            <Segmented
              value={scope}
              onChange={(v) => setScope(v as 'mine' | 'team')}
              options={[
                { value: 'mine', label: '我的任务' },
                { value: 'team', label: '我组任务' },
              ]}
            />
          )}
          <Button onClick={() => void load()}>刷新</Button>
        </Space>
      }
    >
      <WorkbenchTabs
        groups={TASK_GROUPS}
        tab={tab}
        onTab={setTab}
        items={[
          {
            key: '未完成',
            label: `未完成 (${rows.filter((r) => r.status !== '已完成' && r.status !== '已取消').length})`,
          },
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
        pagination={{ pageSize: 10, showSizeChanger: true }}
        locale={{ emptyText: <Empty text={scope === 'team' ? '本组没有任务' : '没有指派给你的任务'} /> }}
        columns={columns}
      />
      <Modal
        open={!!splitTarget}
        title={`拆分派工：${splitTarget?.title ?? ''}`}
        onCancel={() => setSplitTarget(null)}
        onOk={() => void doSplit()}
        okButtonProps={{ disabled: !selected.length }}
        confirmLoading={splitting}
        okText="拆分"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          勾选本专业组员，每人生成一条子任务；前置依赖会跟着继承。
        </Typography.Paragraph>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder={
            members.length ? '选择组员' : '本专业还没有组员 —— 先到「用户与权限」配人'
          }
          value={selected}
          onChange={setSelected}
          options={members.map((m) => ({ value: m.id, label: m.name }))}
        />
      </Modal>
    </Card>
  )
}
