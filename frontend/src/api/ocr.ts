import { api } from './http'

/** ★ 拍照识别库位（OCR）—— 结果**只作候选**（铁律 7：人工确认后才写库）。 */
export interface OcrCandidate {
  code: string
  raw?: string
}

export interface OcrResult {
  engine: string
  available: boolean
  model?: string | null
  candidates: OcrCandidate[]
  raw?: string
  hint?: string
}

export async function ocrLocation(file: File) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<OcrResult>('/warehouse/ocr/location', form)
  return data
}
