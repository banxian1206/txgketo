import type { FormInstance } from 'antd'
import { toneOf } from '../../theme/status'
import { Chip } from '../../components/ds'
// components/design/DrawingsModals.tsx —— 由 EquipmentDesign 拆出（重构 1.6 · 只拆不改）
import { Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tooltip, Typography, Upload } from 'antd'



import { errMsg, uploadDrawingDraft, type StdItem, type VersionRow } from '../../api/client'
import type { TreeNode } from './shared'

export default function DrawingsModals({
addForm,
  addOpen,
  doAdd,
  doAddMaterial,
  equipNo,
  items,
  load,
  matForm,
  matOpen,
  message,
  parentOptions,
  rows,
  saving,
  searchItems,
  selected,
  setAddOpen,
  setMatOpen,
  setSaving,
  setSubmitOpen,
  setVerOpen,
  submitForm,
  submitOpen,
  verOpen,
  versions,
}: {
addForm: FormInstance;
  addOpen: boolean;
  doAdd: (...args: any[]) => any;
  doAddMaterial: (...args: any[]) => any;
  equipNo: string;
  items: StdItem[];
  load: (...args: any[]) => any;
  matForm: FormInstance;
  matOpen: boolean;
  message: any;
  parentOptions: any;
  rows: TreeNode[];
  saving: boolean;
  searchItems: (...args: any[]) => any;
  selected: TreeNode | null;
  setAddOpen: (...args: any[]) => any;
  setMatOpen: (...args: any[]) => any;
  setSaving: (...args: any[]) => any;
  setSubmitOpen: (...args: any[]) => any;
  setVerOpen: (...args: any[]) => any;
  submitForm: FormInstance;
  submitOpen: boolean;
  verOpen: boolean;
  versions: VersionRow[];
}) {
  return (
    <>
      <Modal
        className="engineering-modal"
        title={`新增条目 · 挂在 ${equipNo} 下`}
        open={addOpen}
        width={600}
        onCancel={() => setAddOpen(false)}
        onOk={() => void doAdd()}
        confirmLoading={saving}
        okText="新增"
        forceRender
      >
        <Form form={addForm} layout="vertical" preserve={false}>
          <Form.Item
            name="parent_drawing_no"
            label="挂在哪个下面"
            rules={[{ required: true, message: '请选择挂在哪个下面' }]}
            tooltip="设备本身就是最顶层的父级；设备下可以直接是零件，也可以是组件，组件下还能再挂组件"
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选设备总装图或某个组件"
              options={parentOptions}
            />
          </Form.Item>
          <Form.Item
            name="kind"
            label="类型"
            initialValue="自制件"
            tooltip="机械只分「外购 / 自制」：外购标品（电机/机器人…）从标准库选标准件、不出图；自制件出图后，是否外协由工艺评审判定"
          >
            <Select
              options={[
                { value: '自制件', label: '自制件（出图；是否外协由工艺术判定）' },
                { value: '标准件', label: '标准件（外购标品，从标准库选，不出图）' },
              ]}
            />
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(a, b) => a.kind !== b.kind}>
            {({ getFieldValue }) =>
              getFieldValue('kind') === '标准件' ? (
                <Form.Item
                  name="child_item_no"
                  label="标准库物料"
                  rules={[{ required: true, message: '请从标准库里选一个物料' }]}
                  extra={
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      库里没有？
                      <a href="/library" target="_blank" rel="noopener noreferrer"> 去标准库新建 </a>
                    </Typography.Text>
                  }
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    aria-label="搜索物料/标准件"
                    placeholder="输入编码 / 品名 / 规格 / 品牌搜索"
                    onSearch={(q) => void searchItems(q)}
                    options={items.map((i) => ({
                      value: i.item_no,
                      label: `${i.item_no} ${i.display_name}`,
                    }))}
                  />
                </Form.Item>
              ) : (
                <Form.Item name="title" label="名称" rules={[{ required: true, message: '请填名称' }]}>
                  <Input placeholder="如：机架 / 传动组件 / 导轨安装板" />
                </Form.Item>
              )
            }
          </Form.Item>

          <Space wrap style={{ display: 'flex' }} size="middle">
            <Form.Item name="qty" label="数量" initialValue={1} style={{ minWidth: 120 }}>
              <InputNumber style={{ width: '100%' }} min={0.01} />
            </Form.Item>
            <Form.Item name="unit" label="单位" initialValue="件" style={{ minWidth: 100 }}>
              <Input />
            </Form.Item>
          </Space>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            图号 = 父级图号 + 同级下一个可用序号（系统自动算，不让人手填）。
            挂在设备总装下 → 一级组件（-01-00-00-00）；再往下挂 → 二级、三级；最里面一层就是零件。
          </Typography.Paragraph>
        </Form>
      </Modal>

      {/* 上传图纸草稿（审核走评审单） */}
      <Modal
        className="engineering-modal"
        title={`上传图纸草稿 · ${selected?.drawing_no ?? ''}`}
        open={submitOpen}
        width={560}
        onCancel={() => setSubmitOpen(false)}
        onOk={async () => {
          let v
          try { v = await submitForm.validateFields() } catch { return }
          const file = submitForm.getFieldValue('file')?.[0]?.originFileObj as File | undefined
          setSaving(true)
          try {
            await uploadDrawingDraft(selected!.drawing_no, v.change_reason, file)
            message.success('草图已上传 —— 到「我的提交」里勾选提交评审')
            setSubmitOpen(false)
            await load()
          } catch (e) {
            message.error(errMsg(e))
          } finally {
            setSaving(false)
          }
        }}
        confirmLoading={saving}
        okText="上传"
        destroyOnHidden
      >
        <Form form={submitForm} layout="vertical" preserve={false}>
          <Form.Item name="file" label="图纸文件" valuePropName="fileList" getValueFromEvent={(e) => e?.fileList}>
            <Upload maxCount={1} beforeUpload={() => false}>
              <Button>选择图纸文件</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="change_reason" label="版本说明 / 改版原因">
            <Input.TextArea rows={2} placeholder="如：首版发布 / 现场反馈尺寸偏小，加高 50mm" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 挂标准件 / 挂原材料 */}
      <Modal
        className="engineering-modal"
          title="挂原材料（材料 BOM · 工艺部）"
          open={matOpen}
          width={620}
          onCancel={() => setMatOpen(false)}
          onOk={() => void doAddMaterial()}
          confirmLoading={saving}
          okText="挂上"
          destroyOnHidden
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            都从标准库里选，选不到就去
            <a href="/library" target="_blank" rel="noopener noreferrer"> 标准库新建 </a>
          </Typography.Paragraph>
          <Form form={matForm} layout="vertical" preserve={false}>
            <Form.Item
              name="parent_ref"
              label="给哪个零件配材料"
              rules={[{ required: true, message: '请选择' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={rows
                  .filter((r) => r.source_type === '自制件')
                  .map((r) => ({ value: r.drawing_no, label: `${r.drawing_no} ${r.title}` }))}
              />
            </Form.Item>
            <Form.Item
              name="child_item_no"
              label="原材料"
              rules={[{ required: true, message: '请选择' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="输入编码 / 品名 / 规格 搜索"
                options={items.map((i) => ({ value: i.item_no, label: `${i.item_no} ${i.display_name}` }))}
              />
            </Form.Item>
            <Form.Item name="qty" label="用量" initialValue={1} rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={0.001} />
            </Form.Item>
          </Form>
      </Modal>

      {/* 版本历史 */}
      <Modal
        className="engineering-modal"
        title={`版本历史 · ${selected?.drawing_no ?? ''}`}
        open={verOpen}
        width={760}
        footer={null}
        onCancel={() => setVerOpen(false)}
      >
        <Table<VersionRow>
          scroll={{ x: 720 }}
          rowKey="version"
          size="small"
          pagination={false}
          dataSource={versions}
          columns={[
            {
              title: '版本',
              dataIndex: 'version',
              width: 80,
              render: (v: string, r: VersionRow) => (
                <Tooltip title={r.is_current ? '当前有效版本（车间按这版干）' : '历史版本，只读留档'}>
                  <Chip tone={toneOf(r.is_current ? 'green' : 'default')}>{v}</Chip>
                </Tooltip>
              ),
            },
            { title: '文件', dataIndex: 'filename', render: (v: string | null) => v || '—' },
            {
              title: '提交 / 审核',
              key: 'who',
              render: (_: unknown, r: VersionRow) => (
                <Typography.Text style={{ fontSize: 12 }}>
                  {r.submitted_by ?? '—'} → {r.reviewed_by ?? '—'}
                </Typography.Text>
              ),
            },
            {
              title: '原因 / 意见',
              key: 'note',
              render: (_: unknown, r: VersionRow) => (
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
