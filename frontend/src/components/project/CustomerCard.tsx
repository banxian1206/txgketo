// components/project/CustomerCard.tsx —— 由 ProjectDetailPage 拆出（重构 1.6b · 只拆不改）
import type { Project } from '../../api/client'
import {
  Button,
  Card,
  Empty,
  Table,
  Tag,
} from 'antd'

import EditableField from '../EditableField'
import {
  type ProjectContact,
  type ProjectDetail as Detail,
} from '../../api/client'

export default function CustomerCard({
  detail,
  openContact,
  save,
  DASH,
  p
}: {
  detail: Detail | null;
  openContact: (...args: any[]) => any;
  save: any;
  DASH: any;
  p: Project;
}) {
  return (
    <>
          <Card
            id="sec-customer"
            size="small"
            title="客户与联系人"
            extra={
              <Button size="small" onClick={() => openContact()}>
                + 新增联系人
              </Button>
            }
            style={{ marginBottom: 16 }}
          >
            <div className="ef-grid">
              <EditableField
                label="客户名称"
                value={p.customer_name}
                onSave={(v) => save('customer_name', v)}
              />
              <EditableField
                label="项目地点"
                value={p.site_address}
                onSave={(v) => save('site_address', v)}
              />
            </div>
            <Table<ProjectContact>
              rowKey="id"
              size="small"
              style={{ marginTop: 12 }}
              pagination={false}
              dataSource={detail?.contacts ?? []}
              locale={{ emptyText: <Empty description="还没有登记联系人" /> }}
              columns={[
                {
                  title: '角色',
                  dataIndex: 'role_tag',
                  width: 110,
                  render: (v: string) => (v ? <Tag color="blue">{v}</Tag> : DASH),
                },
                { title: '姓名', dataIndex: 'name', width: 100 },
                { title: '职务', dataIndex: 'title' },
                { title: '电话', dataIndex: 'phone', width: 130 },
                { title: '微信', dataIndex: 'wechat', width: 120 },
                { title: '邮箱', dataIndex: 'email' },
                {
                  title: '',
                  key: 'action',
                  width: 60,
                  render: (_: unknown, r: ProjectContact) => (
                    <a onClick={() => openContact(r)}>编辑</a>
                  ),
                },
              ]}
            />
          </Card>
    </>
  )
}
