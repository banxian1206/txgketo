import { Select, type SelectProps } from 'antd'
import { useEffect, useRef, useState } from 'react'

import { searchItems, type ItemLite } from '../../api/client'

type Props = Omit<SelectProps, 'options'>

/**
 * 标准库物料搜索（字段组件族 · 重构 1.4）：
 * 统一 showSearch + 250ms 防抖；**搜不到时给「去标准库新建」出口**（P-14 语义内置）。
 */
export default function SelectStdItem({ placeholder = '搜标准库（如：焊丝 / 螺丝 / 方通）', ...rest }: Props) {
  const [rows, setRows] = useState<ItemLite[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = (q?: string) => {
    if (timer.current) clearTimeout(timer.current)
    setLoading(true)
    timer.current = setTimeout(() => {
      searchItems(q ?? '')
        .then(setRows)
        .catch(() => setRows([]))
        .finally(() => setLoading(false))
    }, 250)
  }
  useEffect(() => {
    search()
    return () => { if (timer.current) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Select
      showSearch
      filterOption={false}
      onSearch={(q) => search(q)}
      placeholder={placeholder}
      loading={loading}
      options={rows.map((i) => ({ value: i.item_no, label: `${i.item_no} ${i.display_name}` }))}
      notFoundContent={
        loading ? '搜索中…' : (
          <span style={{ fontSize: 12 }}>
            没搜到？<a onClick={() => window.open('/library', '_blank')}>去标准库新建 →</a>
          </span>
        )
      }
      {...rest}
    />
  )
}
