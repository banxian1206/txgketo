import { App, Badge, Button, Drawer, Empty, List, Space, Typography } from 'antd'
import { Status } from '../components/ds'
import { useCallback, useEffect, useState } from 'react'

import { errMsg, listNotifications, markAllNotificationsRead, markNotificationRead, type NotificationRow } from '../api/client'
import { NOTIF_TYPE as TYPE_COLOR, toneOf } from '../theme/status'
import { useGoFrom } from '../hooks/useFrom'

// 通知类型中文名（P-18：不再裸露英文 type）
const TYPE_LABEL: Record<string, string> = {
  task: '任务',
  review: '评审',
  change: '改版',
  release: '发布',
  warehouse: '仓库',
  purchase: '采购',
  acceptance: '验收',
  service: '售后',
}

// 移动端（/m）里点击消息：把 PC 路由映射到移动页
// ★ R4-01（走查 2026-10-04）：手机端没有对应页面的（任务/评审/改版/采购/项目详情…）
//   **不许把人踹进 PC 壳**（会冒出桌面侧栏/宽表横滚），改为一句实话。
const MOBILE_LINK: Record<string, string> = {
  '/warehouse': '/m/warehouse',
  '/shipping': '/m/shipping',
  '/service': '/m/service',
  '/site': '/m/site',
  '/manufacturing': '/m/production',
  '/acceptance': '/m/site',
  '/my-tasks': '/m',
}

interface Props {
  open: boolean
  onClose: () => void
  onReadChange?: (unread: number) => void
}

/** 站内消息抽屉（PC / 移动端共用，06 卷 §9）：永久保留、点开跳单据、全部已读 */
export default function NotificationsDrawer({ open, onClose, onReadChange }: Props) {
  const { message } = App.useApp()
  // ★ 站内消息也是“跨域下钻”的一种：带上来源，详情页才能给出「← 返回某某工作台」（P2-7）
  const go = useGoFrom()
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
    if (n.link) {
      const onMobile = typeof window !== 'undefined' && window.location.pathname.startsWith('/m')
      if (!onMobile || n.link.startsWith('/m')) {
        go(n.link)
      } else {
        const mapped = MOBILE_LINK[n.link]
        if (mapped) go(mapped)
        // ★ 手机端没有这个页面（任务/评审/改版/采购/项目详情…）→ 不跳，说明白（下个迭代才做移动页）
        else message.info('这条消息对应的功能在电脑端处理（手机端还没这个页面）')
      }
    } else {
      void load()
    }
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
                  <Status tone={toneOf(TYPE_COLOR[n.type])}>{TYPE_LABEL[n.type] ?? n.type}</Status>
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
