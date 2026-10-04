import { App, Button, Card, Col, DatePicker, Divider, Empty, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  createPaymentChange,
  decidePaymentChange,
  listMyPendingPaymentChanges,
  listPaymentChanges,
  withdrawPaymentChange,
  type PayChangeRow,
} from '../../api/paymentChange'
import { errMsg, hasPerm } from '../../api/client'
import dayjs from 'dayjs'
import AppModal from '../AppModal'
import { Muted, Stack } from '../ui/Primitives'
import { PAY_CHANGE_STATUS } from '../../theme/status'

const TRIGGERS = ['发货', '到货', '验收', '质保']

/**
 * 付款计划变更（2026-09-30 客户拍板）。
 *
 * 为什么要有这张卡：成交登记只在「线索」阶段能提交（`routes/project.deal`），成交后付款节点
 * **没有任何修改口** —— 实测过比例 170%、金额超合同的脏计划只能一直错着。
 *
 * 口径（与后端 `services/payment_change.py` 同一句话）：
 *  · **只改未来节点**：已收款的节点不许改、不许删（这里只让人填“还没收的节点”）
 *  · 比例：Σ(已收) + Σ(新计划) = 100%；金额：合计不得超合同额
 *  · 审批人 = **商务部总监**（前后端都不按 position 猜 —— 能审哪张由后端 `scope=pending` 说了算）
 */
export default function PaymentChangeCard({
  projectNo,
  terms,
  amount,
  onChanged,
}: {
  projectNo: string
  terms: {
    seq: number
    node_name: string
    trigger_node?: string | null
    percent?: number | null
    amount?: number | null
    received_amount?: number | null
    condition?: string | null
  }[]
  amount?: number | null
  onChanged: () => void | Promise<void>
}) {
  const { message } = App.useApp()
  const [rows, setRows] = useState<PayChangeRow[]>([])
  const [mineTodo, setMineTodo] = useState<number[]>([]) // 后端说“该我批”的 id
  const [open, setOpen] = useState(false)
  const [decideFor, setDecideFor] = useState<PayChangeRow | null>(null)
  const [detailFor, setDetailFor] = useState<PayChangeRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const [decideForm] = Form.useForm()
  const canEdit = hasPerm('payment:edit')

  const load = useCallback(async () => {
    try {
      const list = await listPaymentChanges(projectNo)
      setRows(list)
      // 能审哪张由后端说了算（不拿 position 猜 —— 那必然漂移成“看得见、点了必 403”）
      try {
        const arr = await listMyPendingPaymentChanges()
        setMineTodo(arr.map((x) => x.id))
      } catch {
        setMineTodo([])
      }
    } catch {
      setRows([])
    }
  }, [projectNo])

  useEffect(() => {
    void load()
  }, [load])

  const paid = (terms ?? []).filter((t) => Number(t.received_amount ?? 0) > 0)
  const paidPct = paid.reduce((a, t) => a + Number(t.percent ?? 0), 0)
  const watch = Form.useWatch('terms', form) as { percent?: number | null }[] | undefined
  const newPct = (watch ?? []).reduce((a, t) => a + Number(t?.percent ?? 0), 0)
  const totalPct = Math.round((paidPct + newPct) * 100) / 100
  const pctOff = Math.abs(totalPct - 100) > 0.5

  // ★ 预填一律走 AppModal initialValues（不用 setFieldsValue —— 弹窗 destroyOnHidden，先设后开会丢，
  //   AGENTS §8.1 的 PREFILL 护栏就是为这个坑立的）
  const createInitial = useMemo(
    () => ({
      reason: '',
      terms: (terms ?? [])
        .filter((t) => !Number(t.received_amount ?? 0))
        .map((t) => ({
          node_name: t.node_name,
          percent: t.percent,
          amount: t.amount,
          trigger_node: t.trigger_node,
          condition: t.condition,
        })),
    }),
    [terms],
  )

  const submit = async () => {
    let v: { reason: string; terms: { node_name: string; percent?: number; amount?: number; trigger_node?: string; condition?: string; expect_date?: dayjs.Dayjs }[] }
    try {
      v = await form.validateFields()
    } catch {
      return
    }
    setSaving(true)
    try {
      await createPaymentChange(projectNo, {
        reason: v.reason,
        terms: (v.terms ?? []).map((t) => ({
          node_name: t.node_name,
          percent: t.percent ?? null,
          amount: t.amount ?? null,
          trigger_node: t.trigger_node ?? null,
          condition: t.condition ?? null,
          expect_date: t.expect_date ? t.expect_date.format('YYYY-MM-DD') : null,
        })),
      })
      message.success('变更单已提交 —— 等商务部总监审批（只改未收节点，已收的原样保留）')
      setOpen(false)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const decide = async (approve: boolean) => {
    if (!decideFor) return
    let v: { note?: string }
    try {
      v = await decideForm.validateFields()
    } catch {
      return
    }
    setSaving(true)
    try {
      await decidePaymentChange(decideFor.id, { approve, note: v.note })
      message.success(approve ? '已批准：未收节点按新计划替换，已收的原样保留' : '已否决')
      setDecideFor(null)
      await load()
      await onChanged()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card
      size="small"
      title="付款计划变更（成交后改计划走这张单）"
      extra={
        canEdit ? (
          <Button size="small" onClick={() => setOpen(true)}>
            发起变更
          </Button>
        ) : null
      }
    >
      <Muted>
        成交登记之后付款计划不能直接改 —— 一律走变更单：**只改还没收的节点**，已收款的节点原样保留；
        比例合计（已收 + 新计划）必须是 100%，金额不得超合同额；由**商务部总监**审批。
      </Muted>
      <Table<PayChangeRow>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: <Empty description="没有付款计划变更记录" /> }}
        columns={[
          { title: '变更单', dataIndex: 'change_no', width: 110 },
          { title: '状态', dataIndex: 'status', width: 120, render: (v: string) => <Tag color={PAY_CHANGE_STATUS[v] ?? 'default'}>{v}</Tag> },
          { title: '原因', dataIndex: 'reason', ellipsis: true },
          { title: '提交人', dataIndex: 'requested_by_name', width: 100, render: (v?: string | null) => v ?? '—' },
          {
            title: '时间',
            dataIndex: 'requested_at',
            width: 130,
            render: (v?: string | null) => (v ? dayjs(v).format('MM-DD HH:mm') : '—'),
          },
          {
            title: '操作',
            key: 'a',
            width: 150,
            render: (_: unknown, r: PayChangeRow) => (
              <Space size="small">
                {r.status === '待商务总监审' && mineTodo.includes(r.id) && (
                  /* ★ F14：AppModal(destroyOnHidden) 每次打开都是新实例，开前 reset 只会产生未连接警告 */
                  <a onClick={() => setDecideFor(r)}>审批</a>
                )}
                {r.status === '待商务总监审' && canEdit && (
                  <Popconfirm
                    title="撤回这张变更单？"
                    onConfirm={() =>
                      void withdrawPaymentChange(r.id).then(load).catch((e) => message.error(errMsg(e)))
                    }
                  >
                    <a>撤回</a>
                  </Popconfirm>
                )}
                <a onClick={() => setDetailFor(r)}>对照</a>
              </Space>
            ),
          },
        ]}
      />

      {/* 发起变更：只填「还没收的节点」*/}
      <AppModal
        title={`发起付款计划变更 · ${projectNo}`}
        open={open}
        onClose={() => setOpen(false)}
        onOk={() => void submit()}
        loading={saving}
        okText="提交变更（走商务总监审批）"
        width={860}
        form={form}
        initialValues={createInitial}
      >
        <Muted>
          已收款的节点不在这里出现（它们不许改）；比例合计（已收 {paidPct}% + 新计划）必须凑成 100%。
          合同金额 {amount != null ? `¥${Number(amount).toLocaleString()}` : '未登记'}。
        </Muted>
        <Form.Item name="reason" label="为什么要改（审批人要看依据）" rules={[{ required: true, message: '写清依据' }]}>
            <Input.TextArea rows={2} placeholder="如：客户把验收款/质保金谈成 20%/10%；原录入重复且比例有误" />
          </Form.Item>
          <Divider orientation="left" plain>
            新的付款计划（只填还没收的节点）
          </Divider>
          <Form.List name="terms">
            {(fields, { add, remove }) => (
              <div className="form-dense">
                {fields.map((f) => (
                  <Row key={f.key} gutter={8} align="middle">
                    <Col span={5}>
                      <Form.Item name={[f.name, 'node_name']} rules={[{ required: true, message: '节点名' }]}>
                        <Input placeholder="节点名，如 发货款" />
                      </Form.Item>
                    </Col>
                    <Col span={3}>
                      <Form.Item name={[f.name, 'percent']}>
                        <InputNumber className="w-full" min={0} max={100} suffix="%" />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item name={[f.name, 'amount']} tooltip="不填则按合同额 × 比例折算">
                        <InputNumber className="w-full" min={0} placeholder="金额" />
                      </Form.Item>
                    </Col>
                    <Col span={3}>
                      <Form.Item name={[f.name, 'trigger_node']}>
                        <Select allowClear placeholder="对齐节点" options={TRIGGERS.map((t) => ({ value: t, label: t }))} />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item name={[f.name, 'expect_date']}>
                        <DatePicker className="w-full" placeholder="预计收款" />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item name={[f.name, 'condition']}>
                        <Input placeholder="触发条件" />
                      </Form.Item>
                    </Col>
                    <Col span={1}>
                      <a onClick={() => remove(f.name)}>删</a>
                    </Col>
                  </Row>
                ))}
                <Button type="dashed" onClick={() => add()} block>
                  + 添加未收节点
                </Button>
              </div>
            )}
          </Form.List>
        <Typography.Paragraph>
          <Typography.Text type={pctOff ? 'danger' : 'secondary'}>
            已收 {paidPct}% + 新计划 {Math.round(newPct * 100) / 100}% = {totalPct}%
            {pctOff ? '（必须凑成 100%，否则提交会被退回）' : ' ✓'}
          </Typography.Text>
        </Typography.Paragraph>
      </AppModal>

      {/* 变更前/后对照（留痕：批准后旧行会被替换，这份快照是唯一证据）*/}
      <Modal
        title={`付款计划变更 ${detailFor?.change_no ?? ''}（${detailFor?.status ?? ''}）`}
        open={!!detailFor}
        onCancel={() => setDetailFor(null)}
        footer={null}
        width={720}
        destroyOnHidden
      >
        <Stack dir="col" gap={4}>
          <Muted>原因：{detailFor?.reason}</Muted>
          {detailFor?.decision_note && <Muted>审批意见：{detailFor.decision_note}</Muted>}
          <Divider orientation="left" plain>变更前</Divider>
          {(detailFor?.before_terms ?? []).map((t) => (
            <div key={`b${t.seq}`}>
              {t.seq}. {t.node_name} {t.percent ? `${t.percent}%` : '—'}{' '}
              {t.amount != null ? `¥${Number(t.amount).toLocaleString()}` : '—'}
              {Number(t.received_amount ?? 0) > 0 ? `（已收 ¥${Number(t.received_amount).toLocaleString()}）` : ''}
            </div>
          ))}
          <Divider orientation="left" plain>新计划（未收节点）</Divider>
          {(detailFor?.terms ?? []).map((t) => (
            <div key={`a${t.seq}`}>
              {t.seq}. {t.node_name} {t.percent ? `${t.percent}%` : '—'}{' '}
              {t.amount != null ? `¥${Number(t.amount).toLocaleString()}` : '—'}
            </div>
          ))}
        </Stack>
      </Modal>

      {/* 审批（商务总监）*/}
      <AppModal
        title={`审批付款计划变更 · ${decideFor?.change_no ?? ''}`}
        open={!!decideFor}
        onClose={() => setDecideFor(null)}
        onOk={() => void decide(true)}
        loading={saving}
        okText="批准（只改未收节点）"
        width={640}
        form={decideForm}
        initialValues={{ note: '' }}
      >
        <Stack dir="col" gap={6}>
          <Muted>原因：{decideFor?.reason}</Muted>
          <Muted>
            {decideFor?.terms?.length ?? 0} 个未收节点将被替换；已收款的节点原样保留（历史收款不动）。
          </Muted>
        </Stack>
        <Form.Item name="note" label="审批说明（否决必填）">
          <Input.TextArea rows={2} placeholder="如：按客户新分期执行 / 比例对不上，回去改" />
        </Form.Item>
        <Button danger onClick={() => void decide(false)}>
          否决
        </Button>
      </AppModal>
    </Card>
  )
}
