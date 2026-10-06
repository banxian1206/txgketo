import { App, Button, Space } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { errMsg, workbenchMe, type WorkbenchMe } from '../../api/client'
import { Metrics, PageHead, Panel } from '../../components/ds'
import ShopViews from '../../components/domain/ShopViews'

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
      { label: '我的任务', key: 'my_tasks', to: '/workbench/tasks' },
      { label: '待我审核', key: 'to_review', to: '/workbench/reviews' },
    ],
    quick: [
      { label: '商机 / 项目', to: '/projects' },
      { label: '采购池', to: '/purchase' },
      { label: '仓库', to: '/warehouse' },
    ],
  },
  eng: {
    title: '工程部工作台',
    note: '组员 / 经理 / 总监 三视角：待我处理、我负责的、部门看板。',
    todos: [
      { label: '我的任务', key: 'my_tasks', to: '/workbench/tasks' },
      { label: '待我审核', key: 'to_review', to: '/workbench/reviews' },
      { label: '待我改版', key: 'to_change', to: '/workbench/changes' },
      { label: '待我裁决', key: 'to_decide', to: '/workbench/changes' },
      { label: '我提的改版', key: 'my_changes', to: '/workbench/changes' },
    ],
    quick: [
      { label: '我的任务', to: '/workbench/tasks' },
      { label: '设计评审', to: '/workbench/reviews' },
      { label: '改版', to: '/workbench/changes' },
      { label: '项目 / 设备设计', to: '/projects' },
    ],
  },
  shop: {
    title: '车间工作台',
    note: '制造（S5）：下发（原材料 + 图纸，拍照）→ 到职验收（拍照）→ 转运装配区（拍照）。装配（S6）：齐套率只展示，随时可开工。只管两头，不做工序级报工。',
    todos: [
      { label: '待下发排产单', key: 'shop_wait', to: '/workbench/shop/mfg' },
      { label: '在制 / 待验收', key: 'shop_accept', to: '/workbench/shop/mfg' },
      { label: '待转运装配区', key: 'shop_transfer', to: '/workbench/shop/mfg' },
      { label: '装配中', key: 'shop_assembling', to: '/workbench/shop/assembly' },
      { label: '待厂内调试', key: 'shop_debug', to: '/workbench/shop/assembly' },
      // ★ 2026-10-05 走查去掉了第 6 格「待领料」：① 结论条规格是 ≤5；
      //   ② 领料单是**仓库台**的队列（`?tab=issues`，铁律「一件事只在一个台成队列」），
      //   车间台再摆一份 = 车间以为自己去领料（点过去还是仓库台，徒增一次点击）。
    ],
    quick: [
      { label: '制造（车间）', to: '/workbench/shop/mfg' },
      { label: '装配 · 齐套率', to: '/workbench/shop/assembly' },
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

  return (
    <>
      <div className="ds-page">
      <PageHead
        title={cfg.title}
        sub={cfg.todos.map((t) => `${t.label} ${c?.[t.key] ?? 0}`).join(' · ')}
        help={`${cfg.note ?? ''} 范围按岗位自动过滤（组员=本人 / 经理=本组 / 总监=本部门）。`}
      />
      <Metrics
        items={cfg.todos.map((t) => ({
          key: String(t.key),
          label: t.label,
          value: c?.[t.key] ?? 0,
          unit: '项',
          tone: (c?.[t.key] ?? 0) > 0 ? ('run' as const) : undefined,
          dimZero: true,
          onClick: () => nav(t.to),
        }))}
      />
      {/* ★ docs/15 §6-⑤：视图条在**结论条之后**（与其它台的流程条同位置） */}
      {kind === 'shop' && <ShopViews />}

      <Panel title="其余看板" sub="去对应的队列按流程干活">
        <Space wrap>
          {cfg.quick.map((q) => (
            <Button key={q.to} onClick={() => nav(q.to)}>
              {q.label}
            </Button>
          ))}
        </Space>
      </Panel>
      </div>
    </>
  )
}
