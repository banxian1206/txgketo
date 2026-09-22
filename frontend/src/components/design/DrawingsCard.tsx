import type { FormInstance } from 'antd'
// components/design/DrawingsCard.tsx —— 由 EquipmentDesign 拆出（重构 1.6 · 只拆不改）
import { AppstoreOutlined, BlockOutlined, FolderOpenOutlined } from '@ant-design/icons'
import {
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
  matForm,
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
  submitForm,
  load
}: {
  addForm: FormInstance;
  doNewDrawingVersion: (...args: any[]) => any;
  doRename: (...args: any[]) => any;
  loading: boolean;
  matForm: FormInstance;
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
  submitForm: FormInstance;
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
              onClick={() => {
                matForm.resetFields()
                void searchItems()
                setMatOpen(true)
              }}
            >
              挂原材料
            </Button>
          </Space>
        }
      >
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
                        submitForm.resetFields()
                        setSubmitOpen(true)
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
