import { App, Alert, Button, Card, Form, Input, Select, Space, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { getOcrIntegration, setOcrIntegration, testOcrIntegration, type OcrConfig } from '../../api/integration'
import { errMsg } from '../../api/client'

/** 外部集成（OCR）—— 后台填 API Key 的入口。
 *
 * 客户口径 2026-09-29：OCR 走厂商 API（智谱 glm-ocr / 通义 qwen-vl-ocr，都是 OpenAI 兼容格式）。
 * ★ 密钥**永不回显**（只有掩码）；留空 = 不修改，点「清除」才清空。
 */
export default function IntegrationPanel() {
  const { message } = App.useApp()
  const [cfg, setCfg] = useState<OcrConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    try {
      const c = await getOcrIntegration()
      setCfg(c)
      form.setFieldsValue({ api: c.api, model: c.model ?? undefined, key: '' })
    } catch (e) {
      message.error(errMsg(e))
    }
  }, [form, message])

  useEffect(() => { void load() }, [load])

  const save = async (payload: { api?: string; model?: string | null; key?: string }) => {
    setSaving(true)
    try {
      const c = await setOcrIntegration(payload)
      setCfg(c)
      form.setFieldValue('key', '')
      message.success('已保存')
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const doTest = async () => {
    setTesting(true)
    try {
      const r = await testOcrIntegration()
      message.success(`连通正常（${r.engine}${r.model ? ` / ${r.model}` : ''}）`)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setTesting(false)
    }
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%', maxWidth: 720 }}>
      <Alert
        type="info"
        showIcon
        message="拍照识别库位（OCR）走厂商 API —— 智谱 / 通义千问"
        description={
          <Typography.Paragraph style={{ fontSize: 12, marginBottom: 0 }}>
            两家都是 <b>OpenAI 兼容</b>格式，系统只用 HTTP 调用、<b>不装额外依赖</b>。
            ⚠ 开了之后，<b>库位标签的照片会发到该厂商</b>（内网之外）—— 请知悉。
            未配置时仓库端「拍照识别」按钮置灰，仍可手动选库位。
          </Typography.Paragraph>
        }
      />

      <Card
        size="small"
        title="当前状态"
        extra={
          <Space size={4}>
            <Tag color={cfg?.available ? 'success' : 'default'}>
              {cfg?.available ? '可用' : '未启用'}
            </Tag>
            <Button size="small" onClick={() => void doTest()} loading={testing} disabled={!cfg?.available}>
              测试连接
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={4}>
          <div>
            识别服务：<b>{cfg?.api && cfg.api !== 'none' ? cfg.api : '未启用'}</b>
            {cfg?.model ? ` · 模型 ${cfg.model}` : ''}
          </div>
          <div>
            API Key：
            {cfg?.has_key
              ? <span>{cfg.key_masked} <Typography.Text type="secondary">（来源：{cfg.key_source}）</Typography.Text></span>
              : <Typography.Text type="secondary">未配置</Typography.Text>}
          </div>
        </Space>
      </Card>

      <Card size="small" title="配置">
        <Form form={form} layout="vertical">
          <Form.Item name="api" label="识别服务" rules={[{ required: true, message: '选一个' }]}>
            <Select
              options={[
                { value: 'none', label: '不启用' },
                { value: 'zhipu', label: '智谱（glm-ocr）' },
                { value: 'dashscope', label: '通义千问（qwen-vl-ocr）' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="model"
            label="模型（可留空，留空用默认）"
            extra="智谱默认 glm-ocr；通义默认 qwen-vl-ocr"
          >
            <Input placeholder="glm-ocr / qwen-vl-ocr" />
          </Form.Item>
          <Form.Item
            name="key"
            label="API Key"
            extra={cfg?.has_key ? `已配置（${cfg.key_masked}）—— 留空=不修改；要换就直接粘贴新的` : '粘贴厂商控制台的 API Key'}
          >
            <Input.Password autoComplete="new-password" placeholder={cfg?.has_key ? '留空 = 不修改' : '在此粘贴 API Key'} />
          </Form.Item>
          <Space>
            <Button
              type="primary"
              loading={saving}
              onClick={() =>
                form.validateFields().then((v) => {
                  // ★ key 为空串 = 不改（要清空请点「清除」）
                  const payload: { api: string; model?: string | null; key?: string } = {
                    api: v.api,
                    model: v.model ?? null,
                  }
                  if (v.key) payload.key = v.key
                  return save(payload)
                })
              }
            >
              保存
            </Button>
            <Button onClick={() => form.validateFields().then((v) => save({ api: v.api, model: v.model ?? null, key: '' }))}>
              清除 API Key
            </Button>
          </Space>
        </Form>
      </Card>
    </Space>
  )
}
