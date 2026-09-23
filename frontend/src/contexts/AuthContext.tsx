import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { login as apiLogin, me as fetchMe } from '../api/auth'
import type { User } from '../api/user'
import { clearCredential } from '../utils/credential'
import { clearSession, patchSession, readSession, writeSession, type Session } from './session'

/**
 * 全站登录态单一来源（重构 1.3）：
 * - 登录 / 登出 / 刷新用户 / 进入与退出伪装，**全部经本 Context 一处更新**（state + 持久化同步）
 * - 消费端用 useAuth()；权限判断组件内用 usePerm(code)（读 state → 权限变更即重渲染，根除 stale）
 * - 非组件场景（拦截器/下载）用 session.ts 的 readSession() 同步读
 */

interface AuthValue {
  session: Session | null
  user: User | null
  token: string | null
  impersonateName: string | null
  isImpersonating: boolean
  /** 登录成功写入 session；失败 reject（由页面 catch 出 toast） */
  login: (username: string, password: string) => Promise<User>
  logout: () => void
  /** 拉 /auth/me 刷新用户与权限（岗位/角色变更后调它） */
  refreshMe: () => Promise<User | null>
  startImpersonate: (id: number, name: string) => void
  stopImpersonate: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const nav = useNavigate()
  const [session, setSession] = useState<Session | null>(() => readSession())

  const login = useCallback(async (username: string, password: string) => {
    const data = await apiLogin(username, password)
    // 新登录 = 全新 session（天然清掉「以他人身份查看」，与旧行为一致）
    const s: Session = { token: data.access_token, user: data.user }
    writeSession(s)
    setSession(s)
    return data.user
  }, [])

  const logout = useCallback(() => {
    // 主动退出 = 真退出：连「记住密码」凭据一并清（否则退出后被自动登回，按钮形同虚设）
    // 被动 401 由 http 拦截器只清 session → 凭据保留 → 登录页自动重登（记住密码功能）
    clearCredential()
    clearSession()
    setSession(null)
    nav('/login')
  }, [nav])

  const refreshMe = useCallback(async () => {
    try {
      const u = await fetchMe()
      const next = patchSession({ user: u })
      setSession(next)
      return u
    } catch {
      return null
    }
  }, [])

  const startImpersonate = useCallback((id: number, name: string) => {
    const next = patchSession({ impersonateId: id, impersonateName: name })
    setSession(next)
    // 整页刷新：让全站数据按被查看者身份重取（与原行为一致）
    window.location.href = '/workbench'
  }, [])

  const stopImpersonate = useCallback(() => {
    const next = patchSession({ impersonateId: undefined, impersonateName: undefined })
    setSession(next)
    window.location.href = '/users'
  }, [])

  const value: AuthValue = {
    session,
    user: session?.user ?? null,
    token: session?.token ?? null,
    impersonateName: session?.impersonateName ?? null,
    isImpersonating: session?.impersonateId !== undefined,
    login,
    logout,
    refreshMe,
    startImpersonate,
    stopImpersonate,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth 必须在 <AuthProvider> 内使用')
  return v
}

/** 组件内权限判断（06 卷 §4）：读 Context state，登录/刷新后即时生效 */
export function usePerm(code: string): boolean {
  const { user } = useAuth()
  if (!user) return false
  return user.is_superuser === true || (user.permissions ?? []).includes(code)
}
