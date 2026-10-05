// components/project/DesignProgressCard.tsx —— 由 ProjectDetailPage 拆出（重构 1.6b · 只拆不改）
import { Button, Card, Empty, Space, Table, Typography } from 'antd'
import { Chip } from '../../components/ds'

import { type DesignOverviewRow } from '../../api/client'
import { useGoFrom } from '../../hooks/useFrom'

export default function DesignProgressCard({
  design,
  projectNo
}: {
  design: DesignOverviewRow[];
  projectNo: any;
}) {
  const go = useGoFrom()
  return (
    <>
              <Card
                id="sec-design"
                size="small"
                title="设计进度（工程设计 · 设计 BOM + 材料 BOM）"
                style={{ marginBottom: 16 }}
              >
                <Table<DesignOverviewRow>
                  rowKey="equip_no"
                  size="small"
                  pagination={false}
                  dataSource={design}
                  locale={{ emptyText: <Empty description="还没有设备" /> }}
                  columns={[
                    {
                      title: '设备',
                      key: 'eq',
                      width: 180,
                      render: (_: unknown, r: DesignOverviewRow) => (
                        <Space size="middle">
                          <Button
                            type="primary"
                            size="small"
                            onClick={() => go(`/projects/${projectNo}/design/${r.equip_no}`)}
                          >
                            进入设计
                          </Button>
                          {/* ★ 入口（2026-10-05）：设备档案 —— 设计面之外，项目经理/售后也要看这台设备的一生 */}
                          <Button size="small" onClick={() => go(`/equipment/${projectNo}/${r.equip_no}`)}>
                            设备档案
                          </Button>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            出图 / BOM
                          </Typography.Text>
                        </Space>
                      ),
                    },
                    {
                      title: '设计状态',
                      dataIndex: 'state',
                      width: 130,
                      render: (v: string) =>
                        v === 'BOM完整' ? (
                          <Chip tone="ok">BOM完整</Chip>
                        ) : v === '设计BOM已提交' ? (
                          <Chip tone="warn">设计BOM已提交</Chip>
                        ) : v === '设计中' ? (
                          <Chip tone="run">设计中</Chip>
                        ) : (
                          <Chip>未开始</Chip>
                        ),
                    },
                    {
                      title: '进度',
                      key: 'p',
                      render: (_: unknown, r: DesignOverviewRow) => (
                        <Space size={12} style={{ fontSize: 12 }}>
                          <span>图 {r.drawings}</span>
                          <span>零件 {r.parts}</span>
                          {r.unpublished > 0 && <Chip tone="run">{r.unpublished} 张待发布</Chip>}
                          {r.parts_without_material > 0 && (
                            <Chip tone="warn">{r.parts_without_material} 个缺材料</Chip>
                          )}
                        </Space>
                      ),
                    },
                    {
                      title: '操作',
                      key: 'a',
                      width: 210,
                      render: (_: unknown, r: DesignOverviewRow) => (
                        <Space size={8}>
                          <Button
                            type="primary"
                            size="small"
                            onClick={() => go(`/projects/${projectNo}/design/${r.equip_no}`)}
                          >
                            进入设计
                          </Button>
                          {/* ★ 入口（2026-10-05 用户实测"找不到设备档案"）：设计面之外，
                              项目经理 / 售后也要看这台设备的一生 */}
                          <Button size="small" onClick={() => go(`/equipment/${projectNo}/${r.equip_no}`)}>
                            设备档案
                          </Button>
                        </Space>
                      ),
                    },
                  ]}
                />
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 0' }}>
                  设计师也可以从左侧「我的任务」进入自己的设计任务；这里给项目经理看总体进度。
                </Typography.Paragraph>
              </Card>
    </>
  )
}
