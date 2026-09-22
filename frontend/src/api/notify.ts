// api/notify.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

export interface NotificationRow {
  id: number
  type: string
  title: string
  body?: string | null
  link?: string | null
  is_read: boolean
  created_at?: string | null
}

export async function listNotifications(unreadOnly = false) {
  const { data } = await api.get<{ unread: number; items: NotificationRow[] }>('/notifications', {
    params: unreadOnly ? { unread: true } : {},
  })
  return data
}

export async function unreadNotificationCount() {
  const { data } = await api.get<{ count: number }>('/notifications/unread-count')
  return data.count
}

export async function markNotificationRead(id: number) {
  await api.post(`/notifications/${id}/read`)
}

export async function markAllNotificationsRead() {
  const { data } = await api.post<{ ok: boolean; count: number }>('/notifications/read-all')
  return data
}
