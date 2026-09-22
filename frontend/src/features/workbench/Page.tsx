import { App, Button, Card, Col, List, Row, Space, Statistic, Table, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

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

interface TodoCard {
  label: string
  count: number
  to: string
  hint?: string
}

/** 我的工作台（06 卷 §8）：一屏看完「我该干的事」+ 我能进的工作台 */
export default function Workbench() {
  const { message } = App.useApp()
  const nav = useNavigate()
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
  const todos: TodoCard[] = [
    { label: '我的任务', count: c?.my_tasks ?? 0, to: '/my-tasks' },
    { label: '待我审核', count: c?.to_review ?? 0, to: '/reviews', hint: '评审单' },
    { label: '待我裁决', count: c?.to_decide ?? 0, to: '/changes', hint: '改版申请' },
    { label: '待我改版', count: c?.to_change ?? 0, to: '/changes', hint: '改版任务' },
    { label: '我提的改版', count: c?.my_changes ?? 0, to: '/changes' },
    { label: '待采购', count: c?.to_purchase ?? 0, to: '/purchase', hint: '采购池' },
    { label: '待验收', count: c?.to_inspect ?? 0, to: '/m/warehouse' },
    { label: '待入库', count: c?.to_store ?? 0, to: '/m/warehouse' },
    { label: '待领料', count: c?.issues ?? 0, to: '/m/issues' },
    { label: '我的商机', count: c?.my_leads ?? 0, to: '/projects', hint: '线索 / 待立项' },
  ]

  const visibleWorkbenches = (data?.workbenches ?? []).filter((w) => w.visible && w.key !== 'mine')

  return (
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
        {todos.map((t) => (
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
      </Row>

      {visibleWorkbenches.length > 0 && (
        <Card size="small" title="我能进的工作台" style={{ marginTop: 12 }}>
          <Space wrap>
            {visibleWorkbenches.map((w) => (
              <Tag
                key={w.key}
                color="blue"
                style={{ cursor: 'pointer', padding: '4px 10px', fontSize: 13 }}
                onClick={() => nav(w.route)}
              >
                {w.name} →
              </Tag>
            ))}
          </Space>
        </Card>
      )}

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
  )
}
