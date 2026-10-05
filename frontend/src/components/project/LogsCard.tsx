// components/project/LogsCard.tsx —— 由 ProjectDetailPage 拆出（重构 1.6b · 只拆不改）
import { Card, Empty, Timeline, Typography } from 'antd'

import { type AuditLog, type ProjectDetail as Detail } from '../../api/client'

export default function LogsCard({
  logs
}: {
  detail: Detail | null;
  logs: AuditLog[];
}) {
  return (
    <>
          <Card id="sec-logs" size="small" title={`操作记录（${logs.length}）`}>
            {logs.length ? (
              <Timeline
                items={logs.map((l) => {
                  const changes = l.detail?.changes ?? []
                  return {
                    children: (
                      <>
                        <div>{l.summary ?? l.action}</div>
                        {changes.length > 0 && (
                          <div style={{ marginTop: 4 }}>
                            {changes.map((c, i) => (
                              <div key={i} style={{ fontSize: 12 }}>
                                <Typography.Text type="secondary">{c.label}：</Typography.Text>
                                <Typography.Text delete type="secondary">
                                  {c.old}
                                </Typography.Text>
                                <Typography.Text type="secondary"> → </Typography.Text>
                                <Typography.Text strong>{c.new}</Typography.Text>
                              </div>
                            ))}
                          </div>
                        )}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {l.created_at.replace('T', ' ').slice(0, 16)} · {l.username}
                        </Typography.Text>
                      </>
                    ),
                  }
                })}
              />
            ) : (
              <Empty description="还没有操作记录" />
            )}
          </Card>
    </>
  )
}
