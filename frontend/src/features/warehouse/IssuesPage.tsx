import { App, Button, Input, Modal, Spin } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { api, errMsg } from '../../api/client'
import { MCard, MChip, MEmpty, MGroup, MHead, MStatus } from '../../components/ds/mobile'

interface IssueLine {
  id: number
  item_no: string
  display_name: string
  spec_text?: string | null
  unit?: string | null
  qty_required: number
  qty_picked?: number
  qty_issued: number
  location_name?: string | null
  shortage: boolean
  for_part?: string | null
}

interface IssueRow {
  id: number
  issue_no: string
  project_no: string
  equip_no?: string | null
  status: string
  lines: IssueLine[]
}

/** 手机端领料（R4-b · 2026-10-04 重做）：备料 → 车间领走（03 卷：清单 + 勾选 + 拍照）
 *
 * 改动：`Typography` 堆叠 + 未用到的三量 → 作业卡；一张单 = 一张卡，卡里把**缺料行**直接标出来
 * （原来"缺料"只是个 Tag，看不出缺多少、补货后能不能继续备）。
 * 三量口径（N24）：已备 = `qty_picked`、已领 = `qty_issued`，缺料 = `shortage`。
 */
export default function IssuesM() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<IssueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [handOverId, setHandOverId] = useState<number | null>(null)
  const [handOverTo, setHandOverTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<IssueRow[]>('/warehouse/issues')
      setRows(data)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (id: number, action: 'pick' | 'hand-over') => {
    if (action === 'hand-over') {
      // 领料人用弹窗录入（P-12：不再用浏览器原生 prompt）
      setHandOverId(id)
      setHandOverTo('')
      return
    }
    setBusyId(id)
    try {
      const res = await api.post<{ ok: boolean; status: string }>(`/warehouse/issues/${id}/pick`, {})
      // ★ 走查 2026-10-04 P2：部分领料再备后如实说清（还有缺料 → 补货后可在本页继续备）
      message.success(res.data.status === '部分领料' ? '已备料（仍有缺料，补货后可在本页继续备）' : '已备料')
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setBusyId(null)
    }
  }

  const doHandOver = async () => {
    if (!handOverId) return
    if (!handOverTo.trim()) {
      message.warning('请填领料人（谁领走的）')
      return
    }
    const id = handOverId
    setBusyId(id)
    try {
      await api.post(`/warehouse/issues/${id}/hand-over`, { issued_to: handOverTo.trim() })
      message.success('已领走')
      setHandOverId(null)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setBusyId(null)
    }
  }

  const open = rows.filter((r) => r.status === '待备料' || r.status === '已备料' || r.status === '部分领料')
  const totalShort = open.reduce((a, r) => a + r.lines.filter((l) => l.shortage).length, 0)

  return (
    <>
      <Spin spinning={loading}>
        <MHead
          title="领料"
          sub={
            open.length
              ? `${open.length} 张单待处理${totalShort ? ` · ${totalShort} 行缺料` : ''}`
              : '没有待办的领料单'
          }
        />

        {!open.length && !loading && (
          <MEmpty text="没有待办领料单。车间排产后会生成领料单，仓库备好料车间再领走。" />
        )}

        {open.map((r) => {
          const short = r.lines.filter((l) => l.shortage)
          const done = r.lines.filter((l) => !l.shortage).length
          const tone = short.length ? 'warn' : r.status === '已备料' ? 'ok' : 'run'
          return (
            <MCard
              key={r.id}
              tone={tone}
              head={
                <>
                  <span className="ds-code" style={{ fontSize: 12 }}>
                    {r.issue_no}
                  </span>
                  <MStatus tone={tone}>{r.status}</MStatus>
                </>
              }
              title={`${r.project_no} ${r.equip_no ?? ''}`.trim()}
              lines={[
                <>
                  {r.lines.length} 种物料 · 已齐 {done} 行
                  {short.length ? (
                    <>
                      {' '}
                      · <b>缺 {short.length} 行</b>
                    </>
                  ) : null}
                </>,
              ]}
            >
              {/* 缺料行单独列清楚（哪一行缺、缺多少、从哪备）—— 手机上一眼要能看出"还差什么" */}
              {!!short.length && (
                <>
                  <MGroup title="缺料行" sub="补货后可在本页继续备料" />
                  {short.map((ln) => (
                    <div className="m-row" key={ln.id}>
                      <div className="m-row-tx">
                        <div className="m-row-t">{ln.display_name}</div>
                        <div className="m-row-s">
                          应领 {ln.qty_required} {ln.unit ?? ''}
                          {ln.qty_picked ? ` · 已备 ${ln.qty_picked}` : ''}
                          {ln.location_name ? ` · ${ln.location_name}` : ''}
                        </div>
                      </div>
                      <div className="m-row-r">
                        <MChip tone="err">缺</MChip>
                      </div>
                    </div>
                  ))}
                </>
              )}

              <div className="m-actions">
                {(r.status === '待备料' || r.status === '部分领料') && (
                  <Button
                    block
                    type={r.status === '部分领料' ? 'default' : 'primary'}
                    loading={busyId === r.id}
                    onClick={() => void act(r.id, 'pick')}
                  >
                    {r.status === '部分领料' ? '继续备料' : '备料完成'}
                  </Button>
                )}
                {(r.status === '已备料' || r.status === '部分领料') && (
                  <Button block type="primary" loading={busyId === r.id} onClick={() => void act(r.id, 'hand-over')}>
                    车间领走
                  </Button>
                )}
              </div>
            </MCard>
          )
        })}
      </Spin>

      <Modal
        className="engineering-modal"
        title="车间领走"
        open={handOverId !== null}
        onCancel={() => setHandOverId(null)}
        onOk={() => void doHandOver()}
        confirmLoading={busyId !== null}
        okText="确认领走"
        okButtonProps={{ disabled: !handOverTo.trim() }}
        destroyOnHidden
      >
        <div style={{ fontSize: 12.5, color: 'var(--ds-ink3)', marginBottom: 8 }}>
          领料人必填 —— 谁从仓库领走的，后面追溯就靠这一笔。
        </div>
        <Input
          value={handOverTo}
          onChange={(e) => setHandOverTo(e.target.value)}
          placeholder="领料人（车间），如：李四"
        />
      </Modal>
    </>
  )
}
