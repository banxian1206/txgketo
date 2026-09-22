// api/auth.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

import { User } from './user'
export async function login(username: string, password: string) {
  const { data } = await api.post<{ access_token: string; user: User }>('/auth/login', {
    username,
    password,
  })
  return data
}

export async function me() {
  const { data } = await api.get<User>('/auth/me')
  return data
}
