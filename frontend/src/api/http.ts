// api/http.ts —— 基础设施：axios 实例 + 拦截器（重构 1.1/1.3）
// 登录态唯一存储在 contexts/session.ts，这里只同步读（拦截器非组件场景）
import axios from 'axios'

import { clearSession, readSession } from '../contexts/session'

export const api = axios.create({ baseURL: '/api/v1', timeout: 20000 })

api.interceptors.request.use((config) => {
  const s = readSession()
  if (s?.token) config.headers.Authorization = `Bearer ${s.token}`
  if (s?.impersonateId) config.headers['X-Impersonate'] = String(s.impersonateId)
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401) {
      clearSession()
      if (window.location.pathname !== '/login') window.location.href = '/login'
    }
    // ★ F7：responseType:'blob' 的接口出错时 error.response.data 是 Blob 不是 JSON，
    //   errMsg 读不到 .detail → 鼠标一甩就是 axios 原文（"Request failed with status code 404"）。
    //   在拦截器里把 Blob 回读成 JSON，后端的人话 detail（"…还没上传图纸文件"）就能到屏上。
    const data = err.response?.data
    if (data instanceof Blob) {
      try {
        err.response.data = JSON.parse(await data.text())
      } catch {
        /* 不是 JSON（网关 HTML 错误页等）：保留原 Blob，errMsg 会兜 HTTP 状态码 */
      }
    }
    return Promise.reject(err)
  },
)

/**
 * 把接口错误转成**一句话**（F1：只返回 string，绝不把对象/数组甩给 React 渲染 → 整站白屏）。
 * - FastAPI 422：detail 是 [{type, loc, msg, input}] 对象数组 → 拼成人话（哪个字段、为什么）
 * - detail 为对象（少数自定义错误）→ 取 msg/message，兜底 JSON.stringify
 * - detail 为 Blob（responseType:'blob' 出错时，F7）→ 读不到内容，退回 e.message，
 *   并明确提示「请求失败（HTTP xxx）」而不是 axios 原文「Request failed with status code 404」
 */
export function errMsg(e: unknown): string {
  const anyErr = e as {
    response?: { status?: number; data?: { detail?: unknown } }
    message?: string
  }
  const detail = anyErr?.response?.data?.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail) && detail.length) {
    const parts = detail
      .map((d: Record<string, unknown>) => {
        const loc = Array.isArray(d.loc) ? d.loc.filter((x) => x !== 'body').join('.') : ''
        const msg = typeof d.msg === 'string' ? d.msg : ''
        return loc ? `${loc}: ${msg}` : msg
      })
      .filter(Boolean)
    if (parts.length) return `提交未通过校验：${parts.join('；')}`
  }
  if (detail && typeof detail === 'object' && !(detail instanceof Blob)) {
    const d = detail as Record<string, unknown>
    const m = typeof d.msg === 'string' ? d.msg : typeof d.message === 'string' ? d.message : null
    if (m) return m
    try {
      return JSON.stringify(detail)
    } catch {
      /* 落回下面的兜底 */
    }
  }
  const status = anyErr?.response?.status
  if (status) return `请求失败（HTTP ${status}）：${anyErr?.message ?? ''}`.trim()
  return anyErr?.message || '操作失败'
}
