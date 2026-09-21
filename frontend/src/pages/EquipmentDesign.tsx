import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import type { Dayjs } from 'dayjs'

import ReviewDetailModal from '../components/ReviewDetailModal'
import SubmitReviewModal from '../components/SubmitReviewModal'
import ChangeRequestModal from '../components/ChangeRequestModal'

import {
  addBom,
  addDrawing,
  createProgram,
  deleteDrawing,
  deleteProgram,
  errMsg,
  generateEquipmentPurchase,
  getDesignTree,
  getMyDesignTasks,
  listPrograms,
  listProgramVersions,
  listStdItems,
  listVersions,
  me,
  newDrawingVersion,
  newProgramVersion,
  removeBom,
  uploadDrawingDraft,
  uploadProgramDraft,
  type BomLine,
  type ChangeBrief,
  type DesignRoot,
  type DesignTree,
  type GeneratePurchaseResult,
  type MyDesignTask,
  type ProgramItem,
  type ProgramVersionRow,
  type StdItem,
  type User,
  type VersionRow,
} from '../api/client'

const STATUS_COLOR: Record<string, string> = {
  草稿: 'default',
  审核中: 'processing',
  已发布: 'success',
  已作废: 'default',
}

const STATE_COLOR: Record<string, string> = {
  未开始: 'default',
  设计中: 'processing',
  设计BOM已提交: 'gold',
  BOM完整: 'success',
}

const REVIEW_STATUS_COLOR: Record<string, string> = {
  待组长审: 'processing',
  待总监审: 'gold',
  已退回: 'error',
  已撤回: 'default',
  已通过: 'success',
}

const CHANGE_STATUS_COLOR: Record<string, string> = {
  待裁决: 'processing',
  已批准: 'blue',
  已否决: 'error',
  已下发: 'gold',
  已完成: 'success',
  已归档: 'default',
}

const BOM_STATUS_COLOR: Record<string, string> = {
  草稿: 'default',
  审核中: 'processing',
  已冻结: 'success',
}

interface TreeNode {
  drawing_no: string
  level: number
  parent_drawing_no?: string | null
  title: string
  qty: number
  unit: string
  source_type: string
  current_version: string
  status: string
  is_part: boolean
  change_request?: { id: number; cr_no: string; status: string; change_task_owner_id?: number | null } | null
}

interface Props {
  projectNo?: string
  equipNo?: string
  embedded?: boolean
}

/** 设备设计工作面（S3）：出图 → 版本审核发布 → 设计 BOM + 材料 BOM → 完整 BOM */
export default function EquipmentDesign({ projectNo: p0, equipNo: e0, embedded }: Props) {
  const params = useParams()
  const projectNo = p0 ?? params.projectNo ?? ''
  const equipNo = e0 ?? params.equipNo ?? ''
  const nav = useNavigate()
  const { message } = App.useApp()

  const [data, setData] = useState<DesignTree | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<TreeNode | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [matOpen, setMatOpen] = useState(false)
  const [verOpen, setVerOpen] = useState(false)
  const [submitOpen, setSubmitOpen] = useState(false)
  // 我的提交（评审单）
  const [myTasks, setMyTasks] = useState<MyDesignTask[]>([])
  const [reviewTask, setReviewTask] = useState<MyDesignTask | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [detailTicketId, setDetailTicketId] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [items, setItems] = useState<StdItem[]>([])
  const [addForm] = Form.useForm()
  const [matForm] = Form.useForm()
  const [submitForm] = Form.useForm()
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [purchaseResult, setPurchaseResult] = useState<GeneratePurchaseResult | null>(null)
  const [purchaseForm] = Form.useForm()
  // 改版原因（Modal.confirm 里的小输入框）
  const reasonRef = { current: '' }
  // PLC 程序版本
  const [programs, setPrograms] = useState<ProgramItem[]>([])
  const [progCreateOpen, setProgCreateOpen] = useState(false)
  const [progUploadOpen, setProgUploadOpen] = useState(false)
  const [progUploadTarget, setProgUploadTarget] = useState<ProgramItem | null>(null)
  const [progVerOpen, setProgVerOpen] = useState(false)
  const [progVersions, setProgVersions] = useState<ProgramVersionRow[]>([])
  const [progVerTarget, setProgVerTarget] = useState<ProgramItem | null>(null)
  const [progForm] = Form.useForm()
  const [progUploadForm] = Form.useForm()
  const progReasonRef = { current: '' }
  // 改版（ECN）
  const [profile, setProfile] = useState<User | null>(null)
  const [changeTarget, setChangeTarget] = useState<{
    type: 'DRAWING' | 'PROGRAM' | 'BOM_ITEM'
    ref: string
    title: string
  } | null>(null)

  const load = useCallback(async () => {
    if (!projectNo || !equipNo) return
    setLoading(true)
    try {
      const [d, mt, pg, who] = await Promise.all([
        getDesignTree(projectNo, equipNo),
        getMyDesignTasks(projectNo, equipNo),
        listPrograms(projectNo, equipNo),
        me(),
      ])
      setData(d)
      setMyTasks(mt)
      setPrograms(pg)
      setProfile(who)
      setSelected((prev) => (prev ? d.tree.find((t) => t.drawing_no === prev.drawing_no) ?? null : null))
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [projectNo, equipNo, message])

  useEffect(() => {
    void load()
  }, [load])

  const searchItems = async (q?: string) => {
    try {
      setItems(await listStdItems({ q, limit: 50 }))
    } catch {
      setItems([])
    }
  }

  const doAdd = async () => {
    const v = await addForm.validateFields()
    setSaving(true)
    try {
      if (v.kind === '标准件') {
        await addBom(projectNo, 'std', {
          parent_ref: v.parent_drawing_no,
          child_item_no: v.child_item_no,
          qty: v.qty ?? 1,
        })
        message.success('标准件已挂上（从标准库引用，不出图）')
      } else {
        const d = await addDrawing(projectNo, equipNo, {
          parent_drawing_no: v.parent_drawing_no,
          title: v.title,
          qty: v.qty ?? 1,
          unit: v.unit ?? '件',
          source_type: v.kind ?? '自制件',
        })
        message.success(`已新增 ${d.drawing_no}（${d.title}）`)
      }
      setAddOpen(false)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const doAddMaterial = async () => {
    const v = await matForm.validateFields()
    setSaving(true)
    try {
      await addBom(projectNo, 'material', {
        parent_ref: v.parent_ref,
        child_item_no: v.child_item_no,
        qty: v.qty ?? 1,
        pos_no: v.pos_no,
      })
      message.success('材料已挂上')
      setMatOpen(false)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const openVersions = async (no: string) => {
    setSelected(data?.tree.find((t) => t.drawing_no === no) ?? null)
    try {
      setVersions(await listVersions(no))
      setVerOpen(true)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const CHANGE_ACTION_AVAILABLE = (cr?: ChangeBrief | null) =>
    !!cr && cr.status === '已下发'

  const doNewDrawingVersion = (no: string) => {
    reasonRef.current = ''
    Modal.confirm({
      title: `改版出新版 ${no}`,
      content: (
        <Input
          placeholder="改版说明（如：安装孔左移 5mm）"
          onChange={(e) => {
            reasonRef.current = e.target.value
          }}
        />
      ),
      onOk: () =>
        newDrawingVersion(no, reasonRef.current)
          .then(() => {
            message.success('已生成新版本草稿 —— 去「我的提交」勾选提交评审')
            return load()
          })
          .catch((e) => message.error(errMsg(e))),
    })
  }

  const doCreateProgram = async () => {
    const v = await progForm.validateFields()
    setSaving(true)
    try {
      await createProgram(projectNo, equipNo, { name: v.name, remark: v.remark })
      message.success('程序已建 —— 上传程序文件后到「我的提交」勾选提交评审')
      setProgCreateOpen(false)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const doUploadProgram = async () => {
    if (!progUploadTarget) return
    const v = await progUploadForm.validateFields()
    const file = progUploadForm.getFieldValue('file')?.[0]?.originFileObj as File | undefined
    setSaving(true)
    try {
      await uploadProgramDraft(progUploadTarget.id, v.change_reason, file)
      message.success('程序草稿已上传')
      setProgUploadOpen(false)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const openProgramVersions = async (p: ProgramItem) => {
    setProgVerTarget(p)
    try {
      setProgVersions(await listProgramVersions(p.id))
      setProgVerOpen(true)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const doNewProgramVersion = (p: ProgramItem) => {
    progReasonRef.current = ''
    Modal.confirm({
      title: `程序改版 ${p.name}`,
      content: (
        <Input
          placeholder="改版原因（如：现场反馈报警逻辑要改）"
          onChange={(e) => {
            progReasonRef.current = e.target.value
          }}
        />
      ),
      onOk: () =>
        newProgramVersion(p.id, progReasonRef.current)
          .then(() => {
            message.success('已生成新版本草稿')
            return load()
          })
          .catch((e) => message.error(errMsg(e))),
    })
  }

  const removeProgram = async (p: ProgramItem) => {
    try {
      await deleteProgram(p.id)
      message.success('已删除')
      await load()
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const rows = (data?.tree ?? []) as TreeNode[]
  const root: DesignRoot | undefined = data?.root

  /** 可以当父级的节点：设备总装图永远排第一，然后是现有组件（缩进显示） */
  const parentOptions = [
    ...(root
      ? [
          {
            value: root.drawing_no,
            label: `📦 ${root.equip_no} ${root.title}（${root.drawing_no}）${
              root.exists ? '' : ' · 还没建，新增后自动创建'
            }`,
          },
        ]
      : []),
    ...rows
      .filter((r) => r.level < 4)
      .map((r) => ({
        value: r.drawing_no,
        label: `${'　'.repeat(r.level)}└ ${r.drawing_no} ${r.title}`,
      })),
  ]

  const submitPurchase = async () => {
    let v: { need_date?: Dayjs; remark?: string }
    try {
      v = await purchaseForm.validateFields()
    } catch {
      return
    }
    setSaving(true)
    try {
      const res = await generateEquipmentPurchase(projectNo, equipNo, {
        need_date: v.need_date ? v.need_date.format('YYYY-MM-DD') : undefined,
        remark: v.remark,
      })
      setPurchaseResult(res)
      if (res.created > 0) {
        message.success(`已生成 ${res.created} 条待采购需求进池（合计 ${res.buy_qty}）`)
      } else {
        message.info(res.message ?? '没有新需求')
      }
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* 顶部：完整度 + 待办 */}
      {!embedded && (
        <Card style={{ marginBottom: 16 }}>
          <Row align="middle">
            <Col flex="auto">
              <Space size={8} wrap>
                <a onClick={() => nav(`/projects/${projectNo}`)}>← 返回项目</a>
                <Typography.Text strong style={{ fontSize: 17 }}>
                  {equipNo} 设计工作面
                </Typography.Text>
                {root && (
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    设备总装图 {root.drawing_no}
                    {root.exists ? '' : '（未创建）'}
                  </Typography.Text>
                )}
                <Tag color={STATE_COLOR[data?.state ?? '未开始']}>{data?.state}</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  图 {data?.counts.drawings ?? 0} 张 · 组件 {data?.counts.components ?? 0} · 零件{' '}
                  {data?.counts.parts ?? 0}（自制 {data?.counts.self_made ?? 0} / 外协{' '}
                  {data?.counts.outsource ?? 0}）· 标准件 {data?.counts.std_items ?? 0} · 材料{' '}
                  {data?.counts.materials ?? 0}
                </Typography.Text>
              </Space>
            </Col>
            <Col>
              <Button
                type="primary"
                onClick={() => {
                  purchaseForm.resetFields()
                  setPurchaseResult(null)
                  setPurchaseOpen(true)
                }}
              >
                生成采购需求（进池）
              </Button>
            </Col>
          </Row>
        </Card>
      )}

      {(data?.issues.unpublished.length ?? 0) > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`有 ${data?.issues.unpublished.length} 张图还没发布`}
          description="设计 BOM 要等图纸走完「提交评审 → 两级审核 → 发布冻结」才算数（车间只认已发布的当前有效版本）"
        />
      )}
      {(data?.issues.parts_without_material.length ?? 0) > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`有 ${data?.issues.parts_without_material.length} 个自制件还没挂原材料（工艺部）`}
          description={`材料 BOM 是工艺部的活：${data?.issues.parts_without_material
            .slice(0, 3)
            .join('、')}…  设计 BOM + 材料 BOM 合起来才是设备的完整 BOM`}
        />
      )}

      {/* 我的提交（评审单）：一个任务一张单，多轮共用 */}
      {myTasks.length > 0 && (
        <Card size="small" title="我的提交（评审单）" style={{ marginBottom: 16 }}>
          <Table<MyDesignTask>
            rowKey="task_id"
            size="small"
            pagination={false}
            dataSource={myTasks}
            columns={[
              {
                title: '任务号',
                dataIndex: 'task_no',
                width: 100,
                render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
              },
              { title: '任务', dataIndex: 'title' },
              {
                title: '评审状态',
                key: 'status',
                width: 140,
                render: (_: unknown, r: MyDesignTask) =>
                  r.ticket ? (
                    <Tag color={REVIEW_STATUS_COLOR[r.ticket.status] ?? 'default'}>{r.ticket.status}</Tag>
                  ) : (
                    <Tag>未提交</Tag>
                  ),
              },
              {
                title: '轮次',
                key: 'round',
                width: 80,
                render: (_: unknown, r: MyDesignTask) =>
                  r.ticket ? `第 ${r.ticket.current_round} 轮` : '—',
              },
              {
                title: '操作',
                key: 'action',
                width: 200,
                render: (_: unknown, r: MyDesignTask) => (
                  <Space size="middle">
                    {(!r.ticket || !r.ticket.status.includes('待')) && (
                      <a
                        onClick={() => {
                          setReviewTask(r)
                          setReviewOpen(true)
                        }}
                      >
                        提交评审
                      </a>
                    )}
                    {r.ticket && (
                      <a
                        onClick={() => {
                          setDetailTicketId(r.ticket!.id)
                          setDetailOpen(true)
                        }}
                      >
                        审核记录
                      </a>
                    )}
                  </Space>
                ),
              },
            ]}
          />
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
            勾选草稿内容 → 组长 → 总监 → 发布（= 冻结）。退回/撤回后内容回到草稿，可在同一张单上重新提交。
          </Typography.Paragraph>
        </Card>
      )}

      {/* 图纸树 */}
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
                  parent_drawing_no: root?.drawing_no,
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
                  {r.level === 0 ? '📦 ' : r.is_part ? '🔩 ' : '🧩 '}
                  <Typography.Text strong={r.level === 0}>{v}</Typography.Text>
                </span>
              ),
            },
            {
              title: '名称',
              dataIndex: 'title',
              render: (v: string) => <span className="row-title">{v}</span>,
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
                      addForm.setFieldsValue({ parent_drawing_no: r.drawing_no })
                      setAddOpen(true)
                    }}
                  >
                    加子件
                  </a>
                  <a onClick={() => void openVersions(r.drawing_no)}>版本</a>
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

      {/* 标准件 + 材料 */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={12}>
          <Card size="small" title={`设计 BOM · 标准件（${data?.counts.std_items ?? 0}）`}>
            <Table<BomLine>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={data?.std_bom ?? []}
              locale={{ emptyText: <Empty description="还没挂标准件" /> }}
              columns={[
                { title: '挂在', dataIndex: 'parent_ref', width: 210 },
                {
                  title: '物料',
                  dataIndex: 'display_name',
                  render: (v: string, r: BomLine) => (
                    <Space direction="vertical" size={0}>
                      <span>{v}</span>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {r.child_item_no}
                      </Typography.Text>
                    </Space>
                  ),
                },
                {
                  title: '数量',
                  dataIndex: 'qty',
                  width: 90,
                  render: (v: number, r: BomLine) => `${v} ${r.unit ?? ''}`,
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 80,
                  render: (v: string) => <Tag color={BOM_STATUS_COLOR[v] ?? 'default'}>{v ?? '草稿'}</Tag>,
                },
                {
                  title: '操作',
                  key: 'bomaction',
                  width: 140,
                  render: (_: unknown, r: BomLine) =>
                    r.status === '已冻结' ? (
                      <Space size={4}>
                        {!r.change_request && (
                          <a
                            onClick={() =>
                              setChangeTarget({
                                type: 'BOM_ITEM',
                                ref: String(r.id),
                                title: `${r.parent_ref} ← ${r.display_name} × ${r.qty}`,
                              })
                            }
                          >
                            提改版申请
                          </a>
                        )}
                        {r.change_request && (
                          <Tooltip title={`改版申请 ${r.change_request.cr_no}：${r.change_request.status}`}>
                            <Tag color={CHANGE_STATUS_COLOR[r.change_request.status] ?? 'default'}>
                              {r.change_request.status}
                            </Tag>
                          </Tooltip>
                        )}
                      </Space>
                    ) : (
                      <Popconfirm
                        title="删除？"
                        onConfirm={() =>
                          void removeBom(r.id).then(load).catch((e) => message.error(errMsg(e)))
                        }
                      >
                        <a>删</a>
                      </Popconfirm>
                    ),
                },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card
            size="small"
            title={`材料 BOM · 原材料（${data?.counts.materials ?? 0}）`}
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                工艺部
              </Typography.Text>
            }
          >
            <Table<BomLine>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={data?.material_bom ?? []}
              locale={{ emptyText: <Empty description="工艺部还没补材料" /> }}
              columns={[
                { title: '零件', dataIndex: 'parent_ref', width: 210 },
                { title: '原材料', dataIndex: 'display_name' },
                {
                  title: '用量',
                  dataIndex: 'qty',
                  width: 90,
                  render: (v: number, r: BomLine) => `${v} ${r.unit ?? ''}`,
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 80,
                  render: (v: string) => <Tag color={BOM_STATUS_COLOR[v] ?? 'default'}>{v ?? '草稿'}</Tag>,
                },
                {
                  title: '操作',
                  key: 'bomaction',
                  width: 140,
                  render: (_: unknown, r: BomLine) =>
                    r.status === '已冻结' ? (
                      <Space size={4}>
                        {!r.change_request && (
                          <a
                            onClick={() =>
                              setChangeTarget({
                                type: 'BOM_ITEM',
                                ref: String(r.id),
                                title: `${r.parent_ref} ← ${r.display_name} × ${r.qty}`,
                              })
                            }
                          >
                            提改版申请
                          </a>
                        )}
                        {r.change_request && (
                          <Tooltip title={`改版申请 ${r.change_request.cr_no}：${r.change_request.status}`}>
                            <Tag color={CHANGE_STATUS_COLOR[r.change_request.status] ?? 'default'}>
                              {r.change_request.status}
                            </Tag>
                          </Tooltip>
                        )}
                      </Space>
                    ) : (
                      <Popconfirm
                        title="删除？"
                        onConfirm={() =>
                          void removeBom(r.id).then(load).catch((e) => message.error(errMsg(e)))
                        }
                      >
                        <a>删</a>
                      </Popconfirm>
                    ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* PLC 程序版本（程序专业）：走评审单发布，不采购 */}
      <Card
        size="small"
        title={`PLC 程序版本（${programs.length}）`}
        style={{ marginTop: 16 }}
        extra={
          <Button
            size="small"
            onClick={() => {
              progForm.resetFields()
              setProgCreateOpen(true)
            }}
          >
            + 新建程序
          </Button>
        }
      >
        <Table<ProgramItem>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={programs}
          locale={{ emptyText: <Empty description="程序专业还没建程序（建好后走评审单两级审核发布）" /> }}
          columns={[
            { title: '程序', dataIndex: 'name' },
            {
              title: '版本',
              dataIndex: 'current_version',
              width: 70,
              render: (v: string) => <Tag>{v}</Tag>,
            },
            {
              title: '文件',
              dataIndex: 'current_filename',
              width: 200,
              render: (v: string | null | undefined) => v ?? '—',
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (v: string) => <Tag color={STATUS_COLOR[v] ?? 'default'}>{v}</Tag>,
            },
            {
              title: '操作',
              key: 'action',
              width: 230,
              render: (_: unknown, p: ProgramItem) => (
                <Space size="small">
                  {p.status === '草稿' && (
                    <a
                      onClick={() => {
                        setProgUploadTarget(p)
                        progUploadForm.resetFields()
                        setProgUploadOpen(true)
                      }}
                    >
                      上传程序
                    </a>
                  )}
                  <a onClick={() => void openProgramVersions(p)}>版本</a>
                  {p.status === '已发布' && !p.change_request && (
                    <a
                      onClick={() =>
                        setChangeTarget({
                          type: 'PROGRAM',
                          ref: String(p.id),
                          title: `程序 ${p.name}（${p.current_version}）`,
                        })
                      }
                    >
                      提改版申请
                    </a>
                  )}
                  {p.status === '已发布' && p.change_request && (
                    <Tooltip title={`改版申请 ${p.change_request.cr_no}：${p.change_request.status}`}>
                      <Tag color={CHANGE_STATUS_COLOR[p.change_request.status] ?? 'default'}>
                        {p.change_request.status}
                      </Tag>
                    </Tooltip>
                  )}
                  {CHANGE_ACTION_AVAILABLE(p.change_request) &&
                    p.change_request?.change_task_owner_id === profile?.id && (
                      <a onClick={() => doNewProgramVersion(p)}>改版出新版</a>
                    )}
                  {p.status === '草稿' && (
                    <Popconfirm title={`删除程序 ${p.name}？`} onConfirm={() => void removeProgram(p)}>
                      <a>删除</a>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {/* 新增组件/零件 */}
      {/* 生成采购需求（BOM → 净需求 → 进池） */}
      <Modal
        title={`生成采购需求（进池） · ${equipNo}`}
        open={purchaseOpen}
        width={660}
        onCancel={() => {
          setPurchaseOpen(false)
          setPurchaseResult(null)
        }}
        onOk={() => {
          if (purchaseResult) nav('/purchase')
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
        destroyOnClose
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
          const v = await submitForm.validateFields()
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
        destroyOnClose
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
          destroyOnClose
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
      {/* 新建程序 */}
      <Modal
        title={`新建程序 · ${equipNo}`}
        open={progCreateOpen}
        onCancel={() => setProgCreateOpen(false)}
        onOk={() => void doCreateProgram()}
        confirmLoading={saving}
        okText="创建"
        destroyOnClose
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
        destroyOnClose
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

      {/* 提改版申请 */}
      <ChangeRequestModal
        open={!!changeTarget}
        targetType={changeTarget?.type ?? null}
        targetRef={changeTarget?.ref ?? null}
        targetTitle={changeTarget?.title}
        onClose={() => setChangeTarget(null)}
        onCreated={() => void load()}
      />

      {/* 提交评审 / 审核记录 */}
      <SubmitReviewModal
        task={reviewTask}
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onDone={() => void load()}
      />
      <ReviewDetailModal
        ticketId={detailTicketId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onChanged={() => void load()}
      />
    </>
  )
}

