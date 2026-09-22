import type { FormInstance } from 'antd'
// components/design/ProgramsModals.tsx —— 由 EquipmentDesign 拆出（重构 1.6 · 只拆不改）
import {
  Button,
  Form,
  Input,
  Modal,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd'



import {
  type ProgramItem,
  type ProgramVersionRow,
} from '../../api/client'

export default function ProgramsModals({
doCreateProgram,
  doUploadProgram,
  equipNo,
  progCreateOpen,
  progForm,
  progUploadForm,
  progUploadOpen,
  progUploadTarget,
  progVerOpen,
  progVerTarget,
  progVersions,
  saving,
  setProgCreateOpen,
  setProgUploadOpen,
  setProgVerOpen
}: {
doCreateProgram: (...args: any[]) => any;
  doUploadProgram: (...args: any[]) => any;
  equipNo: string;
  progCreateOpen: boolean;
  progForm: FormInstance;
  progUploadForm: FormInstance;
  progUploadOpen: boolean;
  progUploadTarget: ProgramItem | null;
  progVerOpen: boolean;
  progVerTarget: ProgramItem | null;
  progVersions: ProgramVersionRow[];
  saving: boolean;
  setProgCreateOpen: (...args: any[]) => any;
  setProgUploadOpen: (...args: any[]) => any;
  setProgVerOpen: (...args: any[]) => any;
}) {
  return (
    <>
      <Modal
        title={`新建程序 · ${equipNo}`}
        open={progCreateOpen}
        onCancel={() => setProgCreateOpen(false)}
        onOk={() => void doCreateProgram()}
        confirmLoading={saving}
        okText="创建"
        destroyOnHidden
      >
        <Form form={progForm} layout="vertical" preserve={false}>
          <Form.Item name="name" label="程序名称" rules={[{ required: true, message: '请填程序名称' }]}>
            <Input placeholder="如：PLC 主控程序 / HMI 画面 / 机器人程序" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 上传程序草稿 */}
      <Modal
        title={`上传程序草稿 · ${progUploadTarget?.name ?? ''}`}
        open={progUploadOpen}
        onCancel={() => setProgUploadOpen(false)}
        onOk={() => void doUploadProgram()}
        confirmLoading={saving}
        okText="上传"
        destroyOnHidden
      >
        <Form form={progUploadForm} layout="vertical" preserve={false}>
          <Form.Item
            name="file"
            label="程序文件"
            valuePropName="fileList"
            getValueFromEvent={(e) => e?.fileList}
          >
            <Upload maxCount={1} beforeUpload={() => false}>
              <Button>选择程序文件</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="change_reason" label="版本说明">
            <Input.TextArea rows={2} placeholder="如：首版 / 修复报警逻辑" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 程序版本历史 */}
      <Modal
        title={`程序版本 · ${progVerTarget?.name ?? ''}`}
        open={progVerOpen}
        width={760}
        footer={null}
        onCancel={() => setProgVerOpen(false)}
      >
        <Table<ProgramVersionRow>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={progVersions}
          columns={[
            {
              title: '版本',
              dataIndex: 'version',
              width: 80,
              render: (v: string, r: ProgramVersionRow) => (
                <Tag color={r.is_current ? 'green' : 'default'}>{v}</Tag>
              ),
            },
            { title: '文件', dataIndex: 'filename', render: (v: string | null) => v || '—' },
            {
              title: '提交 / 发布',
              key: 'who',
              render: (_: unknown, r: ProgramVersionRow) => (
                <Typography.Text style={{ fontSize: 12 }}>
                  {r.submitted_by ?? '—'} → {r.published_by ?? '—'}
                </Typography.Text>
              ),
            },
            {
              title: '原因 / 意见',
              key: 'note',
              render: (_: unknown, r: ProgramVersionRow) => (
                <Typography.Text style={{ fontSize: 12 }}>
                  {r.change_reason ?? '—'}
                  {r.review_note ? `（审核：${r.review_note}）` : ''}
                </Typography.Text>
              ),
            },
          ]}
        />
      </Modal>
    </>
  )
}
