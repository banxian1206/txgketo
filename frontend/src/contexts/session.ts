import type { User } from '../api/user'

/** 岗位三级（与后端 `app/models/platform.py` 的 POSITION_* 一一对应，别再各写一份字符串） */
export const POSITION = { member: '组员', lead: '经理', director: '总监' } as const
export type PositionKey = keyof typeof POSITION

/** 把后端下发的 `user.position` 归成三档（认不出来 = 组员，保守：只看到自己那一层） */
export function positionTier(p?: string | null): PositionKey {
  if (p === POSITION.director) return 'director'
  if (p === POSITION.lead) return 'lead'
  return 'member'
}

/**
 * 登录态唯一存储实现（重构 1.3：原 5 个 localStorage key → 1 个 `txgk_session`）
 * - 全站只有本文件可以直接碰 localStorage 的登录相关 key（e2e static 有断言盯着）
 * - 自动迁移旧 key（txgk_token/user/name），迁移后即清理（impersonate 已废弃，旧 key 顺手清掉）
 */

export interface Session {
  token: string
  user: User
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
    const migrated: Session = { token, user }
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

/** 局部更新（登录后刷新用户信息） */
export function patchSession(p: Partial<Session>): Session | null {
  const s = readSession()
  if (!s) return null
  const next: Session = { ...s, ...p }
  writeSession(next)
  return next
}

export function clearSession(): void {
  localStorage.removeItem(KEY)
  legacyCleanup()
}
