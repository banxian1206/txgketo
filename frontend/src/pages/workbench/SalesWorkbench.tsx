import { App, Button, Card, Col, Row, Space, Spin, Table, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { errMsg, salesBoard, workbenchMe, type SalesBoard, type WorkbenchMe } from '../../api/client'

const STAGE_COLOR: Record<string, string> = {
  线索: 'default',
  成交待立项: 'gold',
  执行中: 'processing',
  交付中: 'cyan',
  质保: 'purple',
  已关闭: 'default',
}

/** 商务部工作台（06 卷 §3）：我的商机 → 成交待立项 → 执行中 + 回款 */
export default function SalesWorkbench() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const [me, setMe] = useState<WorkbenchMe | null>(null)
  const [data, setData] = useState<SalesBoard | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [who, board] = await Promise.all([workbenchMe(), salesBoard()])
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

  return (
    <Spin spinning={loading}>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Typography.Title level={5} style={{ margin: 0 }}>
            商务部工作台
          </Typography.Title>
          <Tag color="blue">{me?.user.position || '—'}</Tag>
          <Button size="small" onClick={() => void load()}>
            刷新
          </Button>
          <Button size="small" type="primary" onClick={() => nav('/projects/new')}>
            新建商机
          </Button>
        </Space>
      </Card>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        {[
          { label: '商机（线索）', value: s?.my_leads ?? 0, color: '#1f6feb' },
          { label: '待立项', value: s?.to_initiate ?? 0, color: '#fa8c16' },
          { label: '执行中 / 交付中', value: s?.executing ?? 0, color: '#13c2c2' },
          { label: '跟进超期', value: s?.overdue_followup ?? 0, color: '#f5222d' },
          { label: '待回款节点', value: s?.payments_due ?? 0, color: '#722ed1' },
          { label: '回款逾期', value: s?.payments_overdue ?? 0, color: '#f5222d' },
        ].map((x) => (
          <Col xs={12} sm={8} md={4} key={x.label}>
            <Card size="small" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#888' }}>{x.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: x.value ? x.color : '#bbb' }}>{x.value}</div>
            </Card>
          </Col>
        ))}
      </Row>

      <Card size="small" title="我的商机 / 项目" style={{ marginBottom: 12 }}>
        <Table
          rowKey="project_no"
          size="small"
          dataSource={data?.projects ?? []}
          pagination={{ pageSize: 15, showSizeChanger: false }}
          onRow={(r) => ({ onClick: () => nav(`/projects/${r.project_no}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: '项目号', dataIndex: 'project_no', width: 110 },
            { title: '项目名称', dataIndex: 'project_name' },
            { title: '阶段', dataIndex: 'stage', width: 110, render: (v: string) => <Tag color={STAGE_COLOR[v] ?? 'default'}>{v}</Tag> },
            {
              title: '商机截止',
              dataIndex: 'deadline',
              width: 120,
              render: (v: string | null, r) =>
                v ? (
                  <Space size={4}>
                    <span>{v}</span>
                    {r.overdue_follow && <Tag color="red">已过期</Tag>}
                  </Space>
                ) : (
                  '—'
                ),
            },
            { title: '合同金额', dataIndex: 'amount', width: 120, render: (v: number) => (v ? v.toLocaleString() : '—') },
            { title: '未回款', dataIndex: 'unpaid', width: 120, render: (v: number) => (v ? v.toLocaleString() : '—') },
          ]}
        />
      </Card>

      <Card size="small" title="待回款节点">
        <Table
          rowKey={(r) => `${r.project_no}-${r.node_name}`}
          size="small"
          dataSource={data?.payments ?? []}
          pagination={false}
          columns={[
            { title: '项目号', dataIndex: 'project_no', width: 110 },
            { title: '节点', dataIndex: 'node_name' },
            { title: '应回款', dataIndex: 'amount', width: 120, render: (v: number) => v.toLocaleString() },
            { title: '未回', dataIndex: 'unpaid', width: 120, render: (v: number) => v.toLocaleString() },
            {
              title: '预计日期',
              dataIndex: 'expect_date',
              width: 140,
              render: (v: string | null, r) =>
                v ? (
                  <Space size={4}>
                    <span>{v}</span>
                    {r.overdue && <Tag color="red">逾期</Tag>}
                  </Space>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      </Card>
    </Spin>
  )
}
