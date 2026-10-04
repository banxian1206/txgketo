import type { FormInstance } from 'antd'
// components/design/DrawingsCard.tsx —— 由 EquipmentDesign 拆出（重构 1.6 · 只拆不改）
import { AppstoreOutlined, BlockOutlined, FolderOpenOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Empty,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'


import AuthedFileLink from '../AuthedFileLink'

import {
  deleteDrawing,
  drawingFileUrl,
  errMsg,
  type DesignRoot,
  type User,
} from '../../api/client'
import { DRAWING_STATUS as STATUS_COLOR } from '../../theme/status'
import { CHANGE_STATUS as CHANGE_STATUS_COLOR } from '../../theme/status'
import { changeActionAvailable as CHANGE_ACTION_AVAILABLE } from './shared'
import type { TreeNode } from './shared'

export default function DrawingsCard({
  addForm,
  doNewDrawingVersion,
  doRename,
  loading,
  message,
  openVersions,
  profile,
  root,
  rows,
  searchItems,
  selected,
  setAddOpen,
  setChangeTarget,
  setMatOpen,
  setSelected,
  setSubmitOpen,
  load
}: {
  addForm: FormInstance;
  doNewDrawingVersion: (...args: any[]) => any;
  doRename: (...args: any[]) => any;
  loading: boolean;
  message: any;
  openVersions: (...args: any[]) => any;
  profile: User | null;
  root: DesignRoot | undefined;
  rows: TreeNode[];
  searchItems: (...args: any[]) => any;
  selected: TreeNode | null;
  setAddOpen: (...args: any[]) => any;
  setChangeTarget: (...args: any[]) => any;
  setMatOpen: (...args: any[]) => any;
  setSelected: (...args: any[]) => any;
  setSubmitOpen: (...args: any[]) => any;
  load: (...args: any[]) => any;
}) {
  return (
    <>
      <Card
        size="small"
        title="图纸与 BOM（图号自带结构，录入自动成树）"
        extra={
          <Space>
            <Button
              size="small"
              type="primary"
              title="新增一条组件/零件（新行是草稿，要提交评审发布后才计入采购/排产）"
              onClick={() => {
                addForm.resetFields()
                void searchItems()
                addForm.setFieldsValue({
                  parent_drawing_no: root ? (root.exists ? root.drawing_no : '__ROOT__') : undefined,
                  kind: '自制件',
                  qty: 1,
                  unit: '件',
                })
                setAddOpen(true)
              }}
            >
              + 新增条目
            </Button>
            <Button
              size="small"
              title="给自制件挂原材料（新行是草稿，要提交评审发布后才计入采购）"
              onClick={() => {
                void searchItems()
                setMatOpen(true) // ★ F14：该弹窗 destroyOnHidden，开前 reset 会触发 useForm 未连接警告
              }}
            >
              挂原材料
            </Button>
          </Space>
        }
      >
        {/* ★ N3（2026-10-04 走查核实）：本批已发布冻结后，这两个按钮**没被禁**（新增的是草稿行，
            不发布就不进需求）—— 但界面上没说清“为什么点了没反应/改了没下文”，补一句实话 */}
        {rows.length > 0 && rows.every((r) => r.status === '已发布') && (
          <Alert
            type="info"
            showIcon
            className="alert-mb"
            message="这台设备的图纸已全部发布（冻结）"
            description="从这里新增的条目/材料是【草稿】，要再走一次「提交评审 → 发布」才计入采购和排产；要改已发布的图/BOM 行，请右键行上的「改版申请（ECN）」，不要直接覆盖。"
          />
        )}
        <Table<TreeNode>
          rowKey="drawing_no"
          size="small"
          loading={loading}
          pagination={false}
          dataSource={
            root && !root.exists
              ? ([
                  {
                    drawing_no: root.drawing_no,
                    level: 0,
                    parent_drawing_no: null,
                    title: `${root.title}（还没建）`,
                    qty: 1,
                    unit: '台',
                    source_type: '自制件',
                    current_version: 'V1',
                    status: '草稿',
                    is_part: false,
                    __virtual: true,
                  } as TreeNode & { __virtual?: boolean },
                  ...rows,
                ] as TreeNode[])
              : rows
          }
          locale={{ emptyText: <Empty description="还没出图 —— 点右上角「新增组件/零件」" /> }}
          rowClassName={(r) =>
            (r as { __virtual?: boolean }).__virtual
              ? 'virtual-root-row'
              : selected?.drawing_no === r.drawing_no
                ? 'project-row-hover'
                : ''
          }
          onRow={(r) => ({
            onClick: () => {
              if (!(r as { __virtual?: boolean }).__virtual) setSelected(r)
            },
            style: { cursor: 'pointer' },
          })}
          columns={[
            {
              title: '图号',
              dataIndex: 'drawing_no',
              width: 260,
              render: (v: string, r: TreeNode) => (
                <span style={{ paddingLeft: r.level * 16 }}>
                  {r.level === 0 ? <AppstoreOutlined style={{ marginRight: 4 }} /> : r.is_part ? <BlockOutlined style={{ marginRight: 4 }} /> : <FolderOpenOutlined style={{ marginRight: 4 }} />}
                  <Typography.Text strong={r.level === 0}>{v}</Typography.Text>
                </span>
              ),
            },
            {
              title: '名称',
              dataIndex: 'title',
              render: (v: string, r: TreeNode) =>
                r.status === '草稿' ? (
                  <Typography.Text
                    editable={{
                      onChange: (nv) => {
                        if (nv && nv !== v) void doRename(r.drawing_no, nv)
                      },
                    }}
                  >
                    {v}
                  </Typography.Text>
                ) : (
                  <span className="row-title">{v}</span>
                ),
            },
            {
              title: '数量',
              dataIndex: 'qty',
              width: 80,
              render: (v: number, r: TreeNode) => `${v} ${r.unit}`,
            },
            {
              title: '类型',
              dataIndex: 'source_type',
              width: 90,
              render: (v: string) =>
                v === '自制件' ? (
                  <Tag>自制</Tag>
                ) : v === '外协件' ? (
                  <Tag color="purple">外协</Tag>
                ) : (
                  <Tag color="gold">外购</Tag>
                ),
            },
            {
              title: '版本',
              dataIndex: 'current_version',
              width: 70,
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (v: string) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>,
            },
            {
              title: '操作',
              key: 'action',
              width: 250,
              render: (_: unknown, r: TreeNode) => {
                if ((r as { __virtual?: boolean }).__virtual) {
                  return (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      新增第一个子件时自动创建
                    </Typography.Text>
                  )
                }
                return (
                <Space size="small" onClick={(e) => e.stopPropagation()}>
                  <a
                    onClick={() => {
                      setSelected(r)
                      addForm.resetFields()
                      addForm.setFieldsValue({ parent_drawing_no: r.drawing_no, kind: '自制件', qty: 1, unit: '件' })
                      setAddOpen(true)
                    }}
                  >
                    加子件
                  </a>
                  <a onClick={() => void openVersions(r.drawing_no)}>版本</a>
                  <AuthedFileLink path={drawingFileUrl(r.drawing_no)}>看图纸</AuthedFileLink>
                  {r.status === '草稿' && (
                    <a
                      onClick={() => {
                        setSelected(r)
                        setSubmitOpen(true) // ★ F14：submit 弹窗 destroyOnHidden，开前 reset 会触发 useForm 未连接警告
                      }}
                    >
                      上传图纸
                    </a>
                  )}
                  {r.status === '已发布' && !r.change_request && (
                    <a
                      onClick={() =>
                        setChangeTarget({
                          type: 'DRAWING',
                          ref: r.drawing_no,
                          title: `${r.drawing_no} ${r.title}（${r.current_version}）`,
                        })
                      }
                    >
                      提改版申请
                    </a>
                  )}
                  {r.status === '已发布' && r.change_request && (
                    <Tooltip title={`改版申请 ${r.change_request.cr_no}：${r.change_request.status}`}>
                      <Tag color={CHANGE_STATUS_COLOR[r.change_request.status] ?? 'default'}>
                        {r.change_request.status}
                      </Tag>
                    </Tooltip>
                  )}
                  {CHANGE_ACTION_AVAILABLE(r.change_request) &&
                    r.change_request?.change_task_owner_id === profile?.id && (
                      <a onClick={() => doNewDrawingVersion(r.drawing_no)}>改版出新版</a>
                    )}
                  {r.level > 0 && r.status !== '已发布' && (
                    <Popconfirm
                      title={`删除 ${r.drawing_no}？`}
                      onConfirm={() =>
                        void deleteDrawing(r.drawing_no)
                          .then(load)
                          .catch((e) => message.error(errMsg(e)))
                      }
                    >
                      <a>删除</a>
                    </Popconfirm>
                  )}
                </Space>
                )
              },
            },
          ]}
        />
      </Card>
    </>
  )
}
