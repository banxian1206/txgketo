// api/numbering.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

export async function listNumberRules() {
  const { data } = await api.get<
    { object_type: string; name: string; template: string; scope: string; remark?: string }[]
  >('/numbering/rules')
  return data
}

/** 图号解析（层次码 / 父级） */

export async function parseDrawingNo(drawingNo: string) {
  const { data } = await api.get<{ drawing_no: string; parsed: Record<string, unknown>; level: number; parent: string | null }>(
    '/numbering/drawing/parse',
    { params: { drawing_no: drawingNo } },
  )
  return data
}

/** 图号组装（项目 + 设备 + 4 组层次码） */

export async function composeDrawingNo(params: {
  project_no: string
  equip_no: string
  l1: string
  l2: string
  l3: string
  l4: string
}) {
  const { data } = await api.get<{ drawing_no: string; level: number; parent: string | null }>(
    '/numbering/drawing/compose',
    { params },
  )
  return data
}
