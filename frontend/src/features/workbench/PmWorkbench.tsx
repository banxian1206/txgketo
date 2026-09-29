import { App, Button, Card, Col, Progress, Row, Space, Spin, Table, Tabs, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { errMsg, pmBoard, workbenchMe, type PmBoard, type PmProjectRow, type WorkbenchMe } from '../../api/client'
import { PM_TABS, filterTabs } from '../../configs/tabs'
import { useTab } from '../../hooks/useTab'
import AcceptancePage from '../acceptance/Page'
import { PROJECT_STAGE as STAGE_COLOR } from '../../theme/status'
import { T } from '../../theme/tokens'

/** 项目经理台（06 卷 §3）：我项目的全链进度（设计 → 采购 → 到货/入库）+ 风险/待办 */
function PmBoardPage() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const [me, setMe] = useState<WorkbenchMe | null>(null)
  const [data, setData] = useState<PmBoard | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [who, board] = await Promise.all([workbenchMe(), pmBoard()])
      setMe(who)
      setData(board)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const s = data?.summary

  const columns: ColumnsType<PmProjectRow> = [
    {
      title: '项目',
      key: 'project',
      width: 220,
      render: (_: unknown, r: PmProjectRow) => (
        <a onClick={() => nav(`/projects/${r.project_no}`)}>
          {r.project_no} {r.project_name}
        </a>
      ),
    },
    {
      title: '阶段',
      dataIndex: 'stage',
      width: 100,
      render: (v: string) => <Tag color={STAGE_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: '设计进度',
      key: 'design',
      width: 160,
      render: (_: unknown, r: PmProjectRow) => (
        <Space direction="vertical" size={0} style={{ width: 130 }}>
          <Progress
            percent={r.design_total ? Math.round((r.design_done / r.design_total) * 100) : 0}
            size="small"
            status={r.design_total && r.design_done === r.design_total ? 'success' : 'active'}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已发布 {r.design_done}/{r.design_total}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '采购 / 到货',
      key: 'purchase',
      width: 190,
      render: (_: unknown, r: PmProjectRow) => (
        <Space size={4} wrap>
          <Tag color={r.purchase.to_purchase ? 'gold' : 'default'}>待采购 {r.purchase.to_purchase}</Tag>
          <Tag color={r.purchase.in_transit ? 'processing' : 'default'}>在途 {r.purchase.in_transit}</Tag>
          <Tag color={r.purchase.stored ? 'success' : 'default'}>已入库 {r.purchase.stored}</Tag>
        </Space>
      ),
    },
    {
      title: '风险',
      key: 'risks',
      render: (_: unknown, r: PmProjectRow) =>
        r.risks.length ? (
          <Space size={4} wrap>
            {r.risks.map((x) => (
              <Tag key={x} color="red">
                {x}
              </Tag>
            ))}
          </Space>
        ) : (
          <Tag color="success">正常</Tag>
        ),
    },
  ]

  return (
    <Spin spinning={loading}>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Typography.Title level={5} style={{ margin: 0 }}>
            项目经理台
          </Typography.Title>
          <Tag color="blue">{me?.user.position || '—'}</Tag>
          <Button size="small" onClick={() => void load()}>
            刷新
          </Button>
          <Button size="small" onClick={() => nav('/projects')}>
            商机 / 项目
          </Button>
        </Space>
      </Card>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        {[
          { label: '我负责的项目', value: s?.projects ?? 0, color: T.brand },
          { label: '有风险项目', value: s?.at_risk ?? 0, color: T.error },
          { label: '缺料（待采购）', value: s?.shortage ?? 0, color: T.orange },
          { label: '在途采购', value: s?.in_transit ?? 0, color: T.cyan },
          { label: '超期任务', value: s?.overdue_tasks ?? 0, color: T.error },
        ].map((x) => (
          <Col xs={12} sm={8} md={4} key={x.label}>
            <Card size="small" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: T.textSecondary }}>{x.label}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: x.value ? x.color : T.textDisabled }}>{x.value}</div>
            </Card>
          </Col>
        ))}
      </Row>

      <Card size="small" title="我负责的项目（全链进度）">
        <Table
          rowKey="project_no"
          size="small"
          dataSource={data?.projects ?? []}
          columns={columns}
          pagination={{ pageSize: 15, showSizeChanger: false }}
        />
      </Card>
    </Spin>
  )
}

/**
 * 项目经理台 = 台内页签（docs/10 §8.5 拍板 A 的默认归属）：
 *   看板 · 验收与质保（PM 有 acceptance:edit；质保到期/质保金本就是 PM 与商务关心的）
 * 只剩一个可见页签时不画条（避免多一层噪音）。
 */
export default function PmWorkbench() {
  const vis = filterTabs(PM_TABS)
  const [tab, setTab] = useTab(vis.map((x) => x.key), 'board')
  if (vis.length <= 1) return <PmBoardPage />
  return (
    <Tabs
      activeKey={tab}
      onChange={setTab}
      items={vis.map((x) => ({
        key: x.key,
        label: x.label,
        children: x.key === 'acceptance' ? <AcceptancePage /> : <PmBoardPage />,
      }))}
    />
  )
}
