import { lazy } from 'react'
import { useLocation } from 'react-router-dom'

import HomeRedirect from '../../components/domain/HomeRedirect'

/**
 * 三个「纯落地页」的宿主（2026-10-05）
 * ──────────────────────────────────────────────────────────────────────────
 * 原来这里还渲染**「我的工作台」聚合页**（收件箱：我的任务 / 待我审 / 待采购 / 待验收…），
 * 客户已明确取消该入口：
 *   ① 它与各部门台**内容重叠** —— 实测 wh1：聚合页「待验收 10」= 仓库台「待验收 10」，
 *      同一批事两个入口（而且台条角标还会再报一次，同一个数屏幕上出现三遍）；
 *   ② 它是**按员工视角**做的，没有按岗位分层 —— 总监进去第一眼也是组员那一层
 *      （客户原话：「我总监进来之后应该到顶层了呀」）。
 * 现在改为**每个台 = 我的任务 + 我要看到的**，默认落点与页签顺序随岗位变
 * （`configs/boards.ts::defaultTabFor` / `orderTabsFor`）。
 *
 * ⚠ 但这三个**子路径必须留着**：`/workbench/tasks|reviews|changes` 是
 *   ①站内消息的 link 落点（有评审单等你审核 → 跳这里）②旧书签
 *   ③`ROUTE_REDIRECTS` 的 `/my-tasks` `/reviews` `/changes` 旧路径目标。
 *   断掉它们 = 通知点不开。所以它们保留为**纯落地页**（不进台条、不进侧栏）。
 */
const MyTasks = lazy(() => import('../task/Page'))
const Reviews = lazy(() => import('../review/Page'))
const Changes = lazy(() => import('../change/Page'))

export default function Workbench() {
  const loc = useLocation()
  const seg = loc.pathname.replace(/^\/workbench\/?/, '')
  if (seg === 'tasks') return <MyTasks />
  if (seg === 'reviews') return <Reviews />
  if (seg === 'changes') return <Changes />
  // 根路径 `/workbench` 理论上已由 App.tsx 交给 HomeRedirect；这里兜底同一行为（不渲染聚合页）
  return <HomeRedirect />
}
