import { App, Input } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { Chip, Code, Empty } from '../components/ds'
import { globalSearch, type SearchHit } from '../api/dossier'
import { errMsg } from '../api/http'
import { useGoFrom } from '../hooks/useFrom'

/**
 * ★ 命令栏（⌘K · R2 收尾）—— 「粘任意编号 → 直达」。
 *
 * 为什么这是本项目最重要的一处交互：铁律 1 说**编号只能由发号引擎生成**，
 * 铁律 2 说**图号 = 物料号** —— 也就是说在这套系统里，**编号就是入口**：
 * 18 类单据 + 图号 + 物料号 + 项目号 + 客户名，用户手上永远有一个号。
 * 但改造前全站只有 4 处「列表内模糊搜」，想知道「PO26034 现在到哪了」得先猜它在哪个台、哪个页签。
 *
 * 交互约定（照 A 纸面的规矩来，不引新依赖）：
 *   · ⌘K / Ctrl+K 开关；Esc 关；输入即搜（200ms 防抖 + 丢过期响应）
 *   · ↑↓ 选择、Enter 直达；点击也能进
 *   · 命中带「类型 + 编号 + 名称 + 一句话」；**查不到就说查不到**，并给"去哪个台找"的提示
 *   · 落点用 `useGoFrom().go()` —— 从任何台按 ⌘K 跳过去，都带着**来源**，返回口还能回原台
 */
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp()
  const go = useGoFrom()
  const loc = useLocation()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const seqRef = useRef(0)

  // 打开即聚焦 + 清空（每次进来都是新的一次查找）
  useEffect(() => {
    if (!open) return
    setQ('')
    setHits([])
    setActive(0)
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [open])

  // 输入 → 防抖搜索（丢掉过期响应：AI 不改数据，但别让慢响应覆盖快响应）
  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (term.length < 1) {
      setHits([])
      setLoading(false)
      return
    }
    setLoading(true)
    const seq = ++seqRef.current
    const t = setTimeout(() => {
      globalSearch(term)
        .then((r) => {
          if (seq !== seqRef.current) return
          setHits(r.items)
          setActive(0)
        })
        .catch((e) => {
          if (seq !== seqRef.current) return
          setHits([])
          message.error(errMsg(e))
        })
        .finally(() => {
          if (seq === seqRef.current) setLoading(false)
        })
    }, 200)
    return () => clearTimeout(t)
  }, [q, open, message])

  const pick = useCallback(
    (h: SearchHit) => {
      if (!h.route) return
      onClose()
      go(h.route)
    },
    [go, onClose],
  )

  // 键盘：Esc 关；↑↓ 选；Enter 直达
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, Math.max(0, hits.length - 1)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter' && hits[active]) {
      e.preventDefault()
      pick(hits[active])
    }
  }

  if (!open) return null

  return (
    <div className="cmdk-mask" onClick={onClose} role="presentation">
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="全局检索"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="cmdk-in">
          <Input
            ref={inputRef as never}
            size="large"
            variant="borderless"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="粘一个编号 / 图号 / 物料号 / 项目名 / 客户名，例如 PO26034、TX26001、YL-BC-0001"
            aria-label="全局检索"
          />
          <span className="ds-kbd">Esc</span>
        </div>

        <div className="cmdk-body">
          {q.trim().length === 0 && (
            <div className="cmdk-tip">
              编号即入口：<Code>TX26001</Code> 项目 · <Code>PO26034</Code> 采购单 · <Code>GR26017</Code> 到货单 ·{' '}
              <Code>MI26003</Code> 领料单 · <Code>FH26004</Code> 发运批次 · <Code>SV26003</Code> 售后工单 ·{' '}
              <Code>TX26001-01A-01-01-00-00</Code> 图号（= 物料号）
            </div>
          )}

          {q.trim().length > 0 && !loading && hits.length === 0 && (
            <Empty text={`没有找到「${q.trim()}」。换个编号试试，或到对应的台里按条件筛。`} />
          )}

          {hits.map((h, i) => (
            <button
              key={`${h.kind}-${h.code ?? ''}-${h.title}-${i}`}
              type="button"
              className={`cmdk-row${i === active ? ' on' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(h)}
            >
              <span className="cmdk-kind">
                <Chip tone={i === active ? 'acc' : undefined}>{h.kind}</Chip>
              </span>
              <span className="cmdk-tx">
                <span className="cmdk-t">
                  {h.code ? <span className="ds-code">{h.code}</span> : null} {h.title}
                </span>
                {h.sub ? <span className="cmdk-s">{h.sub}</span> : null}
              </span>
              <span className="cmdk-go">{i === active ? 'Enter ↵' : ''}</span>
            </button>
          ))}
        </div>

        <div className="cmdk-foot">
          <span>↑↓ 选择</span>
          <span>Enter 直达</span>
          <span>Esc 关闭</span>
          <span style={{ marginLeft: 'auto' }}>当前页 {loc.pathname}</span>
        </div>
      </div>
    </div>
  )
}
