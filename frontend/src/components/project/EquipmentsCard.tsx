import { Link } from 'react-router-dom'
// components/project/EquipmentsCard.tsx —— 由 ProjectDetailPage 拆出（重构 1.6b · 只拆不改）
import { Card, Empty, Progress, Space, Table, Typography } from 'antd'
import { type KittingOverviewRow } from '../../api/client'
import { useGoFrom } from '../../hooks/useFrom'
import { T } from '../../theme/tokens'

export default function EquipmentsCard({
  kitting,
  projectNo,
}: {
  kitting: KittingOverviewRow[];
  /** ★ 入口（2026-10-05）：设备档案需要项目号才能定位 —— 由项目详情传进来 */
  projectNo: string;
}) {
  // ★ 来源优先：项目详情 → 车间台（装配）也带来源
  const go = useGoFrom()
  return (
    <>
              <Card
                id="sec-kitting"
                size="small"
                title="齐套率（装配 · 只展示，不设门槛）"
                style={{ marginBottom: 16 }}
                extra={<a onClick={() => go('/workbench/shop/assembly')}>装配 / 厂内调试</a>}
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
                      // ★ 入口（2026-10-05 用户实测"找不到设备档案"）：设备行就是它最自然的入口
                      render: (_: unknown, r: KittingOverviewRow) => (
                        <Space size={6}>
                          <Link to={`/equipment/${projectNo}/${r.equip_no}`} title="看这台设备的一生（设计/齐套/制造/装配/发运/现场/售后）">
                            <Typography.Text strong>{r.equip_no}</Typography.Text>
                          </Link>
                          <Link to={`/equipment/${projectNo}/${r.equip_no}`}>{r.equip_name}</Link>
                        </Space>
                      ),
                    },
                    {
                      title: '齐套率',
                      key: 'rate',
                      width: 280,
                      render: (_: unknown, r: KittingOverviewRow) => (
                        <Progress
                          aria-label="齐套率"
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
