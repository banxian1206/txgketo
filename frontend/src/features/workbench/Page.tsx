
import { App, Button, Card, Col, List, Row, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd'
import { lazy, useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import NotificationsDrawer from '../../components/NotificationsDrawer'
import {
  errMsg,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  workbenchMe,
  type NotificationRow,
  type WorkbenchMe,
} from '../../api/client'
import { WB_TYPE as TYPE_COLOR } from '../../theme/status'
import { PROJECT_STAGE as STAGE_COLOR } from '../../theme/status'
import { T } from '../../theme/tokens'
// A2（v2 拍板②）：三业务页组件复用挂入我的台（lazy import 与 App 同 chunk）
const MyTasks = lazy(() => import('../task/Page'))
const Reviews = lazy(() => import('../review/Page'))
const Changes = lazy(() => import('../change/Page'))

interface TodoCard {
  label: string
  count: number
  to: string
  hint?: string
  /** 角色码标注（A3）：缺省 = 人人可见 */
  roles?: string[]
}

/** 我的工作台（06 卷 §8）：一屏看完「我该干的事」+ 我能进的工作台 */
export default function Workbench() {
  const { message } = App.useApp()
  const nav = useNavigate()
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
    if (n.link) nav(n.link)
    else await load()
  }

  const c = data?.counts
  // A3（v2 拍板）：KPI 按角色裁剪 —— 卡带 roles 标注（对齐后端 WORKBENCHES 思路），ADMIN 角色兜底；
  // 人人卡（我的任务/我提的改版）不标注。仓库三卡改指 PC 仓库台（A6 桌面跳移动修正提前完成）。
  const todos: TodoCard[] = [
    { label: '我的任务', count: c?.my_tasks ?? 0, to: '/workbench/tasks',
      // ★ 到期扫描（§8.3）：超期了就红字点出来，别等他自己翻
      hint: c?.overdue_tasks ? `⚠ 超期 ${c.overdue_tasks}` : undefined },
    { label: '待我审核', count: c?.to_review ?? 0, to: '/workbench/reviews', hint: '评审单', roles: ['DESIGN_AUDIT', 'ADMIN'] },
    { label: '待我裁决', count: c?.to_decide ?? 0, to: '/workbench/changes', roles: ['DESIGN_AUDIT', 'ADMIN'] },
    { label: '待我改版', count: c?.to_change ?? 0, to: '/workbench/changes', hint: '改版任务', roles: ['DESIGN', 'DESIGN_AUDIT', 'CRAFT', 'ADMIN'] },
    { label: '我提的改版', count: c?.my_changes ?? 0, to: '/workbench/changes' },
    { label: '待采购', count: c?.to_purchase ?? 0, to: '/purchase', hint: '采购池', roles: ['PURCHASE', 'PURCHASE_LEAD', 'ADMIN'] },
    { label: '待验收', count: c?.to_inspect ?? 0, to: '/warehouse', roles: ['WAREHOUSE', 'ADMIN'] },
    { label: '待入库', count: c?.to_store ?? 0, to: '/warehouse', roles: ['WAREHOUSE', 'ADMIN'] },
    { label: '待领料', count: c?.issues ?? 0, to: '/warehouse', roles: ['WAREHOUSE', 'ADMIN'] },
    { label: '我的商机', count: c?.my_leads ?? 0, to: '/projects', hint: '线索 / 待立项', roles: ['SALES', 'SCHEME', 'ADMIN'] },
  ]
  // 裁剪：角色码交集 + ADMIN 兜底（无 roles = 人人卡）
  const myRoles = data?.user.roles ?? []
  const isAdminRole = myRoles.includes('ADMIN')
  const visibleTodos = todos.filter((t) => !t.roles || isAdminRole || t.roles.some((r) => myRoles.includes(r)))
  // 管理入口卡（canManageUsers 对齐：ADMIN 角色或总监岗）——纯入口无数字，不发明数据
  const canManageUsers = isAdminRole || data?.user.position === '总监'



  // A2：台内页签 = URL 子路由（/workbench/tasks 等）——待办/我的任务/设计评审/改版申请
  const seg = loc.pathname.replace(/^\/workbench\/?/, '')
  const activeKey = ['tasks', 'reviews', 'changes'].includes(seg) ? seg : 'todo'
  return (
    <Tabs
      type="card"
      activeKey={activeKey}
      onChange={(k) => nav(k === 'todo' ? '/workbench' : `/workbench/${k}`)}
      items={[
        {
          key: 'todo',
          label: '待办',
          children: (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Typography.Text strong style={{ fontSize: 16 }}>
            {data?.user.name ?? '…'}
          </Typography.Text>
          <Tag>{data?.user.department?.name ?? '未分部门'}</Tag>
          {data?.user.position && <Tag color="blue">{data.user.position}</Tag>}
          {data?.user.title && <Tag>{data.user.title}</Tag>}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {data?.user.roles.join(' / ')}
          </Typography.Text>
        </Space>
      </Card>

      <Row gutter={[12, 12]}>
        {visibleTodos.map((t) => (
          <Col xs={12} sm={8} md={6} lg={4} xl={4} key={t.label}>
            <Card size="small" hoverable onClick={() => nav(t.to)} style={{ textAlign: 'center' }}>
              <Statistic
                title={t.label}
                value={t.count}
                valueStyle={{ fontSize: 20, color: t.count ? T.brand : T.textDisabled }}
              />
              {t.hint && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t.hint}
                </Typography.Text>
              )}
            </Card>
          </Col>
        ))}
        {canManageUsers && (
          <Col xs={12} sm={8} md={6} lg={4} xl={4}>
            <Card size="small" hoverable onClick={() => nav('/admin/users')} style={{ textAlign: 'center' }}>
              <Statistic title="系统管理" value="入口" valueStyle={{ fontSize: 20, color: T.brand }} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                用户与权限 · 操作日志 · 演示数据
              </Typography.Text>
            </Card>
          </Col>
        )}
      </Row>


      <Card
        size="small"
        title={`最新消息（未读 ${data?.counts.unread ?? 0}）`}
        style={{ marginTop: 12 }}
        extra={
          <Space>
            <Button size="small" disabled={!data?.counts.unread} onClick={() => void markAllNotificationsRead().then(load)}>
              全部已读
            </Button>
            <Button size="small" onClick={() => setNotifOpen(true)}>
              查看全部
            </Button>
          </Space>
        }
      >
        <List
          size="small"
          dataSource={messages}
          locale={{ emptyText: '没有消息' }}
          renderItem={(n) => (
            <List.Item style={{ cursor: 'pointer', padding: '6px 0' }} onClick={() => void openMessage(n)}>
              <Space size={6} wrap>
                <Tag color={TYPE_COLOR[n.type] ?? 'default'}>{n.type}</Tag>
                <span style={{ fontWeight: n.is_read ? 400 : 600 }}>{n.title}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {n.created_at ? n.created_at.slice(5, 16).replace('T', ' ') : ''}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      </Card>

      <NotificationsDrawer open={notifOpen} onClose={() => setNotifOpen(false)} onReadChange={() => void load()} />

      <Card size="small" title="我参与的项目" style={{ marginTop: 12 }}>
        <Table
          rowKey="project_no"
          size="small"
          pagination={false}
          dataSource={data?.my_projects ?? []}
          locale={{ emptyText: '还没有参与的项目' }}
          onRow={(r) => ({ onClick: () => nav(`/projects/${r.project_no}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: '项目号', dataIndex: 'project_no', width: 110 },
            { title: '项目名称', dataIndex: 'project_name' },
            {
              title: '阶段',
              dataIndex: 'stage',
              width: 110,
              render: (v: string) => <Tag color={STAGE_COLOR[v] ?? 'default'}>{v}</Tag>,
            },
          ]}
        />
      </Card>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
        每个节点一个工作台，按角色显示；「我的工作台」把所有待办收在一屏。工作台的详细内容随后续步骤补齐（06 卷 §11）。
      </Typography.Paragraph>
    </>
        ),
        },
        { key: 'tasks', label: '我的任务', children: <MyTasks /> },
        { key: 'reviews', label: '设计评审', children: <Reviews /> },
        { key: 'changes', label: '改版申请', children: <Changes /> },
      ]}
    />
  )
}
