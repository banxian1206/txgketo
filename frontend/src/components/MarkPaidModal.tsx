import { App, Button, Modal, Typography, Upload } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { useState } from 'react'

import { errMsg, markOrdersPaid, uploadPoVouchers } from '../api/client'

/** 标记已付款（客户口径 #11）：付款凭证（截图）**必填**，先传凭证再标记。 */
export default function MarkPaidModal({
  open = true,
  poId,
  poNo,
  onClose,
  onDone,
}: {
  open?: boolean
  poId: number | null
  poNo: string | null
  onClose: () => void
  onDone?: () => void
}) {
  const { message } = App.useApp()
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)

  const ok = async () => {
    if (!files.length) {
      message.warning('付款凭证（截图）必填')
      return
    }
    if (!poId || !poNo) return
    setBusy(true)
    try {
      await uploadPoVouchers(poNo, files)
      await markOrdersPaid({ po_ids: [poId], note: '采购台标记' })
      message.success('已标记付款')
      setFiles([])
      onDone?.()
      onClose()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      className="engineering-modal"
      title={`标记已付款 · ${poNo ?? ''}`}
      open={open}
      onCancel={onClose}
      onOk={() => void ok()}
      confirmLoading={busy}
      okText="确认已付款"
      okButtonProps={{ disabled: files.length === 0 }}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0 }}>
        付款凭证（财务线下付款截图）<b>必填</b>——上传后才能把这单标记为已付款。
      </Typography.Paragraph>
      <Upload
        multiple
        beforeUpload={() => false}
        listType="picture"
        fileList={files.map((f) => ({ uid: f.name, name: f.name })) as never}
        onChange={({ fileList }) =>
          setFiles(fileList.map((f) => f.originFileObj as File).filter(Boolean) as File[])
        }
      >
        <Button icon={<UploadOutlined />}>选择付款凭证</Button>
      </Upload>
    </Modal>
  )
}
