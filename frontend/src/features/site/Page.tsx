import { useSiteBoard } from './hooks'
import IncomingCheckFields from './components/IncomingCheckFields'
import {
  App,
  Alert,
  Card,
  Col,
  Empty,
  Form,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import {useState} from 'react'
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
import { T } from '../../theme/tokens'
import { SITE_TABS, filterTabs } from '../../configs/tabs'
import { useTab } from '../../hooks/useTab'
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
  // ★ 重整 P0（docs/10 §3.2/§3.3）：页签条按**真实权限码**过滤，状态写进 URL（?tab=）
  const visKeys = filterTabs(SITE_TABS).map((x) => x.key)
  const [tab, setTab] = useTab(visKeys, 'incoming')
  return (
    <Card
      title="现场安装（S8）"
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          勘测 → 来货清点（含直发）→ 每日汇报（拍照/录视频）→ 申请调试；现场问题一律走变更
        </Typography.Text>
      }
    >
      <Space style={{ marginBottom: 12 }}>
        <Select
          showSearch
          optionFilterProp="label"
          style={{ width: 300 }}
          placeholder="选项目"
          value={projectNo}
          onChange={(v: string | undefined) => { setProjectNo(v); void load(v) }}
          options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
        />
        {!canEdit && <Tag>只读</Tag>}
      </Space>
      {!projectNo && <Empty description="先选一个项目（现场日常用手机端 /m/site）" />}
      {projectNo && (
        <>
          <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="现场录入请用手机端"
          description="勘测 / 每日汇报 / 现场问题 / 申请调试 都在手机端「现场」页录入（打开 /m/site，或手机浏览器加主屏）；本页用于查看进度与推进状态。"
        />
        <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={4}><Statistic title="已勘测" value={c?.surveyed ?? 0} /></Col>
            <Col span={4}><Statistic title="今日汇报" value={c?.daily_today ?? 0} /></Col>
            <Col span={4}><Statistic title="待处理问题" value={c?.open_issues ?? 0} valueStyle={{ color: c?.open_issues ? T.error : undefined }} /></Col>
            <Col span={4}><Statistic title="待派调试" value={c?.to_dispatch ?? 0} /></Col>
            <Col span={4}><Statistic title="调试中" value={c?.debugging ?? 0} /></Col>
          </Row>
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: 'incoming',
                label: `来货清点 (${incoming.pending.length})`,
                children: (
                  <Table<SiteIncomingPending>
                    rowKey="receipt_id"
                    size="small"
                    dataSource={incoming.pending}
                    pagination={false}
                    locale={{ emptyText: <Empty description="没有待清点的直发件" /> }}
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
              },
              {
                key: 'daily',
                label: `每日汇报 (${wb?.dailies.length ?? 0})`,
                children: (
                  <Table<SiteDailyRow>
                    rowKey="id"
                    size="small"
                    dataSource={wb?.dailies ?? []}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    locale={{ emptyText: <Empty description="还没有汇报" /> }}
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
              },
              {
                key: 'issues',
                label: `现场问题 (${wb?.issues.length ?? 0})`,
                children: (
                  <Table<SiteIssueRow>
                    rowKey="id"
                    size="small"
                    dataSource={wb?.issues ?? []}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    locale={{ emptyText: <Empty description="没有问题" /> }}
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
              },
              {
                key: 'commission',
                label: `申请调试 (${wb?.commissions.length ?? 0})`,
                children: (
                  <Table<SiteCommissionRow>
                    rowKey="id"
                    size="small"
                    dataSource={wb?.commissions ?? []}
                    pagination={false}
                    locale={{ emptyText: <Empty description="还没申请调试" /> }}
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
              },
              {
                key: 'survey',
                label: `勘测 (${wb?.surveys.length ?? 0})`,
                children: (
                  <Table<SiteSurveyRow>
                    rowKey="id"
                    size="small"
                    dataSource={wb?.surveys ?? []}
                    pagination={false}
                    locale={{ emptyText: <Empty description="还没勘测" /> }}
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
              },
            ].filter((x) => visKeys.includes(x.key))}
          />
        </>
      )}
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
    </Card>
  )
}
