import type { FormInstance } from 'antd'
// components/design/DrawingsModals.tsx —— 由 EquipmentDesign 拆出（重构 1.6 · 只拆不改）
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'



import {
  errMsg,
  uploadDrawingDraft,
  type GeneratePurchaseResult,
  type StdItem,
  type VersionRow,
} from '../../api/client'
import { useGoFrom } from '../../hooks/useFrom'
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
  purchaseForm,
  purchaseOpen,
  rows,
  saving,
  searchItems,
  selected,
  setAddOpen,
  setMatOpen,
  setPurchaseOpen,
  setPurchaseResult,
  setSaving,
  setSubmitOpen,
  setVerOpen,
  submitForm,
  submitOpen,
  submitPurchase,
  verOpen,
  versions,
  purchaseResult
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
  nav: any;
  parentOptions: any;
  purchaseForm: FormInstance;
  purchaseOpen: boolean;
  rows: TreeNode[];
  saving: boolean;
  searchItems: (...args: any[]) => any;
  selected: TreeNode | null;
  setAddOpen: (...args: any[]) => any;
  setMatOpen: (...args: any[]) => any;
  setPurchaseOpen: (...args: any[]) => any;
  setPurchaseResult: (...args: any[]) => any;
  setSaving: (...args: any[]) => any;
  setSubmitOpen: (...args: any[]) => any;
  setVerOpen: (...args: any[]) => any;
  submitForm: FormInstance;
  submitOpen: boolean;
  submitPurchase: any;
  verOpen: boolean;
  versions: VersionRow[];
  purchaseResult: GeneratePurchaseResult | null;
}) {
  // ★ 来源优先：本组件里往采购台的跳转要带来源（nav 仍由 props 传入，此处只用 go）
  const go = useGoFrom()
  return (
    <>
      <Modal
        title={`生成采购需求（进池） · ${equipNo}`}
        open={purchaseOpen}
        width={660}
        onCancel={() => {
          setPurchaseOpen(false)
          setPurchaseResult(null)
        }}
        onOk={() => {
          // ★ 来源优先：设计面 → 采购台也带来源
          if (purchaseResult) go('/purchase')
          else void submitPurchase()
        }}
        okText={purchaseResult ? '去采购工作台' : '生成进池'}
        confirmLoading={saving}
        forceRender
      >
        {purchaseResult ? (
          <>
            <Alert
              type={purchaseResult.created > 0 ? 'success' : 'info'}
              showIcon
              style={{ marginBottom: 12 }}
              message={
                purchaseResult.created > 0
                  ? `生成 ${purchaseResult.created} 条待采购需求（合计 ${purchaseResult.buy_qty}）`
                  : (purchaseResult.message ?? '没有新需求')
              }
              description={`BOM 需求 ${purchaseResult.need_qty}；库存/在途已覆盖 ${purchaseResult.covered_qty}；需要到货 ${
                purchaseResult.need_date ?? '待定'
              }`}
            />
            {(purchaseResult.requests?.length ?? 0) > 0 && (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={purchaseResult.requests}
                columns={[
                  { title: '物料', dataIndex: 'display_name' },
                  {
                    title: '零件',
                    dataIndex: 'part_no',
                    width: 210,
                    render: (v: string | null) => v ?? '—',
                  },
                  {
                    title: '数量',
                    dataIndex: 'qty',
                    width: 90,
                    render: (v: number, r: { unit?: string | null }) => `${v} ${r.unit ?? ''}`,
                  },
                ]}
              />
            )}
          </>
        ) : (
          <>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0 }}>
              只展开已冻结（评审发布过）的标准件/原材料 BOM 行；扣掉仓库可用库存和这台设备已经在跑的需求，
              剩下的按「物料 + 零件」进采购池等合并下单。
            </Typography.Paragraph>
            <Form form={purchaseForm} layout="vertical">
              <Form.Item
                name="need_date"
                label="需要到货日期"
                tooltip="不填就用项目的合同周期结束日"
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="remark" label="备注" style={{ marginBottom: 0 }}>
                <Input placeholder="如：这批和 02A 一起买" />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>

      <Modal
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
            tooltip="决定这个件走哪条路：自制件排产自己做；外协件发出去加工；外购件买现成的；标准件不出图，直接从标准库选"
          >
            <Select
              options={[
                { value: '自制件', label: '自制件（自己做）' },
                { value: '外协件', label: '外协件（发出去加工）' },
                { value: '外购件', label: '外购件（买现成的非标件）' },
                { value: '标准件', label: '标准件（从标准库选，不出图）' },
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
                      <a onClick={() => window.open('/library', '_blank')}> 去标准库新建 </a>
                    </Typography.Text>
                  }
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
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

          <Space style={{ display: 'flex' }} size="middle">
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
            <a onClick={() => window.open('/library', '_blank')}> 标准库新建 </a>
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
        title={`版本历史 · ${selected?.drawing_no ?? ''}`}
        open={verOpen}
        width={760}
        footer={null}
        onCancel={() => setVerOpen(false)}
      >
        <Table<VersionRow>
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
                  <Tag color={r.is_current ? 'green' : 'default'}>{v}</Tag>
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
