// components/project/AttsCard.tsx —— 由 ProjectDetailPage 拆出（重构 1.6b · 只拆不改）
import {
  Button,
  Card,
  Empty,
  Select,
  Space,
  Table,
  Tag,
  Upload,
} from 'antd'

import {
  downloadAttachment,
  type Attachment,
  type ProjectDetail as Detail,
} from '../../api/client'

export default function AttsCard({
  ATT_CATEGORIES,
  attCategory,
  detail,
  doPreview,
  doUpload,
  setAttCategory,
  uploading,
  projectNo
}: {
  ATT_CATEGORIES: string[];
  attCategory: any;
  detail: Detail | null;
  doPreview: (...args: any[]) => any;
  doUpload: (...args: any[]) => any;
  loading: boolean;
  setAttCategory: (...args: any[]) => any;
  uploading: any;
  projectNo: any;
}) {
  return (
    <>
          <Card
            id="sec-atts"
            size="small"
            title={`资料包（${detail?.attachments.length ?? 0}）`}
            style={{ marginBottom: 16 }}
            extra={
              <Space>
                <Select
                  size="small"
                  style={{ width: 110 }}
                  value={attCategory}
                  onChange={setAttCategory}
                  options={ATT_CATEGORIES.map((c) => ({ value: c, label: c }))}
                />
                <Upload
                  multiple
                  showUploadList={false}
                  disabled={uploading}
                  beforeUpload={(file) => {
                    void doUpload(file as unknown as File)
                    return false
                  }}
                >
                  <Button size="small" type="primary" loading={uploading}>
                    上传
                  </Button>
                </Upload>
              </Space>
            }
          >
            <Table<Attachment>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail?.attachments ?? []}
              locale={{ emptyText: <Empty description="还没有资料" /> }}
              columns={[
                {
                  title: '分类',
                  dataIndex: 'category',
                  width: 100,
                  render: (v: string) => <Tag>{v}</Tag>,
                },
                { title: '文件名', dataIndex: 'filename' },
                {
                  title: '大小',
                  dataIndex: 'size',
                  width: 90,
                  render: (v: number | null) =>
                    v ? `${Math.max(1, Math.round(v / 1024))} KB` : '—',
                },
                {
                  title: '上传时间',
                  dataIndex: 'uploaded_at',
                  width: 150,
                  render: (v: string) => (v ? v.replace('T', ' ').slice(0, 16) : '—'),
                },
                {
                  title: '操作',
                  key: 'action',
                  width: 120,
                  render: (_: unknown, r: Attachment) => (
                    <Space size="middle">
                      <a onClick={() => void doPreview(r)}>预览</a>
                      <a onClick={() => void downloadAttachment(projectNo, r)}>下载</a>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
    </>
  )
}
