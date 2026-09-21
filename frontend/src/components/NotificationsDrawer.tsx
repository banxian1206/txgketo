import { App, Badge, Button, Drawer, Empty, List, Space, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  errMsg,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from '../api/client'

const TYPE_COLOR: Record<string, string> = {
  task: 'blue',
  review: 'gold',
  change: 'purple',
  warehouse: 'cyan',
  purchase: 'orange',
}

interface Props {
  open: boolean
  onClose: () => void
  onReadChange?: (unread: number) => void
}

/** 站内消息抽屉（PC / 移动端共用，06 卷 §9）：永久保留、点开跳单据、全部已读 */
export default function NotificationsDrawer({ open, onClose, onReadChange }: Props) {
  const { message } = App.useApp()
  const nav = useNavigate()
  const [items, setItems] = useState<NotificationRow[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await listNotifications()
      setItems(r.items)
      setUnread(r.unread)
      onReadChange?.(r.unread)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message, onReadChange])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const openItem = async (n: NotificationRow) => {
    try {
      if (!n.is_read) await markNotificationRead(n.id)
    } catch {
      /* 忽略已读失败 */
    }
    onClose()
    if (n.link) nav(n.link)
    else void load()
    onReadChange?.(Math.max(0, unread - (n.is_read ? 0 : 1)))
  }

  const readAll = async () => {
    try {
      await markAllNotificationsRead()
      message.success('全部已读')
      await load()
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  return (
    <Drawer
      title={
        <Space>
          <span>站内消息</span>
          {unread > 0 && <Badge count={unread} />}
        </Space>
      }
      width={Math.min(560, typeof window !== 'undefined' ? window.innerWidth - 24 : 560)}
      open={open}
      onClose={onClose}
      footer={
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            消息永久保留
          </Typography.Text>
          <Button size="small" onClick={() => void readAll()} disabled={unread === 0}>
            全部已读
          </Button>
        </Space>
      }
    >
      {items.length === 0 && !loading && <Empty description="没有消息" />}
      <List
        loading={loading}
        dataSource={items}
        renderItem={(n) => (
          <List.Item
            style={{ cursor: 'pointer', padding: '8px 0' }}
            onClick={() => void openItem(n)}
            actions={[!n.is_read ? <Badge key="d" status="processing" /> : null]}
          >
            <List.Item.Meta
              title={
                <Space size={6}>
                  <Tag color={TYPE_COLOR[n.type] ?? 'default'}>{n.type}</Tag>
                  <span style={{ fontWeight: n.is_read ? 400 : 600 }}>{n.title}</span>
                </Space>
              }
              description={
                <>
                  {n.body && <div style={{ fontSize: 12 }}>{n.body}</div>}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {n.created_at ? n.created_at.slice(5, 16).replace('T', ' ') : ''}
                  </Typography.Text>
                </>
              }
            />
          </List.Item>
        )}
      />
    </Drawer>
  )
}
