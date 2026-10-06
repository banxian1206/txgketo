import { Select, type SelectProps } from 'antd'
import { useEffect, useState } from 'react'

import { listProjects, type Project } from '../../api/client'

type Props = Omit<SelectProps, 'options'>

/**
 * 项目选择（字段组件族 · 重构 1.4）：
 * 替代表单里手填/散写的「项目号」——选出来的一定是存在的项目（根治 P-06 幽灵项目一类的 4xx/5xx）。
 * 挂载即拉取（配合 destroyOnHidden 的弹窗：每次打开都是新数据，零缓存失效问题）。
 */
export default function SelectProject({ placeholder = '选项目', ...rest }: Props) {
  const [rows, setRows] = useState<Project[]>([])
  useEffect(() => {
    listProjects()
      .then((r) => setRows(r))
      .catch(() => setRows([]))
  }, [])
  return (
    <Select
      showSearch
      optionFilterProp="label"
      placeholder={placeholder}
      aria-label="选择项目"
      options={rows.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
      notFoundContent={rows.length ? undefined : '项目加载中…'}
      {...rest}
    />
  )
}
