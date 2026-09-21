import { Alert, App, Button, Card, Col, Row, Space, Statistic, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { errMsg, workbenchMe, type WorkbenchMe } from '../../api/client'

type CountKey = keyof WorkbenchMe['counts']

interface Cfg {
  title: string
  note?: string
  todos: { label: string; key: CountKey; to: string }[]
  quick: { label: string; to: string }[]
}

const CONFIG: Record<string, Cfg> = {
  sales: {
    title: '商务部工作台',
    note: '商机 → 成交 → 待立项。跟进、报价、合同与回款都从这里进。',
    todos: [
      { label: '我的商机（线索/待立项）', key: 'my_leads', to: '/projects' },
      { label: '我参与的项目', key: 'my_projects', to: '/projects' },
    ],
    quick: [
      { label: '商机 / 项目', to: '/projects' },
      { label: '新建商机', to: '/projects/new' },
    ],
  },
  pm: {
    title: '项目经理台',
    note: '我负责的项目全链进度：立项 → 设计 → 采购 → 到货/入库 → 缺料。',
    todos: [
      { label: '我参与的项目', key: 'my_projects', to: '/projects' },
      { label: '我的任务', key: 'my_tasks', to: '/my-tasks' },
      { label: '待我审核', key: 'to_review', to: '/reviews' },
    ],
    quick: [
      { label: '商机 / 项目', to: '/projects' },
      { label: '采购池', to: '/purchase' },
      { label: '仓库', to: '/warehouse' },
    ],
  },
  eng: {
    title: '工程部工作台',
    note: '成员 / 组长 / 部门负责人 三视角：待我处理、我负责的、部门看板（详细看板在 D 步补齐）。',
    todos: [
      { label: '我的任务', key: 'my_tasks', to: '/my-tasks' },
      { label: '待我审核', key: 'to_review', to: '/reviews' },
      { label: '待我改版', key: 'to_change', to: '/changes' },
      { label: '待我裁决', key: 'to_decide', to: '/changes' },
      { label: '我提的改版', key: 'my_changes', to: '/changes' },
    ],
    quick: [
      { label: '我的任务', to: '/my-tasks' },
      { label: '设计评审', to: '/reviews' },
      { label: '改版', to: '/changes' },
      { label: '项目 / 设备设计', to: '/projects' },
    ],
  },
  shop: {
    title: '车间工作台',
    note: '制造 / 装配 / 发运（S5–S7）还没做，这里先留位；车间由联络小组统一录入，一线人员不登录。',
    todos: [{ label: '待领料', key: 'issues', to: '/m/issues' }],
    quick: [
      { label: '领料（手机端）', to: '/m/issues' },
      { label: '仓库工作台', to: '/warehouse' },
    ],
  },
}

/** 部门工作台（06 卷 §8）：先给统一外壳（待我处理 / 我负责的 / 范围看板） */
export default function DeptWorkbench({ kind }: { kind: 'sales' | 'pm' | 'eng' | 'shop' }) {
  const cfg = CONFIG[kind]
  const { message } = App.useApp()
  const nav = useNavigate()
  const [data, setData] = useState<WorkbenchMe | null>(null)

  useEffect(() => {
    workbenchMe()
      .then(setData)
      .catch((e) => message.error(errMsg(e)))
  }, [message])

  const c = data?.counts
  const tabs = (data?.workbenches ?? []).filter((w) => w.visible)

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {cfg.title}
          </Typography.Title>
          <Space wrap>
            {tabs.map((w) => (
              <Tag
                key={w.key}
                color={w.route.includes(kind) || (kind === 'sales' && w.key === 'sales') ? 'blue' : 'default'}
                style={{ cursor: 'pointer' }}
                onClick={() => nav(w.route)}
              >
                {w.name}
              </Tag>
            ))}
          </Space>
        </Space>
      </Card>

      {cfg.note && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={cfg.note} />}

      <Typography.Text strong>待我处理</Typography.Text>
      <Row gutter={[12, 12]} style={{ marginTop: 8 }}>
        {cfg.todos.map((t) => (
          <Col xs={12} sm={8} md={6} lg={4} key={t.label}>
            <Card size="small" hoverable onClick={() => nav(t.to)} style={{ textAlign: 'center' }}>
              <Statistic
                title={t.label}
                value={c?.[t.key] ?? 0}
                valueStyle={{ fontSize: 22, color: (c?.[t.key] ?? 0) ? '#1f6feb' : '#bbb' }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Card size="small" title="我负责的 / 范围看板" style={{ marginTop: 12 }}>
        <Space wrap>
          {cfg.quick.map((q) => (
            <Button key={q.to} onClick={() => nav(q.to)}>
              {q.label}
            </Button>
          ))}
        </Space>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          范围按岗位自动过滤（成员=本人 / 组长=本组 / 部门负责人=本部门）。详细看板随 06 卷 §11 D/E 步补齐。
        </Typography.Paragraph>
      </Card>
    </>
  )
}
