import { App, Button, Space, Tag, Upload } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'

import { errMsg, mfgPhotoUrl, uploadMfgPhotos } from '../api/client'
import { isNetworkError, queueAdd, queueList, queueRemove, type QueuedPhoto } from '../hooks/offlineQueue'
import AuthedImage from './AuthedImage'
import { compressImage } from '../utils/image'

/** 拍照（下发/验收/转运/装车/现场）：选图即压缩上传，返回 token 列表。
 * 默认走制造域上传；发运等其他域用 upload/photoUrl 覆盖。
 * 重构 3.2 · 离线：网络失败 → Blob 入 IndexedDB 队列（⏳占位）→ 联网/下次挂载自动 flush 回传 token。 */
export default function MfgPhotoPicker({
  projectNo,
  refNo,
  value,
  onChange,
  max = 6,
  label = '拍照（必须）',
  allowVideo = false,
  upload = uploadMfgPhotos,
  photoUrl = mfgPhotoUrl,
}: {
  projectNo: string
  refNo: string
  value: string[]
  onChange: (tokens: string[]) => void
  max?: number
  label?: string
  allowVideo?: boolean
  upload?: (projectNo: string, ref: string, files: File[]) => Promise<{ token: string }[]>
  photoUrl?: (token: string) => string
}) {
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)
  const [queued, setQueued] = useState<QueuedPhoto[]>([])

  // refs 镜像：flush 发生在任意时机（online 事件/挂载），要拿最新的 value 与 onChange
  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const uploadRef = useRef(upload)
  uploadRef.current = upload

  /** 把队列里的离线照片补传回服务端，token 追加回调给表单 */
  const flush = useCallback(async () => {
    const items = await queueList('photo')
    if (!items.length) return 0
    let added = 0
    let acc = [...valueRef.current]
    for (const it of items) {
      try {
        const f = new File([it.blob], `offline_${it.id}.jpg`, { type: it.blob.type || 'image/jpeg' })
        const rows = await uploadRef.current(it.projectNo, it.refNo, [f])
        acc = [...acc, ...rows.map((r) => r.token)]
        onChangeRef.current(acc)
        await queueRemove(it.id)
        added += 1
      } catch {
        break // 仍失败（非网络原因或后端不可用）→ 保队列，下次再试
      }
    }
    if (added) {
      setQueued(await queueList('photo'))
      message.success(`离线照片已同步 ${added} 张`)
    }
    return added
  }, [message])

  // 挂载扫队列（上次没 flush 成功的）+ 联网自动 flush
  useEffect(() => {
    void queueList('photo').then(setQueued).catch(() => undefined)
    const on = () => { void flush() }
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [flush])

  const pick = async (files: File[]) => {
    setBusy(true)
    try {
      const compressed: File[] = []
      const room = Math.max(0, max - value.length - queued.length)
      for (const f of files.slice(0, room)) {
        // 视频不压缩（直接传），图片压缩后再传
        compressed.push(f.type.startsWith('video/') ? f : await compressImage(f))
      }
      const rows = await upload(projectNo, refNo || 'misc', compressed)
      onChange([...value, ...rows.map((r) => r.token)])
    } catch (e) {
      if (isNetworkError(e)) {
        // 03 卷：弱网拍完先存本地 —— Blob 入队，⏳占位，联网自动同步
        try {
          for (const f of files) await queueAdd({ kind: 'photo', projectNo, refNo: refNo || 'misc', blob: f })
          setQueued(await queueList('photo'))
          message.warning(`网络不可用：${files.length} 张已存本地，联网后自动同步`)
        } catch {
          message.error('本地存储不可用，照片未能保存')
        }
      } else {
        message.error(errMsg(e))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Space direction="vertical" size={4}>
      <Upload
        accept={allowVideo ? "image/*,video/*" : "image/*"}
        capture="environment"
        multiple
        showUploadList={false}
        beforeUpload={() => false}
        onChange={(info) => {
          const files = info.fileList.map((f) => f.originFileObj as File).filter(Boolean)
          if (files.length) void pick(files)
        }}
      >
        <Button size="small" loading={busy} disabled={value.length + queued.length >= max}>
          {label}（{value.length}/{max}）
        </Button>
      </Upload>
      {value.length > 0 && (
        <Space wrap>
          {value.map((t) => (
            <div key={t} style={{ position: 'relative' }}>
              <AuthedImage path={photoUrl(t)} size={56} />
              <a
                style={{ fontSize: 12, marginLeft: 4 }}
                onClick={() => onChange(value.filter((x) => x !== t))}
              >
                删
              </a>
            </div>
          ))}
        </Space>
      )}
      {queued.length > 0 && (
        <Space wrap data-testid="offline-queue">
          {queued.map((q) => (
            <div key={q.id} style={{ position: 'relative' }}>
              <img
                src={URL.createObjectURL(q.blob)}
                alt="离线暂存"
                style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 4, opacity: 0.75 }}
              />
              <Tag color="orange" style={{ position: 'absolute', top: 0, right: 0, fontSize: 10, margin: 0 }}>
                ⏳
              </Tag>
              <a
                style={{ fontSize: 12, marginLeft: 4 }}
                onClick={() => { void queueRemove(q.id).then(() => queueList('photo')).then(setQueued) }}
              >
                删
              </a>
            </div>
          ))}
          <Tag color="orange">离线暂存 {queued.length} 张，联网自动同步</Tag>
        </Space>
      )}
    </Space>
  )
}
