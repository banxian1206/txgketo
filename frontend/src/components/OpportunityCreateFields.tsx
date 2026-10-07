import { Button, Checkbox, Collapse, Col, DatePicker, Form, Input, InputNumber, Row, Select, Switch, Typography } from 'antd'
import type { ReactNode } from 'react'
import { SOURCES, RECEIVED_DOCS } from './ProjectFormFields'

// 从本组件各 data-section 的实际字段生成，隐藏区校验与字段布局同源。
export const OPPORTUNITY_FIELD_SECTION: Record<string, string> = {'project_name': 'basic', 'customer_name': 'basic', 'sales_id': 'basic', 'project_desc': 'require', 'site_address': 'require', 'deadline': 'require', 'deal_mode': 'follow', 'source': 'follow', 'product_type': 'follow', 'required_cycle': 'follow', 'required_capacity': 'follow', 'is_retrofit': 'follow', 'delivery_days': 'follow', 'expect_sign_date': 'follow', 'est_amount': 'follow', 'competitor': 'follow', 'related_project_no': 'follow', 'risk_note': 'follow', 'performance_deposit': 'follow', 'performance_deposit_return_date': 'follow', 'performance_deposit_returned': 'follow', 'contacts': 'basic', 'received_docs': 'follow'}

/** 新建只组织商机建立所需信息；编辑项目仍使用 ProjectFormFields。 */
export default function OpportunityCreateFields({ activeSection, users, projects, docsExtra }: {
 activeSection: string
 users: { id: number; name: string }[]
 projects: { project_no: string; project_name: string }[]
 docsExtra: ReactNode
}) {
 return <>
<section data-section="basic" style={{ display: activeSection === 'basic' ? undefined : 'none' }}>
<Typography.Title level={5}>商机、客户与联系人</Typography.Title>
<Typography.Paragraph type="secondary">先明确这是什么商机、客户是谁、由谁跟进。至少填写一位客户联系人。</Typography.Paragraph>
<Row gutter={[16, 8]}>
<Col xs={24} md={12}>
            <Form.Item
              name="project_name"
              label="商机名称"
              rules={[{ required: true, message: '请输入商机名称' }]}
            >
              <Input placeholder="如：美的 110 寸 TV 总装线" />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item
              name="customer_name"
              label="客户名称"
              rules={[{ required: true, message: '请输入客户名称' }]}
            >
              <Input placeholder="如：美的集团" />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item
              name="sales_id"
              label="销售负责人"
              rules={[{ required: true, message: '必选：这个商机归谁跟' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选销售/商务负责人"
                options={users.map((u) => ({ value: u.id, label: u.name }))}
              />
            </Form.Item>
          </Col>
</Row>
{(
          <>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              客户方联系人（可多个：技术对接人 / 采购 / 决策人）
            </Typography.Text>
            <Form.List
              name="contacts"
              rules={[
                {
                  validator: async (_, value) => {
                    if (!value || value.length === 0) throw new Error('至少要有一个客户方联系人')
                    const first = value[0] ?? {}
                    if (!first.name) throw new Error('第 1 位联系人的姓名必填')
                    if (!first.phone) throw new Error('第 1 位联系人的电话必填')
                  },
                },
              ]}
            >
              {(fields, { add, remove }, { errors }) => (
                <>
                  {fields.map((field) => (
                    <Row key={field.key} className="opportunity-contact-row" gutter={[8, 12]} align="top" style={{ marginTop: 16 }}>
                      <Col xs={24} md={3}>
                        <Form.Item
                          name={[field.name, 'name']}
                          label="姓名"
                          style={{ marginBottom: 0 }}
                          rules={field.name === 0 ? [{ required: true, message: '填姓名' }] : undefined}
                        >
                          <Input placeholder="姓名" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={3}>
                        <Form.Item name={[field.name, 'title']} label="职务" style={{ marginBottom: 0 }}>
                          <Input placeholder="职务" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={4}>
                        <Form.Item
                          name={[field.name, 'phone']}
                          label="电话"
                          style={{ marginBottom: 0 }}
                          rules={field.name === 0 ? [{ required: true, message: '填电话' }] : undefined}
                        >
                          <Input placeholder="电话" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={4}>
                        <Form.Item name={[field.name, 'wechat']} label="微信" style={{ marginBottom: 0 }}>
                          <Input placeholder="微信" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={5}>
                        <Form.Item name={[field.name, 'email']} label="邮箱" style={{ marginBottom: 0 }}>
                          <Input placeholder="邮箱" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={4}>
                        <Form.Item name={[field.name, 'role_tag']} label="角色" style={{ marginBottom: 0 }}>
                          <Select
                            allowClear
                            placeholder="角色"
                            options={[
                              { value: '技术对接人', label: '技术对接人' },
                              { value: '采购', label: '采购' },
                              { value: '决策人', label: '决策人' },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={1} className="opportunity-contact-remove">
                        <Button type="link" style={{ padding: 0 }} aria-label={`删除第 ${field.name + 1} 位联系人`} onClick={() => remove(field.name)}>删除</Button>
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" onClick={() => add()} block style={{ marginTop: 8 }}>
                    + 添加联系人
                  </Button>
                  <Form.ErrorList errors={errors} />
                </>
              )}
            </Form.List>
          </>
        )}
</section>
<section data-section="require" style={{ display: activeSection === 'require' ? undefined : 'none' }}>
<Typography.Title level={5}>客户需求与时间</Typography.Title>
<Typography.Paragraph type="secondary">记录客户要解决的问题、交付地点，以及客户要求何时定下来。</Typography.Paragraph>
<Row gutter={[16, 8]}>
<Col xs={24} md={24}>
            <Form.Item
              name="project_desc"
              label="客户需求"
              rules={[{ required: true, message: '必填：这个项目是干什么的' }]}
            >
              <Input.TextArea rows={2} placeholder="客户要解决什么问题、大概要什么设备" />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item
              name="site_address"
              label="项目地点（客户工厂）"
              tooltip="直接影响现场安装成本与差旅；深圳/惠州双工厂调度要看它"
              rules={[{ required: true, message: '必填：在什么地方交付' }]}
            >
              <Input placeholder="如：佛山顺德" />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item
              name="deadline"
              label="商机截止时间"
              tooltip="客户要求我们什么时候把这件事定下来（如 9/20 前必须定）"
              rules={[{ required: true, message: '必填：商机什么时候截止' }]}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
</Row>
</section>
<section data-section="follow" style={{ display: activeSection === 'follow' ? undefined : 'none' }}>
<Typography.Title level={5}>补充资料与商务信息</Typography.Title>
<Typography.Paragraph type="secondary">本区均为选填，有资料就补充；合同金额、付款节点在成交登记时填写。</Typography.Paragraph>
<Form.Item name="received_docs" label="已收到的资料类型"><Checkbox.Group options={RECEIVED_DOCS.map(d => ({ value: d, label: d }))} /></Form.Item>
{docsExtra}
<Collapse style={{ marginTop: 20 }} items={[{ key: 'extra', label: '更多技术与商务信息（选填）', forceRender: true, children: <>
<Row gutter={[16, 8]}>
<Col xs={24} md={12}>
            <Form.Item name="deal_mode" label="项目方式">
              <Select
                allowClear
                placeholder="投标 / 直签"
                options={[
                  { value: '投标', label: '投标' },
                  { value: '直签', label: '直接签合同' },
                ]}
              />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item name="source" label="线索来源">
              <Select
                allowClear
                placeholder="这条商机从哪来的"
                options={SOURCES.map((s) => ({ value: s, label: s }))}
              />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item name="product_type" label="客户产品类型">
              <Input placeholder="如：110 寸 TV" />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item name="required_cycle" label="要求节拍">
              <Input placeholder="如：25 秒/台" />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item name="required_capacity" label="要求产能">
              <Input placeholder="如：150 台/天" />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item
              name="is_retrofit"
              label="旧线改造"
              valuePropName="checked"
              tooltip="改造项目要停客户产线，现场窗口紧、风险高 —— 立项时会标红"
            >
              <Switch checkedChildren="旧改" unCheckedChildren="新线" />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item
              name="delivery_days"
              label="项目交期（天）"
              tooltip="从签订合同之后开始算，整个项目干多少天（如 90 天）"
            >
              <InputNumber style={{ width: '100%' }} min={1} max={3650} suffix="天" />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item name="expect_sign_date" label="预计签单时间">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item name="est_amount" label="预计金额（元）">
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                step={100000}
                placeholder="线索阶段先有个数"
              />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item name="competitor" label="竞争对手">
              <Input placeholder="选填" />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item
              name="related_project_no"
              label="关联历史项目"
              tooltip="同一客户 / 同类型设备以前做过没有 —— 设计复用与成本估算的关键"
            >
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="以前做过同类设备吗"
                options={projects.map((r) => ({
                  value: r.project_no,
                  label: `${r.project_no} ${r.project_name}`,
                }))}
              />
            </Form.Item>
          </Col>
<Col xs={24} md={24}>
            <Form.Item name="risk_note" label="风险标记">
              <Input placeholder="付款条件差 / 交期极紧 / 客户信誉不明 …" />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item
              name="performance_deposit"
              label="履约保证金（元）"
              tooltip="我们交给对方的钱，履约完成后收回 —— 与质保金（客户扣留我们的钱）方向相反"
            >
              <InputNumber style={{ width: '100%' }} min={0} step={10000} placeholder="选填" />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item
              name="performance_deposit_return_date"
              label="保证金预计退还"
              tooltip="合同约定的退还时间，到期系统提醒去要回来"
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
<Col xs={24} md={12}>
            <Form.Item
              name="performance_deposit_returned"
              label="是否已退还"
              valuePropName="checked"
            >
              <Switch checkedChildren="已退" unCheckedChildren="未退" />
            </Form.Item>
          </Col>
</Row></> }]} />
</section>
</>
}
