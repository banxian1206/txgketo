import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { workbenchMe } from '../api/client'

/**
 * 「我是从哪个台进来的」—— 导航上下文（体检见 docs/11）。
 *
 * 病根：这一维**过去根本不存在**。侧栏选中只能由 `matchSidebarKey(pathname)` 按路径前缀反推，
 * 于是从商务部工作台点项目行 → URL 变 `/projects/TX…` → 侧栏被「项目」抢走、
 * 台 Tab 条整条消失、返回口变成「← 返回列表」（把人彻底踢出自己的台）。
 *
 * 为什么放 URL 而不是 router state：刷新 / 收藏 / 新标签 / 站内消息 都要还在，
 * 而且能被 e2e 直接断言（state 断言不到）。
 *
 * 约定：`?from=<编码后的来源路径，含它自己的 query>`，例如
 *   /projects/TX26003?from=%2Fpurchase%3Ftab%3Dorders
 */
export const FROM_PARAM = 'from'

/** 在台上（或任何页）跳去别处时用它代替 `nav(path)`：自动把当前 URL 记成来源 */
export function useGoFrom() {
  const nav = useNavigate()
  const loc = useLocation()
  return useCallback(
    (path: string) => {
      const origin = loc.pathname + loc.search
      const sep = path.includes('?') ? '&' : '?'
      nav(`${path}${sep}${FROM_PARAM}=${encodeURIComponent(origin)}`)
    },
    [nav, loc.pathname, loc.search],
  )
}

/** 目标页读来源（无来源 = 直达/从列表进，保持原有行为） */
export function useFrom(): string | null {
  const [sp] = useSearchParams()
  const raw = sp.get(FROM_PARAM)
  return raw ? decodeURIComponent(raw) : null
}

export type BackInfo = { to: string; label: string; hasFrom: boolean }

/**
 * 返回口：有来源 → 「← 返回某某工作台」（并回到**原来那个页签**，因为来源 URL 自带 query）；
 * 无来源 → 退回页面自己的默认文案（如「← 返回列表」），行为完全不变。
 *
 * @param fallbackTo   没有来源时去哪（保持各页原有行为）
 * @param fallbackLabel 没有来源时的文案
 * 台清单由 hook 内部**按需自取**（有 from 才取）：不做模块级缓存 ——
 * 那份缓存会跨账号脏读（切换用户/伪装后拿到别人的台名）。
 */
export function useBack(fallbackTo: string, fallbackLabel = '← 返回列表'): BackInfo {
  const from = useFrom()
  const [benches, setBenches] = useState<{ name: string; route: string }[]>([])
  useEffect(() => {
    if (!from) return
    workbenchMe()
      .then((d) => setBenches((d.workbenches ?? []).filter((w) => w.visible).map((w) => ({ name: w.name, route: w.route }))))
      .catch(() => undefined)
  }, [from])
  return useMemo(() => {
    if (!from) return { to: fallbackTo, label: fallbackLabel, hasFrom: false }
    const hit = benches.find(
      (w) => from === w.route || (w.route !== '/workbench' && from.startsWith(w.route + '/')),
    )
    const name = hit?.name ?? guessName(from)
    return { to: from, label: name ? `← 返回${name}` : '← 返回上一步', hasFrom: true }
  }, [from, fallbackTo, fallbackLabel, benches])
}

/** 来源不是台（例如从某个列表页过来）时，至少给个可读的文案 */
function guessName(from: string): string | null {
  if (from.startsWith('/projects')) return '项目列表'
  if (from.startsWith('/library')) return '基础数据'
  if (from.startsWith('/admin')) return '用户与权限'
  return null
}

/** 侧栏/台条的「当前上下文」= 有来源看来源，否则看当前路径 */
export function contextPath(pathname: string, search: string): string {
  const m = new URLSearchParams(search).get(FROM_PARAM)
  return m ? decodeURIComponent(m) : pathname
}
