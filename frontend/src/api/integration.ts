import { api } from './http'

/** ★ OCR 外部集成配置（客户口径 2026-09-29：走厂商 API，key 在后台自己填）。
 *
 * `key` **永不回传原文** —— 只有 `has_key` 与掩码 `key_masked`。
 * 写入语义：不传 key = 保持原样 · 传空串 = 清空 · 传值 = 替换。
 */
export interface OcrApi {
  value: string
  label: string
  default_model?: string | null
}

export interface OcrConfig {
  api: 'none' | 'dashscope' | 'zhipu' | string
  model?: string | null
  has_key: boolean
  key_masked?: string | null
  key_source?: string
  /** ★ 只表示"**配好了**"，**不代表能跑通** —— 能不能用看 `state` / `last_test` */
  available: boolean
  /** 当前 api 的默认模型（服务端权威来源，别在前端写死） */
  default_model?: string | null
  /** 已知识别服务 + 各自默认模型（下拉与 placeholder 都从这里取） */
  apis?: OcrApi[]
  /** 上次「测试连接」的结果 */
  last_test?: { at: string; ok: boolean; verdict: string } | null
  /** unconfigured | unverified | verified | failed */
  state: 'unconfigured' | 'unverified' | 'verified' | 'failed'
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
