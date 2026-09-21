import { App, DatePicker, Input, InputNumber, Select, Spin, Switch, Typography } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { errMsg } from '../api/client'

export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select' | 'switch'

interface Props {
  label: string
  value: unknown
  type?: FieldType
  options?: { value: string | number; label: string }[]
  suffix?: string
  placeholder?: string
  /** 只读时的自定义渲染（比如显示标签、金额格式化） */
  render?: (value: unknown) => ReactNode
  /** 保存：只把改动后的值交给后端 */
  onSave: (value: unknown) => Promise<void>
  /** 占两列 */
  wide?: boolean
}

/**
 * 就地编辑字段：鼠标移上去出现 ✎，点一下就地改，回车/失焦保存，Esc 取消。
 * 不用再「点编辑 → 弹窗 → 找字段 → 改 → 保存」。
 */
export default function EditableField({
  label,
  value,
  type = 'text',
  options,
  suffix,
  placeholder,
  render,
  onSave,
  wide = false,
}: Props) {
  const { message } = App.useApp()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<unknown>(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const save = async (next?: unknown) => {
    const v = next !== undefined ? next : draft
    if (v === value) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(v)
      message.success(`${label} 已保存（变更已记入操作记录）`)
      setEditing(false)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const display = () => {
    if (render) return render(value)
    if (value === null || value === undefined || value === '') {
      return <Typography.Text type="secondary">—</Typography.Text>
    }
    if (type === 'switch') return value ? '是' : '否'
    if (type === 'money') return `¥${Number(value).toLocaleString()}`
    if (type === 'select' && options) {
      return options.find((o) => o.value === value)?.label ?? String(value)
    }
    return `${value}${suffix ?? ''}`
  }

  const editor = () => {
    const common = { size: 'small' as const, autoFocus: true, style: { width: '100%' } }
    switch (type) {
      case 'number':
      case 'money':
        return (
          <InputNumber
            {...common}
            min={0}
            value={draft as number}
            placeholder={placeholder}
            onChange={(v) => setDraft(v)}
            onPressEnter={() => void save()}
            onBlur={() => void save()}
          />
        )
      case 'date':
        return (
          <DatePicker
            {...common}
            value={draft ? dayjs(draft as string) : null}
            onChange={(d) => {
              const v = d ? d.format('YYYY-MM-DD') : null
              setDraft(v)
              void save(v)
            }}
          />
        )
      case 'select':
        return (
          <Select
            {...common}
            allowClear
            value={(draft as string) ?? undefined}
            options={options}
            onChange={(v) => {
              setDraft(v)
              void save(v ?? null)
            }}
          />
        )
      case 'textarea':
        return (
          <Input.TextArea
            {...common}
            rows={2}
            value={draft as string}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void save()}
          />
        )
      default:
        return (
          <Input
            {...common}
            value={draft as string}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={() => void save()}
            onBlur={() => void save()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft(value)
                setEditing(false)
              }
            }}
          />
        )
    }
  }

  if (type === 'switch') {
    return (
      <div className="ef" style={wide ? { gridColumn: 'span 2' } : undefined}>
        <span className="ef-label">{label}</span>
        <span className="ef-value">
          <Switch
            size="small"
            checked={!!value}
            checkedChildren="是"
            unCheckedChildren="否"
            loading={saving}
            onChange={(v) => {
              setDraft(v)
              void save(v)
            }}
          />
          {suffix && (
            <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              {suffix}
            </Typography.Text>
          )}
        </span>
      </div>
    )
  }

  return (
    <div className="ef" style={wide ? { gridColumn: 'span 2' } : undefined}>
      <span className="ef-label">{label}</span>
      <span className="ef-value">
        {editing ? (
          editor()
        ) : (
          <span className="ef-readonly" onClick={() => setEditing(true)}>
            {display()}
          </span>
        )}
      </span>
      {saving ? (
        <Spin size="small" />
      ) : (
        !editing && (
          <span className="ef-pen" onClick={() => setEditing(true)} title="点击修改">
            ✎
          </span>
        )
      )}
    </div>
  )
}
