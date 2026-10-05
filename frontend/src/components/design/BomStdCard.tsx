import { Link } from 'react-router-dom'
import { Status, Chip } from '../../components/ds'
// components/design/BomStdCard.tsx —— 由 EquipmentDesign 拆出（重构 1.6 · 只拆不改）
import { Card, Empty, Popconfirm, Space, Table, Tooltip, Typography } from 'antd'



import { errMsg, removeBom, type BomLine, type DesignTree } from '../../api/client'
import { CHANGE_STATUS as CHANGE_STATUS_COLOR, toneOf } from '../../theme/status'
import { BOM_STATUS as BOM_STATUS_COLOR } from '../../theme/status'

export default function BomStdCard({
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
          <Card size="small" title={`设计 BOM · 标准件（${data?.counts.std_items ?? 0}）`}>
            <Table<BomLine>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={data?.std_bom ?? []}
              locale={{ emptyText: <Empty description="还没挂标准件" /> }}
              columns={[
                {
                  // ★ R2：父级图号可点 → 回那个件的档案（BOM 行只存"挂在谁下面"，点父件才看得出全貌）
                  title: '挂在', dataIndex: 'parent_ref', width: 210,
                  render: (v: string) => <Link to={`/items/${v}`} onClick={(e) => e.stopPropagation()}>{v}</Link>,
                },
                {
                  title: '物料',
                  dataIndex: 'display_name',
                  render: (v: string, r: BomLine) => (
                    <Space direction="vertical" size={0}>
                      <span>{v}</span>
                      <Link to={`/items/${r.child_item_no}`} onClick={(e) => e.stopPropagation()}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {r.child_item_no}
                        </Typography.Text>
                      </Link>
                    </Space>
                  ),
                },
                {
                  title: '数量',
                  dataIndex: 'qty',
                  width: 90,
                  render: (v: number, r: BomLine) => `${v} ${r.unit ?? ''}`,
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 80,
                  render: (v: string) => <Status tone={toneOf(BOM_STATUS_COLOR[v])}>{v ?? '草稿'}</Status>,
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
                            <Chip tone={toneOf(CHANGE_STATUS_COLOR[r.change_request.status])}>
                              {r.change_request.status}
                            </Chip>
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
