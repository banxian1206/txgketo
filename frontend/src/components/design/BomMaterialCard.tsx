// components/design/BomMaterialCard.tsx —— 由 EquipmentDesign 拆出（重构 1.6 · 只拆不改）
import {
  Card,
  Empty,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'



import {
  errMsg,
  removeBom,
  type BomLine,
  type DesignTree,
} from '../../api/client'
import { CHANGE_STATUS as CHANGE_STATUS_COLOR } from '../../theme/status'
import { BOM_STATUS as BOM_STATUS_COLOR } from '../../theme/status'

export default function BomMaterialCard({
data,
  message,
  setChangeTarget,
  load
}: {
data: DesignTree | null;
  message: any;
  setChangeTarget: (...args: any[]) => any;
  load: (...args: any[]) => any;
}) {
  return (
    <>
          <Card
            size="small"
            title={`材料 BOM · 原材料（${data?.counts.materials ?? 0}）`}
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                工艺部
              </Typography.Text>
            }
          >
            <Table<BomLine>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={data?.material_bom ?? []}
              locale={{ emptyText: <Empty description="工艺部还没补材料" /> }}
              columns={[
                { title: '零件', dataIndex: 'parent_ref', width: 210 },
                { title: '原材料', dataIndex: 'display_name' },
                {
                  title: '用量',
                  dataIndex: 'qty',
                  width: 90,
                  render: (v: number, r: BomLine) => `${v} ${r.unit ?? ''}`,
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 80,
                  render: (v: string) => <Tag color={BOM_STATUS_COLOR[v] ?? 'default'}>{v ?? '草稿'}</Tag>,
                },
                {
                  title: '操作',
                  key: 'bomaction',
                  width: 140,
                  render: (_: unknown, r: BomLine) =>
                    r.status === '已冻结' ? (
                      <Space size={4}>
                        {!r.change_request && (
                          <a
                            onClick={() =>
                              setChangeTarget({
                                type: 'BOM_ITEM',
                                ref: String(r.id),
                                title: `${r.parent_ref} ← ${r.display_name} × ${r.qty}`,
                              })
                            }
                          >
                            提改版申请
                          </a>
                        )}
                        {r.change_request && (
                          <Tooltip title={`改版申请 ${r.change_request.cr_no}：${r.change_request.status}`}>
                            <Tag color={CHANGE_STATUS_COLOR[r.change_request.status] ?? 'default'}>
                              {r.change_request.status}
                            </Tag>
                          </Tooltip>
                        )}
                      </Space>
                    ) : (
                      <Popconfirm
                        title="删除？"
                        onConfirm={() =>
                          void removeBom(r.id).then(load).catch((e) => message.error(errMsg(e)))
                        }
                      >
                        <a>删</a>
                      </Popconfirm>
                    ),
                },
              ]}
            />
          </Card>
    </>
  )
}
