import { api } from './http'

/** ★ OCR 外部集成配置（客户口径 2026-09-29：走厂商 API，key 在后台自己填）。
 *
 * `key` **永不回传原文** —— 只有 `has_key` 与掩码 `key_masked`。
 * 写入语义：不传 key = 保持原样 · 传空串 = 清空 · 传值 = 替换。
 */
export interface OcrConfig {
  api: 'none' | 'dashscope' | 'zhipu' | string
  model?: string | null
  has_key: boolean
  key_masked?: string | null
  key_source?: string
  available: boolean
}

export interface OcrIntegrationIn {
  api?: string
  model?: string | null
  key?: string
}

export async function getOcrIntegration() {
  const { data } = await api.get<OcrConfig>('/admin/integrations/ocr')
  return data
}

export async function setOcrIntegration(body: OcrIntegrationIn) {
  const { data } = await api.put<OcrConfig>('/admin/integrations/ocr', body)
  return data
}

/** 连通性自检：拿一张 1×1 占位图问一次，把 401/超时当场暴露（不用等到现场拍照） */
export async function testOcrIntegration() {
  const { data } = await api.post<{ ok: boolean; engine: string; model?: string | null; note: string }>(
    '/admin/integrations/ocr/test',
  )
  return data
}
