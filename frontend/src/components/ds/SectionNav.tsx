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
  // ── 两层：把 sections 按 groups 折叠成"组"；组内切换走同一份 sections ──
  const grouped = groups && groups.length > 0
  const curGroup = grouped
    ? (groups!.find((g) => g.keys.includes(tab)) ?? groups![0])
    : undefined
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
  // 两层形态：组一行（Segmented） + 组内项一行（Segmented）
  if (grouped) {
    const g = curGroup!
    const items = sections.filter((s) => g.keys.includes(s.key))
    return (
      <>
        <div className="ds-subtabs ds-grp">
          <Segmented
            size={flowSize === "small" ? "small" : undefined}
            value={g.key}
            // 点组 = 进该组第一个可见项（与 WorkbenchTabs 同口径：切组不保留另一组的项）
            onChange={(k) => {
              const nx = groups!.find((x) => x.key === String(k))
              if (nx?.keys.length) go(nx.keys[0])
            }}
            options={groups!.map((x) => ({
              value: x.key,
              label: x.keys.length === 1 ? (sections.find((s) => s.key === x.keys[0])?.label ?? x.label) : x.label,
            }))}
          />
        </div>
        {items.length > 1 && (
          <div className="ds-subtabs">
            <Segmented
              size="small"
              value={active?.key}
              onChange={(k) => go(String(k))}
              options={items.map((s) => ({ value: s.key, label: s.label, key: s.key }))}
            />
          </div>
        )}
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
          options={sections.map((x) => ({ value: x.key, label: badgeText(x.badge) ? `${x.label} (${badgeText(x.badge)})` : x.label, key: x.key }))}
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
