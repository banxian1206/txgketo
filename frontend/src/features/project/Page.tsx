import { App, Button, Card, Input, Select, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import { errMsg, listProjects, type Project } from '../../api/client'
import { PROJECT_STAGE as STAGE_COLOR } from '../../theme/status'
import { useGoFrom } from '../../hooks/useFrom'
import { useUrlState } from '../../hooks/useUrlState'
const STAGES = ['线索', '成交待立项', '执行中', '交付中', '质保', '已归档', '已关闭']

export default function Projects() {
  const { message } = App.useApp()
  // ★ docs/11：跳去别的域时带上 ?from= （来源台/来源页），回来还在原来那一层
  const go = useGoFrom()
  const [rows, setRows] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [hoverNo, setHoverNo] = useState<string | null>(null)
  // ★ P3：筛选条件进 URL（docs/12 §2-A）——「筛好一轮回头还要用」不该被刷新抹掉
  const [filters, setFilters] = useUrlState({ stage: undefined, q: undefined })
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const all = await listProjects()
      const q = (filters.q ?? '').trim().toLowerCase()
      setRows(
        all.filter(
          (r: Project) =>
            (!filters.stage || r.stage === filters.stage) &&
            (!q ||
              r.project_no.toLowerCase().includes(q) ||
              (r.project_name ?? '').toLowerCase().includes(q) ||
              (r.customer_name ?? '').toLowerCase().includes(q)),
        ),
      )
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message, filters.stage, filters.q])
  useEffect(() => {
    void load()
  }, [load])
  /** 打开项目详情页（独立页面，有 URL，可刷新/收藏/后退） */
  const openDetail = (projectNo: string) => go(`/projects/${projectNo}`)
  const columns: ColumnsType<Project> = [
    {
      title: '项目编号',
      dataIndex: 'project_no',
      width: 112,
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    {
      title: '项目名称',
      dataIndex: 'project_name',
      render: (v: string, r) => (
        <Space size={4}>
          <span className="row-title">{v}</span>
          {r.is_retrofit && <Tag color="orange">旧改</Tag>}
        </Space>
      ),
    },
    { title: '客户', dataIndex: 'customer_name', width: 130 },
    {
      title: '阶段',
      dataIndex: 'stage',
      width: 110,
      render: (v: string) => <Tag color={STAGE_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      // ★ 列治理（docs/12 §2-A：A 型页列 ≤7）：销售为主、来源为辅合成一列，省掉一整列
      title: '销售 / 来源',
      dataIndex: 'sales_name',
      width: 130,
      render: (v: string) => v || '—',
    },
    {
      title: '商机剩余',
      dataIndex: 'opportunity_days_left',
      width: 122,
      defaultSortOrder: 'ascend',
      sorter: (a: Project, b: Project) =>
        (a.opportunity_days_left ?? Number.MAX_SAFE_INTEGER) -
        (b.opportunity_days_left ?? Number.MAX_SAFE_INTEGER),
      render: (v: number | null, r: Project) => {
        if (r.stage !== '线索') return <Typography.Text type="secondary">—</Typography.Text>
        if (v === null || v === undefined) return '—'
        const label = v < 0 ? `已过期 ${-v} 天` : v === 0 ? '今天到期' : `还剩 ${v} 天`
        const color =
          v < 0 || v === 0 || v <= 3
            ? 'red'
            : v <= 7
              ? 'orange'
              : v <= 30
                ? 'gold'
                : undefined
        return (
          <Tooltip title={`客户要求 ${r.deadline} 前把这件事定下来（商机截止）`}>
            {color ? <Tag color={color}>{label}</Tag> : <span>{label}</span>}
          </Tooltip>
        )
      },
    },
    {
      title: '资料',
      key: 'attachments',
      width: 92,
      render: (_: unknown, r: Project) =>
        (r.attachment_count ?? 0) > 0 ? (
          <a onClick={(e) => { e.stopPropagation(); openDetail(r.project_no) }} title="到项目详情「范围与资料」里查看/预览">
            {r.attachment_count} 份
          </a>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
  ]
  return (
    <Card
      title="商机 / 项目"
      extra={
        <Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            点任意一行看详情 · 可按阶段/关键字筛选（筛选条件在 URL 里，可分享）
          </Typography.Text>
          <Button onClick={() => void load()}>刷新</Button>
          <Button type="primary" onClick={() => go('/projects/new')}>
            新建商机
          </Button>
        </Space>
      }
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          allowClear
          placeholder="阶段"
          style={{ width: 150 }}
          value={filters.stage}
          onChange={(v: string | undefined) => setFilters({ stage: v })}
          options={STAGES.map((s) => ({ value: s, label: s }))}
        />
        <Input.Search
          allowClear
          placeholder="项目号 / 名称 / 客户"
          style={{ width: 260 }}
          defaultValue={filters.q}
          onSearch={(v: string) => setFilters({ q: v || undefined })}
        />
        {(filters.stage || filters.q) && (
          <Button type="link" size="small" onClick={() => setFilters({ stage: undefined, q: undefined })}>
            清空筛选
          </Button>
        )}
      </Space>
      <Table<Project>
        rowKey="project_no"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ x: 1440 }}
        rowClassName={(r) => (hoverNo === r.project_no ? 'project-row-hover' : 'project-row')}
        onRow={(r) => ({
          onClick: () => openDetail(r.project_no),
          onMouseEnter: () => setHoverNo(r.project_no),
          onMouseLeave: () => setHoverNo(null),
          style: { cursor: 'pointer' },
        })}
      />
    </Card>
  )
}
