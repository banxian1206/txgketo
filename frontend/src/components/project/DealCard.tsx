// components/project/DealCard.tsx —— 由 ProjectDetailPage 拆出（重构 1.6b · 只拆不改）
import type { FormInstance } from 'antd'
import type { Project } from '../../api/client'
import {
  Button,
  Card,
  DatePicker,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'

import EditableField from '../EditableField'
import {
  type ProjectDetail as Detail,
  hasPerm,
} from '../../api/client'

export default function DealCard({
  detail,
  doReceive,
  openDeal,
  openReceive,
  receiveForm,
  receiveTarget,
  save,
  saving,
  setReceiveTarget,
  DASH,
  p
}: {
  detail: Detail | null;
  doReceive: (...args: any[]) => any;
  message: any;
  openDeal: (...args: any[]) => any;
  openReceive: (...args: any[]) => any;
  receiveForm: FormInstance;
  receiveTarget: {
    seq: number
    node_name: string
    unpaid: number
  } | null;
  save: any;
  saving: boolean;
  setReceiveTarget: (...args: any[]) => any;
  DASH: any;
  p: Project;
}) {
  return (
    <>
          <Card id="sec-deal" size="small" title="成交信息" style={{ marginBottom: 16 }}>
            {p.stage === '线索' ? (
              <Space direction="vertical">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没成交登记" />
                <Button type="primary" size="small" onClick={openDeal}>
                  现在登记
                </Button>
              </Space>
            ) : (
              <>
                <div className="ef-grid">
                  <EditableField
                    label="合同金额"
                    value={p.amount}
                    type="money"
                    suffix={p.amount_tax_incl ? '（含税）' : '（不含税）'}
                    onSave={(v) => save('amount', v)}
                  />
                  <EditableField
                    label="合同签订日"
                    value={p.period_start}
                    type="date"
                    onSave={(v) => save('period_start', v)}
                  />
                  <EditableField
                    label="合同交期"
                    value={p.period_end}
                    type="date"
                    onSave={(v) => save('period_end', v)}
                  />
                  <EditableField
                    label="客户合同号"
                    value={p.contract_no_customer}
                    onSave={(v) => save('contract_no_customer', v)}
                  />
                  <EditableField
                    label="质保期"
                    value={p.warranty_months}
                    type="number"
                    suffix=" 个月（验收后起算）"
                    onSave={(v) => save('warranty_months', v)}
                  />
                  <div className="ef">
                    <span className="ef-label">质保金</span>
                    <span className="ef-value">
                      {p.warranty_amount ? (
                        <Space size={6}>
                          <span>¥{Number(p.warranty_amount).toLocaleString()}</span>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            （客户扣留，质保期满退回）
                          </Typography.Text>
                        </Space>
                      ) : (
                        DASH
                      )}
                    </span>
                  </div>
                  <EditableField
                    label="技术协议"
                    value={p.tech_agreement_frozen}
                    type="switch"
                    suffix="冻结后 = 设计基线、验收裁判"
                    onSave={(v) => save('tech_agreement_frozen', v)}
                  />
                  <EditableField
                    label="验收标准"
                    value={p.acceptance_standard}
                    wide
                    onSave={(v) => save('acceptance_standard', v)}
                  />
                  <EditableField
                    label="指定品牌"
                    value={p.designated_brand}
                    wide
                    suffix="指定件不能换供应商、不能合并采购"
                    onSave={(v) => save('designated_brand', v)}
                  />
                  <EditableField
                    label="违约条款"
                    value={p.penalty_note}
                    wide
                    onSave={(v) => save('penalty_note', v)}
                  />
                  <EditableField
                    label="交货方式"
                    value={p.delivery_mode}
                    onSave={(v) => save('delivery_mode', v)}
                  />
                  <EditableField
                    label="现场接收条件"
                    value={p.site_condition}
                    onSave={(v) => save('site_condition', v)}
                  />
                </div>
                <Divider orientation="left" plain style={{ marginTop: 8 }}>
                  付款方式（回款跟踪）
                </Divider>
                <Table
                  rowKey="seq"
                  size="small"
                  pagination={false}
                  dataSource={detail?.payment_terms ?? []}
                  locale={{ emptyText: <Empty description="没有登记付款节点" /> }}
                  columns={[
                    { title: '#', dataIndex: 'seq', width: 46 },
                    { title: '节点', dataIndex: 'node_name', width: 110 },
                    {
                      title: '比例',
                      dataIndex: 'percent',
                      width: 80,
                      align: 'right',
                      render: (v: number | null) => (v ? `${v}%` : '—'),
                    },
                    {
                      title: '金额',
                      dataIndex: 'amount',
                      width: 140,
                      align: 'right',
                      render: (v: number | null) => (v ? `¥${v.toLocaleString()}` : '—'),
                    },
                    { title: '触发条件', dataIndex: 'condition' },
                    {
                      title: '收款',
                      dataIndex: 'received_amount',
                      width: 110,
                      align: 'right',
                      render: (v: number | null) => (v ? `¥${v.toLocaleString()}` : <Tag>未收</Tag>),
                    },
                    {
                      title: '操作',
                      key: 'recv',
                      width: 100,
                      render: (_: unknown, t: { seq: number; node_name: string; amount?: number | null; received_amount?: number | null }) => {
                        const unpaid = Math.max(0, Number(t.amount ?? 0) - Number(t.received_amount ?? 0))
                        if (!hasPerm('payment:edit')) return <Typography.Text type="secondary">—</Typography.Text>
                        return unpaid > 0 ? (
                          <a onClick={() => openReceive(t)}>登记回款</a>
                        ) : (
                          <Tag color="success">已收齐</Tag>
                        )
                      },
                    },
                  ]}
                />

                <Modal
                  title={`登记回款：${receiveTarget?.node_name ?? ''}`}
                  open={!!receiveTarget}
                  onCancel={() => setReceiveTarget(null)}
                  onOk={() => void doReceive()}
                  confirmLoading={saving}
                  okText="登记"
                  destroyOnHidden
                >
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                    这个节点还有未收 ¥{Number(receiveTarget?.unpaid ?? 0).toLocaleString()}；可多次登记，未收不超总额。
                  </Typography.Paragraph>
                  <Form form={receiveForm} layout="vertical" preserve={false}>
                    <Form.Item name="received_amount" label="本次实收金额" rules={[{ required: true, message: '填金额' }]}>
                      <InputNumber style={{ width: '100%' }} min={0.01} />
                    </Form.Item>
                    <Form.Item name="received_date" label="收款日期">
                      <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="remark" label="备注">
                      <Input placeholder="如：银行转账 / 承兑" />
                    </Form.Item>
                  </Form>
                </Modal>
              </>
            )}
          </Card>
    </>
  )
}
