import { Empty, Image, Modal } from 'antd'

export interface PreviewState {
  name: string
  kind: 'image' | 'pdf' | 'text' | 'unsupported'
  url?: string
  text?: string
}

/**
 * 资料在线预览（列表、详情共用）
 * 图片直接显示 / PDF 内嵌浏览器阅读器 / 文本直接读出来 / 其他提示下载
 */
export default function AttachmentPreviewModal({
  state,
  onClose,
}: {
  state: PreviewState | null
  onClose: () => void
}) {
  const close = () => {
    if (state?.url) URL.revokeObjectURL(state.url)
    onClose()
  }

  return (
    <Modal
      title={`资料预览 · ${state?.name ?? ''}`}
      open={!!state}
      width={state?.kind === 'pdf' ? 1000 : 760}
      footer={null}
      onCancel={close}
      destroyOnHidden
    >
      {state?.kind === 'image' && <Image src={state.url} style={{ maxWidth: '100%' }} />}
      {state?.kind === 'pdf' && (
        <iframe
          src={state.url}
          title="pdf"
          style={{ width: '100%', height: '72vh', border: 0 }}
        />
      )}
      {state?.kind === 'text' && (
        <pre
          style={{
            maxHeight: '64vh',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            background: '#f6f8fa',
            padding: 12,
            borderRadius: 6,
            margin: 0,
          }}
        >
          {state.text}
        </pre>
      )}
      {state?.kind === 'unsupported' && (
        <Empty description="该格式不支持在线预览（如 DWG / STEP / Word），请下载后查看" />
      )}
    </Modal>
  )
}
