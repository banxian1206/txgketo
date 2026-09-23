/**
 * 「记住密码」凭据存储（2026-09-23 新功能 · 对应 交互规范 §2.6）
 *
 * 语义（2026-09-23 二次修正：退出后勾选/凭据保留 = 填充模式）：
 * - 勾选后凭据保存在本机；【记住的偏好本身也持久化】（退出回登录页勾选仍勾着）
 * - 被动失效（401 被踢）→ 登录页【自动重新登录】，无需任何操作
 * - 主动点「退出登录」→ 保留凭据并置 manual 标记 → 登录页【表单预填好】，点一下登录即可
 *   （不自动登录：给用户确认感，退出动作不被立刻撤销）
 * - 密码必须存（登录 API 要求），混淆 = XOR 盐 + Base64 —— 【弱混淆防直接窥视，非加密】；
 *   安全边界：能读本机 localStorage 的人已能做其他操作；系统为内网私有部署，且需用户主动勾选才存。
 */

const KEY = 'txgk_credential'
const SALT = 'txgk-2026-local-remember' // 固定盐：仅混淆，不提供加密强度（见文件头说明）

function scramble(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const salt = new TextEncoder().encode(SALT)
  const out = bytes.map((b, i) => b ^ salt[i % salt.length])
  return btoa(String.fromCharCode(...out))
}

function unscramble(encoded: string): string {
  try {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
    const salt = new TextEncoder().encode(SALT)
    return new TextDecoder().decode(bytes.map((b, i) => b ^ salt[i % salt.length]))
  } catch {
    return ''
  }
}

export interface SavedCredential {
  username: string
  password: string
}

export function saveCredential(username: string, password: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ u: scramble(username), p: scramble(password) }))
  } catch {
    /* 存储满/隐私模式：静默失败，功能降级为不记住 */
  }
}

export function readCredential(): SavedCredential | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as { u?: string; p?: string }
    if (!d?.u || !d?.p) return null
    const username = unscramble(d.u)
    const password = unscramble(d.p)
    return username && password ? { username, password } : null
  } catch {
    return null
  }
}

export function clearCredential(): void {
  localStorage.removeItem(KEY)
}


/* ── 登录偏好：「记住密码」勾选状态本身也要跨会话保留（2026-09-23 用户反馈） ── */
const PREF_KEY = 'txgk_remember_pref'
const MANUAL_KEY = 'txgk_manual_logout' // 主动退出标记：置位时登录页填充表单而非自动登录

export function readRememberPref(): boolean {
  return localStorage.getItem(PREF_KEY) === '1'
}

export function saveRememberPref(on: boolean): void {
  localStorage.setItem(PREF_KEY, on ? '1' : '0')
}

/** 主动退出时置位（AuthContext.logout）；成功手动登录后清除 */
export function markManualLogout(): void {
  localStorage.setItem(MANUAL_KEY, '1')
}

export function isManualLogout(): boolean {
  return localStorage.getItem(MANUAL_KEY) === '1'
}

export function clearManualLogout(): void {
  localStorage.removeItem(MANUAL_KEY)
}
