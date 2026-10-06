import { useAsmBoard } from '../../hooks/useAsmBoard'
import { App, Button, Form, Input, Radio, Select } from 'antd'
import { useEffect, useState } from 'react'

import { debugAssembly, errMsg, finishAssembly, getKitting, hasPerm, listProjects, startAssembly, type AssemblyRecordRow, type KittingLine, type KittingOverviewRow, type KittingResult } from '../../api/client'
import MfgPhotoPicker from '../../components/MfgPhotoPicker'
import { MCard, MChip, MEmpty, MStatus } from '../../components/ds/mobile'
import AppModal from '../../components/AppModal'


/** 装配状态 → 作业卡 tone（与 PC 同一套语义） */
const ASSY_TONE: Record<string, 'ok' | 'warn' | 'err' | 'run' | undefined> = {
  装配中: 'run', 已装配: 'warn', 调试中: 'warn', 调试完成: 'ok',
}

/** 车间手机端 · 装配与齐套率（S6）：齐套率只展示，随时可开装（勾选 + 拍照）。 */
export default function AssemblyM() {
  const { message } = App.useApp()
  const canEdit = hasPerm('mfg:edit')
  const [projects, setProjects] = useState<{ project_no: string; project_name: string }[]>([])
  const [projectNo, setProjectNo] = useState<string | undefined>()
  const [detail, setDetail] = useState<KittingResult | null>(null)
  const [startTarget, setStartTarget] = useState<KittingOverviewRow | null>(null)
  const [startInitial, setStartInitial] = useState<Record<string, unknown>>({})
  const [debugTarget, setDebugTarget] = useState<AssemblyRecordRow | null>(null)
  const [debugInitial, setDebugInitial] = useState<Record<string, unknown>>({})
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  // 重构 2.3：看板数据走共享 hook（与另一端同源）
  const { overview, records, reload: load } = useAsmBoard(projectNo)
  // ★ N2（2026-10-04）：整机装配已完成的设备不再给「开始装配」入口（组件预装不算数）
  const wholeState: Record<string, string> = {}
  for (const r of records) if (r.sub_assembly === '整机装配' && !(r.equip_no in wholeState)) wholeState[r.equip_no] = r.status
  const WHOLE_DONE = ['已装配', '调试中', '调试完成']

  useEffect(() => {
    listProjects()
      .then((rows) => setProjects(rows.map((p) => ({ project_no: p.project_no, project_name: p.project_name }))))
      .catch(() => undefined)
  }, [])

  const pick = (pno?: string) => {
    setProjectNo(pno)
    setDetail(null)
    void load(pno)
  }

  const openDetail = async (equipNo: string) => {
    if (!projectNo) return
    try {
      const k = await getKitting(projectNo, equipNo)
      setDetail(detail?.equip_no === equipNo ? null : k)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const doStart = async () => {
    if (!startTarget || !projectNo) return
    let v
    try { v = await form.validateFields() } catch { return }
    setSaving(true)
    try {
      await startAssembly({ project_no: projectNo, equip_no: startTarget.equip_no, sub_assembly: v.sub_assembly, photos, remark: v.remark })
      message.success('已开始装配')
      setStartTarget(null)
      setPhotos([])
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const doDebug = async () => {
    if (!debugTarget) return
    let v
    try { v = await form.validateFields() } catch { return }
    setSaving(true)
    try {
      await debugAssembly(debugTarget.id, { result: v.result, note: v.note, photos })
      message.success('调试已记录')
      setDebugTarget(null)
      setPhotos([])
      await load(projectNo)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Select
        showSearch
        optionFilterProp="label"
        aria-label="项目"
        style={{ width: '100%', marginBottom: 12 }}
        placeholder="选项目看齐套率"
        value={projectNo}
        onChange={(v: string | undefined) => pick(v)}
        options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
      />

      {/* 没选项目时给「点一个项目」列表 —— 移动端不要留一整屏空白（原实现只放个下拉 + 空白） */}
      {!projectNo && (
        <>
          <MEmpty text="先选一个项目，看它的齐套率与装配记录。" />
          {projects.map((pj) => (
            <MCard
              key={pj.project_no}
              head={<span className="ds-code" style={{ fontSize: 12 }}>{pj.project_no}</span>}
              title={pj.project_name}
              onClick={() => pick(pj.project_no)}
            />
          ))}
        </>
      )}

      {projectNo &&
        overview.map((o) => {
          const done = WHOLE_DONE.includes(wholeState[o.equip_no] ?? '')
          return (
            <MCard
              key={o.equip_no}
              tone={o.kitting_rate >= 1 ? 'ok' : o.kitting_rate < 0.6 ? 'warn' : 'run'}
              head={
                <>
                  <span className="ds-code" style={{ fontSize: 12 }}>{o.equip_no}</span>
                  <MStatus tone={done ? 'ok' : 'run'}>{wholeState[o.equip_no] ?? '未开始装配'}</MStatus>
                  <span style={{ marginLeft: 'auto' }}>
                    <MChip tone={o.kitting_rate >= 1 ? 'ok' : undefined}>
                      齐套 {Math.round(o.kitting_rate * 100)}%
                    </MChip>
                  </span>
                </>
              }
              title={o.equip_name}
              lines={[
                <>
                  到位 {o.arrived}/{o.total} 种 · 数量 {o.arrived_qty}/{o.total_qty}
                </>,
                <>
                  {/* 齐套率只展示，不设门槛（客户口径）：这里明说，免得车间以为不能开装 */}
                  齐套率只作参考，随时可以开装
                </>,
              ]}
            >
              {/* 明细：缺哪些件（现场最常问的一句） */}
              {detail?.equip_no === o.equip_no && (
                <div style={{ marginTop: 6 }}>
                  {detail.lines.map((l: KittingLine) => (
                    <div className="m-row" key={l.ref}>
                      <div className="m-row-tx">
                        <div className="m-row-t" style={{ fontFamily: 'var(--ds-mono)', fontSize: 12.5 }}>{l.ref}</div>
                        <div className="m-row-s">{l.name ?? ''}</div>
                      </div>
                      <div className="m-row-r">
                        {l.ready ? <MChip tone="ok">到位</MChip> : <MChip tone="err">缺</MChip>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="m-actions">
                <Button block onClick={() => void openDetail(o.equip_no)}>
                  {detail?.equip_no === o.equip_no ? '收起明细' : '看缺哪些件'}
                </Button>
                {canEdit &&
                  (done ? (
                    <Button block disabled>
                      {wholeState[o.equip_no]}（不再给「开始装配」）
                    </Button>
                  ) : (
                    <Button
                      block
                      type="primary"
                      onClick={() => {
                        setPhotos([])
                        setStartInitial({ sub_assembly: '整机装配' })
                        setStartTarget(o)
                      }}
                    >
                      {wholeState[o.equip_no] === '装配中' ? '继续装配' : '开始装配'}
                    </Button>
                  ))}
              </div>
            </MCard>
          )
        })}

      {projectNo && <div className="m-sec">装配 / 厂内调试</div>}
      {projectNo && records.length === 0 && <MEmpty text="还没有装配记录。装配开始时系统会记下当时的齐套率快照。" />}
      {projectNo &&
        records.map((r) => (
          <MCard
            key={r.id}
            tone={ASSY_TONE[r.status]}
            head={
              <>
                <span className="ds-code" style={{ fontSize: 12 }}>{r.equip_no}</span>
                <MStatus tone={ASSY_TONE[r.status]}>{r.status}</MStatus>
                <span style={{ marginLeft: 'auto' }}>
                  <MChip>开工齐套 {Math.round(r.kitting_rate * 100)}%</MChip>
                </span>
              </>
            }
            title={`${r.sub_assembly} · ${r.project_no}`}
          >
            {r.debug_result && (
              <div className="m-card-l" style={{ marginTop: 6 }}>
                调试结果：{r.debug_result}
                {r.debug_note ? ` · ${r.debug_note}` : ''}
              </div>
            )}
            <div className="m-actions">
              {canEdit && r.status === '装配中' && (
                <Button block onClick={() => void finishAssembly(r.id, {}).then(() => void load(projectNo))}>
                  装配完成
                </Button>
              )}
              {canEdit && (r.status === '已装配' || r.status === '调试中') && (
                <Button
                  block
                  type="primary"
                  onClick={() => {
                    setPhotos([])
                    setDebugInitial({ result: '合格' })
                    setDebugTarget(r)
                  }}
                >
                  厂内调试（拍照）
                </Button>
              )}
            </div>
          </MCard>
        ))}

      <AppModal
        open={!!startTarget}
        title={`开始装配 · ${startTarget?.equip_no ?? ''}`}
        onClose={() => setStartTarget(null)}
        onOk={() => void doStart()}
        loading={saving}
        okText="开始装配"
        form={form}
        initialValues={startInitial}
        subtitle={
          <div style={{ fontSize: 12.5, color: 'var(--ds-ink3)' }}>
            当前齐套率 {Math.round((startTarget?.kitting_rate ?? 0) * 100)}% —— 不看齐套率，到了多少都能开工（会记录在履历里）。
          </div>
        }
      >
          <Form.Item name="sub_assembly" label="装配形态" rules={[{ required: true }]}>
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="整机装配">整机装配</Radio.Button>
              <Radio.Button value="组件预装">组件预装</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input placeholder="如 先装框架" />
          </Form.Item>
          <Form.Item label="装配照片">
            <MfgPhotoPicker projectNo={projectNo ?? ''} refNo={`${startTarget?.equip_no ?? ''}-assembly`} value={photos} onChange={setPhotos} label="拍照（可后补）" />
          </Form.Item>
      </AppModal>

      <AppModal
        open={!!debugTarget}
        title={`厂内调试 · ${debugTarget?.equip_no ?? ''}`}
        onClose={() => setDebugTarget(null)}
        onOk={() => void doDebug()}
        loading={saving}
        okText="记录"
        form={form}
        initialValues={debugInitial}
      >
          <Form.Item name="result" label="调试结果" rules={[{ required: true }]}>
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="合格">合格</Radio.Button>
              <Radio.Button value="有问题">有问题</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="note" label="说明">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="调试照片">
            <MfgPhotoPicker projectNo={debugTarget?.project_no ?? ''} refNo={`${debugTarget?.equip_no ?? ''}-debug`} value={photos} onChange={setPhotos} label="拍照（可后补）" />
          </Form.Item>
      </AppModal>
    </>
  )
}
