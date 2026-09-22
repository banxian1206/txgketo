import { App, Button, Card, Table, Tabs, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'

import ChangeDetailModal from '../../components/ChangeDetailModal'
import { errMsg, listChangeRequests, type ChangeRequestRow } from '../../api/client'
import { CHANGE_STATUS as STATUS_COLOR } from '../../theme/status'

/** 改版（ECN）工作台（05 卷 §7、§9）：提申请 → 总监裁决 → 下发 → 修订 → 重审发布 */
export default function Changes() {
  const { message } = App.useApp()
  const [scope, setScope] = useState<'pending' | 'todo' | 'mine' | 'all'>('pending')
  const [rows, setRows] = useState<ChangeRequestRow[]>([])
  const [loading, setLoading] = useState(false)
  const [crId, setCrId] = useState<number | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listChangeRequests(scope))
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [scope, message])

  useEffect(() => {
    void load()
  }, [load])

  const columns: ColumnsType<ChangeRequestRow> = [
    {
      title: '申请号',
      dataIndex: 'cr_no',
      width: 100,
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    {
      title: '改版对象',
      key: 'target',
      width: 320,
      render: (_: unknown, r) => (
        <>
          <div>{r.target_title}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.target_label} {r.target_version ?? ''}
          </Typography.Text>
        </>
      ),
    },
    {
      title: '项目 / 设备',
      key: 'equip',
      width: 160,
      render: (_: unknown, r) => `${r.project_no} / ${r.equip_no ?? ''}`,
    },
    { title: '专业', dataIndex: 'profession', width: 70, render: (v: string | null) => v ?? '—' },
    {
      title: '申请人',
      dataIndex: 'applicant_name',
      width: 90,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => <Tag color={STATUS_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: '改版任务',
      key: 'task',
      width: 150,
      render: (_: unknown, r) => (r.change_task_no ? `${r.change_task_no} → ${r.change_task_owner ?? ''}` : '—'),
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      render: (_: unknown, r) => <a onClick={() => { setCrId(r.id); setOpen(true) }}>查看/处理</a>,
    },
  ]

  return (
    <Card title="改版申请（ECN）" extra={<Button onClick={() => void load()}>刷新</Button>}>
      <Tabs
        activeKey={scope}
        onChange={(k) => setScope(k as 'pending' | 'todo' | 'mine' | 'all')}
        items={[
          { key: 'pending', label: '待我裁决（总监）' },
          { key: 'todo', label: '待我改版' },
          { key: 'mine', label: '我提的' },
          { key: 'all', label: '全部' },
        ]}
      />
      <Table<ChangeRequestRow>
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={rows}
        columns={columns}
        pagination={{ pageSize: 20, showSizeChanger: false }}
      />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
        冻结后要动，必须提改版申请：总监裁决（否决必须给替代方案）→ 下发改版任务 →
        设计师改完重走两级审核 → 新版本发布、旧版留档。影响面（已生成采购需求/已领料）只提示，人工处理。
      </Typography.Paragraph>
      <ChangeDetailModal crId={crId} open={open} onClose={() => setOpen(false)} onChanged={() => void load()} />
    </Card>
  )
}
