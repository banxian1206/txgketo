import { Select, type SelectProps } from 'antd'
import { useEffect, useState } from 'react'

import { listEquipment, type EquipmentItem } from '../../api/client'

type Props = Omit<SelectProps, 'options'> & {
  /** 必须先选项目；不传时为空列表并提示 */
  projectNo?: string | null
}

/** 设备选择（字段组件族 · 重构 1.4）：按项目联动，替代手填 equip_no */
export default function SelectProjectEquip({ projectNo, placeholder, ...rest }: Props) {
  const [rows, setRows] = useState<EquipmentItem[]>([])
  useEffect(() => {
    if (!projectNo) {
      setRows([])
      return
    }
    listEquipment(projectNo)
      .then(setRows)
      .catch(() => setRows([]))
  }, [projectNo])
  return (
    <Select
      showSearch
      optionFilterProp="label"
      placeholder={placeholder ?? (projectNo ? '选设备' : '先选项目')}
      disabled={!projectNo && !rest.value}
      options={rows.map((e) => ({ value: e.equip_no, label: `${e.equip_no} ${e.equip_name}` }))}
      {...rest}
    />
  )
}
