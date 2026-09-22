import { Select, type SelectProps } from 'antd'
import { useEffect, useState } from 'react'

import { listSuppliers, type SupplierRow } from '../../api/client'

type Props = Omit<SelectProps, 'options'>

/** 供应商选择（字段组件族 · 重构 1.4）：替代手填 supplier_id/名称 */
export default function SelectSupplier({ placeholder = '从供应商里选', ...rest }: Props) {
  const [rows, setRows] = useState<SupplierRow[]>([])
  useEffect(() => {
    listSuppliers()
      .then((r) => setRows(r.filter((s) => s.is_active)))
      .catch(() => setRows([]))
  }, [])
  return (
    <Select
      showSearch
      optionFilterProp="label"
      placeholder={placeholder}
      options={rows.map((s) => ({ value: s.id, label: `${s.name}${s.kind ? ` · ${s.kind}` : ''}` }))}
      notFoundContent={rows.length ? undefined : '供应商加载中…'}
      {...rest}
    />
  )
}
