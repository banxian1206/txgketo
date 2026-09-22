import { Image } from 'antd'
import { useEffect, useState } from 'react'

import { fetchFileBlob } from '../api/client'
import { T } from '../theme/tokens'

/** 带鉴权取图（图纸/验收照片都走这里），给手机端做缩略图 */
export default function AuthedImage({
  path,
  size = 72,
}: {
  path: string
  size?: number
}) {
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    let alive = true
    fetchFileBlob(path)
      .then((r) => {
        if (alive) setUrl(r.url)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [path])

  if (!url) {
    return (
      <div
        style={{
          width: size,
          height: size,
          background: T.border,
          borderRadius: 6,
          display: 'inline-block',
        }}
      />
    )
  }
  return (
    <Image
      src={url}
      width={size}
      height={size}
      style={{ objectFit: 'cover', borderRadius: 6 }}
      preview={{ src: url }}
    />
  )
}
