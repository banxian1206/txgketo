/**
 * 「记住密码」凭据存储（2026-09-23 新功能 · 对应 交互规范 §2.6）
 *
 * 语义：
 * - 勾选后凭据保存在本机 → session 被动失效（401 被踢）跳登录页时【自动重新登录】，无需重输
 * - 主动点「退出登录」会清除凭据（AuthContext.logout 调 clearCredential）—— 否则退出形同虚设
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
