import { CheckCircleFilled, MinusCircleOutlined, PlusOutlined, WarningOutlined } from '@ant-design/icons'
import { useSiteBoard } from './hooks'
import IncomingCheckFields from './components/IncomingCheckFields'
import { App, Button, DatePicker, Form, Input, InputNumber, Radio, Select, Space } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'

import { useAuth } from '../../contexts/AuthContext'

import { acceptSiteIncoming, addSiteDaily, addSiteIssue, applyAcceptance, commissionArrive, commissionStart, confirmAcceptance, errMsg, finishCommission, hasPerm, linkSiteIssue, requestCommission, saveSiteSurvey, sitePhotoUrl, uploadSitePhotos, type AcceptanceRow, type SiteCommissionRow, type SiteDailyRow, type SiteIncomingPending, type SiteIssueRow } from '../../api/client'
import { MCard, MChip, MEmpty, MHead, MStatus } from '../../components/ds/mobile'
import MfgPhotoPicker from '../../components/MfgPhotoPicker'
import AppModal from '../../components/AppModal'
import { getDesignTree } from '../../api/design'

type Kind = 'survey' | 'daily' | 'issue' | 'commission' | 'incoming' | 'acc-apply' | 'acc-confirm'

/** 现场手机端（S8）：现场以手机为唯一终端 —— 勘测 / 来货清点 / 每日汇报 / 问题 / 申请调试。 */
/** 现场问题 / 调试申请状态 → 作业卡 tone（与 PC 同一套语义） */
const ISSUE_TONE: Record<string, 'ok' | 'warn' | 'err' | 'run' | undefined> = {
  待处理: 'err', 已转变更: 'run', 已闭环: 'ok',
}
const COMMISSION_TONE: Record<string, 'ok' | 'warn' | 'err' | 'run' | undefined> = {
  已申请: 'warn', 已到现场: 'run', 已开始调试: 'run', 调试完成: 'ok',
}

export default function SiteM() {
  const { message } = App.useApp()
  // ★ N1（2026-10-04 走查核实）：被派的调试工程师本人也能记自己的进度（与后端 _can_act_on_commission 同口径）
  const { user: me } = useAuth()
  const canEdit = hasPerm('site:edit') || hasPerm('project:edit')
  const canActOnCommission = (m: { dispatch_to?: string | null }) => {
    const d = (m.dispatch_to ?? '').trim()
    if (!d || !me) return false
    return d.includes(me.name) || d.includes(me.username)
  }
  const [photos, setPhotos] = useState<string[]>([])
  const [videos, setVideos] = useState<string[]>([])
  const [modal, setModal] = useState<{ kind: Kind; target?: SiteIncomingPending; issue?: SiteIssueRow; acc?: AcceptanceRow } | null>(null)
  const [modalInitial, setModalInitial] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  // ★ R4-c：视图切换从 antd Tabs 改成 .m-seg —— 显式 state（6 个视图：清点/日报/问题/调试/验收/勘测）
  const [view, setView] = useState<'incoming' | 'daily' | 'issues' | 'commission' | 'acceptance' | 'survey'>('incoming')
  const [form] = Form.useForm()

  // 重构 2.1：看板数据走共享 hook（与 PC 同源）
  const { projectNo, setProjectNo, projects, wb, incoming, accs, reload: load } = useSiteBoard({ withAcceptance: true })

  // ★ G3（09 卷 §3）：现场问题要能挂到**具体零件**（不是只到设备）
  //   客户口径：“他肯定是反映这个零件…它是有归属的噱。”
  //   零件列表按“当前填的设备”拉设计面（图号 + 标准件/原材料），供勾选。
  const equipNo = Form.useWatch('equip_no', form) as string | undefined
  const [parts, setParts] = useState<{ value: string; label: string; kind: '图号' | '物料' }[]>([])
  useEffect(() => {
    let alive = true
    if (!projectNo || !equipNo) { setParts([]); return }
    getDesignTree(projectNo, equipNo)
      .then((t) => {
        if (!alive) return
        const ds = (t.tree ?? []).map((d) => ({
          value: d.drawing_no, label: `${d.drawing_no}　${d.title}`, kind: '图号' as const,
        }))
        const its = [...(t.std_bom ?? []), ...(t.material_bom ?? [])].map((b) => ({
          value: b.child_item_no, label: `${b.child_item_no}　${b.display_name ?? ''}`, kind: '物料' as const,
        }))
        setParts([...ds, ...its])
      })
      .catch(() => { if (alive) setParts([]) })
    return () => { alive = false }
  }, [projectNo, equipNo])

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
    // ★ F9（2026-10-04 走查核实）：重复提交不再堆记录 —— 后端复用已有并原地更新，这里如实告诉用户
    let okMsg = '已提交'
    try {
      if (modal.kind === 'survey') {
        const res = await saveSiteSurvey({
          project_no: projectNo,
          contact: v.contact, floor_load: v.floor_load, passage: v.passage, power: v.power, air: v.air, network: v.network,
          enter_date: v.enter_date?.format('YYYY-MM-DD'), photos, remark: v.remark,
        })
        if (res.reused) okMsg = '这个项目已有勘测记录，已更新（没有重复建单）'
      } else if (modal.kind === 'daily') {
        if (photos.length + videos.length === 0) { message.warning('汇报要带照片或视频'); setSaving(false); return }
        await addSiteDaily({
          project_no: projectNo, equip_no: v.equip_no, report_date: v.report_date?.format('YYYY-MM-DD'), stage: v.stage,
          done_items: (v.done_items ?? []).map((i: { text?: string }) => i.text).filter(Boolean),
          people: v.people, photos, videos, problem: v.problem, remark: v.remark,
        })
      } else if (modal.kind === 'issue') {
        await addSiteIssue({ project_no: projectNo, equip_no: v.equip_no, drawing_no: v.drawing_no, title: v.title, desc: v.desc, photos })
      } else if (modal.kind === 'commission') {
        const res = await requestCommission({ project_no: projectNo, dispatch_to: v.dispatch_to, plan_date: v.plan_date?.format('YYYY-MM-DD'), remark: v.remark })
        if (res.reused) okMsg = '已有未完成的调试申请，已更新（没有重复建单）'
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
      message.success(okMsg)
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
    <MCard
      key={d.id}
      tone={d.problem ? 'err' : 'run'}
      head={
        <>
          <MStatus tone="run">{d.stage}</MStatus>
          <span style={{ marginLeft: 'auto' }}>
            <MChip>{d.photos.length} 张 · {d.videos.length} 视频</MChip>
          </span>
        </>
      }
      title={d.report_date}
      lines={[
        ...(d.people != null ? [<>现场 {d.people} 人</>] : []),
        ...d.done_items.map((x) => (
          <span key={x} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CheckCircleFilled style={{ color: 'var(--ds-ok)' }} /> {x}
          </span>
        )),
        ...(d.problem
          ? [
              <span key="p" style={{ color: 'var(--ds-err)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <WarningOutlined /> {d.problem}
              </span>,
            ]
          : []),
      ]}
    />
  )

  return (
    <>
      <Select
        showSearch optionFilterProp="label" aria-label="项目" style={{ width: '100%', marginBottom: 12 }} placeholder="选项目"
        value={projectNo} onChange={(v: string | undefined) => pick(v)}
        options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
      />
      {!projectNo && (
        <>
          <MHead title="现场" sub="先选一个项目（现场日常用手机浏览器加主屏）" />
          {projects.map((pj) => (
            <MCard
              key={pj.project_no}
              head={<span className="ds-code" style={{ fontSize: 12 }}>{pj.project_no}</span>}
              title={pj.project_name}
              onClick={() => pick(pj.project_no)}
            />
          ))}
        </>
      )}

      {projectNo && (
        <MHead
          title="现场"
          sub={`待清点 ${incoming.pending.length} · 今日汇报 ${c?.daily_today ?? 0} · 问题 ${
            c?.open_issues ?? 0
          } · 待派调试 ${c?.to_dispatch ?? 0}`}
        />
      )}

      {projectNo && (
        <div className="m-seg wrap">
          {(
            [
              ['incoming', `来货清点${incoming.pending.length ? ` ${incoming.pending.length}` : ''}`],
              ['daily', '每日汇报'],
              ['issues', `现场问题${c?.open_issues ? ` ${c.open_issues}` : ''}`],
              ['commission', `申请调试${c?.to_dispatch ? ` ${c.to_dispatch}` : ''}`],
              ['acceptance', `客户验收${accs.length ? ` ${accs.length}` : ''}`],
              ['survey', '勘测'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={view === k ? 'on' : ''} onClick={() => setView(k)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {projectNo && view === 'incoming' && (
        <>
          {incoming.pending.length === 0 && <MEmpty text="没有待清点的直发件。直发到现场的货会出现在这里。" />}
          {incoming.pending.map((p) => (
            <MCard
              key={p.receipt_no}
              tone="warn"
              head={
                <>
                  <span className="ds-code" style={{ fontSize: 12 }}>{p.receipt_no}</span>
                  <MStatus tone="warn">待清点</MStatus>
                  <span style={{ marginLeft: 'auto' }}>
                    <MChip>直发客户现场</MChip>
                  </span>
                </>
              }
              title={`${p.item_no} × ${p.qty} ${p.unit ?? ''}`}
              lines={[<>到货 {p.receipt_date ?? '—'}</>]}
            >
              <div className="m-actions">
                {canEdit && (
                  <Button block type="primary" onClick={() => open('incoming', p)}>
                    清点验收（逐项到 / 缺 / 损 + 拍照）
                  </Button>
                )}
              </div>
            </MCard>
          ))}
        </>
      )}

      {projectNo && view === 'daily' && (
        <>
          {canEdit && (
            <div className="m-actions" style={{ marginTop: 0, marginBottom: 12 }}>
              <Button block type="primary" onClick={() => open('daily')}>
                ＋ 今天汇报（必带照片）
              </Button>
            </div>
          )}
          {(wb?.dailies.length ?? 0) === 0 && <MEmpty text="还没有汇报。每天收工前报一次：勾今天做完的 + 拍照。" />}
          {wb?.dailies.map(dailyCard)}
        </>
      )}

      {projectNo && view === 'issues' && (
        <>
          {canEdit && (
            <div className="m-actions" style={{ marginTop: 0, marginBottom: 12 }}>
              <Button block danger onClick={() => open('issue')}>
                ＋ 上报问题（改动一律走变更）
              </Button>
            </div>
          )}
          {(wb?.issues.length ?? 0) === 0 && <MEmpty text="没有问题。现场遇到的改动需求都从这里上报，走变更审批。" />}
          {wb?.issues.map((it) => (
            <MCard
              key={it.id}
              tone={ISSUE_TONE[it.status]}
              head={
                <>
                  <MStatus tone={ISSUE_TONE[it.status]}>{it.status}</MStatus>
                  {it.drawing_no && <span className="ds-code" style={{ fontSize: 12 }}>{it.drawing_no}</span>}
                </>
              }
              title={it.title}
              lines={[<>{it.desc ?? ''}</>]}
            >
              {canEdit && it.status === '待处理' && (
                <div className="m-actions">
                  <Button
                    block
                    onClick={() => void linkSiteIssue(it.id, { change_id: undefined }).then(() => void load(projectNo))}
                  >
                    转变更（走 ECN 审批）
                  </Button>
                  <Button block onClick={() => void linkSiteIssue(it.id, { close: true }).then(() => void load(projectNo))}>
                    直接闭环
                  </Button>
                </div>
              )}
            </MCard>
          ))}
        </>
      )}

      {projectNo && view === 'commission' && (
        <>
          {canEdit && (
            <div className="m-actions" style={{ marginTop: 0, marginBottom: 12 }}>
              <Button block type="primary" onClick={() => open('commission')}>
                ＋ 申请调试（派人到现场）
              </Button>
            </div>
          )}
          {(wb?.commissions.length ?? 0) === 0 && <MEmpty text="还没申请调试。安装完成后在这里申请，必须写清派谁去。" />}
          {wb?.commissions.map((m: SiteCommissionRow) => (
            <MCard
              key={m.id}
              tone={COMMISSION_TONE[m.status]}
              head={
                <>
                  <MStatus tone={COMMISSION_TONE[m.status]}>{m.status}</MStatus>
                  <span style={{ marginLeft: 'auto' }}>
                    <MChip>{m.dispatch_to ?? '待派'}</MChip>
                  </span>
                </>
              }
              title={`计划到场 ${m.plan_date ?? '待定'}`}
            >
              {/* ★ N1（2026-10-04 走查核实）：被派的调试工程师本人也能记自己的进度 ——
                  修前只有 site:edit 能点，派了活被派的人却看不到入口（后端同步放行） */}
              <div className="m-actions">
                {(canEdit || canActOnCommission(m)) && m.status === '已申请' && (
                  <Button block onClick={() => void commissionArrive(m.id).then(() => void load(projectNo))}>
                    已到现场
                  </Button>
                )}
                {(canEdit || canActOnCommission(m)) && m.status === '已到现场' && (
                  <Button block type="primary" onClick={() => void commissionStart(m.id).then(() => void load(projectNo))}>
                    开始调试
                  </Button>
                )}
                {(canEdit || canActOnCommission(m)) && m.status === '已开始调试' && (
                  <Button block type="primary" onClick={() => void finishCommission(m.id).then(() => void load(projectNo))}>
                    调试完成（可申请验收）
                  </Button>
                )}
              </div>
            </MCard>
          ))}
        </>
      )}

      {projectNo && view === 'acceptance' && (
        <>
          {canEdit && (
            <div className="m-actions" style={{ marginTop: 0, marginBottom: 12 }}>
              <Button block type="primary" onClick={() => open('acc-apply')}>
                ＋ 申请客户验收
              </Button>
            </div>
          )}
          {accs.length === 0 && <MEmpty text="还没验收单。调试完成后申请，客户签字即自动进入质保期。" />}
          {accs.map((a) => (
            <MCard
              key={a.id}
              tone={a.status === '已通过' ? 'ok' : a.status === '未通过' ? 'err' : 'warn'}
              head={
                <>
                  <MStatus tone={a.status === '已通过' ? 'ok' : a.status === '未通过' ? 'err' : 'warn'}>
                    {a.status}
                  </MStatus>
                  <span style={{ marginLeft: 'auto' }}>
                    <MChip tone={a.signed_count >= a.doc_count && a.doc_count > 0 ? 'ok' : undefined}>
                      资料 {a.signed_count}/{a.doc_count} 已签
                    </MChip>
                  </span>
                </>
              }
              title="验收资料包"
              lines={[
                ...(a.warranty_start ? [<>质保 {a.warranty_start} ~ {a.warranty_end}</>] : []),
                ...(a.signed_by ? [<>客户签字：{a.signed_by}</>] : []),
              ]}
            >
              <div className="m-actions">
                <Button block onClick={() => open('acc-confirm', undefined, undefined, a)} disabled={!canEdit}>
                  看资料包 / 标记已签
                </Button>
                {canEdit && a.status === '待验收' && (
                  <Button block type="primary" onClick={() => open('acc-confirm', undefined, undefined, a)}>
                    客户确认验收（签字）
                  </Button>
                )}
              </div>
            </MCard>
          ))}
        </>
      )}

      {projectNo && view === 'survey' && (
        <>
          {canEdit && (
            <div className="m-actions" style={{ marginTop: 0, marginBottom: 12 }}>
              <Button block type="primary" onClick={() => open('survey')}>
                ＋ 现场勘测（定入场时间）
              </Button>
            </div>
          )}
          {(wb?.surveys.length ?? 0) === 0 && <MEmpty text="还没勘测。入场前先勘测：承重 / 通道 / 电 / 气 / 网 + 约定入场时间。" />}
          {wb?.surveys.map((s) => (
            <MCard
              key={s.id}
              tone="ok"
              head={
                <>
                  <MStatus tone="ok">已勘测</MStatus>
                  <span style={{ marginLeft: 'auto' }}>
                    <MChip tone="acc">约定入场 {s.enter_date ?? '待定'}</MChip>
                  </span>
                </>
              }
              title={s.contact ? `甲方 ${s.contact}` : '现场条件'}
              lines={[
                <>
                  承重 {s.floor_load ?? '—'} · 通道 {s.passage ?? '—'}
                </>,
                <>
                  电 {s.power ?? '—'} · 气 {s.air ?? '—'} · 网 {s.network ?? '—'}
                </>,
                ...(s.remark ? [<>{s.remark}</>] : []),
              ]}
            />
          ))}
        </>
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
              <Form.Item name="drawing_no" label="哪个零件（可选）" extra={equipNo ? '选到具体零件，问题归属才清楚（也会带上零件名）' : '先填设备号，再选零件'}>
                <Select
                  allowClear
                  showSearch
                  disabled={!equipNo}
                  placeholder={equipNo ? '选这台设备的零件' : '先填设备号'}
                  optionFilterProp="label"
                  options={parts.map((p) => ({ value: p.value, label: `${p.label}（${p.kind}）` }))}
                />
              </Form.Item>
              <Form.Item name="title" label="问题标题" rules={[{ required: true }]}><Input placeholder="如 转接件尺寸不符" /></Form.Item>
              <Form.Item name="desc" label="说明"><Input.TextArea rows={2} /></Form.Item>
              <Form.Item label="照片">
                <MfgPhotoPicker projectNo={projectNo ?? ''} refNo="issue" value={photos} onChange={setPhotos} upload={uploadSitePhotos} photoUrl={sitePhotoUrl} label="拍照" />
              </Form.Item>
            </>
          )}

          {modal?.kind === 'commission' && (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--ds-ink3)', marginBottom: 8 }}>一个动作：必须派人到现场（设备太多，远程调不了）。会同时通知装配/调试组和项目团队。</div>
              <Form.Item name="dispatch_to" label="派谁去（调试工程师）" rules={[{ required: true, message: '必须写明派谁去' }]}>
                <Input placeholder="如 王工" />
              </Form.Item>
              <Form.Item name="plan_date" label="计划到场日期"><DatePicker style={{ width: '100%' }} /></Form.Item>
              <Form.Item name="remark" label="备注"><Input /></Form.Item>
            </>
          )}

          {modal?.kind === 'acc-apply' && (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--ds-ink3)', marginBottom: 8 }}>现场调试完成 → 申请客户验收。资料包在 PC「验收与质保」页上传（要传要签的东西很多）。</div>
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
              <div style={{ fontSize: 12.5, color: 'var(--ds-ink3)', marginTop: 4 }}>通过后自动进入质保期，项目阶段推进到「质保」。</div>
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
