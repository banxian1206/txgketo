import { useCallback, useEffect, useRef } from 'react'

import { Segmented } from 'antd'

import type { SectionDef } from '../../configs/sections'
import { badgeText } from '../../configs/sections'
import type { TabGroup } from '../../configs/tabs'

/**
 * 分区壳（docs/14 · P1）：**一页多区、横向切**，替代"卡片一个个往下摆"。
 *
 * 用法（页面的"结论常驻区"自己放在它上面，切区时不动）：
 * ```tsx
 * <PageHead ... />            // 标题 / 状态 / 主操作        ← 常驻
 * <Metrics items={...} />     // 关键数字（跨区对比靠它）    ← 常驻
 * <div>⚠ 卡点…</div>          // 最要紧的一句              ← 常驻
 * <SectionNav sections={secs} tab={tab} onTab={setTab} />
 * ```
 *
 * ★ 2026-10-05（docs/15）：**这一条也是"台内流程条"的唯一实现** —— 过去台类页用
 * `WorkbenchTabs`（另一套：antd Tabs + Segmented），详情页用本组件，**两套并行**是
 * "每个工作台都不一样"的根因。现在合成一条：多传一个 `groups` 即可支持两层
 * （组 + 组内项），且 **≤4 项时不分层**（少一层点击）。
 *   协议：`groups` 不传 → 单层，与旧行为**逐像素一致**（详情页/档案页零改动）。
 *
 * 四条实现约定（护栏盯着）：
 *   · 分区条**不是**下划线 Tab —— 一屏只允许一条页签条（台类页已占），分区条是更轻的一档
 *   · **不嵌套**：分区内容里不许再出现视图切换
 *   · **空分区保留**：`children` 为空时显示统一的"还没有记录"，不隐藏分区
 *   · 切区**回到内容顶部**（不记住上一区滚动位置，免得"点开了不知道在哪"）
 */
export default function SectionNav({
  sections,
  tab,
  onTab,
  emptyText = '这一区还没有记录。',
  keepMounted = false,
  barOnly = false,
  groups,
  variant = 'section',
  flowSize = 'default',
}: {
  sections: SectionDef[]
  tab: string
  onTab: (key: string) => void
  /** 空分区的兜底文案（页面可覆盖） */
  emptyText?: string
  /**
   * 切换器形态：
   *   · `section`（默认）= 详情页「分区条」：浅色按钮行（`ds-sec`），比台条轻一档
   *   · `flow`         = 台内「流程条」：**一律胶囊 Segmented**（第 1 级 default、第 2 级 small）
   *
   * ★ 为什么要分（2026-10-05 客户实测"采购车间、仓库现场的 tab 样式不一样"）：
   *   台内切换器过去是**两种组件混用** —— >4 项的台第 1 级走 antd 下划线 Tabs、≤4 项的台
   *   走浅色按钮行；同一屏里既有"下划线"又有"胶囊"，看着就不是一套。
   *   现在台内**只用胶囊**，层级靠尺寸区分；详情页分区条保持"更轻一档"（不与台条抢）。
   */
  variant?: 'section' | 'flow'
  /** flow 形态下的尺寸：`small` = 第 2 级（页面自己还有一条更重的视图条时用） */
  flowSize?: 'default' | 'small'
  /**
   * 两层流程条（台类页）：>4 项时先出"组"，组内再出"项"；≤4 项时调用方不该传它。
   * ⚠ tab key 语义不变（组只是**多一层选择**，不改 key、不改 `?tab=`）。
   */
  groups?: TabGroup[]
  /**
   * ★ **表单页专用**：所有分区内容都保持挂载，只把非当前区**藏起来**（display:none）。
   *   为什么：antd Form 的字段一旦卸载就丢值 —— 切个步骤把已填的字段清空，是灾难。
   *   代价：隐藏区的校验错误看不见 → 所以表单页提交失败时要**自动跳到第一个出错的区**
   *   （页面用 `data-section` 找错误归属，见 CreatePage）。
   */
  keepMounted?: boolean
  /** 只要分区条、不要内容区（表单页：内容由页面自己渲染并保持挂载） */
  barOnly?: boolean
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  // ★ 2026-10-05：页签条已**全部平铺**（组名不再当可点胶囊，也不再画小标题），
  //   所以 `groups` 只用来决定“要不要渲染这条页签条”，不再用来算当前组。
  const grouped = groups && groups.length > 0
  const active = sections.find((s) => s.key === tab) ?? sections[0]

  // 切区：滚到内容顶部（只动内容区，不动整页）
  const go = useCallback(
    (key: string) => {
      onTab(key)
      bodyRef.current?.scrollIntoView({ block: 'nearest' })
    },
    [onTab],
  )

  // ←/→ 切区（与 ⌘K 命令栏一致的操作习惯）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const i = sections.findIndex((s) => s.key === active?.key)
      if (i < 0) return
      const next = e.key === 'ArrowRight' ? sections[i + 1] : sections[i - 1]
      if (next) {
        e.preventDefault()
        go(next.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sections, active?.key, go])

  if (!sections.length) return null
  // 只有一个分区时不画条（避免"为一条内容摆一排按钮"）
  if (sections.length === 1 && !grouped) {
    return <div className="ds-sec-body">{renderBody(sections[0], emptyText)}</div>
  }
  // 两层形态：**组行只做分段小标题（不可点）+ 全部页签平铺成一行可点的队列**
  // ★ 2026-10-05 客户实测 bug：“点『待办』没有任何反应，但『待我审批』明明有 3 单”。
  //   根因：组也是一排可点胶囊，点它 = “跳到组内第一个”——而人已经在那一组时
  //   **URL 与内容都不变** = 死路，于是用户以为“没展示”。
  //   客户要求：**“待办这里应该就是我的三条待审批的采购单”**——
  //   即“待办”与“待我审批”在心里是同一件事，不该拆成两个名字让人选两遍。
  //   于是：**组名降为灰色分段小标题（纯说明、不可点），所有队列平铺一行、带待办数**。
  //   好处：① 不再有“点了没反应”的死路；② 全站只准**一行可点标签**（页签条唯一，行为统一，
  //   符合 TAB-一屏一条页签条）；③ 不用点两遍就到队列；④ 组名仍保留分段信息。
  if (grouped) {
    // ★ 数字**只拼一次**：`WorkbenchPage` 传进来的 `s.label` 已经过 `tabLabel(t, counts)` 处理
    //   （`待我审批 (3)`）。第一版我在 `labelOf` 里又拼了一次 → 屏上出现「待我审批 (3) (3)」。
    const labelOf = (s?: (typeof sections)[number]) => s?.label ?? ''
    return (
      <>
        {/* ★ 页签已全部平铺（带待办数），**不再画组名**。
            原先那个“组”是另一排可点胶囊，点它 = 跳到组内第一个 —— 人已在该组时 URL 与内容
            都不变 = 死路（客户实测“点『待办』没反应”）。降级成小标题后它又会**随当前页签变**
            （切到采购池就写“采购”），反而像可点、也是纯噪音 —— 所以直接去掉。
            `groups` 仍留在注册表里：① 顺序上保证待办类在前 ② e2e 静态护栏按它核对键集合。 */}
        <div className="ds-subtabs is-flow">
          <Segmented
            size={flowSize === 'small' ? 'small' : undefined}
            value={active?.key}
            onChange={(k) => go(String(k))}
            options={sections.map((s) => ({ value: s.key, label: labelOf(s), key: s.key }))}
          />
        </div>
        <div className="ds-sec-body" ref={bodyRef}>
          {renderBody(active, emptyText)}
        </div>
      </>
    )
  }
  // flow：单层也画胶囊（与台内其它行同款）
  if (variant === 'flow') {
    const bar2 = (
      <div className="ds-subtabs is-flow">
        <Segmented
          size={flowSize === "small" ? "small" : undefined}
          value={active?.key}
          onChange={(k) => go(String(k))}
          options={sections.map((x) => ({ value: x.key, label: x.label, key: x.key /* 数字已由 WorkbenchPage 的 tabLabel(t, counts) 拼好·这里别再拼一次 */}))}
        />
      </div>
    )
    if (barOnly) return bar2
    return (
      <>
        {bar2}
        <div className="ds-sec-body" ref={bodyRef}>
          {renderBody(active, emptyText)}
        </div>
      </>
    )
  }
  const bar = (
    <nav className="ds-sec-nav" aria-label="页面分区">
      {sections.map((s) => {
        const b = badgeText(s.badge)
        return (
          <button
            key={s.key}
            type="button"
            className={`ds-sec${s.key === active?.key ? ' on' : ''}`}
            aria-current={s.key === active?.key ? 'page' : undefined}
            onClick={() => go(s.key)}
          >
            {s.label}
            {b && <span className="ds-sec-b">{b}</span>}
          </button>
        )
      })}
    </nav>
  )
  if (barOnly) return bar
  // ★ keepMounted：全部渲染、只藏非当前区（表单字段不卸载 → 不丢值）
  if (keepMounted) {
    return (
      <>
        {bar}
        {sections.map((s) => (
          <div key={s.key} data-section={s.key} style={{ display: s.key === active?.key ? undefined : 'none' }}>
            {renderBody(s, emptyText)}
          </div>
        ))}
      </>
    )
  }

  return (
    <>
      <nav className="ds-sec-nav" aria-label="页面分区">
        {sections.map((s) => {
          const b = badgeText(s.badge)
          return (
            <button
              key={s.key}
              type="button"
              className={`ds-sec${s.key === active?.key ? ' on' : ''}`}
              aria-current={s.key === active?.key ? 'page' : undefined}
              onClick={() => go(s.key)}
            >
              {s.label}
              {b && <span className="ds-sec-b">{b}</span>}
            </button>
          )
        })}
      </nav>
      <div className="ds-sec-body" ref={bodyRef}>
        {renderBody(active, emptyText)}
      </div>
    </>
  )
}

function renderBody(s: SectionDef | undefined, emptyText: string) {
  if (!s) return null
  // 空分区**保留分区条**、内容位置给一句人话（不隐藏 —— 隐藏会让人以为系统没这项）
  if (s.children === null || s.children === undefined || s.children === false) {
    return <div className="ds-sec-empty">{emptyText}</div>
  }
  return s.children
}
