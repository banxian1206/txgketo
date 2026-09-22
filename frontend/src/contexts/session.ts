import type { User } from '../api/user'

/**
 * 登录态唯一存储实现（重构 1.3：原 5 个 localStorage key → 1 个 `txgk_session`）
 * - 全站只有本文件可以直接碰 localStorage 的登录相关 key（e2e static 有断言盯着）
 * - 自动迁移旧 key（txgk_token/user/name/impersonate×2），迁移后即清理
 */

export interface Session {
  token: string
  user: User
  /** 「以某人身份查看」（06 卷 §4，只读；缺省 = 本人） */
  impersonateId?: number
  impersonateName?: string
}

const KEY = 'txgk_session'
const LEGACY_KEYS = ['txgk_token', 'txgk_user', 'txgk_name', 'txgk_impersonate', 'txgk_impersonate_name']

function legacyCleanup() {
  for (const k of LEGACY_KEYS) localStorage.removeItem(k)
}

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as Session
      return s?.token && s?.user ? s : null
    }
    // 旧 5 key → 首次读取时迁移（升级无感，不掉登录）
    const token = localStorage.getItem('txgk_token')
    if (!token) return null
    const user = JSON.parse(localStorage.getItem('txgk_user') ?? 'null') as User | null
    if (!user) return null
    const imp = localStorage.getItem('txgk_impersonate')
    const migrated: Session = {
      token,
      user,
      ...(imp
        ? { impersonateId: Number(imp), impersonateName: localStorage.getItem('txgk_impersonate_name') ?? undefined }
        : {}),
    }
    writeSession(migrated)
    return migrated
  } catch {
    return null
  }
}

export function writeSession(s: Session): void {
  localStorage.setItem(KEY, JSON.stringify(s))
  legacyCleanup()
}

/** 局部更新（登录刷新用户/切换伪装）；impersonateId 置 undefined 时成对清除 */
export function patchSession(p: Partial<Session>): Session | null {
  const s = readSession()
  if (!s) return null
  const next: Session = { ...s, ...p }
  if (!p.impersonateId) {
    if ('impersonateId' in p || 'impersonateName' in p) {
      delete next.impersonateId
      delete next.impersonateName
    }
  }
  writeSession(next)
  return next
}

export function clearSession(): void {
  localStorage.removeItem(KEY)
  legacyCleanup()
}
