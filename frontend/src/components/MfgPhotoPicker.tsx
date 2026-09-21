import { App, Button, Space, Upload } from 'antd'
import { useState } from 'react'

import { errMsg, mfgPhotoUrl, uploadMfgPhotos } from '../api/client'
import AuthedImage from './AuthedImage'
import { compressImage } from '../utils/image'

/** 拍照（下发/验收/转运/装车/现场）：选图即压缩上传，返回 token 列表。
 * 默认走制造域上传；发运等其他域用 upload/photoUrl 覆盖。 */
export default function MfgPhotoPicker({
  projectNo,
  refNo,
  value,
  onChange,
  max = 6,
  label = '拍照（必须）',
  upload = uploadMfgPhotos,
  photoUrl = mfgPhotoUrl,
}: {
  projectNo: string
  refNo: string
  value: string[]
  onChange: (tokens: string[]) => void
  max?: number
  label?: string
  upload?: (projectNo: string, ref: string, files: File[]) => Promise<{ token: string }[]>
  photoUrl?: (token: string) => string
}) {
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)

  const pick = async (files: File[]) => {
    setBusy(true)
    try {
      const compressed: File[] = []
      for (const f of files.slice(0, max - value.length)) compressed.push(await compressImage(f))
      const rows = await upload(projectNo, refNo || 'misc', compressed)
      onChange([...value, ...rows.map((r) => r.token)])
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Space direction="vertical" size={4}>
      <Upload
        accept="image/*"
        capture="environment"
        multiple
        showUploadList={false}
        beforeUpload={() => false}
        disabled={busy || value.length >= max}
        onChange={(info) => {
          const files = info.fileList.map((f) => f.originFileObj as File).filter(Boolean)
          if (files.length) void pick(files)
        }}
      >
        <Button size="small" loading={busy} disabled={value.length >= max}>
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
    </Space>
  )
}
