import { App } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { errMsg, mobileHome, type MobileHome } from '../../api/client'
import { MCard, MChip, MEmpty, MHead, MStatus } from '../../components/ds/mobile'
import { hasPerm } from '../../api/user'

/**
 * 手机端首页 · 今日任务流（R4 · 2026-10-04 重做）
 *
 * 改造前：**14 个数字格**（2 列 × 7 行），其中一半是 0 —— 用户得自己判断"今天先干哪件"，
 * 而且真正的动作藏在底部 4 个 Tab 里。改版后：
 *   ① 一条**行级任务流**（后端 `/m/home.tasks` 给编号/名称/去向），**0 的类别不出现**
 *   ② 每条 = 一个动作，点一下就进那个作业页
 *   ③ 首页不再解释"系统怎么用"（那句「不做扫码，清单+勾选+拍照就够了」已删）——
 *      说明进 `?`（这里用不到就干脆不写）
 *   ④ 归类小计（"还有 N 条"）只在该类真有剩余时出现
 *
 * ★ 可见性：`tasks[].tab` 必须命中**该用户可见的移动台**（与底部 Tab 同一套判断），
 *   否则后端给的全局行级数据会越权显示。
 */
export default function HomeM() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const [data, setData] = useState<MobileHome | null>(null)

  useEffect(() => {
    mobileHome()
      .then(setData)
      .catch((e) => message.error(errMsg(e)))
  }, [message])

  // 与 MobileLayout 的底部入口同一套可见性判断（能力位 → 能不能看这个台）
  const visibleTabs = useMemo(() => {
    const tabs: Record<string, boolean> = {
      '/m/warehouse': hasPerm('warehouse:view') || hasPerm('warehouse:edit'),
      '/m/issues': true, // 领料人人可见（谁都能看自己那张单）
      '/m/production': hasPerm('mfg:view'),
      '/m/assembly': hasPerm('mfg:view'),
      '/m/shipping': hasPerm('ship:edit') || hasPerm('site:edit'),
      '/m/site': hasPerm('site:edit') || hasPerm('project:edit'),
      '/m/service': hasPerm('service:edit'),
    }
    return tabs
  }, [])

  const tasks = (data?.tasks ?? []).filter((t) => visibleTabs[t.tab] !== false)
  const c = data?.counts
  // 同类只在**第一张卡**上标「还有 N 条」（后端给的是该队列总数）—— 避免每张卡都重复一遍
  const seenKind = new Set<string>()

  const dueCount = tasks.filter((t) => t.tone === 'err').length
  const today = tasks.length

  return (
    <>
      <MHead
        title={`${data?.user.name ?? '…'}，你好`}
        sub={
          data
            ? today > 0
              ? `${today} 件事等你处理${dueCount ? ` · ${dueCount} 件已超期` : ''}`
              : '今天没有待办的事'
            : '正在加载…'
        }
      />

      {/* 顶部一行小计：只放"要盯的"（0 不占位） */}
      {(data?.unread ?? 0) > 0 && (
        <div style={{ display: 'flex', gap: 8, padding: '0 2px 12px', flexWrap: 'wrap' }}>
          <MChip tone="acc">未读 {data?.unread}</MChip>
          {(c?.shipments_open ?? 0) > 0 && <MChip>发运待办 {c?.shipments_open}</MChip>}
          {(c?.site_to_dispatch ?? 0) > 0 && <MChip tone="run">待派调试 {c?.site_to_dispatch}</MChip>}
          {(c?.service_open ?? 0) > 0 && <MChip tone="warn">售后 {c?.service_open}</MChip>}
        </div>
      )}

      {tasks.length === 0 ? (
        <MEmpty
          text={
            data
              ? '今天没有待办。有新任务会出现在这里 —— 也可以从底部进你自己的台看看。'
              : '正在加载…'
          }
        />
      ) : (
        tasks.map((t, i) => {
          const first = !seenKind.has(t.kind)
          seenKind.add(t.kind)
          return (
            <MCard
              key={`${t.tab}-${t.code ?? ''}-${i}`}
              tone={t.tone ?? undefined}
              head={
                <>
                  {t.code && <span className="ds-code" style={{ fontSize: 12 }}>{t.code}</span>}
                  <MStatus tone={t.tone ?? undefined}>{t.kind}</MStatus>
                  {first && (t.more ?? 0) > 1 && (
                    <span style={{ marginLeft: 'auto' }}>
                      <MChip>共 {t.more} 条</MChip>
                    </span>
                  )}
                </>
              }
              title={t.title}
              lines={t.sub ? [t.sub] : undefined}
              onClick={() => nav(t.to)}
            />
          )
        })
      )}

      {tasks.length > 0 && (
        <div className="m-sec">按你的角色显示 · 只看你有权限处理的</div>
      )}
    </>
  )
}
