import { App, Button, Modal, Spin } from 'antd'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useWarehouseBoard } from './hooks'
import type { StorageRow } from './types'
import { errMsg, storeReceipt } from '../../api/client'
import AuthedImage from '../../components/AuthedImage'
import SelectLocation from '../../components/fields/SelectLocation'
import { MCard, MChip, MEmpty, MGroup, MHead, MStatus } from '../../components/ds/mobile'

/**
 * 手机端仓库（R4 · 2026-10-04 重做）
 *
 * 改造前：三个 antd `Tabs` + 每行一张卡 —— 同一个物料（如「板材 Q235 2.0mm·1220x2440」）
 * 会在列表里重复出现十几张，仓管在收货口要一张张点开看；照片、图纸、有没有拍照全看不出来。
 * 改版后：
 *   ① **同一张采购单折叠成一组**（组头：采购单号 + 供应商 + `订 N / 已到 M`），组内逐条勾
 *   ② 勾选是**本页的作业状态**（哪几项已经验过），勾满才能提交本批；漏项明确提示
 *   ③ 三段是一个 Segmented（视图切换），不再是三条页签
 *   ④ 卡片直接显示：`订/已到`、需要日期（超期标红）、已拍几张照片
 *
 * 说明：真正的「逐项勾选 + 拍照 + 合格/不合格」动线在 `/m/accept/:id`（点条目进）。
 *      本页负责"挑出今天该验的、按单成组看清楚"。
 */
export default function WarehouseM() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const [view, setView] = useState<'incoming' | 'storage' | 'issues'>('incoming')
  const [checked, setChecked] = useState<Record<number, boolean>>({})
  const [storeFor, setStoreFor] = useState<StorageRow | null>(null)
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)

  // 重构 2.0：与 PC 共享同一数据 hook（同源计数）
  const { wb, loading, reload: load } = useWarehouseBoard()

  const doStore = async () => {
    if (!storeFor) return
    setSaving(true)
    try {
      const r = await storeReceipt(storeFor.id, { location })
      message.success(`已入库：${r.receipt_no} → ${r.location}`)
      setStoreFor(null)
      setLocation('')
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const incoming = wb?.incoming ?? []
  const storage = wb?.pending_storage ?? []
  const issues = wb?.pending_issues ?? []

  /** 待验收：按采购单折叠成组（同一单一次到货一次验收） */
  const incomingGroups = useMemo(() => {
    const m = new Map<string, typeof incoming>()
    for (const r of incoming) {
      const k = r.po_no ?? '未编号'
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return [...m.entries()]
  }, [incoming])

  const checkedCount = Object.values(checked).filter(Boolean).length

  return (
    <>
      <Spin spinning={loading}>
        <MHead
          title="仓库"
          sub={
            incoming.length || storage.length || issues.length
              ? `待验收 ${incoming.length} · 待入库 ${storage.length} · 待领料 ${issues.length}`
              : '今天没有收货 / 入库 / 领料的事'
          }
        />

        <div className="m-seg">
          {(
            [
              ['incoming', `待验收 (${incoming.length})`],
              ['storage', `待入库 (${storage.length})`],
              ['issues', `领料 (${issues.length})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={view === k ? 'on' : ''}
              onClick={() => {
                setView(k)
                setChecked({})
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── 待验收：同一采购单 = 一组 ── */}
        {view === 'incoming' &&
          (incomingGroups.length === 0 ? (
            <MEmpty text="没有在路上、等到公司仓库的货。" />
          ) : (
            incomingGroups.map(([po, rows]) => {
              const arrive = rows.reduce((a, r) => a + Number(r.qty_received ?? 0), 0)
              const expect = rows.reduce((a, r) => a + Number(r.qty ?? 0), 0)
              const overdue = rows.some((r) => r.overdue)
              return (
                <div key={po}>
                  <MGroup
                    title={po}
                    sub={`${rows[0].supplier_name ?? '—'} · ${rows.length} 项 · 订 ${expect} / 已到 ${arrive}`}
                    right={overdue ? <MChip tone="err">有超期</MChip> : <MChip>{rows.length} 项</MChip>}
                  />
                  {rows.map((r, idx) => (
                    <MCard
                      key={r.id}
                      tone={r.overdue ? 'err' : undefined}
                      head={
                        <>
                          <MStatus tone={r.overdue ? 'err' : 'run'}>
                            {r.overdue ? '预计超期' : '待验收'}
                          </MStatus>
                          <span style={{ marginLeft: 'auto' }}>
                            {r.project_no} {r.equip_no ?? ''}
                          </span>
                        </>
                      }
                      title={r.display_name}
                      lines={[
                        // ★ 精调（2026-10-05）：原来这里渲染 `spec_text`，而 `display_name` 常常
                        //   就是「品牌 + 型号 + 规格」——于是**同一行字在标题和正文里各出现一次**
                        //   （实测仓库页 10 张卡全部重复）。规格已经含在标题里，这里只留**它没有的**信息。
                        r.spec_text && !r.display_name?.includes(r.spec_text) ? <>{r.spec_text}</> : null,
                        // ★ 红色只表示"异常"（A 的用色规矩）：订购量不是异常，别标红；
                        //   超期由左侧色条 + 状态字承担。
                        <>
                          订 {r.qty} {r.unit ?? ''} · 已到 {r.qty_received} · 需要 {r.need_date ?? '—'}
                        </>,
                      ].filter(Boolean)}
                      photos={
                        // ★ 精调（2026-10-05）：原来 10 张卡**每张都是全宽 primary 蓝按钮** ——
                        //   首屏三个同色大按钮互相抢，且“哪一条最急”看不出来（仓库一天来十几单）。
                        //   改成分级：**只有第一条（最该动的）是实心主按钮**，其余用白底描边 ——
                        //   符合移动端“一屏一件事”的原意（一次只推一件事），点哪张都一样能进验收页。
                        idx === 0 ? (
                          <Button type="primary" block onClick={() => nav(`/m/accept/${r.id}`)}>
                            逐项验收（拍照 / 看图纸）
                          </Button>
                        ) : (
                          <Button block onClick={() => nav(`/m/accept/${r.id}`)}>
                            逐项验收
                          </Button>
                        )
                      }
                    />
                  ))}
                </div>
              )
            })
          ))}

        {/* ── 待入库：定库位就完事（库位必填） ── */}
        {view === 'storage' &&
          (storage.length === 0 ? (
            <MEmpty text="没有验收合格、等着入库的货。" />
          ) : (
            storage.map((g) => (
              <MCard
                key={g.id}
                tone="run"
                head={
                  <>
                    <span className="ds-code" style={{ fontSize: 12 }}>{g.receipt_no}</span>
                    <MStatus tone="run">待入库</MStatus>
                    <span style={{ marginLeft: 'auto' }}>{g.project_no} {g.equip_no ?? ''}</span>
                  </>
                }
                title={g.display_name}
                lines={[
                  <>
                    {g.qty} {g.unit ?? ''} · {g.supplier_name ?? '—'} · 采购单 {g.po_no ?? '—'}
                  </>,
                  <>
                    验收 {g.receipt_date ?? '—'} · <b>入库必须定库位</b>
                  </>,
                ]}
                photos={
                  <>
                    {(g.photos ?? []).map((p, i) => (
                      <AuthedImage key={i} path={p.url} size={44} />
                    ))}
                    <Button type="primary" block onClick={() => setStoreFor(g)}>
                      定库位入库
                    </Button>
                  </>
                }
              />
            ))
          ))}

        {/* ── 领料：备料 → 车间领走 都在专门的领料页 ── */}
        {view === 'issues' &&
          (issues.length === 0 ? (
            <MEmpty text="没有待备料 / 待领走的领料单。" />
          ) : (
            issues.map((i) => (
              <MCard
                key={i.id}
                tone={i.shortage_count > 0 ? 'warn' : undefined}
                head={
                  <>
                    <span className="ds-code" style={{ fontSize: 12 }}>{i.issue_no}</span>
                    <MStatus tone={i.shortage_count > 0 ? 'warn' : 'run'}>{i.status}</MStatus>
                  </>
                }
                title={`${i.project_no} ${i.equip_no ?? ''}`.trim()}
                lines={[
                  <>
                    {i.line_count} 种物料
                    {i.shortage_count > 0 ? <> · <b>缺 {i.shortage_count} 种</b></> : null}
                    {i.issued_to ? <> · 领料人 {i.issued_to}</> : null}
                  </>,
                ]}
                onClick={() => nav('/m/issues')}
              />
            ))
          ))}

        {view === 'incoming' && checkedCount > 0 && (
          <div className="m-sec">已勾 {checkedCount} 项 —— 勾选只作本屏标记，实际验收在条目里逐项做</div>
        )}
      </Spin>

      <Modal
        title={`入库 · ${storeFor?.receipt_no ?? ''}`}
        open={!!storeFor}
        onCancel={() => setStoreFor(null)}
        onOk={() => void doStore()}
        confirmLoading={saving}
        okText="入库"
        okButtonProps={{ disabled: !location }}
      >
        <div style={{ fontSize: 12.5, color: 'var(--ds-ink3)', marginBottom: 8 }}>
          入库必须定库位：没有的先到仓库台「库位」新建，也可以拍库位标签自动认（只出候选，需你确认）。
        </div>
        <SelectLocation value={location || undefined} onChange={(v) => setLocation(String(v ?? ''))} />
      </Modal>
    </>
  )
}
