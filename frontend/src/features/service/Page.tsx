import { useSvcBoard } from '../../hooks/useSvcBoard'
import { Chip, Code, Empty as DsEmpty, Status } from '../../components/ds'
import QueueBoard from '../../components/ds/QueueBoard'
import WorkbenchPage from '../../components/domain/WorkbenchPage'
import { SERVICE_BOARD } from '../../configs/boards'
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Typography,
} from 'antd'
import { useState, type ReactNode } from 'react'

import {
  arriveServiceOrder,
  createServiceOrder,
  createSparePart,
  dispatchServiceOrder,
  errMsg,
  fixServiceOrder,
  hasPerm,
  listSparePartMoves,
  moveSparePart,
  servicePhotoUrl,
  signServiceOrder,
  uploadServicePhotos,
  type ServiceOrderRow,
  type SparePartRow,
} from '../../api/client'
import MfgPhotoPicker from '../../components/MfgPhotoPicker'
import AppModal from '../../components/AppModal'
import { SelectEquipment, SelectProject } from '../../components/fields'
import ItemSelect from '../../components/fields/ItemSelect'
import { SERVICE_ORDER_STATUS as SO_COLOR, toneOf } from '../../theme/status'

type Kind = 'create' | 'dispatch' | 'fix' | 'sign' | 'part' | 'move'

/** 售后台（S11）：报修受理 → 派工 → 到场 → 处理（备件更换）→ 客户签字 → 关闭。 */
export default function Service() {
  const { message } = App.useApp()
  const canEdit = hasPerm('service:edit')

  const [moves, setMoves] = useState<Record<number, { move_type: string; qty: number; moved_at?: string | null }[]>>({})
  /**
   * ★ 队列只列**有下一步动作**的行（docs/15 判定法）。已关闭的工单行尾没有按钮，
   *   混在队列里会出现「结论条 5 格全 0（今天没活）· 队列却躺着 2 条已关闭」的矛盾
   *   （2026-10-05 逐页走查实测）。已关闭的按台账处理：默认收起，行尾给一个开关看。
   */
  const [showClosed, setShowClosed] = useState(false)
  // ★ 重整 P0（docs/10 §3.2/§3.3）：页签条按**真实权限码**过滤，状态写进 URL（?tab=）

  const [modal, setModal] = useState<{ kind: Kind; order?: ServiceOrderRow; part?: SparePartRow } | null>(null)
  const [modalInitial, setModalInitial] = useState<Record<string, unknown>>({})
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  // 字段组件联动：设备按已选项目过滤（重构 1.4，原手填 equip_no）
  const watchProject = Form.useWatch('project_no', form)

  // 重构 2.3：看板数据走共享 hook（与另一端同源）
  const { wb, parts: partsList, reload: load } = useSvcBoard({ full: true })

  const open = (kind: Kind, order?: ServiceOrderRow, part?: SparePartRow) => {
    setPhotos([])
    setModalInitial(kind === 'move' && part ? { part_id: part.id, move_type: '领出', qty: 1 } : {})
    setModal({ kind, order, part })
  }

  const submit = async () => {
    if (!modal) return
    let v
    try { v = await form.validateFields() } catch { return }
    setSaving(true)
    try {
      if (modal.kind === 'create') {
        const r = await createServiceOrder(v)
        message.success(`已建工单 ${r.so_no}（${r.in_warranty ? '在保' : '过保'}）`)
      } else if (modal.kind === 'dispatch' && modal.order) {
        await dispatchServiceOrder(modal.order.id, v.dispatched_to)
        message.success('已派工')
      } else if (modal.kind === 'fix' && modal.order) {
        await fixServiceOrder(modal.order.id, { solution: v.solution, labor_hours: v.labor_hours, photos, remark: v.remark })
        message.success('处理完成，待客户签字')
      } else if (modal.kind === 'sign' && modal.order) {
        await signServiceOrder(modal.order.id, v.customer_sign)
        message.success('客户签字，工单关闭')
      } else if (modal.kind === 'part') {
        await createSparePart(v)
        message.success('备件已建账')
      } else if (modal.kind === 'move') {
        await moveSparePart({
          part_id: v.part_id,
          move_type: v.move_type,
          qty: v.qty,
          service_order_id: v.service_order_id || undefined,
          issued_to: v.issued_to || undefined,
          remark: v.remark,
        })
        message.success('收发已记录')
      }
      setModal(null)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const loadMoves = async (partId: number) => {
    try {
      const rows = await listSparePartMoves(partId)
      setMoves((m) => ({ ...m, [partId]: rows }))
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const c = wb?.counts
  const partOptions = partsList.map((p) => ({ value: p.id, label: `${p.item_no} ${p.item_name ?? ''}（库存 ${p.qty_stock}）` }))
  // 队列 = 未关闭（行尾有下一个动作）；开关打开才把已关闭的也列进来（当台账查）
  const queueOrders = (wb?.orders ?? []).filter((r) => showClosed || r.status !== '已关闭')

  // 体：按页签 key 取（顺序 / 标题 / 徽标 / 可见性全来自注册表 SERVICE_BOARD）
  const partsOf: Record<string, ReactNode> = {
    orders: (
      <>
        <div className="ds-q-bar">
          <div className="l">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              报修时自动判定这台设备在保 / 过保；每一步（派工→到场→处理→签字）都在行尾那一个按钮上。
            </Typography.Text>
          </div>
          <div className="r">
            <Button type="primary" size="small" disabled={!canEdit} onClick={() => open('create')}>
              报修（新建工单）
            </Button>
          </div>
        </div>
        <QueueBoard
          emptyText={
            (c?.closed ?? 0) > 0
              ? `没有待处理的工单 —— ${c?.closed} 单已关闭（点右上角「已关闭」可以查）。`
              : '还没有服务工单 —— 客户报修后在这里受理、派工、处理、签字关单。'
          }
          toolbar={
            (c?.closed ?? 0) > 0 ? (
              <Button size="small" onClick={() => setShowClosed((v) => !v)}>
                {showClosed ? '只看未关闭' : `已关闭 ${c?.closed}`}
              </Button>
            ) : undefined
          }
          items={queueOrders.map((r) => ({
            key: r.id,
            // ★ 方向 2 ③：色条只给**阶段差异**（同一队列里每行阶段都不同，所以这里能传）。
            //   待受理 = 客户在等没人接（红）· 待客户签字 = 只差他一下（橙）· 其余在修（蓝）。
            tone: r.status === '待受理' ? 'err' : r.status === '待客户签字' ? 'warn' : 'run',
            lead: <Code>{r.so_no}</Code>,
            title: r.fault ?? '（未填故障描述）',
            meta: `${r.project_no}${r.equip_no ? ` · ${r.equip_no}` : ''} · 处理人 ${r.dispatched_to ?? '待派工'}`,
            cells: [
              {
                text: r.in_warranty == null ? '—' : r.in_warranty ? <Chip tone="ok">在保</Chip> : <Chip tone="warn">过保</Chip>,
                title: '质保',
              },
              { text: <Status tone={toneOf(SO_COLOR[r.status])}>{r.status}</Status>, title: '状态' },
            ],
            action: !canEdit ? undefined : r.status === '待受理' ? (
              <Button type="primary" size="small" onClick={() => open('dispatch', r)}>
                派工
              </Button>
            ) : r.status === '已派工' ? (
              <Button
                type="primary"
                size="small"
                onClick={() => void arriveServiceOrder(r.id).then(() => void load()).catch((e) => message.error(errMsg(e)))}
              >
                到场
              </Button>
            ) : r.status === '已到场' ? (
              <Button type="primary" size="small" onClick={() => open('fix', r)}>
                处理完成
              </Button>
            ) : r.status === '待客户签字' ? (
              <Button type="primary" size="small" onClick={() => open('sign', r)}>
                客户签字
              </Button>
            ) : undefined,
          }))}
        />
      </>
    ),
    parts: (
      <>
        <Space style={{ marginBottom: 10 }}>
          <Button type="primary" disabled={!canEdit} onClick={() => open('part')}>备件建账</Button>
          <Button disabled={!canEdit || partsList.length === 0} onClick={() => open('move')}>备件收发（领出/退回/补货）</Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>领出可关联服务工单；低于安全库存会标红。</Typography.Text>
        </Space>
        <Table<SparePartRow>
          scroll={{ x: 850 }}
          rowKey="id"
          size="small"
          dataSource={partsList}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          locale={{ emptyText: <DsEmpty text="还没有备件" /> }}
          columns={[
            { title: '物料', dataIndex: 'item_no', width: 180 },
            { title: '名称', dataIndex: 'item_name', render: (v: string | null) => v ?? '—' },
            { title: '项目 / 设备', key: 'pe', width: 160, render: (_: unknown, r: SparePartRow) => `${r.project_no ?? ''}${r.equip_no ? ` · ${r.equip_no}` : ''}` || '通用' },
            {
              title: '备件库存',
              dataIndex: 'qty_stock',
              width: 110,
              align: 'right',
              render: (v: number, r: SparePartRow) =>
                r.min_qty != null && v < r.min_qty ? <Status tone="err">{v}（低于 {r.min_qty}）</Status> : v,
            },
            { title: '装机数', dataIndex: 'qty_installed', width: 90, align: 'right' },
            {
              title: '收发记录',
              key: 'm',
              width: 120,
              render: (_: unknown, r: SparePartRow) =>
                moves[r.id] ? (
                  <span style={{ fontSize: 12 }}>
                    {moves[r.id].slice(0, 3).map((m, i) => (
                      <div key={i}>{m.move_type} ×{m.qty}</div>
                    ))}
                  </span>
                ) : (
                  <a onClick={() => void loadMoves(r.id)}>查看</a>
                ),
            },
          ]}
        />
      </>

    ),
  }

  // ★ docs/15 台骨架四件套：台头 → 结论条 → 流程条（注册表驱动）→ 体
  return (
    <>
      <WorkbenchPage
        board={SERVICE_BOARD}
        sub={
          // ★ 方向 2 ①：异常优先（待受理是唯一“客户在等”的），没事才报未关闭 / 备件
          (c?.wait ?? 0) > 0
            ? `有 ${c?.wait} 单等你受理`
            : (c?.open ?? 0) > 0
              ? `未关闭 ${c?.open} 单（处理中 ${c?.in_progress} · 待客户签字 ${c?.to_sign}）`
              : (c?.low_parts ?? 0) > 0
                ? `没有未关闭工单 · ${c?.low_parts} 种备件低库存`
                : '没有未关闭工单'
        }
        help="报修受理 → 派工 → 到场 → 处理（备件更换）→ 客户签字 → 关闭；报修时自动判定这台设备在保 / 过保。"
        actions={
          <>
            {/* ★ 精调（2026-10-05）：台头 actions 只留**能按下去的动作**。
                 原来这里摆的是“缺货 3 种 / 到货超期 N / 有风险 N”这类**纯计数**——
                 而结论条里已经有同一个数（而且**可点**，点了直接切到那个队列）。
                 同一批数在一个页上出现两次，是“看着毛”的头号来源（实测 5 个台都有）。 */}
            <Button size="small" onClick={() => void load()}>
              刷新
            </Button>
          </>
        }
        counts={{ orders: wb?.orders.length ?? 0, parts: partsList.length }}
        metrics={[
          // ★ 方向 2 ② 主角指认：售后台主角 = **待受理**：客户已经报修了、还没人接 —— 最该马上有人动的就是它。（ds `MetricItem.lead`）
          { key: 'wait', label: '待受理', value: c?.wait ?? 0, unit: '单', tone: c?.wait ? 'err' : undefined, dimZero: true, to: '?tab=orders', lead: true },
          { key: 'run', label: '处理中', value: c?.in_progress ?? 0, unit: '单', dimZero: true, to: '?tab=orders' },
          { key: 'sign', label: '待客户签字', value: c?.to_sign ?? 0, unit: '单', dimZero: true, to: '?tab=orders' },
          { key: 'part', label: '备件低库存', value: c?.low_parts ?? 0, unit: '种', tone: c?.low_parts ? 'warn' : undefined, dimZero: true, to: '?tab=parts' },
          { key: 'open', label: '未关闭工单', value: c?.open ?? 0, unit: '单', dimZero: true, to: '?tab=orders' },
        ]}
      >
        {(t) => partsOf[t]}
      </WorkbenchPage>

      <AppModal
        className="engineering-modal"
        open={!!modal}
        title={
          modal?.kind === 'create' ? '报修（新建服务工单）'
            : modal?.kind === 'dispatch' ? `派工 · ${modal.order?.so_no ?? ''}`
              : modal?.kind === 'fix' ? `处理完成 · ${modal.order?.so_no ?? ''}`
                : modal?.kind === 'sign' ? `客户签字 · ${modal.order?.so_no ?? ''}`
                  : modal?.kind === 'part' ? '备件建账' : '备件收发'
        }
        onClose={() => setModal(null)}
        onOk={() => void submit()}
        loading={saving}
        okText="提交"
        form={form}
        initialValues={modalInitial}
      >
          {modal?.kind === 'create' && (
            <>
              <Form.Item name="project_no" label="项目号" rules={[{ required: true, message: '选项目' }]}>
                <SelectProject />
              </Form.Item>
              <Form.Item name="equip_no" label="设备号（可选）">
                <SelectEquipment projectNo={watchProject} />
              </Form.Item>
              <Form.Item name="fault" label="故障描述" rules={[{ required: true, message: '必填：出了什么问题' }]}><Input.TextArea rows={2} /></Form.Item>
            </>
          )}
          {modal?.kind === 'dispatch' && (
            <Form.Item name="dispatched_to" label="派谁去修" rules={[{ required: true }]}><Input placeholder="如 李工 138xxxx" /></Form.Item>
          )}
          {modal?.kind === 'fix' && (
            <>
              <Form.Item name="solution" label="处理方案" rules={[{ required: true }]}><Input.TextArea rows={2} placeholder="如 更换电磁阀 + 调整气路" /></Form.Item>
              <Form.Item name="labor_hours" label="工时（小时）"><InputNumber min={0} style={{ width: 140 }} /></Form.Item>
              <Form.Item name="remark" label="备注"><Input /></Form.Item>
              <Form.Item label="现场照片">
                <MfgPhotoPicker
                  projectNo={modal.order?.project_no ?? ''} refNo={modal.order?.so_no ?? ''} value={photos} onChange={setPhotos}
                  upload={uploadServicePhotos} photoUrl={servicePhotoUrl} label="拍照"
                />
              </Form.Item>
            </>
          )}
          {modal?.kind === 'sign' && (
            <Form.Item name="customer_sign" label="客户签字人" rules={[{ required: true }]}><Input placeholder="如 客户 王经理" /></Form.Item>
          )}
          {modal?.kind === 'part' && (
            <>
              {/* ★ 备件也走「搜物料 + 选项目/设备」（P2-10）：手打物料号会建出库里有码但拼错的备件档 */}
              <Form.Item name="item_no" label="物料" rules={[{ required: true, message: '选一个物料' }]}>
                <ItemSelect />
              </Form.Item>
              <Form.Item name="item_name" label="名称（不填用库里的）"><Input /></Form.Item>
              <Space>
                <Form.Item name="project_no" label="项目（可选）"><SelectProject /></Form.Item>
                <Form.Item name="equip_no" label="设备（可选）"><Input style={{ width: 100 }} placeholder="如 01A" /></Form.Item>
              </Space>
              <Space>
                <Form.Item name="qty_stock" label="备件库存"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
                <Form.Item name="qty_installed" label="装机数"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
                <Form.Item name="min_qty" label="安全库存"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
              </Space>
            </>
          )}
          {modal?.kind === 'move' && (
            <>
              <Form.Item name="part_id" label="备件" rules={[{ required: true }]}>
                <Select options={partOptions} placeholder="选备件" showSearch optionFilterProp="label" />
              </Form.Item>
              <Space>
                <Form.Item name="move_type" label="类型" rules={[{ required: true }]}>
                  <Select style={{ width: 110 }} options={['领出', '退回', '补货'].map((t) => ({ value: t, label: t }))} />
                </Form.Item>
                <Form.Item name="qty" label="数量" rules={[{ required: true }]}><InputNumber min={0.01} style={{ width: 110 }} /></Form.Item>
                <Form.Item name="issued_to" label="领给谁"><Input style={{ width: 130 }} /></Form.Item>
              </Space>
              <Form.Item name="service_order_id" label="关联服务工单（可选）">
                <Select
                  allowClear
                  placeholder="选工单"
                  options={(wb?.orders ?? []).map((o) => ({ value: o.id, label: `${o.so_no} ${o.project_no}` }))}
                  showSearch
                  optionFilterProp="label"
                />
              </Form.Item>
              <Form.Item name="remark" label="备注"><Input /></Form.Item>
            </>
          )}
      </AppModal>
    </>
  )
}

