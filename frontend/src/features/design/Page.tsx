import { Alert, App, Form, Input, Modal } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import DesignHeaderCard from '../../components/design/DesignHeaderCard'
import SectionNav from '../../components/ds/SectionNav'
import { DESIGN_SECTIONS, defaultSectionKey } from '../../configs/sections'
import { useTab } from '../../hooks/useTab'
import MySubmitsCard from '../../components/design/MySubmitsCard'
import DrawingsCard from '../../components/design/DrawingsCard'
import BomStdCard from '../../components/design/BomStdCard'
import BomMaterialCard from '../../components/design/BomMaterialCard'
import ProgramsCard from '../../components/design/ProgramsCard'
import DrawingsModals from '../../components/design/DrawingsModals'
import ProgramsModals from '../../components/design/ProgramsModals'
import ReviewDetailModal from '../../components/ReviewDetailModal'
import SubmitReviewModal from '../../components/SubmitReviewModal'
import ChangeRequestModal from '../../components/ChangeRequestModal'

import { addBom, addDrawing, createProgram, deleteProgram, errMsg, getDesignTree, getMyDesignTasks, listPrograms, listProgramVersions, listStdItems, listVersions, me, newDrawingVersion, newProgramVersion, uploadProgramDraft, updateDrawing, type DesignRoot, type DesignTree, type MyDesignTask, type ProgramItem, type ProgramVersionRow, type StdItem, type User, type VersionRow } from '../../api/client'

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
  // ★ P3：设计面分区进 URL（`?tab=`）
  const [tab, setTab] = useTab(DESIGN_SECTIONS.map((x) => x.key), defaultSectionKey(DESIGN_SECTIONS))

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
    let v
    try { v = await addForm.validateFields() } catch { return }
    // 哨兵值 __ROOT__ = 挂在设备总装下（不传父级，后端自动创建总装图）
    const parentRef = v.parent_drawing_no === '__ROOT__' ? undefined : v.parent_drawing_no
    if (v.kind === '标准件' && !parentRef) {
      message.warning('标准件要挂在某张图纸下，请先新增一张自制件图纸')
      return
    }
    setSaving(true)
    try {
      if (v.kind === '标准件') {
        await addBom(projectNo, 'std', {
          parent_ref: parentRef,
          child_item_no: v.child_item_no,
          qty: v.qty ?? 1,
        })
        message.success('标准件已挂上（从标准库引用，不出图）')
      } else {
        const d = await addDrawing(projectNo, equipNo, {
          parent_drawing_no: parentRef,
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
    let v
    try { v = await matForm.validateFields() } catch { return }
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

  const doRename = async (drawingNo: string, title: string) => {
    try {
      await updateDrawing(drawingNo, { title })
      message.success('已改名')
      await load()
    } catch (e) {
      message.error(errMsg(e))
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
    let v
    try { v = await progForm.validateFields() } catch { return }
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
    let v
    try { v = await progUploadForm.validateFields() } catch { return }
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
            // ★ 总装图还没建时用哨兵值：提交时不传父级，后端会自动创建总装图（P-01）
            value: root.exists ? root.drawing_no : '__ROOT__',
            label: `${root.equip_no} ${root.title}（${root.exists ? root.drawing_no : '新增后自动创建'}）`,
          },
        ]
      : []),
    ...rows
      .filter((r) => r.level < 4)
      // ★ 走查 2026-10-04 P3：总装图已在上面单独列了一项，而 `rows`（design tree）里**也含总装图**
      //   → 会生成两个同 value 的选项 → React「Encountered two children with the same key」告警
      //   （选项可能被吞/重复）。这里把总装图从 rows 分支里排掉，它只保留第一项那个「挂在总装下」的入口。
      .filter((r) => !(root?.exists && r.drawing_no === root.drawing_no))
      .map((r) => ({
        value: r.drawing_no,
        label: `${'　'.repeat(r.level)}└ ${r.drawing_no} ${r.title}`,
      })),
  ]

  return (
    <>
      {/* 顶部：完整度 + 待办 */}
      {!embedded && (
      <DesignHeaderCard data={data} equipNo={equipNo} nav={nav} projectNo={projectNo} root={root} />
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
      <MySubmitsCard myTasks={myTasks} setDetailOpen={setDetailOpen} setDetailTicketId={setDetailTicketId} setReviewOpen={setReviewOpen} setReviewTask={setReviewTask} />
      )}
      {/* ★ 提交评审是按「任务的负责人」做的：你在这台设备上没有设计任务时
          （典型是管理员/其他专业的人来看），就看不到「我的提交」入口，
          容易以为「东西填完了却不能发布」。说清楚该换谁操作。 */}
      {!loading && myTasks.length === 0 && (data?.counts.drawings ?? 0) > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="你在这台设备上没有设计任务，不能在这里提交评审"
          description="提交评审是按「任务的负责人」做的 —— 请用这台设备对应专业的负责人账号（机械/电气/程序/工艺经理）登录，把图纸文件传齐后再提交评审、发布（冻结）。发布后 BOM 才计入采购。"
        />
      )}

      {/* 图纸树 */}

      {/* ── 分区：图纸与 BOM / 标准件 / 原材料 / PLC 程序（docs/14 P3）──
          原来 4 张卡纵向堆（1079px），现在横向切；设计面头部「设备档案」入口与结论保持常驻 */}
      <SectionNav
        tab={tab}
        onTab={setTab}
        emptyText="这一区还没有内容。"
        sections={[
          {
            key: 'drawing',
            label: '图纸与 BOM',
            badge: rows.length,
            children: (
              <DrawingsCard addForm={addForm} doNewDrawingVersion={doNewDrawingVersion} doRename={doRename} loading={loading} message={message} openVersions={openVersions} profile={profile} root={root} rows={rows} searchItems={searchItems} selected={selected} setAddOpen={setAddOpen} setChangeTarget={setChangeTarget} setMatOpen={setMatOpen} setSelected={setSelected} setSubmitOpen={setSubmitOpen} load={load} />
            ),
          },
          {
            key: 'std',
            label: '标准件',
            badge: data?.counts.std_items,
            children: <BomStdCard data={data} message={message} setChangeTarget={setChangeTarget} load={load} />,
          },
          {
            key: 'material',
            label: '原材料',
            badge: data?.counts.materials,
            children: <BomMaterialCard data={data} message={message} setChangeTarget={setChangeTarget} load={load} />,
          },
          {
            key: 'program',
            label: 'PLC 程序',
            badge: programs.length,
            children: <ProgramsCard doNewProgramVersion={doNewProgramVersion} openProgramVersions={openProgramVersions} profile={profile} programs={programs} removeProgram={removeProgram} setChangeTarget={setChangeTarget} setProgCreateOpen={setProgCreateOpen} setProgUploadOpen={setProgUploadOpen} setProgUploadTarget={setProgUploadTarget} />,
          },
        ]}
      />

      {/* 新增组件/零件 */}
      {/* 生成采购需求（BOM → 净需求 → 进池） */}
      <DrawingsModals addForm={addForm} addOpen={addOpen} doAdd={doAdd} doAddMaterial={doAddMaterial} equipNo={equipNo} items={items} load={load} matForm={matForm} matOpen={matOpen} message={message} parentOptions={parentOptions} rows={rows} saving={saving} searchItems={searchItems} selected={selected} setAddOpen={setAddOpen} setMatOpen={setMatOpen} setSaving={setSaving} setSubmitOpen={setSubmitOpen} setVerOpen={setVerOpen} submitForm={submitForm} submitOpen={submitOpen} verOpen={verOpen} versions={versions} />
      {/* 新建程序 */}
      <ProgramsModals doCreateProgram={doCreateProgram} doUploadProgram={doUploadProgram} equipNo={equipNo} progForm={progForm} progUploadForm={progUploadForm} progCreateOpen={progCreateOpen} progUploadOpen={progUploadOpen} progUploadTarget={progUploadTarget} progVerOpen={progVerOpen} progVerTarget={progVerTarget} progVersions={progVersions} saving={saving} setProgCreateOpen={setProgCreateOpen} setProgUploadOpen={setProgUploadOpen} setProgVerOpen={setProgVerOpen} />

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

