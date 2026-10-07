import { useState } from 'react'
import { Button, Descriptions, Empty, Input, Popconfirm, Space, Table } from 'antd'
import type { OrgRow } from '../../api/client'
import { Chip } from '../ds'

export default function OrganizationManager({ rows, selectedId, onSelect, canCreateDepartment, onCreateDepartment, onCreateGroup, onEdit, onToggle, onMembers }: {
  rows: OrgRow[]; selectedId?: number; onSelect: (id: number) => void;
  canCreateDepartment: boolean; onCreateDepartment: () => void; onCreateGroup: () => void;
  onEdit: () => void; onToggle: (org: OrgRow) => void; onMembers: (id: number) => void;
}) {
  const [query, setQuery] = useState('')
  const selected = rows.find((org) => org.id === selectedId) ?? rows[0]
  const children = rows.filter((org) => org.parent_id === selected?.id)
  const parent = rows.find((org) => org.id === selected?.parent_id)
  const depth = (org: OrgRow) => {
    let count = 0, id = org.parent_id
    const seen = new Set<number>([org.id])
    while (id && !seen.has(id)) { seen.add(id); count++; id = rows.find((r) => r.id === id)?.parent_id }
    return count
  }
  const memberCount = (org: OrgRow) => {
    const ids = new Set<number>([org.id])
    for (let changed = true; changed;) {
      changed = false
      for (const row of rows) if (row.parent_id && ids.has(row.parent_id) && !ids.has(row.id)) { ids.add(row.id); changed = true }
    }
    return rows.filter((row) => ids.has(row.id)).reduce((sum, row) => sum + (row.user_count ?? 0), 0)
  }
  return <>
    <div className="org-toolbar"><p>左侧选择部门或小组，右侧查看成员与下属组织。人数为含下属组织的启用账号数。</p>
      {canCreateDepartment && <Button type="primary" onClick={onCreateDepartment}>新增公司部门</Button>}
    </div>
    <div className="org-manager">
      <aside className="org-directory" aria-label="部门与小组列表">
        <Input.Search aria-label="搜索部门或小组" placeholder="搜索部门或小组" allowClear value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="org-directory-list">
          {rows.filter((org) => org.name.includes(query.trim())).map((org) => <button type="button" key={org.id}
            aria-current={selected?.id === org.id ? 'page' : undefined} onClick={() => onSelect(org.id)}
            style={{ paddingInlineStart: 12 + (query ? 0 : Math.min(depth(org), 4) * 16) }}>
            <span><strong>{org.name}</strong><small>{org.parent_id ? '小组 / 下属组织' : '部门'}{!org.is_active ? ' · 已停用' : ''}</small></span>
            <span className="org-people">{memberCount(org)} 人</span>
          </button>)}
          {!rows.some((org) => org.name.includes(query.trim())) && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的部门或小组" />}
        </div>
      </aside>
      <section className="org-detail" aria-label="所选组织详情">
        {selected ? <>
          <div className="org-detail-heading"><div><h3>{selected.name}</h3><p>{parent ? `隶属 ${parent.name}` : '公司直属部门'}</p></div><Chip tone={selected.is_active ? 'ok' : undefined}>{selected.is_active ? '启用中' : '已停用'}</Chip></div>
          <Space wrap className="org-detail-actions">
            <Button type="primary" onClick={onCreateGroup}>在「{selected.name}」下新增小组</Button>
            <Button onClick={onEdit}>编辑「{selected.name}」</Button>
            <Button onClick={() => onMembers(selected.id)}>查看启用成员（{memberCount(selected)}）</Button>
          </Space>
          <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="组织代码">{selected.code}</Descriptions.Item>
            <Descriptions.Item label="类型">{selected.kind ?? '未填写'}</Descriptions.Item>
            <Descriptions.Item label="直属启用成员">{selected.user_count ?? 0} 人</Descriptions.Item>
            <Descriptions.Item label="含下属启用成员">{memberCount(selected)} 人</Descriptions.Item>
            <Descriptions.Item label="直接下属组织">{children.length} 个</Descriptions.Item>
          </Descriptions>
          <h4>下属部门 / 小组</h4>
          <Table rowKey="id" size="small" pagination={false} dataSource={children} scroll={{ x: 480 }}
            locale={{ emptyText: '还没有下属组织，可用上方按钮新增小组。' }}
            columns={[{ title: '名称', dataIndex: 'name', render: (name: string, org: OrgRow) => <button type="button" className="project-entry" onClick={() => onSelect(org.id)}>{name}</button> },
              { title: '启用成员（含下属）', render: (_: unknown, org: OrgRow) => `${memberCount(org)} 人` },
              { title: '状态', dataIndex: 'is_active', render: (active: boolean) => active ? '启用' : '停用' }]} />
          <div className="org-status-action"><span>停用后保留组织及历史记录。</span><Popconfirm title={selected.is_active ? `停用「${selected.name}」？历史记录会保留。` : `重新启用「${selected.name}」？`} onConfirm={() => onToggle(selected)}>
            <Button type="text" danger={selected.is_active}>{selected.is_active ? '停用此组织' : '重新启用'}</Button>
          </Popconfirm></div>
        </> : <Empty description="暂无组织，请先新增公司部门。" />}
      </section>
    </div>
  </>
}
