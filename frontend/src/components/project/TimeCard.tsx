// components/project/TimeCard.tsx —— 由 ProjectDetailPage 拆出（重构 1.6b · 只拆不改）
import type { Project } from '../../api/client'
import {
  Card,
  Tag,
  Typography,
} from 'antd'

import EditableField from '../EditableField'

export default function TimeCard({
  save,
  DASH,
  p
}: {
  save: any;
  DASH: any;
  p: Project;
}) {
  return (
    <>
          <Card
            id="sec-time"
            size="small"
            title="时间与金额"
            style={{ marginBottom: 16 }}
          >
            <div className="ef-grid">
              <EditableField
                label="商机截止"
                value={p.deadline}
                type="date"
                onSave={(v) => save('deadline', v)}
              />
              <div className="ef">
                <span className="ef-label">商机剩余</span>
                <span className="ef-value">
                  {p.opportunity_days_left === null || p.opportunity_days_left === undefined ? (
                    DASH
                  ) : p.opportunity_days_left < 0 ? (
                    <Tag color="red">已过期 {-p.opportunity_days_left} 天</Tag>
                  ) : p.opportunity_days_left === 0 ? (
                    <Tag color="red">今天到期</Tag>
                  ) : (
                    <Tag color={p.opportunity_days_left <= 3 ? 'red' : 'blue'}>
                      还剩 {p.opportunity_days_left} 天
                    </Tag>
                  )}
                </span>
              </div>
              <EditableField
                label="项目交期"
                value={p.delivery_days}
                type="number"
                suffix=" 天（签约后起算）"
                onSave={(v) => save('delivery_days', v)}
              />
              <div className="ef">
                <span className="ef-label">项目起止</span>
                <span className="ef-value">
                  {p.delivery_start && p.delivery_end ? (
                    `${p.delivery_start} → ${p.delivery_end}`
                  ) : (
                    <Typography.Text type="secondary">待签约</Typography.Text>
                  )}
                </span>
              </div>
              <EditableField
                label="预计签单"
                value={p.expect_sign_date}
                type="date"
                onSave={(v) => save('expect_sign_date', v)}
              />
              <EditableField
                label="预计金额"
                value={p.est_amount}
                type="money"
                onSave={(v) => save('est_amount', v)}
              />
              <EditableField
                label="履约保证金"
                value={p.performance_deposit}
                type="money"
                suffix="（我们交给对方）"
                onSave={(v) => save('performance_deposit', v)}
              />
              <EditableField
                label="保证金退还"
                value={p.performance_deposit_return_date}
                type="date"
                onSave={(v) => save('performance_deposit_return_date', v)}
              />
              <EditableField
                label="已退还"
                value={p.performance_deposit_returned}
                type="switch"
                onSave={(v) => save('performance_deposit_returned', v)}
              />
            </div>
          </Card>
    </>
  )
}
