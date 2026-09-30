// components/project/DealModals.tsx —— 由 ProjectDetailPage 拆出（重构 1.6b · 只拆不改）
import type { FormInstance } from 'antd'
import {
  Button,
  Col,
  DatePicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Typography,
} from 'antd'

import AppModal from '../AppModal'

import {
  type ProjectContact,
} from '../../api/client'

export default function DealModals({
  CLOSE_REASONS,
  closeForm,
  closeOpen,
  contactForm,
  contactOpen,
  dealForm,
  dealOpen,
  dealInitialValues,
  editingContact,
  saving,
  setCloseOpen,
  setContactOpen,
  setDealOpen,
  submitClose,
  submitContact,
  submitDeal,
  projectNo
}: {
  CLOSE_REASONS: string[];
  closeForm: FormInstance;
  closeOpen: boolean;
  contactForm: FormInstance;
  contactOpen: boolean;
  dealForm: FormInstance;
  dealOpen: boolean;
  dealInitialValues: Record<string, unknown>;
  editingContact: ProjectContact | null;
  message: any;
  saving: boolean;
  setCloseOpen: (...args: any[]) => any;
  setContactOpen: (...args: any[]) => any;
  setDealOpen: (...args: any[]) => any;
  submitClose: (...args: any[]) => any;
  submitContact: (...args: any[]) => any;
  submitDeal: (...args: any[]) => any;
  projectNo: any;
}) {
  // ★ 付款节点比例要有**实时合计**（2026-09-30 P1-2：文案写着“应为 100%”却没人算过账，
  //   实测 8 条合计 170% 也能成交，而且成交后改不了 —— 错数据一旦进来就是永久的）
  const watchTerms = Form.useWatch('payment_terms', dealForm) as
    | { percent?: number | null }[]
    | undefined
  const pctList = (watchTerms ?? []).map((t) => t?.percent).filter((x) => x !== null && x !== undefined) as number[]
  const pctSum = Math.round(pctList.reduce((a, b) => a + Number(b), 0) * 100) / 100
  const pctOff = pctList.length > 0 && Math.abs(pctSum - 100) > 0.5

  return (
    <>
      <AppModal
        title={`成交登记 · ${projectNo}`}
        open={dealOpen}
        width={900}
        onClose={() => setDealOpen(false)}
        onOk={() => void submitDeal()}
        loading={saving}
        okText="确认成交"
        form={dealForm}
        initialValues={dealInitialValues}
        subtitle={
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            登记后阶段变为「成交待立项」；所有字段都会记入操作记录（旧值 → 新值）
          </Typography.Paragraph>
        }
        styles={{ body: { maxHeight: '68vh', overflowY: 'auto', paddingRight: 8 } }}
      >
          <Row gutter={12}>
            <Col span={6}>
              <Form.Item name="period_start" label="合同签订日" rules={[{ required: true, message: '必填' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="period_end" label="合同交期" rules={[{ required: true, message: '必填' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="amount" label="合同金额（元）" rules={[{ required: true, message: '必填' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={100000} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="warranty_months" label="质保期（月）" rules={[{ required: true, message: '必填' }]}>
                <InputNumber style={{ width: '100%' }} min={0} suffix="月" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="contract_no_customer" label="客户合同号">
                <Input placeholder="选填" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="acceptance_standard" label="验收标准">
                <Input placeholder="如：节拍 22 秒/台，连续运行 72 小时" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="designated_brand" label="甲方指定品牌 / 供应商">
                <Input placeholder="如：PLC 指定西门子；机器人指定 ABB" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="delivery_mode" label="交货方式与地点">
                <Input placeholder="厂内提货 / 送货到厂 / 到场安装" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="site_condition" label="客户现场接收条件">
                <Input placeholder="水电气 / 地坪 / 通道 / 进场时间窗" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="penalty_note" label="交期与违约条款">
                <Input placeholder="如：逾期每天按合同额 0.5‰ 计罚" />
              </Form.Item>
            </Col>
          </Row>
          <Divider orientation="left" plain>
            付款方式（比例合计应为 100%）
          </Divider>
          <Typography.Paragraph style={{ marginTop: -8 }}>
            <Typography.Text type={pctOff ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
              当前比例合计：{pctList.length ? `${pctSum}%` : '—'}
              {pctOff ? '（不是 100%，改完再提交）' : pctList.length ? ' ✓' : ''}
            </Typography.Text>
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
            质保金 = 节点名含「质保」的那一条（客户从货款里扣留、质保期满才付给我们），系统自动带出
          </Typography.Paragraph>
          <Form.List
            name="payment_terms"
            rules={[
              {
                validator: async (_, value) => {
                  if (!value || value.length === 0) throw new Error('至少登记 1 个付款节点')
                  const first = value[0] ?? {}
                  if (!first.node_name) throw new Error('第 1 个付款节点的节点名必填')
                  // ★ 比例合计必须 100%（与后端同一口径，两边都拦）
                  const ps = (value as { percent?: number | null }[])
                    .map((t) => t?.percent)
                    .filter((x) => x !== null && x !== undefined) as number[]
                  if (ps.length) {
                    const sum = Math.round(ps.reduce((a, b) => a + Number(b), 0) * 100) / 100
                    if (Math.abs(sum - 100) > 0.5) throw new Error(`比例合计 ${sum}%，必须是 100%`)
                  }
                },
              },
            ]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field) => (
                  <Row key={field.key} gutter={8} align="middle">
                    <Col span={6}>
                      <Form.Item
                        name={[field.name, 'node_name']}
                        style={{ marginBottom: 0 }}
                        rules={field.name === 0 ? [{ required: true, message: '填节点名' }] : undefined}
                      >
                        <Input placeholder="节点名，如 预付款" />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item name={[field.name, 'percent']}>
                        <InputNumber style={{ width: '100%' }} min={0} max={100} suffix="%" />
                      </Form.Item>
                    </Col>
                    {/* ★ G2：这个款跟哪个业务节点对上（到了就提醒商务部收款）；不选则按节点名自动推断 */}
                    <Col span={4}>
                      <Form.Item name={[field.name, 'trigger_node']}>
                        <Select
                          allowClear
                          placeholder="对齐节点"
                          options={[
                            { value: '立项', label: '立项' },
                            { value: '发货', label: '发货' },
                            { value: '到货', label: '到货' },
                            { value: '验收', label: '验收' },
                            { value: '质保', label: '质保' },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name={[field.name, 'condition']}>
                        <Input placeholder="触发条件" />
                      </Form.Item>
                    </Col>
                    <Col span={2}>
                      <a onClick={() => remove(field.name)}>删除</a>
                    </Col>
                  </Row>
                ))}
                <Button type="dashed" onClick={() => add()} block>
                  + 添加付款节点
                </Button>
                <Form.ErrorList errors={errors} />
              </>
            )}
          </Form.List>
      </AppModal>

      {/* ============ 关闭订单 ============ */}
      <AppModal
        title={`关闭订单 · ${projectNo}`}
        open={closeOpen}
        width={520}
        onClose={() => setCloseOpen(false)}
        onOk={() => void submitClose()}
        loading={saving}
        okText="确认关闭"
        danger
        form={closeForm}
        subtitle={
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            关闭后阶段变为「已关闭」，不可再推进
          </Typography.Paragraph>
        }
      >
          <Form.Item
            name="close_reason"
            label="关闭原因"
            rules={[{ required: true, message: '请选择关闭原因' }]}
          >
            <Select options={CLOSE_REASONS.map((r) => ({ value: r, label: r }))} />
          </Form.Item>
          <Form.Item name="close_note" label="备注">
            <Input.TextArea rows={2} placeholder="如：客户预算砍了 30%，本轮放弃" />
          </Form.Item>
      </AppModal>

      {/* ============ 联系人 ============ */}
      <AppModal
        title={editingContact ? `编辑联系人 · ${editingContact.name}` : '新增联系人'}
        open={contactOpen}
        width={560}
        onClose={() => setContactOpen(false)}
        onOk={() => void submitContact()}
        loading={saving}
        okText="保存"
        form={contactForm}
        initialValues={
          editingContact
            ? {
                name: editingContact.name,
                role_tag: editingContact.role_tag ?? undefined,
                title: editingContact.title ?? undefined,
                phone: editingContact.phone ?? undefined,
                wechat: editingContact.wechat ?? undefined,
                email: editingContact.email ?? undefined,
              }
            : {}
        }
      >
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="role_tag" label="角色">
                <Select
                  allowClear
                  options={[
                    { value: '技术对接人', label: '技术对接人' },
                    { value: '采购', label: '采购' },
                    { value: '决策人', label: '决策人' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="title" label="职务">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="电话">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="wechat" label="微信">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="email" label="邮箱">
                <Input />
              </Form.Item>
            </Col>
          </Row>
      </AppModal>
    </>
  )
}
