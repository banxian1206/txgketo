// components/design/shared.ts —— 设计面跨组件共享（重构 1.6 从 EquipmentDesign 提升）
import type { ChangeBrief } from '../../api/client'

export interface TreeNode {
  drawing_no: string
  level: number
  parent_drawing_no?: string | null
  title: string
  qty: number
  unit: string
  source_type: string
  current_version: string
  status: string
  is_part: boolean
  change_request?: { id: number; cr_no: string; status: string; change_task_owner_id?: number | null } | null
}

export type ChangeTarget = {
  type: 'DRAWING' | 'PROGRAM' | 'BOM_ITEM'
  ref: string
  title: string
}

/** 改版动作是否可用：改版申请已下发（05 卷 §6） */
export const changeActionAvailable = (cr?: ChangeBrief | null) => !!cr && cr.status === '已下发'
