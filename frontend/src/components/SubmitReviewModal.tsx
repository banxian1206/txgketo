import { Alert, App, Checkbox, Empty, Input, Modal, Select, Space, Tag, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  errMsg,
  getReviewCandidates,
  submitReview,
  type MyDesignTask,
  type ReviewCandidate,
  type ReviewSelection,
} from '../api/client'

interface Props {
  task: MyDesignTask | null
  open: boolean
  onClose: () => void
  onDone: () => void
}

const SECTION_STYLE: React.CSSProperties = { marginBottom: 14 }

/** 提交评审：勾选草稿内容 → 一张任务级评审单（经理 → 总监，发布=冻结） */
export default function SubmitReviewModal({ task, open, onClose, onDone }: Props) {
  const { message } = App.useApp()
  const [cand, setCand] = useState<ReviewCandidate | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [tags, setTags] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    if (!task) return
    setLoading(true)
    try {
      const data = await getReviewCandidates(task.task_id)
      setCand(data)
      // ★ 总装图是设备父级：默认勾选（已传文件时）
      const init: Record<string, boolean> = {}
      data.drawings.forEach((d) => {
        if (d.drawing_no.endsWith('-00-00-00-00') && d.filename) init[`D:${d.drawing_no}`] = true
      })
      setChecked(init)
      setNote('')
      const t: Record<string, string> = {}
      data.source_tags.forEach((s) => {
        t[s.drawing_no] = s.source_type
      })
      setTags(t)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [task, message])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const selections: ReviewSelection[] = useMemo(() => {
    if (!cand) return []
    const out: ReviewSelection[] = []
    cand.drawings.forEach((d) => {
      if (checked[`D:${d.drawing_no}`]) out.push({ item_type: 'DRAWING', item_ref: d.drawing_no })
    })
    cand.std_bom.forEach((b) => {
      if (checked[`B:${b.id}`]) out.push({ item_type: 'BOM_DESIGN', item_ref: String(b.id) })
    })
    cand.material_bom.forEach((b) => {
      if (checked[`M:${b.id}`]) out.push({ item_type: 'BOM_MATERIAL', item_ref: String(b.id) })
    })
    cand.source_tags.forEach((s) => {
      const v = tags[s.drawing_no]
      if (checked[`S:${s.drawing_no}`] && v) {
        out.push({ item_type: 'SOURCE_TAG', item_ref: s.drawing_no, source_type: v })
      }
    })
    cand.programs.forEach((p) => {
      if (checked[`P:${p.program_id}`]) out.push({ item_type: 'PROGRAM', item_ref: String(p.program_id) })
    })
    return out
  }, [cand, checked, tags])

  const submit = async () => {
    if (!task) return
    if (!selections.length) {
      message.warning('至少勾一项内容')
      return
    }
    setSaving(true)
    try {
      await submitReview(task.task_id, selections, note)
      message.success('已提交评审：经理 → 总监，两级通过后发布冻结')
      onClose()
      onDone()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const isEmpty =
    cand != null &&
    !cand.drawings.length &&
    !cand.std_bom.length &&
    !cand.material_bom.length &&
    !cand.source_tags.length &&
    !cand.programs.length

  const toggle = (key: string, on: boolean) => setChecked((p) => ({ ...p, [key]: on }))

  return (
    <Modal
      title={`提交评审 · ${task?.task_no ?? ''} ${task?.profession ?? ''}`}
      open={open}
      width={700}
      onCancel={onClose}
      onOk={() => void submit()}
      confirmLoading={saving || loading}
      okText={`提交（已勾 ${selections.length} 项）`}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="发布 = 冻结"
        description="两级审核（经理 → 总监）都通过后，这一轮勾选的内容成为冻结版本；退回或撤回会解锁回草稿。"
      />
      {isEmpty && <Empty description="没有可提交的草稿内容 —— 先把图/BOM 建好" />}

      {!!cand?.drawings.length && (
        <div style={SECTION_STYLE}>
          <Typography.Text strong>图纸草稿</Typography.Text>
          <div style={{ marginTop: 6 }}>
            {cand.drawings.map((d) => (
              <div key={d.drawing_no}>
                <Checkbox
                  disabled={!d.filename}
                  checked={!!checked[`D:${d.drawing_no}`]}
                  onChange={(e) => toggle(`D:${d.drawing_no}`, e.target.checked)}
                >
                  {d.drawing_no} {d.title}
                  {d.drawing_no.endsWith('-00-00-00-00') && <Tag color="purple" style={{ marginLeft: 6 }}>总装图</Tag>}
                  <Tag style={{ marginLeft: 6 }}>{d.version}</Tag>
                  {d.filename ? <Tag color="green">已传文件</Tag> : <Tag color="orange">未传文件（请先上传）</Tag>}
                </Checkbox>
              </div>
            ))}
          </div>
        </div>
      )}

      {!!cand?.std_bom.length && (
        <div style={SECTION_STYLE}>
          <Typography.Text strong>设计 BOM 行（标准件 / 定制件）</Typography.Text>
          <div style={{ marginTop: 6 }}>
            {cand.std_bom.map((b) => (
              <div key={b.id}>
                <Checkbox checked={!!checked[`B:${b.id}`]} onChange={(e) => toggle(`B:${b.id}`, e.target.checked)}>
                  {b.parent_ref} ← {b.display_name} × {b.qty}
                  {b.unit ?? ''}
                </Checkbox>
              </div>
            ))}
          </div>
        </div>
      )}

      {!!cand?.material_bom.length && (
        <div style={SECTION_STYLE}>
          <Typography.Text strong>材料 BOM 行（原材料）</Typography.Text>
          <div style={{ marginTop: 6 }}>
            {cand.material_bom.map((b) => (
              <div key={b.id}>
                <Checkbox checked={!!checked[`M:${b.id}`]} onChange={(e) => toggle(`M:${b.id}`, e.target.checked)}>
                  {b.parent_ref} ← {b.display_name} × {b.qty}
                  {b.unit ?? ''}
                </Checkbox>
              </div>
            ))}
          </div>
        </div>
      )}

      {!!cand?.source_tags.length && (
        <div style={SECTION_STYLE}>
          <Typography.Text strong>自制 / 外协 判定（工艺）</Typography.Text>
          <div style={{ marginTop: 6 }}>
            {cand.source_tags.map((s) => (
              <Space key={s.drawing_no} style={{ display: 'flex', marginBottom: 4 }}>
                <Checkbox
                  checked={!!checked[`S:${s.drawing_no}`]}
                  onChange={(e) => toggle(`S:${s.drawing_no}`, e.target.checked)}
                >
                  {s.drawing_no} {s.title}
                </Checkbox>
                <Select
                  size="small"
                  style={{ width: 110 }}
                  value={tags[s.drawing_no]}
                  onChange={(v) => setTags((p) => ({ ...p, [s.drawing_no]: v }))}
                  options={['自制件', '外协件', '定制件'].map((v) => ({ value: v, label: v }))}
                />
              </Space>
            ))}
          </div>
        </div>
      )}

      {!!cand?.programs.length && (
        <div style={SECTION_STYLE}>
          <Typography.Text strong>PLC 程序版本</Typography.Text>
          <div style={{ marginTop: 6 }}>
            {cand.programs.map((p) => (
              <div key={p.program_id}>
                <Checkbox
                  disabled={!p.filename}
                  checked={!!checked[`P:${p.program_id}`]}
                  onChange={(e) => toggle(`P:${p.program_id}`, e.target.checked)}
                >
                  {p.name}
                  <Tag style={{ marginLeft: 6 }}>{p.version}</Tag>
                  {p.filename ? <Tag color="green">已传文件</Tag> : <Tag color="orange">未传文件（请先上传）</Tag>}
                </Checkbox>
              </div>
            ))}
          </div>
        </div>
      )}

      <Typography.Text strong>提交说明</Typography.Text>
      <Input.TextArea
        rows={2}
        style={{ marginTop: 6 }}
        placeholder="这次交了什么 / 改了什么（可留空）"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </Modal>
  )
}
