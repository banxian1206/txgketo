import { Muted } from '../ui/Primitives'
import { Chip } from '../../components/ds'
// components/project/CustomerCard.tsx —— 由 ProjectDetailPage 拆出（重构 1.6b · 只拆不改）
import type { Project } from '../../api/client'
import { Button, Card, Empty, Table } from 'antd'

import EditableField from '../EditableField'
import { type ProjectContact, type ProjectDetail as Detail } from '../../api/client'

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
              // ★ 泳道里**不许**把长表平铺开：实测某客户攒了 26 个联系人 → 这一张卡就 1195px，
              //   单条泳道 2180px（等于把「9 屏平铺」搬回来了）。这里封顶 5 行 + 分页。
              pagination={{ pageSize: 5, size: 'small', showSizeChanger: false, hideOnSinglePage: true }}
              dataSource={detail?.contacts ?? []}
              locale={{ emptyText: <Empty description="还没有登记联系人" /> }}
              columns={[
                {
                  title: '角色',
                  dataIndex: 'role_tag',
                  width: 110,
                  render: (v: string) => (v ? <Chip tone="run">{v}</Chip> : DASH),
                },
                { title: '姓名', dataIndex: 'name', width: 110 },
                { title: '电话', dataIndex: 'phone', width: 140 },
                // ★ 列治理（docs/12 §3.2）：7 列 → 4 列。职务/微信/邮箱多数为空，
                //   过去三列空占位把关键信息挤没了 —— 收进展开行，有才显示。
                {
                  title: '联系方式',
                  key: 'more',
                  render: (_: unknown, r: ProjectContact) =>
                    r.wechat || r.email ? (
                      <Muted>
                        {[r.wechat && `微信 ${r.wechat}`, r.email && `邮箱 ${r.email}`].filter(Boolean).join(' · ')}
                      </Muted>
                    ) : (
                      <Muted>仅电话</Muted>
                    ),
                },
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
