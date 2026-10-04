import { useAsmBoard } from '../../hooks/useAsmBoard'
import { App, Button, Card, Empty, Form, Input, Progress, Radio, Select, Space, Tag, Typography } from 'antd'
import {useEffect, useState} from 'react'

import {
  debugAssembly,
  errMsg,
  finishAssembly,
  getKitting,
  hasPerm,
  listProjects,
  startAssembly,
  type AssemblyRecordRow,
  type KittingLine,
  type KittingOverviewRow,
  type KittingResult,
} from '../../api/client'
import MfgPhotoPicker from '../../components/MfgPhotoPicker'
import AppModal from '../../components/AppModal'
import { ASSEMBLY_STATUS as STATUS_COLOR } from '../../theme/status'
import { T } from '../../theme/tokens'

const rateColor = (r: number) => (r >= 1 ? T.success : r >= 0.6 ? T.brand : T.warning)

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
        style={{ width: '100%', marginBottom: 12 }}
        placeholder="选项目看齐套率"
        value={projectNo}
        onChange={(v: string | undefined) => pick(v)}
        options={projects.map((p) => ({ value: p.project_no, label: `${p.project_no} ${p.project_name}` }))}
      />

      {projectNo &&
        overview.map((o) => (
          <Card
            key={o.equip_no}
            size="small"
            style={{ marginBottom: 10 }}
            title={`${o.equip_no} ${o.equip_name}`}
            extra={<a onClick={() => void openDetail(o.equip_no)}>{detail?.equip_no === o.equip_no ? '收起' : '明细'}</a>}
          >
            <Progress percent={Math.round(o.kitting_rate * 100)} strokeColor={rateColor(o.kitting_rate)} />
            <div style={{ fontSize: 12, color: T.textSecondary }}>
              到位 {o.arrived}/{o.total} 种 · 数量 {o.arrived_qty}/{o.total_qty}
            </div>
            <Space style={{ marginTop: 8 }}>
              {canEdit && (
                WHOLE_DONE.includes(wholeState[o.equip_no] ?? '') ? (
                  <Tag color="success">{wholeState[o.equip_no]}</Tag>
                ) : (
                  <Button size="small" type="primary" onClick={() => { setPhotos([]); setStartInitial({ sub_assembly: '整机装配' }); setStartTarget(o) }}>
                    {wholeState[o.equip_no] === '装配中' ? '继续装配' : '开始装配'}
                  </Button>
                )
              )}
            </Space>
            {detail?.equip_no === o.equip_no && (
              <div style={{ marginTop: 8 }}>
                {detail.lines.map((l: KittingLine) => (
                  <div key={l.ref} style={{ fontSize: 12, padding: '3px 0', borderBottom: `1px solid ${T.border}` }}>
                    <span>{l.ref}</span>{' '}
                    {l.ready ? <Tag color="success">{l.state}</Tag> : <Tag color="error">缺 · {l.state}</Tag>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}

      {projectNo && <Typography.Title level={5}>装配 / 厂内调试</Typography.Title>}
      {projectNo && records.length === 0 && <Empty description="还没有装配记录" />}
      {projectNo &&
        records.map((r) => (
          <Card key={r.id} size="small" style={{ marginBottom: 10 }}>
            <Space>
              <Tag color={STATUS_COLOR[r.status] ?? 'default'}>{r.status}</Tag>
              <Typography.Text>{r.equip_no}</Typography.Text>
              <Tag color={rateColor(r.kitting_rate)}>开工齐套 {Math.round(r.kitting_rate * 100)}%</Tag>
            </Space>
            <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 4 }}>{r.sub_assembly} · {r.project_no}</div>
            {r.debug_result && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                调试：<Tag color={r.debug_result === '合格' ? 'success' : 'error'}>{r.debug_result}</Tag> {r.debug_note}
              </div>
            )}
            <Space style={{ marginTop: 8 }}>
              {canEdit && r.status === '装配中' && (
                <Button size="small" onClick={() => void finishAssembly(r.id, {}).then(() => void load(projectNo))}>
                  装配完成
                </Button>
              )}
              {canEdit && (r.status === '已装配' || r.status === '调试中') && (
                <Button size="small" type="primary" onClick={() => { setPhotos([]); setDebugInitial({ result: '合格' }); setDebugTarget(r) }}>
                  厂内调试
                </Button>
              )}
            </Space>
          </Card>
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
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            当前齐套率 <b>{Math.round((startTarget?.kitting_rate ?? 0) * 100)}%</b> —— 不看齐套率，到了多少都能开工（会记录在履历里）。
          </Typography.Paragraph>
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
