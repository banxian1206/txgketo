import { App } from 'antd'
import type { ReactNode } from 'react'

import { errMsg, fetchFileBlob } from '../api/client'

/**
 * 带鉴权打开文件（图纸 / 程序 / PDF 等）。
 * 浏览器直接跳转不会带 Authorization 头，所以必须先取 blob 再用 objectURL 打开。
 */
export default function AuthedFileLink({
  path,
  children,
}: {
  path: string
  children?: ReactNode
}) {
  const { message } = App.useApp()

  const open = async () => {
    const w = window.open('', '_blank')
    try {
      const { url } = await fetchFileBlob(path)
      if (w) w.location.href = url
      else window.open(url, '_blank')
    } catch (e) {
      if (w) w.close()
      message.error(errMsg(e))
    }
  }

  return (
    <a
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void open()
      }}
    >
      {children}
    </a>
  )
}
