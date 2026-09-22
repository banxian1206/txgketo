import { App } from 'antd'
import type { FormInstance } from 'antd'
import { useState } from 'react'
import { errMsg } from '../api/client'

/**
 * 统一表单提交（重构 1.2 · 根治 P-09 类问题）：
 *   validate → 校验失败静默返回（antd 已行内标红）
 *            → loading 防重复提交
 *            → 成功：toast(结果文案) + close + after(视图刷新)  ★ 反馈必须落在视图上
 *            → 失败：errMsg 统一 toast，**reject 永不逃逸**（原来 42 处裸 await validateFields 的 pageerror 来源）
 *
 *   const { run, loading } = useSubmit(form, {
 *     request: (v) => inspectPurchase(id, v),
 *     success: (r) => `验收合格 → ${r.receipt_no} 待入库`,
 *     close: () => setAcceptOpen(false),
 *     after: () => reload(),
 *   })
 *   <AppModal onOk={run} loading={loading} …>
 */
export function useSubmit<V extends object, R>(form: FormInstance<V>, opts: {
  request: (values: V) => Promise<R>
  success?: (res: R) => string
  /** 提交成功后先关弹窗（默认不关，由调用方给 close） */
  close?: () => void
  /** 关窗后的视图刷新（reload 列表等） */
  after?: (res: R) => void | Promise<void>
}) {
  const [loading, setLoading] = useState(false)
  const { message } = App.useApp()

  const run = async () => {
    if (loading) return // 防重复提交
    let v: V
    try {
      v = await form.validateFields()
    } catch {
      return // 校验失败：antd 已行内标红，不外抛
    }
    setLoading(true)
    try {
      const res = await opts.request(v)
      if (opts.success) message.success(opts.success(res))
      opts.close?.()
      await opts.after?.(res)
    } catch (e) {
      message.error(errMsg(e)) // ★ 业务错误（含 400 文案）统一出口
    } finally {
      setLoading(false)
    }
  }

  return { run, loading }
}
