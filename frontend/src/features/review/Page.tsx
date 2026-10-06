import { App, Button, Card, Table, Tooltip, Typography } from 'antd'
import { Status, Empty } from '../../components/ds'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'

import WorkbenchTabs from '../../components/ds/WorkbenchTabs'
import ReviewDetailModal from '../../components/ReviewDetailModal'
import { errMsg, listReviewTickets, me, type ReviewTicketBrief, type User } from '../../api/client'
import { REVIEW_STATUS as STATUS_COLOR, toneOf } from '../../theme/status'
import { REVIEW_TABS, filterTabs, REVIEW_GROUPS } from '../../configs/tabs'
import { useTab } from '../../hooks/useTab'

/** 设计评审：待我审核 / 我提交的 / 全部（05 卷 §3、§9 评审工作台） */
export default function Reviews() {
  const { message } = App.useApp()
  // ★ 重整 P0（docs/10 §3.2/§3.3）：页签条按**真实权限码**过滤，状态写进 URL（?tab=）
  const visKeys = filterTabs(REVIEW_TABS).map((x) => x.key)
  const [tabKey, setTab] = useTab(visKeys, 'todo')
  const scope = tabKey as 'todo' | 'mine' | 'all'
  const [rows, setRows] = useState<ReviewTicketBrief[]>([])
  const [loading, setLoading] = useState(false)
  const [profile, setProfile] = useState<User | null>(null)
  const [ticketId, setTicketId] = useState<number | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [data, who] = await Promise.all([listReviewTickets(scope), me()])
      setRows(data)
      setProfile(who)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [scope, message])

  useEffect(() => {
    void load()
  }, [load])

  const openDetail = (id: number) => {
    setTicketId(id)
    setOpen(true)
  }

  const isReviewer =
    ['经理', '组长', '设计组长', '主管'].includes(profile?.position ?? '') ||
    ['总监', '部门负责人', '工程总监'].includes(profile?.position ?? '')

  const columns: ColumnsType<ReviewTicketBrief> = [
    {
      title: '评审单',
      dataIndex: 'ticket_no',
      width: 100,
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    {
      title: '任务',
      dataIndex: 'task_no',
      width: 260,
      render: (v: string | null | undefined, r) => (
        <span>
          {v} {r.task_title ?? ''}
        </span>
      ),
    },
    {
      title: '项目 / 设备',
      key: 'equip',
      width: 160,
      render: (_: unknown, r) => `${r.project_no} / ${r.equip_no ?? ''}`,
    },
    {
      title: '专业',
      dataIndex: 'profession',
      width: 70,
      render: (v: string | null | undefined) => v ?? '—',
    },
    {
      title: '提交人',
      dataIndex: 'submitter_name',
      width: 90,
      render: (v: string | null | undefined) => v ?? '—',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Status tone={toneOf(STATUS_COLOR[v])}>{v}</Status>,
    },
    {
      title: '轮次',
      dataIndex: 'current_round',
      width: 60,
      render: (v: number) => `第 ${v} 轮`,
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 130,
      render: (v: string | null | undefined) => (v ? v.slice(5, 16).replace('T', ' ') : '—'),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: unknown, r: ReviewTicketBrief) => (
        <a onClick={() => openDetail(r.id)}>{r.status.includes('待') && isReviewer ? '去审核' : '查看'}</a>
      ),
    },
  ]

  return (
    <Card
      title={
        <>
          设计评审{' '}
          <Tooltip title="审核链：组员提交 → 本部门经理（一级）→ 总监（二级）→ 发布（= 冻结）。发布后这一轮内容成为冻结版本，采购按发布批次触发。">
            <span className="ds-help">?</span>
          </Tooltip>
        </>
      }
      extra={<Button onClick={() => void load()}>刷新</Button>}
    >
      <WorkbenchTabs
        groups={REVIEW_GROUPS}
        tab={scope}
        onTab={setTab}
        items={[
          { key: 'todo', label: `待我审核 (${scope === 'todo' ? rows.length : '—'})` },
          { key: 'mine', label: '我提交的' },
          { key: 'all', label: '全部' },
        ].filter((x) => visKeys.includes(x.key))}
      />
      <Table<ReviewTicketBrief>
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={rows}
        columns={columns}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        locale={{ emptyText: <Empty text="没有评审单 —— 设计师提交后会出现在这里。" /> }}
      />
      <ReviewDetailModal
        ticketId={ticketId}
        open={open}
        onClose={() => setOpen(false)}
        onChanged={() => void load()}
      />
    </Card>
  )
}
