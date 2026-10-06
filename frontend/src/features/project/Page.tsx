import { App, Button, Input, Select, Table, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import { errMsg, listProjects, type Project } from '../../api/client'
import { Chip, Code, Empty, NA, PageHead, Panel, Status } from '../../components/ds'
import { PROJECT_STAGE as STAGE_COLOR, toneOf } from '../../theme/status'
import { useGoFrom } from '../../hooks/useFrom'
import { useUrlState } from '../../hooks/useUrlState'

const STAGES = ['线索', '成交待立项', '执行中', '交付中', '质保', '已归档', '已关闭']

/** 商机 / 项目列表（A 型台账页 · 方案 A「纸面」2026-10-04 重做）
 *
 * 改版要点：
 *   ① 卡片标题 + 页内说明句 → `PageHead`（一句现状 + 主操作），说明进 `help`
 *   ② 项目号 → `Code`（等宽），阶段 → `Status`（圆点+文字，不再彩色 Tag）
 *   ③ 行列数**保持 7**（docs/12 §2-A 的 A 型页上限，护栏 `LIST-筛选进URL且列数受控` 盯着）
 *   ④ 筛选继续走 URL（可分享 / 刷新不丢）
 */
export default function Projects() {
  const { message } = App.useApp()
  // ★ docs/11：跳去别的域时带上 ?from= （来源台/来源页），回来还在原来那一层
  const go = useGoFrom()
  const [rows, setRows] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
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
      width: 118,
      render: (v: string) => <Code>{v}</Code>,
    },
    {
      title: '项目名称',
      dataIndex: 'project_name',
      render: (v: string, r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="row-title">{v}</span>
          {r.is_retrofit && <Chip tone="warn">旧线改造</Chip>}
        </span>
      ),
    },
    { title: '客户', dataIndex: 'customer_name', width: 140, render: (v: string) => v || NA },
    {
      title: '阶段',
      dataIndex: 'stage',
      width: 118,
      render: (v: string) => <Status tone={toneOf(STAGE_COLOR[v])}>{v}</Status>,
    },
    {
      // ★ 列治理（docs/12 §2-A：A 型页列 ≤7）：销售为主、来源为辅合成一列，省掉一整列
      title: '销售 / 来源',
      dataIndex: 'sales_name',
      width: 132,
      render: (v: string) => v || NA,
    },
    {
      title: '商机剩余',
      dataIndex: 'opportunity_days_left',
      width: 118,
      defaultSortOrder: 'ascend',
      sorter: (a: Project, b: Project) =>
        (a.opportunity_days_left ?? Number.MAX_SAFE_INTEGER) -
        (b.opportunity_days_left ?? Number.MAX_SAFE_INTEGER),
      render: (v: number | null, r: Project) => {
        if (r.stage !== '线索') return NA
        if (v === null || v === undefined) return NA
        const label = v < 0 ? `已过期 ${-v} 天` : v === 0 ? '今天到期' : `还剩 ${v} 天`
        const tone = v <= 0 ? 'err' : v <= 7 ? 'warn' : undefined
        // 已过期/今天到期上用色，其余走中性文字（A：颜色只给异常）
        return (
          <Tooltip title={`客户要求 ${r.deadline} 前把这件事定下来（商机截止）`}>
            {tone ? <Status tone={tone}>{label}</Status> : <span>{label}</span>}
          </Tooltip>
        )
      },
    },
    {
      title: '资料',
      key: 'attachments',
      width: 84,
      render: (_: unknown, r: Project) =>
        (r.attachment_count ?? 0) > 0 ? (
          <a
            onClick={(e) => {
              e.stopPropagation()
              openDetail(r.project_no)
            }}
            title="到项目详情「范围与资料」里查看/预览"
          >
            {r.attachment_count} 份
          </a>
        ) : (
          NA
        ),
    },
  ]

  const filtered = Boolean(filters.stage || filters.q)

  return (
    <div className="ds-page">
      <PageHead
        title="项目"
        sub={`共 ${rows.length} 条${filtered ? '（已筛选）' : ''} · 一条 = 一个项目全生命周期`}
        actions={
          <>
            <Button size="small" onClick={() => void load()}>
              刷新
            </Button>
            <Button size="small" type="primary" onClick={() => go('/projects/new')}>
              新建商机
            </Button>
          </>
        }
      />

      <Panel>
        <div className="ds-toolbar">
          <span className="ds-sub">点任意一行看详情 · 筛选条件在 URL 里（可分享、刷新不丢）</span>
          <div className="sp">
            <Select
              allowClear
              size="small"
              aria-label="按阶段筛选"
              placeholder="阶段：全部"
              style={{ width: 132 }}
              value={filters.stage}
              onChange={(v: string | undefined) => setFilters({ stage: v })}
              options={STAGES.map((s) => ({ value: s, label: s }))}
            />
            <Input.Search
              allowClear
              size="small"
              placeholder="项目号 / 名称 / 客户"
              style={{ width: 220 }}
              defaultValue={filters.q}
              onSearch={(v: string) => setFilters({ q: v || undefined })}
            />
            {filtered && (
              <Button size="small" type="text" onClick={() => setFilters({ stage: undefined, q: undefined })}>
                清空筛选
              </Button>
            )}
          </div>
        </div>
        <Table<Project>
          rowKey="project_no"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          scroll={{ x: 1100 }}
          locale={{ emptyText: <Empty text={filtered ? '没有符合筛选条件的项目。' : '还没有项目。'} action={<Button size="small" onClick={() => setFilters({ stage: undefined, q: undefined })}>清空筛选</Button>} /> }}
          onRow={(r) => ({ onClick: () => openDetail(r.project_no), style: { cursor: 'pointer' } })}
        />
      </Panel>
    </div>
  )
}
