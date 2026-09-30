import { Select, Typography } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'

import { searchItems } from '../../api/library'

/**
 * 物料搜索选择（标准库物料：标准件/原材料/自制件…）。
 *
 * 用途：任何「填物料号」的地方都该用它，而不是裸 Input ——
 * 手打物料号会建出「库里有码、单上是另一个拼法」的分裂数据，
 * 库存/备件/价格库从此对不上（2026-09-30 UI 真实场景测试 P2-10 的备件建账）。
 */
export default function ItemSelect({
  value,
  onChange,
  placeholder = '输入编码 / 品名 / 规格 / 品牌搜索',
  style,
}: {
  value?: string
  onChange?: (v?: string) => void
  placeholder?: string
  style?: React.CSSProperties
}) {
  const [rows, setRows] = useState<{ item_no: string; display_name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((q: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setLoading(true)
      searchItems(q || '')
        .then((r) => setRows(r as { item_no: string; display_name: string }[]))
        .catch(() => setRows([]))
        .finally(() => setLoading(false))
    }, 250)
  }, [])

  useEffect(() => {
    search('')
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [search])

  const options = rows.map((i) => ({ value: i.item_no, label: `${i.item_no} ${i.display_name}` }))
  if (value && !rows.some((i) => i.item_no === value)) options.unshift({ value, label: value })

  return (
    <Select
      showSearch
      allowClear
      value={value}
      placeholder={placeholder}
      loading={loading}
      optionFilterProp="label"
      filterOption={false}
      onSearch={search}
      onChange={(v) => onChange?.(v as string | undefined)}
      options={options}
      style={style ?? { width: '100%' }}
      notFoundContent={<Typography.Text type="secondary">没搜到 —— 先到「基础数据 → 标准库」建码</Typography.Text>}
    />
  )
}
