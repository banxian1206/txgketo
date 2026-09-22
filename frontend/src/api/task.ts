// api/task.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

export interface TaskItem {
  id: number
  task_no: string
  project_no: string
  project_name?: string | null
  equip_no?: string | null
  task_type: string
  profession?: string | null
  title: string
  content?: string | null
  owner_id?: number | null
  owner_name?: string | null
  depends_on_id?: number | null
  parent_task_id?: number | null
  blocked?: boolean
  blocked_reason?: string | null
  plan_start?: string | null
  plan_end?: string | null
  status: string
  done_at?: string | null
  ref_type?: string | null
  ref_id?: number | null
  ref_no?: string | null
  remark?: string | null
}

export async function generateTasks(
  no: string,
  body: { professions: string[]; with_purchase: boolean },
) {
  const { data } = await api.post<{ created: number; unassigned: string[]; items: TaskItem[] }>(
    `/projects/${no}/generate-tasks`,
    body,
  )
  return data
}

export async function listProjectTasks(no: string) {
  const { data } = await api.get<TaskItem[]>(`/projects/${no}/tasks`)
  return data
}

export async function listMyTasks(status?: string, scope: 'mine' | 'team' = 'mine') {
  const params: Record<string, string> = { scope }
  if (status) params.status = status
  const { data } = await api.get<TaskItem[]>('/my-tasks', { params })
  return data
}

export async function splitTask(taskId: number, items: { owner_id: number; title?: string }[]) {
  const { data } = await api.post<TaskItem[]>(`/tasks/${taskId}/split`, { items })
  return data
}

export async function updateTask(
  id: number,
  body: Partial<{ status: string; owner_id: number; plan_start: string; plan_end: string; remark: string }>,
) {
  const { data } = await api.patch<TaskItem>(`/tasks/${id}`, body)
  return data
}

export async function taskSummary() {
  const { data } = await api.get<
    { owner: string; total: number; done: number; doing: number; todo: number }[]
  >('/tasks/summary')
  return data
}

// ============================== 工程设计（图纸 / 版本 / BOM）====================
