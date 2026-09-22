import { Select, type SelectProps } from 'antd'
import { useEffect, useState } from 'react'

import { listLocations, type LocationRow } from '../../api/client'

type Props = Omit<SelectProps, 'options'> & {
  /**
   * value 形态（valueMode，避开 antd Select.mode 撞名）：
   * - 'text'（默认）= `${仓库} ${编码}`（goods_receipt.store 等用字符串库位）
   * - 'id'          = LocationRow.id（manualInbound 等用库位 id）
   */
  valueMode?: 'text' | 'id'
  /** 只显示启用中的库位（默认 true） */
  activeOnly?: boolean
}

/** 库位选择（字段组件族 · 重构 1.4）：替代手填库位文本（P-11：手打易分裂库存） */
export default function SelectLocation({ valueMode = 'text', activeOnly = true, placeholder, ...rest }: Props) {
  const [rows, setRows] = useState<LocationRow[]>([])
  useEffect(() => {
    listLocations()
      .then((r) => setRows(activeOnly ? r.filter((l) => l.is_active) : r))
      .catch(() => setRows([]))
  }, [activeOnly])
  const text = (l: LocationRow) => `${l.warehouse} ${l.code}${l.name ? ` ${l.name}` : ''}`
  // value 形态与原实现对齐：text = `${仓库} ${编码}`（不含 name），label 展示带 name
  const val = (l: LocationRow) => (valueMode === 'id' ? l.id : `${l.warehouse} ${l.code}`)
  return (
    <Select
      showSearch
      optionFilterProp="label"
      placeholder={placeholder ?? '选库位（没有就先到「库位」页签新建）'}
      options={rows.map((l) => ({ value: val(l), label: text(l) }))}
      notFoundContent={rows.length ? undefined : '库位加载中…'}
      {...rest}
    />
  )
}
