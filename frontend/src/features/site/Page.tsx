import { useSiteBoard } from './hooks'
import {Chip, Empty as DsEmpty } from '../../components/ds'
import WorkbenchPage from '../../components/domain/WorkbenchPage'
import { SITE_BOARD } from '../../configs/boards'
import IncomingCheckFields from './components/IncomingCheckFields'
import {
  App,
  
  Form,
  Select,
  Space,
  Table,
  Tag,
} from 'antd'
import { useState, type ReactNode } from 'react'
import {
  acceptSiteIncoming,
  commissionArrive,
  commissionStart,
  finishCommission,
  errMsg,
  hasPerm,
  linkSiteIssue,
  sitePhotoUrl,
  uploadSitePhotos,
  type SiteCommissionRow,
  type SiteDailyRow,
  type SiteIncomingPending,
  type SiteIssueRow,
  type SiteSurveyRow,
} from '../../api/client'
import AuthedImage from '../../components/AuthedImage'
import MfgPhotoPicker from '../../components/MfgPhotoPicker'
import AppModal from '../../components/AppModal'
import { SITE_ISSUE_STATUS as ISSUE_COLOR } from '../../theme/status'
import { SITE_COMMISSION_STATUS as COMMISSION_COLOR } from '../../theme/status'
import { useGoFrom } from '../../hooks/useFrom'
/** 现场台（PC，S8）：给项目经理/现场负责人看整体 —— 手机端是现场的主终端。 */
export default function Site() {
  const { message } = App.useApp()
  // ★ docs/11：跳去别的域时带上 ?from= （来源台/来源页），回来还在原来那一层
  const go = useGoFrom()
  const canEdit = hasPerm('site:edit') || hasPerm('project:edit')
  const [target, setTarget] = useState<SiteIncomingPending | null>(null)
  const [targetInitial, setTargetInitial] = useState<Record<string, unknown>>({})
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  // 重构 2.1：看板数据走共享 hook（与移动端同源）
  const { projectNo, setProjectNo, projects, wb, incoming, reload: load } = useSiteBoard()
  const doIncoming = async () => {
    if (!target) return
    let v
    try { v = await form.validateFields() } catch { return }
    if (!photos.length) {
      message.warning('到货清点要拍照')
      return
    }
    setSaving(true)
    try {
      await acceptSiteIncoming(target.receipt_id, {
        result: v.result,
        shortage_detail: (v.shortage ?? []).filter((s: { item?: string }) => s.item),
        photos,
        remark: v.remark,
      })
      message.success('现场清点完成')
      setTarget(null)
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }
  const c = wb?.counts
  // 体：按页签 key 取（顺序 / 标题 / 徽标 / 可见性全来自注册表 SITE_BOARD）
  const partsOf: Record<string, ReactNode> = {
    incoming: (
          <Table<SiteIncomingPending>
            rowKey="receipt_id"
            size="small"
            dataSource={incoming.pending}
            pagination={false}
            locale={{ emptyText: <DsEmpty text="没有待清点的直发件" /> }}
            columns={[
              { title: '到货单', dataIndex: 'receipt_no', width: 130 },
              { title: '物料', dataIndex: 'item_no', width: 160 },
              { title: '数量', key: 'q', width: 100, render: (_: unknown, r) => `${r.qty} ${r.unit ?? ''}` },
              { title: '到货日', dataIndex: 'receipt_date', width: 120 },
              { title: '收货地点', dataIndex: 'deliver_to', width: 130 },
              {
                title: '操作',
                key: 'a',
                width: 100,
                render: (_: unknown, r) =>
                  canEdit ? <a onClick={() => {
                    setPhotos([])
                    // 预填交给 AppModal initialValues：弹窗 destroyOnHidden，先 setFieldsValue 会丢（实测「齐」预选不上）
                    setTargetInitial({ result: '齐', shortage: [] })
                    setTarget(r)
                  }}>清点验收</a> : '—',
              },
            ]}
          />
        
    ),
    daily: (
          <Table<SiteDailyRow>
            rowKey="id"
            size="small"
            dataSource={wb?.dailies ?? []}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            locale={{ emptyText: <DsEmpty text="还没有汇报" /> }}
            columns={[
              { title: '日期', dataIndex: 'report_date', width: 110 },
              { title: '阶段', dataIndex: 'stage', width: 100, render: (v: string) => <Tag color="processing">{v}</Tag> },
              { title: '设备', dataIndex: 'equip_no', width: 80, render: (v: string | null) => v ?? '—' },
              { title: '人数', dataIndex: 'people', width: 70, render: (v: number | null) => v ?? '—' },
              { title: '完成了', dataIndex: 'done_items', render: (v: string[]) => v.join('；') },
              { title: '问题', dataIndex: 'problem', render: (v: string | null) => v ?? '—' },
              {
                title: '照片 / 视频',
                key: 'p',
                width: 140,
                render: (_: unknown, r: SiteDailyRow) => (
                  <Space wrap>
                    {r.photos.slice(0, 2).map((p) => <AuthedImage key={p} path={sitePhotoUrl(p)} size={32} />)}
                    <span style={{ fontSize: 12 }}>{r.photos.length} 图 · {r.videos.length} 视频</span>
                  </Space>
                ),
              },
            ]}
          />
        
    ),
    issues: (
          <Table<SiteIssueRow>
            rowKey="id"
            size="small"
            dataSource={wb?.issues ?? []}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            locale={{ emptyText: <DsEmpty text="没有问题" /> }}
            columns={[
              { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag color={ISSUE_COLOR[v] ?? 'default'}>{v}</Tag> },
              { title: '设备', dataIndex: 'equip_no', width: 80, render: (v: string | null) => v ?? '—' },
              { title: '问题', dataIndex: 'title' },
              { title: '说明', dataIndex: 'desc', render: (v: string | null) => v ?? '—' },
              {
                title: '操作',
                key: 'a',
                width: 160,
                render: (_: unknown, r: SiteIssueRow) => (
                  <Space size={4}>
                    {canEdit && r.status === '待处理' && (
                      <>
                        <a onClick={() => void linkSiteIssue(r.id, { change_id: undefined }).then(() => void load(projectNo))}>转变更</a>
                        <a onClick={() => void linkSiteIssue(r.id, { close: true }).then(() => void load(projectNo))}>闭环</a>
                      </>
                    )}
                    {r.related_change_id && <a onClick={() => go('/workbench/changes')}>看变更</a>}
                  </Space>
                ),
              },
            ]}
          />
        
    ),
    commission: (
          <Table<SiteCommissionRow>
            rowKey="id"
            size="small"
            dataSource={wb?.commissions ?? []}
            pagination={false}
            locale={{ emptyText: <DsEmpty text="还没申请调试" /> }}
            columns={[
              { title: '状态', dataIndex: 'status', width: 110, render: (v: string) => <Tag color={COMMISSION_COLOR[v] ?? 'default'}>{v}</Tag> },
              { title: '申请时间', dataIndex: 'request_at', width: 150, render: (v: string | null) => v?.slice(0, 16).replace('T', ' ') ?? '—' },
              { title: '派谁去', dataIndex: 'dispatch_to', width: 140, render: (v: string | null) => v ?? '—' },
              { title: '计划到场', dataIndex: 'plan_date', width: 110, render: (v: string | null) => v ?? '—' },
              { title: '实际到场', dataIndex: 'arrived_at', width: 150, render: (v: string | null) => v?.slice(0, 16).replace('T', ' ') ?? '—' },
              {
                title: '操作',
                key: 'a',
                width: 140,
                render: (_: unknown, r: SiteCommissionRow) => (
                  <Space size={4}>
                    {canEdit && r.status === '已申请' && <a onClick={() => void commissionArrive(r.id).then(() => void load(projectNo))}>已到现场</a>}
                    {canEdit && r.status === '已到现场' && <a onClick={() => void commissionStart(r.id).then(() => void load(projectNo))}>开始调试</a>}
                    {canEdit && r.status === '已开始调试' && <a onClick={() => void finishCommission(r.id).then(() => void load(projectNo))}>调试完成</a>}
                  </Space>
                ),
              },
            ]}
          />
        
    ),
    survey: (
          <Table<SiteSurveyRow>
            rowKey="id"
            size="small"
            dataSource={wb?.surveys ?? []}
            pagination={false}
            locale={{ emptyText: <DsEmpty text="还没勘测" /> }}
            columns={[
              { title: '约定入场', dataIndex: 'enter_date', width: 120, render: (v: string | null) => v ?? '待定' },
              { title: '甲方现场', dataIndex: 'contact', width: 160, render: (v: string | null) => v ?? '—' },
              { title: '承重', dataIndex: 'floor_load', width: 100, render: (v: string | null) => v ?? '—' },
              { title: '通道', dataIndex: 'passage', width: 120, render: (v: string | null) => v ?? '—' },
              { title: '电/气/网', key: 'e', render: (_: unknown, r: SiteSurveyRow) => `${r.power ?? '—'} / ${r.air ?? '—'} / ${r.network ?? '—'}` },
              { title: '备注', dataIndex: 'remark', render: (v: string | null) => v ?? '—' },
            ]}
          />
        
    ),
  }

  // ★ docs/15 台骨架四件套：台头 → 结论条 → 流程条（注册表驱动）→ 体（弹窗与台并列，故包一层 fragment）
  return (
    <>
      <WorkbenchPage
        board={SITE_BOARD}
        toolbar={
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: 300 }}
            placeholder="选项目"
            value={projectNo}
            onChange={(v: string | undefined) => {
              setProjectNo(v)
              void load(v)
            }}
            options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
          />
        }
        sub={projectNo ? `当前项目 ${projectNo}` : '现场日常用手机端（/m/site）'}
        help="勘测 → 来货清点（含直发）→ 每日汇报（拍照/录视频）→ 申请调试；现场问题一律走变更。客户验收签认在手机端完成。"
        actions={
          <>
            {!canEdit && <Chip>只读</Chip>}
            {c?.debugging ? <Chip tone="run">调试中 {c.debugging}</Chip> : null}
            {c?.daily_today ? <Chip tone="ok">今日汇报 {c.daily_today}</Chip> : null}
          </>
        }
        counts={{
          incoming: incoming.pending.length,
          survey: wb?.surveys.length ?? 0,
          daily: wb?.dailies.length ?? 0,
          commission: wb?.commissions.length ?? 0,
          issues: wb?.issues.length ?? 0,
        }}
        metrics={[
          { key: 'incoming', label: '待清点来货', value: incoming.pending.length, unit: '单', tone: incoming.pending.length ? 'warn' : undefined, dimZero: true, to: '?tab=incoming' },
          { key: 'issues', label: '现场问题待处理', value: wb?.issues.filter((x) => x.status === '待处理').length ?? 0, unit: '个', tone: (wb?.issues.filter((x) => x.status === '待处理').length ?? 0) > 0 ? 'err' : undefined, dimZero: true, to: '?tab=issues' },
          { key: 'commission', label: '申请调试', value: wb?.commissions.length ?? 0, unit: '单', dimZero: true, to: '?tab=commission' },
          { key: 'daily', label: '今日汇报', value: c?.daily_today ?? 0, unit: '条', tone: c?.daily_today ? 'ok' : undefined, dimZero: true, to: '?tab=daily' },
          { key: 'survey', label: '勘测记录', value: wb?.surveys.length ?? 0, unit: '条', dimZero: true, to: '?tab=survey' },
        ]}
      >
        {(t) => partsOf[t]}
      </WorkbenchPage>
      <AppModal
        open={!!target}
        title={`现场清点 · ${target?.item_no ?? ''}`}
        onClose={() => setTarget(null)}
        onOk={() => void doIncoming()}
        loading={saving}
        okText="提交"
        form={form}
        initialValues={targetInitial}
      >
                    <IncomingCheckFields />
          <Form.Item label="照片（必须）" required>
            <MfgPhotoPicker projectNo={projectNo ?? ''} refNo="incoming" value={photos} onChange={setPhotos} upload={uploadSitePhotos} photoUrl={sitePhotoUrl} label="拍照" />
          </Form.Item>
      </AppModal>
    </>
  )
}
