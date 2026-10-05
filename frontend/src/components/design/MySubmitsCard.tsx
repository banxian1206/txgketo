// components/design/MySubmitsCard.tsx —— 由 EquipmentDesign 拆出（重构 1.6 · 只拆不改）
import { Card, Space, Table, Typography } from 'antd'
import { Status, Chip } from '../../components/ds'



import { type MyDesignTask } from '../../api/client'
import { REVIEW_STATUS as REVIEW_STATUS_COLOR, toneOf } from '../../theme/status'

export default function MySubmitsCard({
myTasks,
  setDetailOpen,
  setDetailTicketId,
  setReviewOpen,
  setReviewTask
}: {
myTasks: MyDesignTask[];
  setDetailOpen: (...args: any[]) => any;
  setDetailTicketId: (...args: any[]) => any;
  setReviewOpen: (...args: any[]) => any;
  setReviewTask: (...args: any[]) => any;
}) {
  return (
    <>
        <Card size="small" title="我的提交（评审单）" style={{ marginBottom: 16 }}>
          <Table<MyDesignTask>
            rowKey="task_id"
            size="small"
            pagination={false}
            dataSource={myTasks}
            columns={[
              {
                title: '任务号',
                dataIndex: 'task_no',
                width: 100,
                render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
              },
              { title: '任务', dataIndex: 'title' },
              {
                title: '评审状态',
                key: 'status',
                width: 140,
                render: (_: unknown, r: MyDesignTask) =>
                  r.ticket ? (
                    <Status tone={toneOf(REVIEW_STATUS_COLOR[r.ticket.status])}>{r.ticket.status}</Status>
                  ) : (
                    <Chip>未提交</Chip>
                  ),
              },
              {
                title: '轮次',
                key: 'round',
                width: 80,
                render: (_: unknown, r: MyDesignTask) =>
                  r.ticket ? `第 ${r.ticket.current_round} 轮` : '—',
              },
              {
                title: '操作',
                key: 'action',
                width: 200,
                render: (_: unknown, r: MyDesignTask) => (
                  <Space size="middle">
                    {(!r.ticket || !r.ticket.status.includes('待')) && (
                      <a
                        onClick={() => {
                          setReviewTask(r)
                          setReviewOpen(true)
                        }}
                      >
                        提交评审
                      </a>
                    )}
                    {r.ticket && (
                      <a
                        onClick={() => {
                          setDetailTicketId(r.ticket!.id)
                          setDetailOpen(true)
                        }}
                      >
                        审核记录
                      </a>
                    )}
                  </Space>
                ),
              },
            ]}
          />
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
            勾选草稿内容 → 经理 → 总监 → 发布（= 冻结）。退回/撤回后内容回到草稿，可在同一张单上重新提交。
          </Typography.Paragraph>
        </Card>
    </>
  )
}
