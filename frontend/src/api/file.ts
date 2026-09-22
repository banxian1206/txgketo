// api/file.ts —— 由 client.ts 按域拆分（重构 1.1），导出名不变
import { api } from './http'

export async function fetchFileBlob(path: string): Promise<{ url: string; type: string }> {
  const { data } = await api.get(path, { responseType: 'blob' })
  const blob = data as Blob
  return { url: URL.createObjectURL(blob), type: blob.type || '' }
}

/** 图纸当前版本文件（带鉴权，配合 AuthedFileLink 用） */

export function drawingFileUrl(drawingNo: string) {
  return `/drawings/${drawingNo}/file`
}

/** PLC 程序当前版本文件 */

export function programFileUrl(programId: number) {
  return `/programs/${programId}/file`
}
