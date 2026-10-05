import SectionNav from '../../components/ds/SectionNav'
import { INITIATE_SECTIONS, defaultSectionKey } from '../../configs/sections'
import { useTab } from '../../hooks/useTab'
import { Chip } from '../../components/ds'
import { toneOf } from '../../theme/status'
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Row,
  Space,
  Spin,
  Table,
  Typography,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { EquipmentEditor, LongLeadEditor, MilestoneEditor, TeamEditor } from '../../components/InitiationEditors'
import { errMsg, generateMilestones, generateTasks, listProjectTasks, type TaskItem, getProjectDetail, initiateProject, listEquipment, listMembers, listMilestones, listPurchaseRequests, listUsers, type EquipmentItem, type MilestoneItem, type ProjectDetail, type PurchaseRequestItem } from '../../api/client'
import { useBack, useGoFrom } from '../../hooks/useFrom'

/**
 * 立项（00 卷 §3 S1）：项目组全体会议要定的三件事
 *   ① 统一理解 → 项目团队任命
 *   ② 任务分配 → 设备清单（01A/02A… 各是什么设备）
 *   ③ 节点时间段 → 里程碑计划
 *   ＋ 长周期采购 → 立项即下单
 */
export default function ProjectInitiate() {
  const { projectNo = '' } = useParams()
  const nav = useNavigate()
  const go = useGoFrom()
  // ★ docs/11：从台里点进来的，返回口要回**那个台**（并回到原来那个页签）；没有来源时行为完全不变
  const back = useBack(`/projects/${projectNo}`, '← 返回项目')
  const { message } = App.useApp()

  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [users, setUsers] = useState<{ id: number; name: string }[]>([])
  const [equipment, setEquipment] = useState<EquipmentItem[]>([])
  const [milestones, setMilestones] = useState<MilestoneItem[]>([])
  const [members, setMembers] = useState<{ id: number; project_role: string }[]>([])
  const [requests, setRequests] = useState<PurchaseRequestItem[]>([])
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [professions, setProfessions] = useState<string[]>(['机械', '电气', '程序', '工艺'])
  const [withPurchase, setWithPurchase] = useState(true)
  const [genLoading, setGenLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  // ★ P4：分区（= 步骤）进 URL
  const [tab, setTab] = useTab(INITIATE_SECTIONS.map((x) => x.key), defaultSectionKey(INITIATE_SECTIONS))

  const load = useCallback(async () => {
    if (!projectNo) return
    setLoading(true)
    try {
      const [d, u, e, m, mem, pr, tk] = await Promise.all([
        getProjectDetail(projectNo),
        listUsers(),
        listEquipment(projectNo),
        listMilestones(projectNo),
        listMembers(projectNo),
        listPurchaseRequests(projectNo),
        listProjectTasks(projectNo),
      ])
      setDetail(d)
      setUsers(u)
      setEquipment(e)
      setMilestones(m)
      setMembers(mem)
      setRequests(pr)
      setTasks(tk)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [projectNo, message])

  useEffect(() => {
    void load()
  }, [load])

  const notOrdered = requests.filter((r) => r.is_long_lead && !r.ordered_at)
  const unassigned = tasks.filter((t) => !t.owner_id)

  const doGenerateTasks = async () => {
    setGenLoading(true)
    try {
      const r = await generateTasks(projectNo, {
        professions,
        with_purchase: withPurchase,
      })
      message.success(`生成 ${r.created} 条任务`)
      if (r.unassigned.length) {
        message.warning(
          `有 ${r.unassigned.length} 条没指派到人 —— 先到「用户与权限」里把各专业经理配好，再点一次生成`,
        )
      }
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setGenLoading(false)
    }
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      const r = await initiateProject(projectNo)
      message.success(
        `立项完成：设备 ${r.equipment_count} 台 · 节点 ${r.milestone_count} 个 · 团队 ${r.member_count} 人 · 任务 ${r.task_count} 条已分派`,
      )
      // ★ 来源优先：立项完成后的详情页也要继续带来源（否则它的返回口会回默认项目列表）
      go(`/projects/${projectNo}`)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin />
      </div>
    )
  }

  const p = detail?.project
  const checklist = [
    { ok: members.length > 0, text: `项目团队（已任命 ${members.length} 个角色）` },
    { ok: equipment.length > 0, text: `设备清单（已定 ${equipment.length} 台设备）` },
    { ok: milestones.length > 0, text: `节点计划（已定 ${milestones.length} 个节点）` },
    {
      ok: tasks.length > 0 && unassigned.length === 0,
      text:
        tasks.length === 0
          ? '任务还没分派（设计派给各专业经理，采购派给采购员）'
          : unassigned.length
            ? `${unassigned.length} 条任务没指派负责人`
            : `任务已分派（${tasks.length} 条到人）`,
    },
    {
      ok: notOrdered.length === 0,
      text:
        notOrdered.length === 0
          ? `长周期件（${requests.length} 项，全部已下单）`
          : `长周期件：${notOrdered.map((r) => r.item_name).join('、')} 还没下单（建议立项前就下单）`,
      warnOnly: true,
    },
  ]

  return (
    <>
      {/* ── 常驻区（切分区不动）：能不能立项的结论 + 确认按钮 ──────────────
          原来是页首一张 Card，往下滑 2.6 屏才看到 ①…⑤ —— 现在它在最上面、切区不动 */}
      <div className="ds-panel" style={{ marginBottom: 16 }}>
        <div className="ds-panel-b">
        <Row align="middle">
          <Col flex="auto">
            <Space size={8}>
              <a onClick={() => nav(back.to)}>{back.label}</a>
              <Typography.Text strong style={{ fontSize: 16 }}>
                立项 · {projectNo}
              </Typography.Text>
              <Typography.Text>{p?.project_name}</Typography.Text>
              <Chip tone="warn">{p?.stage}</Chip>
            </Space>
            <div style={{ marginTop: 6 }}>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                项目组全体会议要定的三件事：① 统一理解 ② 任务分配（设备）③ 节点时间段；
                长周期件立项就下单
              </Typography.Text>
            </div>
          </Col>
          <Col>
            <Space direction="vertical" align="end" size={4}>
              {checklist.map((c, i) => (
                <Typography.Text
                  key={i}
                  type={c.ok ? 'success' : c.warnOnly ? 'warning' : 'danger'}
                  style={{ fontSize: 12 }}
                >
                  {c.ok ? '✓' : '○'} {c.text}
                </Typography.Text>
              ))}
              <Button
                type="primary"
                loading={submitting}
                disabled={
                !members.length ||
                !equipment.length ||
                !milestones.length ||
                !tasks.length ||
                unassigned.length > 0
              }
                onClick={() => void submit()}
              >
                确认立项（进入执行中）
              </Button>
            </Space>
          </Col>
        </Row>
        </div>
      </div>

      {notOrdered.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`有 ${notOrdered.length} 项长周期件还没下单`}
          description={`${notOrdered
            .map((r) => r.item_name)
            .join('、')} —— 这类件不备货、周期长，立项阶段就该把单下给采购，否则会拖死交期。`}
        />
      )}

      {/* ── 分区：①–⑤（docs/14 P4）—— 表单页的"分区"就是**步骤导航**，
          原来 ①…⑤ 一路往下摆（2297px = 2.6 屏），现在横向切、提交按钮在常驻区 ── */}
      <SectionNav
        tab={tab}
        onTab={setTab}
        emptyText="这一步还没有内容。"
        sections={[
          { key: 'team', label: '① 项目团队', badge: members.length, children: <TeamEditor projectNo={projectNo} users={users} onChanged={load} /> },
          { key: 'equipment', label: '② 设备清单', badge: equipment.length, children: <EquipmentEditor projectNo={projectNo} onChanged={load} /> },
          {
            key: 'milestone',
            label: '③ 节点计划',
            badge: milestones.length,
            children: (
              <>
      <Card
        size="small"
        title="③ 节点计划（每个节点的时间段）"
        extra={
          milestones.length === 0 ? (
            <Button
              size="small"
              type="primary"
              onClick={() =>
                void generateMilestones(projectNo)
                  .then((r) => {
                    message.success(`已生成 ${r.created.length} 个标准节点，日期请按实际情况填`)
                    return load()
                  })
                  .catch((e) => message.error(errMsg(e)))
              }
            >
              一键生成标准节点
            </Button>
          ) : null
        }
        style={{ marginBottom: 16 }}
      >
        <MilestoneEditor projectNo={projectNo} users={users} onChanged={load} />
      </Card>
              </>
            ),
          },
          {
            key: 'longlead',
            label: '④ 长周期采购',
            children: (
              <>
      <Card size="small" title="④ 长周期采购（立项即下单）" style={{ marginBottom: 16 }}>
        <LongLeadEditor projectNo={projectNo} onChanged={load} />
      </Card>
              </>
            ),
          },
          {
            key: 'tasks',
            label: '⑤ 任务分派',
            badge: tasks.length,
            children: (
              <>
      <Card
        size="small"
        title="⑤ 任务分派（立项后任务开始并行）"
        extra={
          <Space>
            <Checkbox.Group
              value={professions}
              onChange={(v) => setProfessions(v as string[])}
              options={[
                { value: '机械', label: '机械设计' },
                { value: '电气', label: '电气设计' },
                { value: '程序', label: '程序设计' },
                { value: '工艺', label: '工艺（挂机械之后）', disabled: !professions.includes('机械') },
              ]}
            />
            <Checkbox checked={withPurchase} onChange={(e) => setWithPurchase(e.target.checked)}>
              采购任务
            </Checkbox>
            <Button type="primary" size="small" loading={genLoading} onClick={() => void doGenerateTasks()}>
              生成任务
            </Button>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          每台设备 × 勾选的专业 → 一条设计任务，直接派给对应专业的经理（工程部岗位），经理再拆给组员；
          工艺挂在机械之后（机械首次发布即可开工）。每个长周期件 → 一条采购任务。生成后各人在「我的任务」里看到自己的活。
        </Typography.Paragraph>
        <Table<TaskItem>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={tasks}
          locale={{ emptyText: <Empty description="还没生成任务" /> }}
          columns={[
            { title: '任务号', dataIndex: 'task_no', width: 100 },
            {
              title: '类型',
              dataIndex: 'task_type',
              width: 110,
              render: (v: string, r: TaskItem) => (
                <Space size={4}>
                  <Chip tone={toneOf(v === '设计' ? 'blue' : 'gold')}>{v}</Chip>
                  {r.profession && r.profession !== '采购' && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.profession}
                    </Typography.Text>
                  )}
                </Space>
              ),
            },
            { title: '任务', dataIndex: 'title' },
            {
              title: '负责人',
              dataIndex: 'owner_name',
              width: 130,
              render: (v: string | null) =>
                v ?? <Chip tone="err">未指派</Chip>,
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (v: string) => <Chip>{v}</Chip>,
            },
          ]}
        />
      </Card>
              </>
            ),
          },
        ]}
      />

    </>
  )
}
