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
  (err) => {
    if (err.response?.status === 401) {
      clearSession()
      if (window.location.pathname !== '/login') window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export function errMsg(e: unknown): string {
  const anyErr = e as { response?: { data?: { detail?: string } }; message?: string }
  return anyErr?.response?.data?.detail ?? anyErr?.message ?? '操作失败'
}
