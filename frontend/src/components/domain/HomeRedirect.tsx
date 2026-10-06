import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'

import { workbenchMe, type WorkbenchItem } from '../../api/client'

/**
 * 「我的工作台」取消后的 `/workbench` 中转站（2026-10-05 客户拍板）
 * ──────────────────────────────────────────────────────────────────────────
 * 客户原话：「**我的工作台这个路口不要了**」。理由是它是"按员工视角"做的一套收件箱，
 * 与各部门台**内容重叠**（实测 wh1：我的工作台「待验收 10」= 仓库台「待验收 10」），
 * 而且**没有按岗位分层**（总监进去看到的也是组员那一层）。
 * 现在改成：**每个台 = 我的任务 + 我要看到的**，按岗位分层
 * （默认落点/页签顺序随岗位变，见 `configs/boards.ts::defaultTabFor/orderTabsFor`）。
 *
 * 为什么这里保留一个中转而不是 404：
 *   `/workbench` 有 9 处引用（侧栏入口 / 面包屑 / 登录后默认 / 无权限回退 / 登出跳回…），
 *   逐处改成"第一个台"会把同一个规则抄 9 遍、以后必然漂一处。
 *   这里统一成一句：**跳到我可见的第一个台**（前端已经有 `/workbench/me` 这份清单）。
 *   加载时渲染空而不是闪回 `/login` —— 否则会看到一次登录页抖动。
 */
export default function HomeRedirect() {
  const [route, setRoute] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    workbenchMe()
      .then((d) => {
        if (!alive) return
        const visible = (d.workbenches as WorkbenchItem[]).filter((w) => w.visible)
        // ⚠ **跳过驾驶舱**（`/dashboard`）：它是“看全局”的只读页，不是干活的地方。
        //   超管/admin 命中它时（台清单里 gm 排最前）会直接被送到驾驶舱，台条也不会出现 ——
        //   实测 admin 访问 /workbench 落到 /dashboard 就是这个原因。
        //   所以：优先第一个**业务台**；真只有一个驾驶舱时再用它。
        const biz = visible.find((w) => w.route !== '/dashboard')
        const first = biz ?? visible[0]
        if (first) setRoute(first.route)
        else setFailed(true)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  if (route) return <Navigate to={route} replace />
  // 一个台都看不到（角色没配）→ 去项目列表（仍然只读，不会 403）
  if (failed) return <Navigate to="/projects" replace />
  return <div className="ds-page" />
}
