import { useWarehouseBoard } from './hooks'
import type { StorageRow } from './types'
import { App, Button, Card, Empty, Input, Modal, Space, Spin, Tabs, Tag, Typography } from 'antd'
import {useState} from 'react'
import { useNavigate } from 'react-router-dom'

import {errMsg, storeReceipt} from '../../api/client'
import AuthedImage from '../../components/AuthedImage'


/** 手机端仓库：待验收 / 待入库 / 领料（03 卷：清单 + 勾选 + 拍照） */
export default function WarehouseM() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const [storeFor, setStoreFor] = useState<StorageRow | null>(null)
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)

  // 重构 2.0：与 PC 共享同一数据 hook（同源计数）
  const { wb, loading, reload: load } = useWarehouseBoard()

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
                    {!!g.photos?.length && (
                      <Space wrap size={4}>
                        {g.photos.map((p, i) => (
                          <AuthedImage key={i} path={p.url} size={44} />
                        ))}
                      </Space>
                    )}
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
