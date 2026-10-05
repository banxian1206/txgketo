import { App, Button, Table } from 'antd'
import { lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import NotificationsDrawer from '../../components/NotificationsDrawer'
import { Chip, Code, Empty, Metrics, Muted, NA, PageHead, Panel, QueueGroup, QueueRow, Status, type MetricItem, type Tone } from '../../components/ds'
import { errMsg, listNotifications, markAllNotificationsRead, markNotificationRead, workbenchMe, type NotificationRow, type WorkbenchMe } from '../../api/client'
import { hasPerm } from '../../api/user'
import { PROJECT_STAGE as STAGE_COLOR, toneOf } from '../../theme/status'
import { useGoFrom } from '../../hooks/useFrom'
// A2（v2 拍板②）：三业务页组件复用挂入我的台（lazy import 与 App 同 chunk）
const MyTasks = lazy(() => import('../task/Page'))
const Reviews = lazy(() => import('../review/Page'))
const Changes = lazy(() => import('../change/Page'))

interface TodoRow {
  label: string
  count: number
  to: string
  hint?: string
  /** 归属分组（只用于分区显示，不参与权限判断） */
  group: 'mine' | 'purchase' | 'warehouse' | 'sales'
  /** 角色码标注（A3）：缺省 = 人人可见 */
  roles?: string[]
  /** 有值时的强调色（超期 = err） */
  tone?: Tone
}

const GROUP_LABEL: Record<TodoRow['group'], string> = {
  mine: '我的工作',
  purchase: '采购',
  warehouse: '仓库',
  sales: '商务',
}

/** 我的工作台 → 收件箱（06 卷 §8；方案 A「纸面」2026-10-04 重做）
 *
 * 改版要点（docs/13 §3.2）：
 *   ① 数字卡墙 → **一行指标条**：只显示非 0 的，点一下就到那个队列（0 的项不占首屏）
 *   ② 待办 → **分区队列**（我的工作 / 采购 / 仓库 / 商务），一条 = 一个动作
 *   ③ 长说明与内部口径**一律不上屏**（旧版页脚那句「06 卷 §11」已删）
 *   ④ 0 的项仍在列表里（你有这项权限、当前 0），只是弱化 —— 不藏事实，也不抢注意力
 */
export default function Workbench() {
  const { message } = App.useApp()
  const nav = useNavigate()
  // ★ docs/11：跳去别的域时带上 ?from= （来源台/来源页），回来还在原来那一层
  const go = useGoFrom()
  const loc = useLocation()
  const [data, setData] = useState<WorkbenchMe | null>(null)
  const [messages, setMessages] = useState<NotificationRow[]>([])
  const [notifOpen, setNotifOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const [me, notif] = await Promise.all([workbenchMe(), listNotifications()])
      setData(me)
      setMessages(notif.items.slice(0, 5))
    } catch (e) {
      message.error(errMsg(e))
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const openMessage = async (n: NotificationRow) => {
    try {
      if (!n.is_read) await markNotificationRead(n.id)
    } catch {
      /* 忽略 */
    }
    // ★ 站内消息点开 = 跨域下钻：带上来源，详情页才有「← 返回某某工作台」（P2-7）
    if (n.link) go(n.link)
    else await load()
  }

  const c = data?.counts
  // A3（v2 拍板）：KPI 按角色裁剪 —— 行带 roles 标注（对齐后端 WORKBENCHES 思路），ADMIN 角色兜底；
  // 人人行（我的任务/我提的改版）不标注。
  const todos: TodoRow[] = [
    { label: '我的任务', count: c?.my_tasks ?? 0, to: '/workbench/tasks', group: 'mine',
      // ★ 到期扫描（§8.3）：超期了就红字点出来，别等他自己翻
      hint: c?.overdue_tasks ? `其中 ${c.overdue_tasks} 项已超期` : undefined,
      tone: c?.overdue_tasks ? 'err' : undefined },
    { label: '待我审核', count: c?.to_review ?? 0, to: '/workbench/reviews?tab=todo', group: 'mine', hint: '评审单', roles: ['DESIGN_AUDIT', 'ADMIN'] },
    { label: '待我裁决', count: c?.to_decide ?? 0, to: '/workbench/changes?tab=pending', group: 'mine', hint: '改版申请', roles: ['DESIGN_AUDIT', 'ADMIN'] },
    { label: '待我改版', count: c?.to_change ?? 0, to: '/workbench/changes?tab=pending', group: 'mine', hint: '改版任务', roles: ['DESIGN', 'DESIGN_AUDIT', 'CRAFT', 'ADMIN'] },
    { label: '我提的改版', count: c?.my_changes ?? 0, to: '/workbench/changes?tab=mine', group: 'mine' },
    { label: '待采购', count: c?.to_purchase ?? 0, to: '/purchase?tab=pool', group: 'purchase', hint: '采购池', roles: ['PURCHASE', 'PURCHASE_LEAD', 'ADMIN'] },
    { label: '待验收', count: c?.to_inspect ?? 0, to: '/warehouse?tab=incoming', group: 'warehouse', roles: ['WAREHOUSE', 'ADMIN'] },
    { label: '待入库', count: c?.to_store ?? 0, to: '/warehouse?tab=storage', group: 'warehouse', roles: ['WAREHOUSE', 'ADMIN'] },
    { label: '待领料', count: c?.issues ?? 0, to: '/warehouse?tab=issues', group: 'warehouse', roles: ['WAREHOUSE', 'ADMIN'] },
    { label: '我的商机', count: c?.my_leads ?? 0, to: '/projects', group: 'sales', hint: '线索 / 待立项', roles: ['SALES', 'SCHEME', 'ADMIN'] },
  ]
  // 裁剪：角色码交集 + ADMIN 兜底（无 roles = 人人行）
  const myRoles = data?.user.roles ?? []
  const isAdminRole = myRoles.includes('ADMIN')
  const visibleTodos = todos.filter((t) => !t.roles || isAdminRole || t.roles.some((r) => myRoles.includes(r)))
  const canManageUsers = hasPerm('admin:users')

  // ★ 结论条（docs/15 台骨架）：**≤5 个、只放"要动手的数"**，0 也占位（灰显）——
  //   过去"只放非 0"导致很多人（如项目经理）首屏只有 1 个数字、左边空 2/3，
  //   跟别的台的 5 个数字一比就不像一套。
  const metrics = useMemo<MetricItem[]>(() => {
    const items: MetricItem[] = [
      {
        key: 'my_tasks',
        label: '我的任务',
        value: c?.my_tasks ?? 0,
        unit: '项',
        note: c?.overdue_tasks ? `其中 ${c.overdue_tasks} 超期` : undefined,
        tone: c?.overdue_tasks ? 'err' : undefined,
        dimZero: true,
        to: '/workbench/tasks',
      },
    ]
    // 角色相关的待办最多补 2 个（**0 也补** —— 灰显的 0 说明"你有这项职责、现在没有待办"，
    //   比留空更清楚；也让每个账号的结论条都是 4~5 个，不再"有的人 1 个、有的人 5 个"）
    for (const t of visibleTodos.filter((x) => x.label !== '我的任务').slice(0, 2)) {
      items.push({
        key: t.label,
        label: t.label,
        value: t.count,
        unit: '项',
        note: t.hint ?? (t.group === 'mine' ? undefined : GROUP_LABEL[t.group]),
        tone: t.tone,
        dimZero: true,
        to: t.to,
      })
    }
    items.push({ key: 'proj', label: '我参与的项目', value: data?.my_projects?.length ?? 0, unit: '个', dimZero: true, to: '/projects' })
    items.push({
      key: 'unread',
      label: '未读消息',
      value: c?.unread ?? 0,
      unit: '条',
      tone: c?.unread ? 'run' : undefined,
      dimZero: true,
      onClick: () => setNotifOpen(true),
    })
    return items.slice(0, 5)
  }, [visibleTodos, c?.unread, c?.my_tasks, c?.overdue_tasks, data?.my_projects?.length])

  // 待办分区（0 的项也列出，但弱化）
  const groups = (['mine', 'purchase', 'warehouse', 'sales'] as const)
    .map((g) => ({ g, rows: visibleTodos.filter((t) => t.group === g) }))
    .filter((x) => x.rows.length > 0)

  // 分区计数（第一分区不重复显示数字 —— 首屏指标条已经给过）
  const totalOpen = visibleTodos.reduce((a, t) => a + t.count, 0)

  // ★ 重整 P1（docs/10 §8.4）：**台内不再放页签条**，待办行本身就是入口，
  //   点它直达「对应台 + 对应页签」（?tab=）。三个子路由**保留**（通知 link / 书签 / ROUTE_REDIRECTS 不破）。
  const seg = loc.pathname.replace(/^\/workbench\/?/, '')
  if (seg === 'tasks') return <MyTasks />
  if (seg === 'reviews') return <Reviews />
  if (seg === 'changes') return <Changes />

  return (
    <div className="ds-page">
      <PageHead
        title={`${data?.user.name ?? '…'}，你好`}
        sub={
          <>
            {data?.user.department?.name ?? '未分部门'}
            {data?.user.position ? ` · ${data.user.position}` : ''}
            {' · '}
            {totalOpen > 0 ? `今天有 ${totalOpen} 项待处理` : '今天没有待处理的事'}
          </>
        }
        actions={
          <>
            <Button size="small" type="primary" onClick={() => setNotifOpen(true)}>
              消息中心{c?.unread ? ` (${c.unread})` : ''}
            </Button>
          </>
        }
      />

      <Metrics items={metrics} />

      <Panel
        title="待办"
        sub="一行 = 一件事，点一下直接过去"
        help="按角色下发：你看得到的都是你有权限处理的。数量为 0 的项仍列在这里（你有这项职责，当前没有待办）。"
        extra={
          <Chip tone={totalOpen ? 'acc' : undefined}>
            共 {totalOpen} 项
          </Chip>
        }
      >
        {groups.map(({ g, rows }) => (
          <div key={g}>
            <QueueGroup
              label={GROUP_LABEL[g]}
              tone={rows.some((r) => r.tone === 'err') ? 'err' : g === 'mine' ? 'run' : undefined}
            />
            {rows.map((t) => (
              <QueueRow
                key={t.label}
                title={t.label}
                meta={t.hint ?? (t.count ? undefined : '当前没有待办')}
                muted={t.count === 0}
                cells={[
                  { text: t.count ? `${t.count} 项` : NA, tone: t.count ? t.tone : undefined },
                ]}
                actions={
                  <Button size="small" disabled={!t.count} onClick={() => go(t.to)}>
                    去处理
                  </Button>
                }
                onClick={() => go(t.to)}
              />
            ))}
          </div>
        ))}
        {canManageUsers && (
          <div>
            <QueueGroup label="系统管理" />
            <QueueRow
              title="用户与权限"
              meta="组织架构 · 角色与岗位 · 操作日志 · 演示数据"
              onClick={() => nav('/admin/users')}
              actions={<Button size="small">进入</Button>}
            />
          </div>
        )}
        {!groups.length && !canManageUsers && <Empty text="这个账号还没有被分配任何工作台，请联系管理员。" />}
      </Panel>

      <Panel
        title={`最新消息${c?.unread ? `（未读 ${c.unread}）` : ''}`}
        sub="只显示最近 5 条"
        help="系统通知与业务消息；点一条就直接跳到对应页面。"
        extra={
          <>
            <Button size="small" disabled={!c?.unread} onClick={() => void markAllNotificationsRead().then(load)}>
              全部已读
            </Button>
            <Button size="small" onClick={() => setNotifOpen(true)}>
              查看全部
            </Button>
          </>
        }
      >
        {messages.length ? (
          messages.map((n) => (
            <QueueRow
              key={n.id}
              lead={<Chip>{n.type}</Chip>}
              title={<span style={{ fontWeight: n.is_read ? 400 : 600 }}>{n.title}</span>}
              cells={[
                { text: <Muted>{n.created_at ? n.created_at.slice(5, 16).replace('T', ' ') : ''}</Muted> },
              ]}
              onClick={() => void openMessage(n)}
            />
          ))
        ) : (
          <Empty text="没有消息。任务派工、评审、改版、到货都会在这里通知你。" />
        )}
      </Panel>

      <Panel title="我参与的项目" sub="我是项目经理 / 销售负责人 / 项目团队成员">
        <Table
          rowKey="project_no"
          size="small"
          pagination={false}
          dataSource={data?.my_projects ?? []}
          locale={{
            emptyText: <Empty text="还没有参与的项目。项目立项后你会在团队里看到它。" />,
          }}
          onRow={(r) => ({ onClick: () => go(`/projects/${r.project_no}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: '项目号', dataIndex: 'project_no', width: 120, render: (v: string) => <Code>{v}</Code> },
            { title: '项目名称', dataIndex: 'project_name' },
            {
              title: '阶段',
              dataIndex: 'stage',
              width: 120,
              render: (v: string) => <Status tone={toneOf(STAGE_COLOR[v])}>{v}</Status>,
            },
          ]}
        />
      </Panel>

      <NotificationsDrawer open={notifOpen} onClose={() => setNotifOpen(false)} onReadChange={() => void load()} />
    </div>
  )
}
