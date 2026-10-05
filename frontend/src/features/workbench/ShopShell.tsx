import { Outlet } from 'react-router-dom'

/**
 * 车间台权限壳（只剩一件事：`RequirePerm(mfg:view)` 的挂载点）。
 *
 * ★ docs/15 §6-⑤：**三视图条已从这里移走** —— 过去它在 `<Outlet/>` **之上**用 antd card 页签渲染，
 *   是全站唯一一个"页签条跑到标题之上"的台。现在由各视图在**自己台头之后**渲染 `ShopViews`
 *   （位置与其它台的流程条一致）；URL 子路由语义没变。
 */
export default function ShopShell() {
  return <Outlet />
}
