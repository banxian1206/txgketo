import { App, Button, Card, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import AttachmentPreviewModal, { type PreviewState } from '../components/AttachmentPreviewModal'
import { errMsg, listProjects, previewAttachment, type Project } from '../api/client'
import { PROJECT_STAGE as STAGE_COLOR } from '../theme/status'

function isImage(name: string) {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(
    name.split('.').pop()?.toLowerCase() ?? '',
  )
}

export default function Projects() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const [rows, setRows] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [hoverNo, setHoverNo] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listProjects())
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  /** 打开项目详情页（独立页面，有 URL，可刷新/收藏/后退） */
  const openDetail = (projectNo: string) => nav(`/projects/${projectNo}`)

  /** 点资料标签 → 就地预览，不跳转 */
  const previewFile = async (projectNo: string, id: number, filename: string) => {
    try {
      const r = await previewAttachment(projectNo, {
        id,
        filename,
        category: '',
        is_frozen: false,
        uploaded_at: '',
      })
      setPreview({ name: filename, kind: r.kind, url: r.url, text: r.text })
    } catch (e) {
      message.error(errMsg(e))
    }
  }

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
    { title: '线索来源', dataIndex: 'source', width: 110 },
    {
      title: '销售负责人',
      dataIndex: 'sales_name',
      width: 110,
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
      width: 330,
      render: (_: unknown, r: Project) => {
        const list = r.attachments_brief ?? []
        if (!list.length) return <Typography.Text type="secondary">—</Typography.Text>
        return (
          <Space size={4} wrap onClick={(e) => e.stopPropagation()}>
            <Tooltip title={`共 ${r.attachment_count} 份资料`}>
              <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                {r.attachment_count} 份
              </Tag>
            </Tooltip>
            {list.map((a) => (
              <Tag
                key={a.id}
                style={{ cursor: 'pointer', marginInlineEnd: 0 }}
                onClick={() => void previewFile(r.project_no, a.id, a.filename)}
                title={`${a.category} · 点击预览`}
              >
                {isImage(a.filename) ? '🖼' : '📄'} {a.filename}
              </Tag>
            ))}
            {(r.attachment_count ?? 0) > list.length && (
              <Tag
                style={{ cursor: 'pointer', marginInlineEnd: 0 }}
                color="blue"
                onClick={() => openDetail(r.project_no)}
              >
                +{(r.attachment_count ?? 0) - list.length}
              </Tag>
            )}
          </Space>
        )
      },
    },
    {
      title: '',
      key: 'hint',
      width: 92,
      align: 'right',
      render: (_: unknown, r: Project) =>
        hoverNo === r.project_no ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            查看详情 →
          </Typography.Text>
        ) : null,
    },
  ]

  return (
    <Card
      title="商机 / 项目"
      extra={
        <Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            点任意一行看详情 · 点资料标签就地预览
          </Typography.Text>
          <Button onClick={() => void load()}>刷新</Button>
          <Button type="primary" onClick={() => nav('/projects/new')}>
            新建商机
          </Button>
        </Space>
      }
    >
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

      <AttachmentPreviewModal state={preview} onClose={() => setPreview(null)} />

    </Card>
  )
}
