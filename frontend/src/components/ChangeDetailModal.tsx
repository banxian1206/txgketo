import {
  Alert,
  App,
  Button,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'

import {
  changeImpact,
  decideChangeRequest,
  dispatchChangeRequest,
  errMsg,
  getChangeRequest,
  listUsers,
  me,
  reviseChangeBom,
  type ChangeImpact,
  type ChangeRequestRow,
  type User,
  type UserRow,
} from '../api/client'
import { CHANGE_STATUS as STATUS_COLOR } from '../theme/status'

interface Props {
  crId: number | null
  open: boolean
  onClose: () => void
  onChanged?: () => void
}

/** 改版申请详情：总监裁决/下发、影响面、BOM 修订（05 卷 §7） */
export default function ChangeDetailModal({ crId, open, onClose, onChanged }: Props) {
  const { message } = App.useApp()
  const [cr, setCr] = useState<ChangeRequestRow | null>(null)
  const [impact, setImpact] = useState<ChangeImpact | null>(null)
  const [profile, setProfile] = useState<User | null>(null)
  const [users, setUsers] = useState<UserRow[]>([])
  const [note, setNote] = useState('')
  const [solution, setSolution] = useState('')
  const [assignee, setAssignee] = useState<number | undefined>()
  const [busy, setBusy] = useState(false)
  const [reviseOpen, setReviseOpen] = useState(false)
  const [reviseForm] = Form.useForm()

  const load = useCallback(async () => {
    if (!crId) return
    try {
      const [d, imp, who, us] = await Promise.all([
        getChangeRequest(crId),
        changeImpact(crId),
        me(),
        listUsers(),
      ])
      setCr(d)
      setImpact(imp)
      setProfile(who)
      setUsers(us)
      setNote('')
      setSolution('')
      setAssignee(undefined)
    } catch (e) {
      message.error(errMsg(e))
    }
  }, [crId, message])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const isDirector = ['总监', '部门负责人', '工程总监'].includes(profile?.position ?? '')
  const isTaskOwner = !!cr && cr.change_task_owner_id === profile?.id
  const canDecide = cr?.status === '待裁决' && isDirector
  const canDispatch = cr?.status === '已批准' && isDirector
  const canRevise = cr?.target_type === 'BOM_ITEM' && cr.status === '已下发' && isTaskOwner

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      message.success(ok)
      await load()
      onChanged?.()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const doRevise = async () => {
    if (!cr) return
    let v
    try { v = await reviseForm.validateFields() } catch { return }
    await act(
      () => reviseChangeBom(cr.id, { qty: v.qty, pos_no: v.pos_no ?? null, remark: v.remark ?? null }),
      '已生成替代草稿行 —— 到设计面「我的提交」里勾选提交评审',
    )
    setReviseOpen(false)
  }

  const candidates = users.filter(
    (u) =>
      u.is_active &&
      cr != null &&
      (u.profession === cr.profession ||
        ['经理', '组长', '设计组长', '主管'].includes(u.position ?? '') ||
        u.is_superuser),
  )

  return (
    <Modal
      title={
        cr ? (
          <Space>
            <span>改版申请 {cr.cr_no}</span>
            <Tag color={STATUS_COLOR[cr.status] ?? 'default'}>{cr.status}</Tag>
          </Space>
        ) : (
          '改版申请'
        )
      }
      open={open}
      width={760}
      onCancel={onClose}
      footer={
        <Space>
          {canRevise && <Button onClick={() => setReviseOpen(true)}>修订 BOM 行</Button>}
          {canDecide && (
            <>
              <Button
                danger
                loading={busy}
                onClick={() => void act(() => decideChangeRequest(cr!.id, { decision: '否决', note, solution }), '已否决')}
              >
                否决
              </Button>
              <Button
                type="primary"
                loading={busy}
                onClick={() => void act(() => decideChangeRequest(cr!.id, { decision: '批准', note, solution: '' }), '已批准 —— 等下发任务')}
              >
                批准
              </Button>
            </>
          )}
          {canDispatch && (
            <Button
              type="primary"
              disabled={!assignee}
              loading={busy}
              onClick={() => void act(() => dispatchChangeRequest(cr!.id, assignee!), '已下发改版任务')}
            >
              下发改版任务
            </Button>
          )}
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
    >
      {cr && (
        <>
          <Descriptions size="small" column={2} style={{ marginBottom: 8 }}>
            <Descriptions.Item label="对象">
              {cr.target_title}（{cr.target_label} {cr.target_version}）
            </Descriptions.Item>
            <Descriptions.Item label="设备">
              {cr.project_no} / {cr.equip_no ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="专业">{cr.profession ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="申请人">{cr.applicant_name ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="问题" span={2}>
              {cr.reason}
            </Descriptions.Item>
            {cr.proposal && (
              <Descriptions.Item label="建议" span={2}>
                {cr.proposal}
              </Descriptions.Item>
            )}
            {cr.decided_by_name && (
              <Descriptions.Item label="裁决" span={2}>
                {cr.decided_by_name} · {cr.decision_note ?? '—'}
                {cr.solution ? `（替代方案：${cr.solution}）` : ''}
              </Descriptions.Item>
            )}
            {cr.change_task_no && (
              <Descriptions.Item label="改版任务" span={2}>
                {cr.change_task_no} → {cr.change_task_owner ?? '—'}（{cr.change_task_status}）
              </Descriptions.Item>
            )}
            {cr.new_release_no && (
              <Descriptions.Item label="发布" span={2}>
                {cr.new_release_no}
              </Descriptions.Item>
            )}
          </Descriptions>

          {(canDecide || canDispatch) && (
            <>
              {canDecide && (
                <>
                  <Input.TextArea
                    rows={2}
                    style={{ marginBottom: 8 }}
                    placeholder="裁决意见（可留空）"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <Input.TextArea
                    rows={2}
                    style={{ marginBottom: 8 }}
                    placeholder="否决时的替代方案 / 处理办法（否决必填）"
                    value={solution}
                    onChange={(e) => setSolution(e.target.value)}
                  />
                </>
              )}
              {canDispatch && (
                <Select
                  style={{ width: '100%', marginBottom: 8 }}
                  placeholder={`下发给「${cr.profession}」专业的设计师`}
                  value={assignee}
                  onChange={setAssignee}
                  options={candidates.map((u) => ({
                    value: u.id,
                    label: `${u.name}${u.position ? `（${u.position}）` : ''}`,
                  }))}
                />
              )}
            </>
          )}

          <Divider orientation="left" plain>
            影响面（只提示，人工处理）
          </Divider>
          <Alert type={impact?.has_open_purchase ? 'warning' : 'info'} showIcon message={impact?.note ?? ''} style={{ marginBottom: 8 }} />
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={impact?.purchase_requests ?? []}
            locale={{ emptyText: '没有关联的采购需求' }}
            columns={[
              { title: '物料', dataIndex: 'item_no', width: 140 },
              { title: '零件', dataIndex: 'part_no', width: 180, render: (v: string | null) => v ?? '—' },
              {
                title: '数量',
                dataIndex: 'qty',
                width: 90,
                render: (v: number, r: { unit?: string | null }) => `${v} ${r.unit ?? ''}`,
              },
              { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag>{v}</Tag> },
              { title: '来源', dataIndex: 'source', width: 90 },
              { title: '采购单', dataIndex: 'po_no', render: (v: string | null) => v ?? '—' },
            ]}
          />
          {(impact?.material_issues.length ?? 0) > 0 && (
            <Table
              style={{ marginTop: 8 }}
              rowKey="issue_no"
              size="small"
              pagination={false}
              dataSource={impact?.material_issues ?? []}
              columns={[
                { title: '领料单', dataIndex: 'issue_no' },
                { title: '状态', dataIndex: 'status' },
                { title: '应领', dataIndex: 'qty_required' },
                { title: '已领', dataIndex: 'qty_issued' },
              ]}
            />
          )}
          {canRevise && (
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
              这是你负责的改版任务：点「修订 BOM 行」生成替代草稿行，改完在设计面勾选提交评审。
            </Typography.Paragraph>
          )}
        </>
      )}

      <Modal
        title="修订 BOM 行"
        open={reviseOpen}
        onCancel={() => setReviseOpen(false)}
        onOk={() => void doRevise()}
        confirmLoading={busy}
        okText="生成替代行"
        destroyOnHidden
      >
        <Form form={reviseForm} layout="vertical" preserve={false}>
          <Form.Item name="qty" label="新用量" rules={[{ required: true, message: '填新用量' }]}>
            <InputNumber style={{ width: '100%' }} min={0.001} />
          </Form.Item>
          <Form.Item name="pos_no" label="位号">
            <Input />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Modal>
  )
}
