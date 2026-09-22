// api/http.ts —— 基础设施：axios 实例 + 拦截器 + 常量（重构 1.1）
import axios from 'axios'

export const TOKEN_KEY = 'txgk_token'
// 管理员「以某人身份查看」（只读，06 卷 §4）

export const IMPERSONATE_KEY = 'txgk_impersonate'

export const IMPERSONATE_NAME_KEY = 'txgk_impersonate_name'

export const api = axios.create({ baseURL: '/api/v1', timeout: 20000 })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  const imp = localStorage.getItem(IMPERSONATE_KEY)
  if (imp) config.headers['X-Impersonate'] = imp
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      if (window.location.pathname !== '/login') window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export function errMsg(e: unknown): string {
  const anyErr = e as { response?: { data?: { detail?: string } }; message?: string }
  return anyErr?.response?.data?.detail ?? anyErr?.message ?? '操作失败'
}
