import { useSiteBoard } from './hooks'
import IncomingCheckFields from './components/IncomingCheckFields'
import { App, Button, Card, DatePicker, Empty, Form, Input, InputNumber, Radio, Select, Space, Tabs, Tag, Typography } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {useState} from 'react'

import {
  acceptSiteIncoming,
  addSiteDaily,
  addSiteIssue,
  applyAcceptance,
  commissionArrive,
  commissionStart,
  confirmAcceptance,
  errMsg,
  finishCommission,
  hasPerm,
  linkSiteIssue,
  requestCommission,
  saveSiteSurvey,
  sitePhotoUrl,
  uploadSitePhotos,
  type AcceptanceRow,
  type SiteCommissionRow,
  type SiteDailyRow,
  type SiteIncomingPending,
  type SiteIssueRow,
} from '../../api/client'
import MfgPhotoPicker from '../../components/MfgPhotoPicker'
import AppModal from '../../components/AppModal'
import { SITE_ISSUE_STATUS as ISSUE_COLOR } from '../../theme/status'
import { SITE_COMMISSION_STATUS as COMMISSION_COLOR } from '../../theme/status'
import { T } from '../../theme/tokens'

type Kind = 'survey' | 'daily' | 'issue' | 'commission' | 'incoming' | 'acc-apply' | 'acc-confirm'

/** 现场手机端（S8）：现场以手机为唯一终端 —— 勘测 / 来货清点 / 每日汇报 / 问题 / 申请调试。 */
export default function SiteM() {
  const { message } = App.useApp()
  const canEdit = hasPerm('site:edit') || hasPerm('project:edit')
  const [photos, setPhotos] = useState<string[]>([])
  const [videos, setVideos] = useState<string[]>([])
  const [modal, setModal] = useState<{ kind: Kind; target?: SiteIncomingPending; issue?: SiteIssueRow; acc?: AcceptanceRow } | null>(null)
  const [modalInitial, setModalInitial] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  // 重构 2.1：看板数据走共享 hook（与 PC 同源）
  const { projectNo, setProjectNo, projects, wb, incoming, accs, reload: load } = useSiteBoard({ withAcceptance: true })
  const pick = (pno?: string) => {
    setProjectNo(pno)
    void load(pno)
  }

  const open = (kind: Kind, target?: SiteIncomingPending, issue?: SiteIssueRow, acc?: AcceptanceRow) => {
    setPhotos([])
    setVideos([])
    let init: Record<string, unknown> = {}
    if (kind === 'daily') init = { stage: '安装', report_date: dayjs(), done_items: [{ text: '' }], people: 4 }
    if (kind === 'incoming') init = { result: '齐', shortage: [] }
    if (kind === 'commission') init = { plan_date: dayjs().add(3, 'day') }
    if (kind === 'acc-confirm') init = { result: '通过', accepted_at: dayjs() }
    setModalInitial(init)
    setModal({ kind, target, issue, acc })
  }

  const submit = async () => {
    if (!modal || !projectNo) return
    let v
    try { v = await form.validateFields() } catch { return }
    setSaving(true)
    try {
      if (modal.kind === 'survey') {
        await saveSiteSurvey({
          project_no: projectNo,
          contact: v.contact, floor_load: v.floor_load, passage: v.passage, power: v.power, air: v.air, network: v.network,
          enter_date: v.enter_date?.format('YYYY-MM-DD'), photos, remark: v.remark,
        })
      } else if (modal.kind === 'daily') {
        if (photos.length + videos.length === 0) { message.warning('汇报要带照片或视频'); setSaving(false); return }
        await addSiteDaily({
          project_no: projectNo, equip_no: v.equip_no, report_date: v.report_date?.format('YYYY-MM-DD'), stage: v.stage,
          done_items: (v.done_items ?? []).map((i: { text?: string }) => i.text).filter(Boolean),
          people: v.people, photos, videos, problem: v.problem, remark: v.remark,
        })
      } else if (modal.kind === 'issue') {
        await addSiteIssue({ project_no: projectNo, equip_no: v.equip_no, title: v.title, desc: v.desc, photos })
      } else if (modal.kind === 'commission') {
        await requestCommission({ project_no: projectNo, dispatch_to: v.dispatch_to, plan_date: v.plan_date?.format('YYYY-MM-DD'), remark: v.remark })
      } else if (modal.kind === 'incoming' && modal.target) {
        if (!photos.length) { message.warning('到货清点要拍照'); setSaving(false); return }
        await acceptSiteIncoming(modal.target.receipt_id, {
          result: v.result,
          shortage_detail: (v.shortage ?? []).filter((s: { item?: string }) => s.item),
          photos, remark: v.remark,
        })
      } else if (modal.kind === 'acc-apply') {
        await applyAcceptance({ project_no: projectNo, remark: v.remark })
      } else if (modal.kind === 'acc-confirm' && modal.acc) {
        await confirmAcceptance(modal.acc.id, {
          result: v.result, signed_by: v.signed_by, accepted_at: v.accepted_at?.format('YYYY-MM-DD'), remark: v.remark,
        })
      }
      message.success('已提交')
      setModal(null)
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const c = wb?.counts

  const dailyCard = (d: SiteDailyRow) => (
    <Card key={d.id} size="small" style={{ marginBottom: 10 }}>
      <Space>
        <Tag color="processing">{d.stage}</Tag>
        <Typography.Text>{d.report_date}</Typography.Text>
        {d.equip_no && <Tag>{d.equip_no}</Tag>}
        {d.people != null && <Typography.Text type="secondary" style={{ fontSize: 12 }}>现场 {d.people} 人</Typography.Text>}
      </Space>
      <div style={{ fontSize: 12, marginTop: 4 }}>
        {d.done_items.map((x, i) => <div key={i}>✅ {x}</div>)}
        {d.problem && <div style={{ color: T.error }}>⚠ {d.problem}</div>}
      </div>
      <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 4 }}>照片 {d.photos.length} · 视频 {d.videos.length}</div>
    </Card>
  )

  return (
    <>
      <Select
        showSearch optionFilterProp="label" style={{ width: '100%', marginBottom: 12 }} placeholder="选项目"
        value={projectNo} onChange={(v: string | undefined) => pick(v)}
        options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
      />
      {projectNo && (
        <Card size="small" style={{ marginBottom: 10 }}>
          <Space split="|" wrap>
            <span>已勘测 {c?.surveyed ?? 0}</span>
            <span>今日汇报 {c?.daily_today ?? 0}</span>
            <span style={{ color: c?.open_issues ? T.error : undefined }}>待处理问题 {c?.open_issues ?? 0}</span>
            <span>待派调试 {c?.to_dispatch ?? 0}</span>
          </Space>
        </Card>
      )}

      {projectNo && (
        <Tabs
          items={[
            {
              key: 'incoming',
              label: `来货清点 ${incoming.pending.length}`,
              children: (
                <>
                  {incoming.pending.length === 0 && <Empty description="没有待清点的直发件" />}
                  {incoming.pending.map((p) => (
                    <Card key={p.receipt_no} size="small" style={{ marginBottom: 10 }}>
                      <div><b>{p.item_no}</b> × {p.qty} {p.unit ?? ''}</div>
                      <div style={{ fontSize: 12, color: T.textSecondary }}>{p.receipt_no} · {p.receipt_date ?? ''} · 直发客户现场</div>
                      {canEdit && <Button size="small" type="primary" style={{ marginTop: 8 }} onClick={() => open('incoming', p)}>清点验收</Button>}
                    </Card>
                  ))}
                </>
              ),
            },
            {
              key: 'daily',
              label: '每日汇报',
              children: (
                <>
                  {canEdit && <Button type="primary" block style={{ marginBottom: 10 }} onClick={() => open('daily')}>＋ 今天汇报</Button>}
                  {(wb?.dailies.length ?? 0) === 0 && <Empty description="还没有汇报" />}
                  {wb?.dailies.map(dailyCard)}
                </>
              ),
            },
            {
              key: 'issues',
              label: `现场问题 ${wb?.issues.length ?? 0}`,
              children: (
                <>
                  {canEdit && <Button danger block style={{ marginBottom: 10 }} onClick={() => open('issue')}>＋ 上报问题（走变更）</Button>}
                  {(wb?.issues.length ?? 0) === 0 && <Empty description="没有问题" />}
                  {wb?.issues.map((it) => (
                    <Card key={it.id} size="small" style={{ marginBottom: 10 }}>
                      <Space>
                        <Tag color={ISSUE_COLOR[it.status] ?? 'default'}>{it.status}</Tag>
                        <b>{it.title}</b>
                      </Space>
                      <div style={{ fontSize: 12, color: T.textStrong, marginTop: 4 }}>{it.desc}</div>
                      {canEdit && it.status === '待处理' && (
                        <Space style={{ marginTop: 8 }}>
                          <Button size="small" onClick={() => void linkSiteIssue(it.id, { change_id: undefined }).then(() => void load(projectNo))}>转变更</Button>
                          <Button size="small" onClick={() => void linkSiteIssue(it.id, { close: true }).then(() => void load(projectNo))}>闭环</Button>
                        </Space>
                      )}
                    </Card>
                  ))}
                </>
              ),
            },
            {
              key: 'commission',
              label: `申请调试 ${wb?.commissions.length ?? 0}`,
              children: (
                <>
                  {canEdit && <Button type="primary" block style={{ marginBottom: 10 }} onClick={() => open('commission')}>＋ 申请调试（派人到现场）</Button>}
                  {(wb?.commissions.length ?? 0) === 0 && <Empty description="还没申请调试" />}
                  {wb?.commissions.map((m: SiteCommissionRow) => (
                    <Card key={m.id} size="small" style={{ marginBottom: 10 }}>
                      <Space>
                        <Tag color={COMMISSION_COLOR[m.status] ?? 'default'}>{m.status}</Tag>
                        <span>{m.plan_date ?? '待定'}</span>
                        <span>{m.dispatch_to ?? '待派'}</span>
                      </Space>
                      {canEdit && m.status === '已申请' && <Button size="small" style={{ marginTop: 8 }} onClick={() => void commissionArrive(m.id).then(() => void load(projectNo))}>已到现场</Button>}
                      {canEdit && m.status === '已到现场' && <Button size="small" type="primary" style={{ marginTop: 8 }} onClick={() => void commissionStart(m.id).then(() => void load(projectNo))}>开始调试</Button>}
                      {canEdit && m.status === '已开始调试' && <Button size="small" type="primary" style={{ marginTop: 8 }} onClick={() => void finishCommission(m.id).then(() => void load(projectNo))}>调试完成</Button>}
                    </Card>
                  ))}
                </>
              ),
            },
            {
              key: 'acceptance',
              label: `客户验收 ${accs.length}`,
              children: (
                <>
                  {canEdit && <Button type="primary" block style={{ marginBottom: 10 }} onClick={() => open('acc-apply')}>＋ 申请客户验收</Button>}
                  {accs.length === 0 && <Empty description="还没验收单" />}
                  {accs.map((a) => (
                    <Card key={a.id} size="small" style={{ marginBottom: 10 }}>
                      <Space>
                        <Tag color={a.status === '已通过' ? 'success' : a.status === '未通过' ? 'error' : 'gold'}>{a.status}</Tag>
                        <span>资料 {a.doc_count} 个（已签 {a.signed_count}）</span>
                      </Space>
                      {a.warranty_start && (
                        <div style={{ fontSize: 12, color: T.textStrong, marginTop: 4 }}>质保 {a.warranty_start} ~ {a.warranty_end}</div>
                      )}
                      {a.signed_by && <div style={{ fontSize: 12, color: T.textStrong }}>客户签字：{a.signed_by}</div>}
                      {canEdit && a.status === '待验收' && (
                        <Button size="small" type="primary" style={{ marginTop: 8 }} onClick={() => open('acc-confirm', undefined, undefined, a)}>客户确认验收</Button>
                      )}
                    </Card>
                  ))}
                </>
              ),
            },
            {
              key: 'survey',
              label: '勘测',
              children: (
                <>
                  {canEdit && <Button type="primary" block style={{ marginBottom: 10 }} onClick={() => open('survey')}>＋ 现场勘测</Button>}
                  {(wb?.surveys.length ?? 0) === 0 && <Empty description="还没勘测" />}
                  {wb?.surveys.map((s) => (
                    <Card key={s.id} size="small" style={{ marginBottom: 10 }} title={`约定入场 ${s.enter_date ?? '待定'}`}>
                      <div style={{ fontSize: 12, color: T.textStrong }}>
                        甲方：{s.contact ?? '—'} · 承重：{s.floor_load ?? '—'} · 通道：{s.passage ?? '—'}
                        <br />电：{s.power ?? '—'} · 气：{s.air ?? '—'} · 网：{s.network ?? '—'}
                      </div>
                      {s.remark && <div style={{ fontSize: 12, marginTop: 4 }}>{s.remark}</div>}
                    </Card>
                  ))}
                </>
              ),
            },
          ]}
        />
      )}

      <AppModal
        open={!!modal}
        title={modal?.kind === 'survey' ? '现场勘测' : modal?.kind === 'daily' ? '每日汇报' : modal?.kind === 'issue' ? '上报现场问题' : modal?.kind === 'commission' ? '申请调试' : modal?.kind === 'acc-apply' ? '申请客户验收' : modal?.kind === 'acc-confirm' ? '客户确认验收' : `来货清点 · ${modal?.target?.item_no ?? ''}`}
        onClose={() => setModal(null)}
        onOk={() => void submit()}
        loading={saving}
        okText="提交"
        form={form}
        initialValues={modalInitial}
      >
          {modal?.kind === 'survey' && (
            <>
              <Form.Item name="contact" label="甲方现场负责人 / 电话"><Input /></Form.Item>
              <Form.Item name="enter_date" label="约定入场时间" rules={[{ required: true, message: '勘测核心结论：约定入场时间' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="floor_load" label="地面承重"><Input placeholder="如 3t/m²" /></Form.Item>
              <Form.Item name="passage" label="通道 / 吊装口"><Input /></Form.Item>
              <Form.Item name="power" label="电"><Input placeholder="如 380V 100A" /></Form.Item>
              <Form.Item name="air" label="气"><Input placeholder="如 0.6MPa" /></Form.Item>
              <Form.Item name="network" label="网"><Input placeholder="如 有 WiFi" /></Form.Item>
              <Form.Item name="remark" label="备注"><Input /></Form.Item>
            </>
          )}

          {modal?.kind === 'daily' && (
            <>
              <Space>
                <Form.Item name="stage" label="阶段" rules={[{ required: true }]}>
                  <Select style={{ width: 130 }} options={['安装', '单机调试', '联调'].map((s) => ({ value: s, label: s }))} />
                </Form.Item>
                <Form.Item name="report_date" label="日期"><DatePicker /></Form.Item>
                <Form.Item name="equip_no" label="设备"><Input style={{ width: 100 }} /></Form.Item>
                <Form.Item name="people" label="人数"><InputNumber min={0} style={{ width: 80 }} /></Form.Item>
              </Space>
              <Form.Item label="今天做完了什么（勾选清单）">
                <Form.List name="done_items">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map((f) => (
                        <Space key={f.key} style={{ marginBottom: 6 }}>
                          <Form.Item name={[f.name, 'text']} style={{ marginBottom: 0 }}><Input placeholder="如 框架就位" style={{ width: 240 }} /></Form.Item>
                          <MinusCircleOutlined onClick={() => remove(f.name)} />
                        </Space>
                      ))}
                      <Button type="dashed" block onClick={() => add({ text: '' })} icon={<PlusOutlined />}>加一项</Button>
                    </>
                  )}
                </Form.List>
              </Form.Item>
              <Form.Item name="problem" label="今天的问题 / 待协调"><Input.TextArea rows={2} /></Form.Item>
              <Form.Item label="照片（必须）" required>
                <MfgPhotoPicker projectNo={projectNo ?? ''} refNo="daily" value={photos} onChange={setPhotos} allowVideo={false} upload={uploadSitePhotos} photoUrl={sitePhotoUrl} label="拍照" max={9} />
              </Form.Item>
              <Form.Item label="录视频（可选）">
                <MfgPhotoPicker projectNo={projectNo ?? ''} refNo="daily-video" value={videos} onChange={setVideos} allowVideo upload={uploadSitePhotos} photoUrl={sitePhotoUrl} label="录视频" max={3} />
              </Form.Item>
            </>
          )}

          {modal?.kind === 'issue' && (
            <>
              <Form.Item name="equip_no" label="设备"><Input style={{ width: 120 }} /></Form.Item>
              <Form.Item name="title" label="问题标题" rules={[{ required: true }]}><Input placeholder="如 转接件尺寸不符" /></Form.Item>
              <Form.Item name="desc" label="说明"><Input.TextArea rows={2} /></Form.Item>
              <Form.Item label="照片">
                <MfgPhotoPicker projectNo={projectNo ?? ''} refNo="issue" value={photos} onChange={setPhotos} upload={uploadSitePhotos} photoUrl={sitePhotoUrl} label="拍照" />
              </Form.Item>
            </>
          )}

          {modal?.kind === 'commission' && (
            <>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                一个动作：必须派人到现场（设备太多，远程调不了）。会同时通知装配/调试组和项目团队。
              </Typography.Paragraph>
              <Form.Item name="dispatch_to" label="派谁去（调试工程师）" rules={[{ required: true, message: '必须写明派谁去' }]}>
                <Input placeholder="如 王工" />
              </Form.Item>
              <Form.Item name="plan_date" label="计划到场日期"><DatePicker style={{ width: '100%' }} /></Form.Item>
              <Form.Item name="remark" label="备注"><Input /></Form.Item>
            </>
          )}

          {modal?.kind === 'acc-apply' && (
            <>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                现场调试完成 → 申请客户验收。资料包在 PC「验收与质保」页上传（要传要签的东西很多）。
              </Typography.Paragraph>
              <Form.Item name="remark" label="说明"><Input placeholder="现场调试完成，具备验收条件" /></Form.Item>
            </>
          )}

          {modal?.kind === 'acc-confirm' && (
            <>
              <Form.Item name="result" label="验收结论" rules={[{ required: true }]}>
                <Radio.Group optionType="button" buttonStyle="solid">
                  <Radio.Button value="通过">通过</Radio.Button>
                  <Radio.Button value="不通过">不通过</Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Form.Item name="signed_by" label="客户签字人"><Input placeholder="如 客户 张工" /></Form.Item>
              <Form.Item name="accepted_at" label="验收日期"><DatePicker style={{ width: '100%' }} /></Form.Item>
              <Form.Item name="remark" label="备注"><Input /></Form.Item>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>通过后自动进入质保期，项目阶段推进到「质保」。</Typography.Text>
            </>
          )}

          {modal?.kind === 'incoming' && (
            <>
                            <IncomingCheckFields />
              <Form.Item label="照片（必须）" required>
                <MfgPhotoPicker projectNo={projectNo ?? ''} refNo="incoming" value={photos} onChange={setPhotos} upload={uploadSitePhotos} photoUrl={sitePhotoUrl} label="拍照" />
              </Form.Item>
            </>
          )}
      </AppModal>
    </>
  )
}
