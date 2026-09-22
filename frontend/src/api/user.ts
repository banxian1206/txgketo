// api/user.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

export interface User {
  id: number
  username: string
  name: string
  is_superuser: boolean
  profession?: string | null
  position?: string | null
  title?: string | null
  org_id?: number | null
}

/** 用户管理页的行（比 User 多管理字段） */

export interface UserRow extends User {
  phone?: string | null
  is_active: boolean
  roles?: string[]
}

export interface OrgRow {
  id: number
  code: string
  name: string
  parent_id?: number | null
  kind?: string | null
  is_active?: boolean
  user_count?: number
}

/** 我的权限范围（06 卷 §4）：能不能管用户/组织、能勾哪些角色 */

export interface MyScope {
  is_admin: boolean
  can_manage_users: boolean
  can_manage_org: boolean
  department: { id: number; code: string; name: string } | null
  assignable_role_codes: string[] | null
  positions: string[]
}

export interface RoleRow {
  id: number
  code: string
  name: string
}

/** 工程部专业 / 岗位（06 卷 §3，与后端 PROFESSIONS / POSITIONS 对齐） */

export const PROFESSIONS = ['机械', '电气', '程序', '工艺']

export const POSITIONS = ['组员', '经理', '总监']

export async function listUsers(params?: {
  org_id?: number
  role_code?: string
  is_active?: boolean
  q?: string
}) {
  const { data } = await api.get<UserRow[]>('/users', { params })
  return data
}

export async function getMyScope() {
  const { data } = await api.get<MyScope>('/my-scope')
  return data
}

/** 前端权限判断（06 卷 §4）：读登录时存的 permissions */

export function hasPerm(code: string): boolean {
  try {
    const u = JSON.parse(localStorage.getItem('txgk_user') ?? '{}') as {
      is_superuser?: boolean
      permissions?: string[]
    }
    return u.is_superuser === true || (u.permissions ?? []).includes(code)
  } catch {
    return false
  }
}

/** 离职/停用一键转交（06 卷 §10） */

export async function handoverUser(userId: number, body: { to_user_id: number; deactivate: boolean }) {
  const { data } = await api.post<{ ok: boolean; moved: Record<string, number>; deactivated: boolean }>(
    `/users/${userId}/handover`,
    body,
  )
  return data
}

/** 演示账号（06 卷 §4，仅管理员）：一键生成 / 停用 / 启用 */

export interface DemoUserRow {
  username: string
  name: string
  password: string
  org?: string | null
  position: string
  profession?: string | null
  roles: string[]
  created: boolean
}

export async function generateDemoUsers() {
  const { data } = await api.post<{ action: string; password: string; users: DemoUserRow[] }>(
    '/demo-users',
    { action: 'create' },
  )
  return data
}

export async function setDemoUsersActive(action: 'enable' | 'disable') {
  const { data } = await api.post<{ action: string; count: number }>('/demo-users', { action })
  return data
}

// ------------------- 工作台（06 卷 §8）-------------------

export async function createOrg(body: {
  name: string
  parent_id?: number | null
  kind?: string | null
}) {
  const { data } = await api.post<OrgRow>('/orgs', body)
  return data
}

export async function updateOrg(
  id: number,
  body: { name?: string; parent_id?: number | null; kind?: string | null; is_active?: boolean },
) {
  const { data } = await api.patch<OrgRow>(`/orgs/${id}`, body)
  return data
}

export async function createUser(body: {
  username: string
  password: string
  name: string
  phone?: string | null
  org_id?: number | null
  profession?: string | null
  position?: string | null
  title?: string | null
  role_codes: string[]
}) {
  const { data } = await api.post<UserRow>('/users', body)
  return data
}

export async function updateUser(
  id: number,
  body: {
    name?: string
    phone?: string | null
    org_id?: number | null
    profession?: string | null
    position?: string | null
    title?: string | null
    role_codes?: string[]
    is_active?: boolean
    password?: string
  },
) {
  const { data } = await api.patch<UserRow>(`/users/${id}`, body)
  return data
}

export async function listOrgs() {
  const { data } = await api.get<OrgRow[]>('/orgs')
  return data
}

export async function listRoles() {
  const { data } = await api.get<RoleRow[]>('/roles')
  return data
}
