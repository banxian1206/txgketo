import { CameraOutlined, FileTextOutlined } from '@ant-design/icons'
import { Alert, App, Button, DatePicker, Empty, Image, Input, InputNumber, Modal, Radio, Select, Space, Spin, Typography } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import AuthedImage from '../../components/AuthedImage'
import SelectLocation from '../../components/fields/SelectLocation'
import { MCard, MChip, MEmpty, MHead, MStatus } from '../../components/ds/mobile'
import { errMsg, fetchFileBlob, hasPerm, inspectPurchase, mobileMaterial, storeReceipt, uploadReceiptPhotos, type MobileMaterial } from '../../api/client'
import { compressImage } from '../../utils/image'

/** 到货单状态 → 作业卡 tone（与 PC 同一套语义，只此一处翻译） */
const RECEIPT_TONE: Record<string, 'ok' | 'warn' | 'err' | 'run' | undefined> = {
  已入库: 'ok', 现场已验收: 'ok', 不合格: 'err', 已退货: 'err', 已换货: 'warn',
  待入库: 'run', 现场待验收: 'warn',
}
const toneOfReceipt = (st: string) => RECEIPT_TONE[st]

/** 动线步骤标（① 拍照 → ② 验货 → ③ 入库）—— 手机上明确"现在这步干什么" */
function MStep({ n, text }: { n: number; text: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          width: 20, height: 20, borderRadius: 999, background: 'var(--ds-acc)', color: 'var(--ds-surface)',
          fontSize: 12, fontWeight: 600, display: 'inline-grid', placeItems: 'center',
        }}
      >
        {n}
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{text}</span>
    </span>
  )
}

/** 手机端到货验收动线（03 卷）：看电子图纸 → 拍照 → 合格/不合格 → 入库 */
export default function AcceptM() {
  const { requestId } = useParams()
  const { message } = App.useApp()
  const nav = useNavigate()
  const [data, setData] = useState<MobileMaterial | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // ★ 2026-09-30 UI 真实场景测试 P1-3：清空「本次到货数量」曾静默变成 1
  //   （`Number(v ?? 1)`）→ 订 40 件记成 1 件，库存/齐套/对账全偏小且没人报。
  //  现在留 null 状态，提交时拦住并说清楚。
  const [qty, setQty] = useState<number | null>(null)
  const [qtyOk, setQtyOk] = useState<number | null>(null)
  const [poLineId, setPoLineId] = useState<number | null>(null)
  const [result, setResult] = useState<'合格' | '不合格'>('合格')
  const [note, setNote] = useState('')
  const [receiptDate, setReceiptDate] = useState(dayjs())
  const [photos, setPhotos] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [viewer, setViewer] = useState<{ url?: string; type?: string } | null>(null)
  const [storeFor, setStoreFor] = useState<{ id: number; no: string } | null>(null)
  const [location, setLocation] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const canStore = hasPerm('warehouse:edit')

  const load = useCallback(async () => {
    if (!requestId) return
    setLoading(true)
    try {
      const d = await mobileMaterial(Number(requestId))
      setData(d)
      // ★ 走查 2026-10-04 P3：剩余为 0 时**不再**用 0.001 兜底预填（会提交出费解的 400）；
      //   留 null + 显示「已全部到货」+ 提交置灰。
      const remaining = Number(d.qty ?? 0) - Number(d.qty_received ?? 0)
      setQty(remaining > 1e-9 ? remaining : null)
      // ★ N12：拆单时默认选唯一一行；多行让仓库自己选
      setPoLineId(d.lines && d.lines.length === 1 ? d.lines[0].po_line_id : null)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [requestId, message])

  useEffect(() => {
    void load()
  }, [load])

  const openDrawing = async () => {
    if (!data?.drawing) return
    try {
      const r = await fetchFileBlob(data.drawing.file_url)
      setViewer({ url: r.url, type: r.type })
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return
    const picked: File[] = []
    for (const f of Array.from(files).slice(0, 6)) picked.push(await compressImage(f))
    setPhotos((p) => [...p, ...picked])
    setPreviews((p) => [...p, ...picked.map((f) => URL.createObjectURL(f))])
  }

  const doInspect = async () => {
    if (!data) return
    const remaining = Number(data.qty ?? 0) - Number(data.qty_received ?? 0)
    if (remaining <= 1e-9) {
      message.warning('这个需求已经全部到货了（没有可验收的数量）—— 如有多送，请走采购的换货/退货')
      return
    }
    if (qty === null || Number.isNaN(qty) || qty <= 0) {
      message.warning('请填「本次到货数量」—— 这是入库和结算的依据，不能空着')
      return
    }
    if (qty > remaining + 1e-9) {
      message.warning(`本次到货不能超过未到数量 ${remaining} ${data.unit ?? ''}`)
      return
    }
    setSaving(true)
    try {
      const qtyOkVal = result === '合格' && qtyOk !== null ? qtyOk : undefined
      const res = await inspectPurchase(data.project_no, data.id, {
        receipt_date: receiptDate.format('YYYY-MM-DD'),
        qty,
        result,
        qty_ok: qtyOkVal,
        qty_rejected: qtyOkVal !== undefined ? Math.max(0, qty - qtyOkVal) : undefined,
        po_line_id: poLineId ?? undefined,
        note: note || undefined,
      })
      if (photos.length) await uploadReceiptPhotos(res.receipt_id, photos)
      message.success(
        result === '合格'
          ? `验收合格 → ${res.receipt_no} 待入库`
          : `验收不合格：${res.receipt_no} 已退回采购协商`,
      )
      setPhotos([])
      setPreviews([])
      setNote('')
      await load()
      if (result === '合格') setStoreFor({ id: res.receipt_id, no: res.receipt_no })
      setResult('合格')
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

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

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin />
      </div>
    )
  }
  if (!data) return <Empty description="找不到这条采购需求" />

  const pendingStorage = data.receipts.filter((g) => g.status === '待入库')
  const remaining = Number(data.qty ?? 0) - Number(data.qty_received ?? 0)
  const fullyReceived = remaining <= 1e-9

  return (
    <>
      <Button block onClick={() => nav('/m/warehouse')}>
        ← 返回仓库
      </Button>

      <MHead
        title={data.display_name}
        sub={
          <>
            {data.spec_text ?? ''} {data.brand ? `· ${data.brand}` : ''}
          </>
        }
      />

      {/* 一张卡说清"验的是哪一件"：订/已到/供应商/采购单/归属/两个日期 */}
      <MCard
        tone={fullyReceived ? 'ok' : data.status === '不合格' ? 'err' : undefined}
        head={
          <>
            <span className="ds-code" style={{ fontSize: 12 }}>{data.po_no ?? '—'}</span>
            <MStatus tone={toneOfReceipt(data.status)}>{data.status}</MStatus>
            <span style={{ marginLeft: 'auto' }}>
              <MChip tone={fullyReceived ? 'ok' : 'run'}>
                订 {data.qty} / 已到 {data.qty_received}
              </MChip>
            </span>
          </>
        }
        title={`${data.project_no ?? '（辅料 / 办公）'} ${data.equip_no ?? ''}`.trim()}
        lines={[
          <>供应商 {data.supplier_name ?? '—'}</>,
          <>需要到货 {data.need_date ?? '—'} · 预计 {data.expected_date ?? '—'}</>,
        ]}
      >
        <div className="m-actions">
          {data.drawing && (
            <Button block onClick={() => void openDrawing()}>
              <FileTextOutlined /> 看电子图纸 {data.drawing.drawing_no}（{data.drawing.version}）
            </Button>
          )}
        </div>
      </MCard>

      <MCard head={<MStep n={1} text="拍照留痕" />}>
        <Space wrap>
          <Button onClick={() => fileRef.current?.click()}><CameraOutlined /> 拍照 / 选图</Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={(e) => void onPick(e.target.files)}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已选 {photos.length} 张（自动压缩后再传）
          </Typography.Text>
        </Space>
        {previews.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <Image.PreviewGroup>
              {previews.map((p, i) => (
                <Image key={i} src={p} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 6, marginRight: 6 }} />
              ))}
            </Image.PreviewGroup>
          </div>
        )}
      </MCard>

      <MCard head={<MStep n={2} text="验货（数量 + 合格判定）" />}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space>
            <span>到货日期</span>
            <DatePicker value={receiptDate} onChange={(d) => d && setReceiptDate(d)} allowClear={false} />
          </Space>
          {data && (data.lines?.length ?? 0) > 1 && (
            <Space>
              <span>这批货是哪张采购单的</span>
              <Select
                aria-label="指明这批量是哪张采购单"
                style={{ minWidth: 220 }}
                placeholder="请指明哪张单"
                value={poLineId ?? undefined}
                onChange={(v) => setPoLineId(Number(v))}
                options={(data.lines ?? []).map((l) => ({
                  value: l.po_line_id,
                  label: `${l.po_no ?? '—'} · ${l.supplier_name ?? '—'} · 订 ${l.qty}（已到 ${l.received_qty}）`,
                }))}
              />
            </Space>
          )}
          <Space>
            <span>本次到货数量</span>
            <InputNumber
              min={0.001}
              max={fullyReceived ? undefined : remaining}
              disabled={fullyReceived}
              value={qty ?? undefined}
              onChange={(v) => setQty(v === null || v === undefined ? null : Number(v))}
              style={{ width: 120 }}
            />
            {!fullyReceived && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                未到 {remaining} {data.unit ?? ''}
              </Typography.Text>
            )}
          </Space>
          {fullyReceived && (
            <Alert
              type="info"
              showIcon
              message="这个需求已经全部到货，没有可验收的数量"
              description="订购与已到数量相等。如有多送的货，请走采购的「换货 / 退货」。"
            />
          )}
          <Radio.Group value={result} onChange={(e) => setResult(e.target.value)}>
            <Radio.Button value="合格">合格</Radio.Button>
            <Radio.Button value="不合格">不合格</Radio.Button>
          </Radio.Group>
          {result === '合格' && (
            <Space>
              <span>其中合格数（不填 = 全部合格）</span>
              <InputNumber
                min={0}
                max={qty ?? undefined}
                value={qtyOk ?? undefined}
                onChange={(v) => setQtyOk(v === null || v === undefined ? null : Number(v))}
                style={{ width: 120 }}
              />
            </Space>
          )}
          <Input.TextArea
            rows={2}
            placeholder={result === '不合格' ? '不合格原因（如：尺寸不对、少发 2 个）' : '备注（可留空）'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {/* ★ 吸底主操作条（规范 §5.2）：站在货架边单手作业，主按钮不该在屏幕外要往上够 */}
          <div className="m-actionbar">
            <Button type="primary" block loading={saving} disabled={!canStore || fullyReceived} onClick={() => void doInspect()}>
              提交验收{photos.length ? `（含 ${photos.length} 张照片）` : ''}
            </Button>
          </div>
        </Space>
      </MCard>

      {pendingStorage.length > 0 && (
        <MCard head={<MStep n={3} text="入库（定库位）" />}>
          {pendingStorage.map((g) => (
            <div className="m-actions" key={g.id}>
              <div className="m-card-l">
                <span className="ds-code" style={{ fontSize: 12 }}>{g.receipt_no}</span> · {g.qty} {g.unit ?? ''}
              </div>
              <Button block type="primary" disabled={!canStore} onClick={() => setStoreFor({ id: g.id, no: g.receipt_no })}>
                选库位入库
              </Button>
            </div>
          ))}
        </MCard>
      )}

      <div className="m-sec">到货单记录</div>
      {data.receipts.length === 0 ? (
        <MEmpty text="还没有到货单。本次验收提交后会自动生成一张。" />
      ) : (
        data.receipts.map((g) => (
          <MCard
            key={g.id}
            tone={toneOfReceipt(g.status)}
            head={
              <>
                <span className="ds-code" style={{ fontSize: 12 }}>{g.receipt_no}</span>
                <MStatus tone={toneOfReceipt(g.status)}>{g.status}</MStatus>
                <span style={{ marginLeft: 'auto' }}>
                  <MChip>{g.qty} {g.unit ?? ''}</MChip>
                </span>
              </>
            }
            lines={[
              <>
                {g.receipt_date ?? ''}
                {g.location ? ` · 库位 ${g.location}` : ''}
              </>,
              ...(g.inspect_note ? [<span key="n" style={{ color: 'var(--ds-err)' }}>{g.inspect_note}</span>] : []),
            ]}
            photos={
              g.photos.length > 0 ? (
                <Image.PreviewGroup>
                  {g.photos.map((p) => (
                    <AuthedImage key={p.url} path={p.url} size={56} />
                  ))}
                </Image.PreviewGroup>
              ) : undefined
            }
          />
        ))
      )}

      <Modal
        open={!!viewer}
        title={`电子图纸 · ${data.drawing?.drawing_no ?? ''}`}
        footer={null}
        width="96vw"
        style={{ top: 12 }}
        onCancel={() => setViewer(null)}
      >
        {viewer?.type?.startsWith('image/') ? (
          <Image src={viewer.url} style={{ width: '100%' }} />
        ) : (
          <iframe src={viewer?.url} title="图纸" style={{ width: '100%', height: '78vh', border: 0 }} />
        )}
      </Modal>

      <Modal
        title={`入库 · ${storeFor?.no ?? ''}`}
        open={!!storeFor}
        onCancel={() => setStoreFor(null)}
        onOk={() => void doStore()}
        confirmLoading={saving}
        okText="入库"
        okButtonProps={{ disabled: !location }}
      >
        <div style={{ fontSize: 12.5, color: 'var(--ds-ink3)', marginBottom: 8 }}>
          入库必须定库位：没有的先到仓库台「库位」页新建，也可以拍库位标签自动认（只出候选，需你确认）。
        </div>
        <SelectLocation value={location || undefined} onChange={(v) => setLocation(String(v ?? ''))} />
      </Modal>
    </>
  )
}
