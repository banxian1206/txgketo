import { Alert, App, Button, Descriptions, Divider, Drawer, Input, Popconfirm, Space, Tag, Timeline, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import {
  errMsg,
  getReviewTicket,
  me,
  reviewTicket,
  withdrawTicket,
  type ReviewTicketDetail,
  type User,
} from '../api/client'
import { REVIEW_STATUS as STATUS_COLOR } from '../theme/status'

interface Props {
  ticketId: number | null
  open: boolean
  onClose: () => void
  onChanged?: () => void
}

/** 评审单详情：多轮提交 + 全部审核记录 + 发布批次；审核人在线两级审/退回，提交人可撤回 */
export default function ReviewDetailModal({ ticketId, open, onClose, onChanged }: Props) {
  const { message } = App.useApp()
  const [detail, setDetail] = useState<ReviewTicketDetail | null>(null)
  const [profile, setProfile] = useState<User | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!ticketId) return
    try {
      const [d, who] = await Promise.all([getReviewTicket(ticketId), me()])
      setDetail(d)
      setProfile(who)
      setNote('')
    } catch (e) {
      message.error(errMsg(e))
    }
  }, [ticketId, message])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const canReview1 =
    detail?.status === '待经理审' &&
    ['经理', '组长', '设计组长', '主管'].includes(profile?.position ?? '') &&
    profile?.profession === detail.profession
  const canReview2 =
    detail?.status === '待总监审' && ['总监', '部门负责人', '工程总监'].includes(profile?.position ?? '')
  const canWithdraw =
    !!detail &&
    (detail.status === '待经理审' || detail.status === '待总监审') &&
    detail.submitter_id === profile?.id

  const act = async (action: '通过' | '退回') => {
    if (!detail) return
    if (action === '退回' && !note.trim()) {
      message.warning('退回必须写说明')
      return
    }
    setBusy(true)
    try {
      await reviewTicket(detail.id, action, note)
      message.success(action === '通过' ? '已通过' : '已退回')
      await load()
      onChanged?.()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const doWithdraw = async () => {
    if (!detail) return
    setBusy(true)
    try {
      await withdrawTicket(detail.id)
      message.success('已撤回')
      await load()
      onChanged?.()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const rounds = Array.from(new Set((detail?.items ?? []).map((i) => i.round_no))).sort((a, b) => a - b)

  return (
    <Drawer
      title={
        detail ? (
          <Space>
            <span>评审单 {detail.ticket_no}</span>
            <Tag color={STATUS_COLOR[detail.status] ?? 'default'}>{detail.status}</Tag>
          </Space>
        ) : (
          '评审单'
        )
      }
      open={open}
      width={720}
      onClose={onClose}
      footer={
        <Space>
          {canWithdraw && (
            <Popconfirm title="撤回这一轮提交？内容会解锁回草稿" onConfirm={() => void doWithdraw()}>
              <Button loading={busy}>撤回</Button>
            </Popconfirm>
          )}
          {(canReview1 || canReview2) && (
            <>
              <Button danger loading={busy} onClick={() => void act('退回')}>
                退回
              </Button>
              <Button type="primary" loading={busy} onClick={() => void act('通过')}>
                通过
              </Button>
            </>
          )}
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
    >
      {detail && (
        <>
          <Descriptions size="small" column={2} style={{ marginBottom: 8 }}>
            <Descriptions.Item label="任务">
              {detail.task_no} {detail.task_title}
            </Descriptions.Item>
            <Descriptions.Item label="设备">
              {detail.project_no} / {detail.equip_no}
            </Descriptions.Item>
            <Descriptions.Item label="专业">{detail.profession}</Descriptions.Item>
            <Descriptions.Item label="提交人">{detail.submitter_name ?? '—'}</Descriptions.Item>
          </Descriptions>
          {(canReview1 || canReview2) && (
            <Input.TextArea
              rows={2}
              style={{ marginBottom: 10 }}
              placeholder="审核意见（退回必填）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
          {detail.status === '已退回' && (
            <Alert type="warning" showIcon style={{ marginBottom: 10 }} message="已退回：修改后在同一张单上重新提交，审核记录会保留" />
          )}

          {rounds.map((r) => {
            const items = detail.items.filter((i) => i.round_no === r)
            const acts = detail.actions.filter((a) => a.round_no === r)
            const rel = detail.releases.find((x) => x.round_no === r)
            return (
              <div key={r} style={{ marginBottom: 12 }}>
                <Divider orientation="left" plain>
                  第 {r} 轮
                </Divider>
                <Timeline
                  items={[
                    ...items.map((i) => ({
                      color: 'blue',
                      children: (
                        <span>
                          <Tag>{i.item_label}</Tag>
                          {i.item_ref}
                          {i.version ? ` ${i.version}` : ''}
                          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                            {i.submitted_by_name} {i.submitted_at?.slice(5, 16).replace('T', ' ')}
                          </Typography.Text>
                        </span>
                      ),
                    })),
                    ...acts.map((a) => ({
                      color: a.action === '退回' ? 'red' : a.action === '撤回' ? 'gray' : a.action === '跳过' ? 'gray' : 'green',
                      children: (
                        <span>
                          {a.level === 1 ? '经理' : a.level === 2 ? '总监' : '提交人'}
                          {a.action}
                          {a.reviewer_name ? ` · ${a.reviewer_name}` : ''}
                          {a.note ? `：${a.note}` : ''}
                          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                            {a.acted_at?.slice(5, 16).replace('T', ' ')}
                          </Typography.Text>
                        </span>
                      ),
                    })),
                    ...(rel
                      ? [
                          {
                            color: 'green',
                            children: (
                              <span>
                                发布冻结 <Tag color="success">{rel.release_no}</Tag>
                                {rel.released_by_name ? ` · ${rel.released_by_name}` : ''}
                                <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                                  {rel.released_at?.slice(5, 16).replace('T', ' ')}
                                </Typography.Text>
                              </span>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            )
          })}
        </>
      )}
    </Drawer>
  )
}
