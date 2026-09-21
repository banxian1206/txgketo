import {
  App,
  Button,
  Card,
  DatePicker,
  Divider,
  Empty,
  Image,
  Input,
  InputNumber,
  Modal,
  Radio,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import AuthedImage from '../../components/AuthedImage'
import {
  errMsg,
  fetchFileBlob,
  hasPerm,
  inspectPurchase,
  mobileMaterial,
  storeReceipt,
  uploadReceiptPhotos,
  type MobileMaterial,
} from '../../api/client'
import { compressImage } from '../../utils/image'

const RECEIPT_COLOR: Record<string, string> = {
  待入库: 'processing',
  已入库: 'success',
  不合格: 'error',
  现场已验收: 'purple',
}

/** 手机端到货验收动线（03 卷）：看电子图纸 → 拍照 → 合格/不合格 → 入库 */
export default function AcceptM() {
  const { requestId } = useParams()
  const { message } = App.useApp()
  const nav = useNavigate()
  const [data, setData] = useState<MobileMaterial | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [qty, setQty] = useState<number>(1)
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
      setQty(Math.max(0.001, d.qty - d.qty_received))
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
    if (!data || !data.project_no) return
    setSaving(true)
    try {
      const res = await inspectPurchase(data.project_no, data.id, {
        receipt_date: receiptDate.format('YYYY-MM-DD'),
        qty,
        result,
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

  return (
    <>
      <Button type="link" style={{ paddingLeft: 0 }} onClick={() => nav('/m/warehouse')}>
        ← 返回仓库
      </Button>

      <Card size="small" style={{ marginBottom: 10 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {data.display_name}
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {data.spec_text ?? ''} {data.brand ? `· ${data.brand}` : ''}
        </Typography.Text>
        <Divider style={{ margin: '8px 0' }} />
        <Space direction="vertical" size={2} style={{ fontSize: 13 }}>
          <span>
            订 {data.qty} {data.unit ?? ''} · 已到 {data.qty_received} · 状态 <Tag>{data.status}</Tag>
          </span>
          <span>
            供应商 {data.supplier_name ?? '—'} · 采购单 {data.po_no ?? '—'}
          </span>
          <span>
            {data.project_no} {data.equip_no ?? ''} · 需要到货 {data.need_date ?? '—'} · 预计{' '}
            {data.expected_date ?? '—'}
          </span>
        </Space>
        {data.drawing && (
          <Button type="primary" ghost size="small" style={{ marginTop: 10 }} onClick={() => void openDrawing()}>
            📐 看电子图纸 {data.drawing.drawing_no}（{data.drawing.version}）
          </Button>
        )}
      </Card>

      <Card size="small" title="① 拍照" style={{ marginBottom: 10 }}>
        <Space wrap>
          <Button onClick={() => fileRef.current?.click()}>📷 拍照 / 选图</Button>
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
      </Card>

      <Card size="small" title="② 验货" style={{ marginBottom: 10 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space>
            <span>到货日期</span>
            <DatePicker value={receiptDate} onChange={(d) => d && setReceiptDate(d)} allowClear={false} />
          </Space>
          <Space>
            <span>本次到货数量</span>
            <InputNumber min={0.001} value={qty} onChange={(v) => setQty(Number(v ?? 1))} style={{ width: 120 }} />
          </Space>
          <Radio.Group value={result} onChange={(e) => setResult(e.target.value)}>
            <Radio.Button value="合格">合格</Radio.Button>
            <Radio.Button value="不合格">不合格</Radio.Button>
          </Radio.Group>
          <Input.TextArea
            rows={2}
            placeholder={result === '不合格' ? '不合格原因（如：尺寸不对、少发 2 个）' : '备注（可留空）'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button type="primary" block loading={saving} disabled={!canStore} onClick={() => void doInspect()}>
            提交验收{photos.length ? `（含 ${photos.length} 张照片）` : ''}
          </Button>
        </Space>
      </Card>

      {pendingStorage.length > 0 && (
        <Card size="small" title="③ 入库" style={{ marginBottom: 10 }}>
          {pendingStorage.map((g) => (
            <div key={g.id} style={{ marginBottom: 8 }}>
              <Space>
                <Tag color={RECEIPT_COLOR[g.status] ?? 'default'}>{g.status}</Tag>
                <span>
                  {g.receipt_no} · {g.qty} {g.unit ?? ''}
                </span>
                <Button size="small" type="primary" disabled={!canStore} onClick={() => setStoreFor({ id: g.id, no: g.receipt_no })}>
                  选库位入库
                </Button>
              </Space>
            </div>
          ))}
        </Card>
      )}

      <Card size="small" title="到货单记录">
        {data.receipts.length === 0 && <Empty description="还没有到货单" />}
        {data.receipts.map((g) => (
          <div key={g.id} style={{ marginBottom: 10 }}>
            <Space>
              <Tag color={RECEIPT_COLOR[g.status] ?? 'default'}>{g.status}</Tag>
              <Typography.Text>
                {g.receipt_no} · {g.qty} {g.unit ?? ''} · {g.receipt_date ?? ''}
              </Typography.Text>
              {g.location && <Typography.Text type="secondary">{g.location}</Typography.Text>}
            </Space>
            {g.inspect_note && (
              <div>
                <Typography.Text type="danger" style={{ fontSize: 12 }}>
                  {g.inspect_note}
                </Typography.Text>
              </div>
            )}
            {g.photos.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <Image.PreviewGroup>
                  {g.photos.map((p) => (
                    <span key={p.url} style={{ marginRight: 6 }}>
                      <AuthedImage path={p.url} />
                    </span>
                  ))}
                </Image.PreviewGroup>
              </div>
            )}
          </div>
        ))}
      </Card>

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
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          库位填法：深圳仓 A-03-12（不填就进「待定」）
        </Typography.Paragraph>
        <Input placeholder="如：深圳仓 A-03-12" value={location} onChange={(e) => setLocation(e.target.value)} />
      </Modal>
    </>
  )
}
