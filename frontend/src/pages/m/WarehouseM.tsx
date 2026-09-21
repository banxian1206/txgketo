import { App, Button, Card, Empty, Input, Modal, Space, Spin, Tabs, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, errMsg, storeReceipt } from '../../api/client'

interface Incoming {
  id: number
  project_no: string
  project_name?: string | null
  equip_no?: string | null
  equip_name?: string | null
  item_no: string
  display_name: string
  spec_text?: string | null
  qty: number
  qty_received: number
  unit?: string | null
  po_no?: string | null
  supplier_name?: string | null
  need_date?: string | null
  expected_date?: string | null
  overdue: boolean
}

interface PendingStorage {
  id: number
  receipt_no: string
  project_no: string
  project_name?: string | null
  po_no?: string | null
  equip_no?: string | null
  equip_name?: string | null
  supplier_name?: string | null
  item_no: string
  display_name: string
  spec_text?: string | null
  qty: number
  unit?: string | null
  receipt_date?: string | null
}

interface PendingIssue {
  id: number
  issue_no: string
  project_no: string
  equip_no?: string | null
  status: string
  line_count: number
  shortage_count: number
}

interface Workbench {
  incoming: Incoming[]
  pending_storage: PendingStorage[]
  pending_issues: PendingIssue[]
}

/** 手机端仓库：待验收 / 待入库 / 领料（03 卷：清单 + 勾选 + 拍照） */
export default function WarehouseM() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const [wb, setWb] = useState<Workbench | null>(null)
  const [loading, setLoading] = useState(true)
  const [storeFor, setStoreFor] = useState<PendingStorage | null>(null)
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<Workbench>('/warehouse/workbench')
      setWb(data)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const doStore = async () => {
    if (!storeFor) return
    setSaving(true)
    try {
      const r = await storeReceipt(storeFor.id, { location })
      message.success(`已入库：${r.receipt_no} → ${r.location}`)
      setStoreFor(null)
      setLocation('')
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const incoming = wb?.incoming ?? []
  const storage = wb?.pending_storage ?? []
  const issues = wb?.pending_issues ?? []

  return (
    <>
      <Spin spinning={loading}>
        <Tabs
        items={[
          {
            key: 'incoming',
            label: `待验收 (${incoming.length})`,
            children: incoming.length ? (
              incoming.map((r) => (
                <Card
                  key={r.id}
                  size="small"
                  style={{ marginBottom: 10 }}
                  onClick={() => nav(`/m/accept/${r.id}`)}
                >
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Space>
                      <Typography.Text strong>{r.display_name}</Typography.Text>
                      {r.overdue && <Tag color="red">预计超期</Tag>}
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.spec_text ?? ''}
                    </Typography.Text>
                    <Typography.Text style={{ fontSize: 13 }}>
                      订 {r.qty} {r.unit ?? ''} · 已到 {r.qty_received} · {r.supplier_name ?? '—'}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.project_no} {r.equip_no ?? ''} · 采购单 {r.po_no ?? '—'} · 需要 {r.need_date ?? '—'}
                    </Typography.Text>
                  </Space>
                </Card>
              ))
            ) : (
              <Empty description="没有待验收的货" />
            ),
          },
          {
            key: 'storage',
            label: `待入库 (${storage.length})`,
            children: storage.length ? (
              storage.map((g) => (
                <Card key={g.id} size="small" style={{ marginBottom: 10 }}>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Typography.Text strong>
                      {g.receipt_no} · {g.display_name}
                    </Typography.Text>
                    <Typography.Text style={{ fontSize: 13 }}>
                      {g.qty} {g.unit ?? ''} · {g.supplier_name ?? '—'} · 采购单 {g.po_no ?? '—'}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {g.project_no} {g.equip_no ?? ''} · 验收 {g.receipt_date ?? '—'}
                    </Typography.Text>
                    <Button type="primary" size="small" onClick={() => setStoreFor(g)}>
                      选库位入库
                    </Button>
                  </Space>
                </Card>
              ))
            ) : (
              <Empty description="没有待入库的货" />
            ),
          },
          {
            key: 'issues',
            label: `领料 (${issues.length})`,
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                  备料 → 车间领走，都在「领料」页里做。
                </Typography.Paragraph>
                {issues.map((i) => (
                  <Card key={i.id} size="small" style={{ marginBottom: 10 }} onClick={() => nav('/m/issues')}>
                    <Space>
                      <Typography.Text strong>{i.issue_no}</Typography.Text>
                      <Tag>{i.status}</Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {i.project_no} {i.equip_no ?? ''} · {i.line_count} 种
                        {i.shortage_count > 0 ? ` · 缺 ${i.shortage_count}` : ''}
                      </Typography.Text>
                    </Space>
                  </Card>
                ))}
                {!issues.length && <Empty description="没有待办领料单" />}
              </>
            ),
          },
        ]}
      />
      </Spin>

      <Modal
        title={`入库 · ${storeFor?.receipt_no ?? ''}`}
        open={!!storeFor}
        onCancel={() => setStoreFor(null)}
        onOk={() => void doStore()}
        confirmLoading={saving}
        okText="入库"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          库位填法：深圳仓 A-03-12（不填就进「待定」）
        </Typography.Paragraph>
        <Input
          placeholder="如：深圳仓 A-03-12"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </Modal>
    </>
  )
}
