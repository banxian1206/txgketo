// components/project/EquipmentsCard.tsx —— 由 ProjectDetailPage 拆出（重构 1.6b · 只拆不改）
import {
  Card,
  Empty,
  Progress,
  Space,
  Table,
  Typography,
} from 'antd'
import {useNavigate} from 'react-router-dom'

import {
  type KittingOverviewRow,
} from '../../api/client'
import { T } from '../../theme/tokens'

export default function EquipmentsCard({
  kitting
}: {
  kitting: KittingOverviewRow[];
}) {
  const nav = useNavigate()
  return (
    <>
              <Card
                id="sec-kitting"
                size="small"
                title="齐套率（装配 · 只展示，不设门槛）"
                style={{ marginBottom: 16 }}
                extra={<a onClick={() => nav('/workbench/shop/assembly')}>装配 / 厂内调试</a>}
              >
                <Table<KittingOverviewRow>
                  rowKey="equip_no"
                  size="small"
                  pagination={false}
                  dataSource={kitting}
                  locale={{ emptyText: <Empty description="还没有设备" /> }}
                  columns={[
                    {
                      title: '设备',
                      key: 'eq',
                      width: 180,
                      render: (_: unknown, r: KittingOverviewRow) => (
                        <Space size={6}>
                          <Typography.Text strong>{r.equip_no}</Typography.Text>
                          <span>{r.equip_name}</span>
                        </Space>
                      ),
                    },
                    {
                      title: '齐套率',
                      key: 'rate',
                      width: 280,
                      render: (_: unknown, r: KittingOverviewRow) => (
                        <Progress
                          size="small"
                          percent={Math.round((r.kitting_rate ?? 0) * 100)}
                          strokeColor={r.kitting_rate >= 1 ? T.success : r.kitting_rate >= 0.6 ? T.brand : T.warning}
                        />
                      ),
                    },
                    {
                      title: '到位',
                      key: 'd',
                      render: (_: unknown, r: KittingOverviewRow) =>
                        `${r.arrived}/${r.total} 种 · 数量 ${r.arrived_qty}/${r.total_qty}`,
                    },
                  ]}
                />
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 0' }}>
                  齐套率只做展示：装配随时能开工（56%、78% 都行），不设 100% 门槛。自制件已转运、外协件合格、采购件已到货/入库、库存够，就算到位。
                </Typography.Paragraph>
              </Card>
    </>
  )
}
