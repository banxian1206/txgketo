import { Form, Modal } from 'antd'
import type { FormInstance, FormProps } from 'antd'
import type { ReactNode } from 'react'

/**
 * 动作弹窗基座（重构 1.2 · 根治 P-03 类预填时序问题）：
 * - 时序结构性固定：**Modal 打开 → Form 挂载 → 读 initialValues → 展示**
 *   （关闭即销毁、打开即重建，不再依赖「setFieldsValue 必须在打开前/后」的手工时序，
 *    「setFieldsValue 必须在打开前/后」的手工时序，45 处同类 destroyOnClose 弹窗的 bug 从根上消失）
 * - 内置：subtitle 单据上下文 · 提交 loading 防重 · ok 按钮随 danger 变红
 * - 配合 useSubmit：onOk={run}，校验/错误/反馈一条龙
 *
 *   <AppModal open title={`验收 · ${r.display_name}`} subtitle={`采购单 ${r.po_no}…`}
 *     form={form} initialValues={{ result: '合格', receipt_date: dayjs() }}
 *     onOk={run} loading={loading} okText="提交验收" danger={result === '不合格'}
 *     onClose={() => setOpen(false)}>
 *     …字段…
 *   </AppModal>
 */
export default function AppModal<V extends Record<string, unknown>>({
  open,
  title,
  subtitle,
  width = 580,
  form,
  initialValues,
  onOk,
  loading,
  okText = '确定',
  danger,
  onClose,
  extraFooter,
  children,
  onValuesChange,
  ...modalRest
}: {
  open: boolean
  title: ReactNode
  /** 单据上下文（采购单/归属/数量…），显示在标题下、字段上 */
  subtitle?: ReactNode
  width?: number
  form: FormInstance<V>
  /** ★ 打开即预填：Form 挂载时读取，关闭销毁后下次打开重新生效 */
  initialValues?: Partial<V>
  onOk: () => void
  loading?: boolean
  okText?: string
  danger?: boolean
  onClose: () => void
  /** 弹窗底部左侧补充区（如「取消」外的次操作） */
  extraFooter?: ReactNode
  /** 字段变化回调（如「收货地点」联动） */
  onValuesChange?: FormProps<V>['onValuesChange']
  children: ReactNode
} & Omit<Parameters<typeof Modal>[0], 'title' | 'onOk' | 'confirmLoading' | 'onCancel' | 'footer'>) {
  return (
    <Modal
      open={open}
      title={title}
      width={width}
      onCancel={onClose}
      onOk={onOk}
      confirmLoading={loading}
      okText={okText}
      okButtonProps={{ danger }}
      destroyOnHidden
      {...modalRest}
    >
      {subtitle}
      <Form form={form} layout="vertical" preserve={false} initialValues={initialValues as FormProps<V>['initialValues']} onValuesChange={onValuesChange}>
        {children}
      </Form>
      {extraFooter}
    </Modal>
  )
}
