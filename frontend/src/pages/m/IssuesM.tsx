import { App, Button, Card, Empty, Space, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { api, errMsg } from '../../api/client'

const STATUS_COLOR: Record<string, string> = { 待备料: 'gold', 已备料: 'processing', 已领走: 'success' }

interface IssueLine {
  id: number
  item_no: string
  display_name: string
  spec_text?: string | null
  unit?: string | null
  qty_required: number
  qty_issued: number
  location_name?: string | null
  shortage: boolean
  for_part?: string | null
}

interface IssueRow {
  id: number
  issue_no: string
  project_no: string
  equip_no?: string | null
  status: string
  lines: IssueLine[]
}

/** 手机端领料：备料 → 车间领走（03 卷：清单 + 勾选） */
export default function IssuesM() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<IssueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<IssueRow[]>('/warehouse/issues')
      setRows(data)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (id: number, action: 'pick' | 'hand-over') => {
    const body: Record<string, unknown> = {}
    if (action === 'hand-over') {
      const who = window.prompt('领料人（车间）')
      if (!who) return
      body.issued_to = who
    }
    setBusyId(id)
    try {
      await api.post(`/warehouse/issues/${id}/${action}`, body)
      message.success(action === 'pick' ? '已备料' : '已领走')
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setBusyId(null)
    }
  }

  const open = rows.filter((r) => r.status === '待备料' || r.status === '已备料')

  return (
    <>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        领料（备料 → 领走）
      </Typography.Title>
      {!open.length && !loading && <Empty description="没有待办领料单" />}
      {open.map((r) => (
        <Card key={r.id} size="small" style={{ marginBottom: 10 }}>
          <Space>
            <Typography.Text strong>{r.issue_no}</Typography.Text>
            <Tag color={STATUS_COLOR[r.status] ?? 'default'}>{r.status}</Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {r.project_no} {r.equip_no ?? ''}
            </Typography.Text>
          </Space>
          <div style={{ marginTop: 8 }}>
            {r.lines.map((ln) => (
              <div key={ln.id} style={{ fontSize: 13, marginBottom: 2 }}>
                {ln.display_name} × {ln.qty_required} {ln.unit ?? ''}
                {ln.location_name ? `（${ln.location_name}）` : ''}
                {ln.shortage ? <Tag color="red" style={{ marginLeft: 6 }}>缺料</Tag> : null}
              </div>
            ))}
          </div>
          <Space style={{ marginTop: 8 }}>
            {r.status === '待备料' && (
              <Button size="small" type="primary" loading={busyId === r.id} onClick={() => void act(r.id, 'pick')}>
                备料完成
              </Button>
            )}
            {r.status === '已备料' && (
              <Button size="small" type="primary" loading={busyId === r.id} onClick={() => void act(r.id, 'hand-over')}>
                车间领走
              </Button>
            )}
          </Space>
        </Card>
      ))}
    </>
  )
}
