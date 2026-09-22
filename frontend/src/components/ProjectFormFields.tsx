import {
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd'
import type { Dayjs } from 'dayjs'
import type { ReactNode } from 'react'
import { T } from '../theme/tokens'

/** 项目表单的全部字段（新建 / 编辑共用） */
export interface ProjectFormValues {
  // ① 基本信息
  project_name: string
  deal_mode?: string
  source?: string
  project_desc?: string
  // ② 客户信息
  customer_name: string
  contacts?: ContactForm[]
  // ③ 项目要求
  site_address?: string
  product_type?: string
  required_cycle?: string
  required_capacity?: string
  is_retrofit?: boolean
  // ④ 时间与金额
  deadline?: Dayjs
  delivery_days?: number
  expect_sign_date?: Dayjs
  est_amount?: number
  performance_deposit?: number
  performance_deposit_return_date?: Dayjs
  performance_deposit_returned?: boolean
  // ⑤ 接收到的资料
  received_docs?: string[]
  // ⑥ 商务跟进
  sales_id?: number
  competitor?: string
  related_project_no?: string
  risk_note?: string
  // ⑦ 成交信息（签约后才有）
  amount?: number
  amount_tax_incl?: boolean
  period_start?: Dayjs
  period_end?: Dayjs
  warranty_months?: number
  contract_no_customer?: string
  tech_agreement_frozen?: boolean
}

export interface ContactForm {
  name: string
  title?: string
  phone?: string
  wechat?: string
  email?: string
  role_tag?: string
}

export const SOURCES = ['老客户复购', '客户询价', '展会', '转介绍', '招标平台', '销售拜访', '其他']

export const RECEIVED_DOCS = [
  '客户需求书',
  '产品图纸',
  '节拍产能要求',
  '现场照片',
  '招标文件',
  '样品照片',
  '其他',
]

function Group({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <span>{title}</span>
          {hint && (
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              {hint}
            </Typography.Text>
          )}
        </Space>
      }
      style={{ marginBottom: 16 }}
      styles={{ header: { background: T.bgSubtle } }}
    >
      {children}
    </Card>
  )
}

interface Props {
  users?: { id: number; name: string }[]
  projects?: { project_no: string; project_name: string }[]
  /** 新建时显示「客户方联系人」录入（编辑时联系人在详情页签里单独维护） */
  withContacts?: boolean
  /** 第 ⑤ 组「接收到的资料」下面附加的内容（新建页用来放文件上传） */
  docsExtra?: ReactNode
  /** 显示第 ⑦ 组「成交信息」（编辑时用；新建商机时还没有合同） */
  withDeal?: boolean
}

/**
 * 项目表单字段（新建商机页面 / 编辑项目弹窗共用）。
 * 分 6 组：基本信息 · 客户信息 · 项目要求 · 时间与金额 · 接收到的资料 · 商务跟进
 */
export default function ProjectFormFields({
  users = [],
  projects = [],
  withContacts = false,
  docsExtra,
  withDeal = false,
}: Props) {
  return (
    <>
      <Group title="① 基本信息">
        <Row gutter={16}>
          <Col span={10}>
            <Form.Item
              name="project_name"
              label="项目名称"
              rules={[{ required: true, message: '请输入项目名称' }]}
            >
              <Input placeholder="如：美的 110 寸 TV 总装线" />
            </Form.Item>
          </Col>
          <Col span={7}>
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
          <Col span={7}>
            <Form.Item name="source" label="线索来源">
              <Select
                allowClear
                placeholder="这条商机从哪来的"
                options={SOURCES.map((s) => ({ value: s, label: s }))}
              />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item
              name="project_desc"
              label="项目描述"
              rules={[{ required: true, message: '必填：这个项目是干什么的' }]}
            >
              <Input.TextArea rows={2} placeholder="客户要解决什么问题、大概要什么设备" />
            </Form.Item>
          </Col>
        </Row>
      </Group>

      <Group title="② 客户信息">
        <Row gutter={16}>
          <Col span={10}>
            <Form.Item
              name="customer_name"
              label="客户名称"
              rules={[{ required: true, message: '请输入客户名称' }]}
            >
              <Input placeholder="如：美的集团" />
            </Form.Item>
          </Col>
        </Row>
        {withContacts && (
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
                    <Row key={field.key} gutter={8} align="middle" style={{ marginTop: 8 }}>
                      <Col span={3}>
                        <Form.Item
                          name={[field.name, 'name']}
                          style={{ marginBottom: 0 }}
                          rules={field.name === 0 ? [{ required: true, message: '填姓名' }] : undefined}
                        >
                          <Input placeholder="姓名" />
                        </Form.Item>
                      </Col>
                      <Col span={3}>
                        <Form.Item name={[field.name, 'title']} style={{ marginBottom: 0 }}>
                          <Input placeholder="职务" />
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item
                          name={[field.name, 'phone']}
                          style={{ marginBottom: 0 }}
                          rules={field.name === 0 ? [{ required: true, message: '填电话' }] : undefined}
                        >
                          <Input placeholder="电话" />
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item name={[field.name, 'wechat']} style={{ marginBottom: 0 }}>
                          <Input placeholder="微信" />
                        </Form.Item>
                      </Col>
                      <Col span={5}>
                        <Form.Item name={[field.name, 'email']} style={{ marginBottom: 0 }}>
                          <Input placeholder="邮箱" />
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item name={[field.name, 'role_tag']} style={{ marginBottom: 0 }}>
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
                      <Col span={1}>
                        <a onClick={() => remove(field.name)}>删</a>
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
      </Group>

      <Group title="③ 项目要求">
        <Row gutter={16}>
          <Col span={7}>
            <Form.Item
              name="site_address"
              label="项目地点（客户工厂）"
              tooltip="直接影响现场安装成本与差旅；深圳/惠州双工厂调度要看它"
              rules={[{ required: true, message: '必填：在什么地方交付' }]}
            >
              <Input placeholder="如：佛山顺德" />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item name="product_type" label="客户产品类型">
              <Input placeholder="如：110 寸 TV" />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="required_cycle" label="要求节拍">
              <Input placeholder="如：25 秒/台" />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="required_capacity" label="要求产能">
              <Input placeholder="如：150 台/天" />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item
              name="is_retrofit"
              label="旧线改造"
              valuePropName="checked"
              tooltip="改造项目要停客户产线，现场窗口紧、风险高 —— 立项时会标红"
            >
              <Switch checkedChildren="旧改" unCheckedChildren="新线" />
            </Form.Item>
          </Col>
        </Row>
      </Group>

      <Group
        title="④ 时间与金额"
        hint="商机截止 ≠ 项目交期：前者是客户要求何时定下来，后者是签约后干多少天"
      >
        <Row gutter={16}>
          <Col span={6}>
            <Form.Item
              name="deadline"
              label="商机截止时间"
              tooltip="客户要求我们什么时候把这件事定下来（如 9/20 前必须定）"
              rules={[{ required: true, message: '必填：商机什么时候截止' }]}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item
              name="delivery_days"
              label="项目交期（天）"
              tooltip="从签订合同之后开始算，整个项目干多少天（如 90 天）"
            >
              <InputNumber style={{ width: '100%' }} min={1} max={3650} suffix="天" />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item name="expect_sign_date" label="预计签单时间">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="est_amount" label="预计金额（元）">
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                step={100000}
                placeholder="线索阶段先有个数"
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item
              name="performance_deposit"
              label="履约保证金（元）"
              tooltip="我们交给对方的钱，履约完成后收回 —— 与质保金（客户扣留我们的钱）方向相反"
            >
              <InputNumber style={{ width: '100%' }} min={0} step={10000} placeholder="选填" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item
              name="performance_deposit_return_date"
              label="保证金预计退还"
              tooltip="合同约定的退还时间，到期系统提醒去要回来"
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item
              name="performance_deposit_returned"
              label="是否已退还"
              valuePropName="checked"
            >
              <Switch checkedChildren="已退" unCheckedChildren="未退" />
            </Form.Item>
          </Col>
        </Row>
      </Group>

      <Group title="⑤ 接收到的资料" hint="勾选拿到哪些，并把文件传上来">
        <Form.Item name="received_docs" style={{ marginBottom: docsExtra ? 12 : 0 }}>
          <Checkbox.Group options={RECEIVED_DOCS.map((d) => ({ value: d, label: d }))} />
        </Form.Item>
        {docsExtra}
      </Group>

      <Group title="⑥ 商务跟进" hint="内部用">
        <Row gutter={16}>
          <Col span={6}>
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
          <Col span={6}>
            <Form.Item name="competitor" label="竞争对手">
              <Input placeholder="选填" />
            </Form.Item>
          </Col>
          <Col span={12}>
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
          <Col span={24}>
            <Form.Item name="risk_note" label="风险标记">
              <Input placeholder="付款条件差 / 交期极紧 / 客户信誉不明 …" />
            </Form.Item>
          </Col>
        </Row>
      </Group>

      {withDeal && (
        <Group title="⑦ 成交信息" hint="签约后填；付款节点与质保金在「成交登记」里维护">
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="amount" label="合同金额（元）">
                <InputNumber style={{ width: '100%' }} min={0} step={100000} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="amount_tax_incl" label="金额口径" valuePropName="checked">
                <Switch checkedChildren="含税" unCheckedChildren="不含税" />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="period_start" label="合同签订日">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="period_end" label="合同交期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="warranty_months" label="质保期（月）">
                <InputNumber style={{ width: '100%' }} min={0} suffix="月" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="contract_no_customer" label="客户合同号">
                <Input placeholder="选填" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="tech_agreement_frozen"
                label="技术协议冻结"
                valuePropName="checked"
                tooltip="冻结后 = 设计基线、验收裁判"
              >
                <Switch checkedChildren="已冻结" unCheckedChildren="未冻结" />
              </Form.Item>
            </Col>
          </Row>
        </Group>
      )}
    </>
  )
}
