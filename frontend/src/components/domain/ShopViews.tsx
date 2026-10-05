import { Segmented } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * 车间台的三视图切换（看板 / 制造 / 装配）。
 *
 * 为什么单独抽出来（docs/15 §6-⑤）：这三个视图过去由 `ShopShell` 在**页面之上**用 antd
 * `type="card"` 页签渲染 → 全站唯一一个"页签条跑到标题之上"的台，和别处的「台头 → 结论条 →
 * 流程条 → 体」正好相反。
 *
 * 现在改成：**每个视图各自在自己台头之后渲染这一条**（位置与其它台的流程条一致），
 * 形态用 `ds-subtabs` 的 Segmented（不再用 card 页签）。
 *
 * ⚠ URL 语义不变：三个视图仍是**子路由**（`/workbench/shop`、`/workbench/shop/mfg`、
 * `/workbench/shop/assembly`）—— 通知 link / `ROUTE_REDIRECTS` / 书签全靠它，一个都没改。
 * （这也正是它**不并进 `WorkbenchPage`** 的原因：那几个视图是三个页面，
 *   不是同一页里的三个分区；合并需要先把它们拆成"体"，见 docs/15 §6-⑤。）
 */
const VIEWS = [
  { key: 'shop', label: '看板' },
  { key: 'mfg', label: '制造' },
  { key: 'assembly', label: '装配' },
] as const

export default function ShopViews() {
  const loc = useLocation()
  const nav = useNavigate()
  const active = loc.pathname.endsWith('/mfg') ? 'mfg' : loc.pathname.endsWith('/assembly') ? 'assembly' : 'shop'
  return (
    <div className="ds-subtabs shop-views">
      <Segmented
        value={active}
        onChange={(k) => nav(k === 'shop' ? '/workbench/shop' : `/workbench/shop/${k}`)}
        options={VIEWS.map((v) => ({ value: v.key, label: v.label }))}
      />
      <span className="hint">车间只管两头：下任务 + 验收零件</span>
    </div>
  )
}
