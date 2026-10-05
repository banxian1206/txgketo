import { App, Button, List, Modal, Select, Space, Tooltip, Typography, type SelectProps } from 'antd'
import { Chip } from '../../components/ds'
import { CameraOutlined } from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'

import { errMsg, listLocations, type LocationRow } from '../../api/client'
import { ocrLocation, type OcrResult } from '../../api/ocr'

type Props = Omit<SelectProps, 'options'> & {
  /**
   * value 形态（valueMode，避开 antd Select.mode 撞名）：
   * - 'text'（默认）= `${仓库} ${编码}`（goods_receipt.store 等用字符串库位）
   * - 'id'          = LocationRow.id（manualInbound 等用库位 id）
   */
  valueMode?: 'text' | 'id'
  /** 只显示启用中的库位（默认 true） */
  activeOnly?: boolean
}

/** 库位选择（字段组件族 · 重构 1.4）：替代手填库位文本（P-11：手打易分裂库存）
 *
 * ★ 2026-09-29 加「拍照识别」：拍库位标签 → OCR 出**候选** → **人工点选**才填（铁律 7）。
 *   识别引擎走厂商 API，key 在「用户与权限 → 外部集成」里填；没配时按钮照常可用但会提示。
 */
export default function SelectLocation({ valueMode = 'text', activeOnly = true, placeholder, onChange, ...rest }: Props) {
  const { message } = App.useApp()
  const [rows, setRows] = useState<LocationRow[]>([])
  const [picking, setPicking] = useState(false)
  const [ocr, setOcr] = useState<OcrResult | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    listLocations()
      .then((r) => setRows(activeOnly ? r.filter((l) => l.is_active) : r))
      .catch(() => setRows([]))
  }, [activeOnly])

  const text = (l: LocationRow) => `${l.warehouse} ${l.code}${l.name ? ` ${l.name}` : ''}`
  // value 形态与原实现对齐：text = `${仓库} ${编码}`（不含 name），label 展示带 name
  const val = (l: LocationRow) => (valueMode === 'id' ? l.id : `${l.warehouse} ${l.code}`)

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setPicking(true)
    try {
      const r = await ocrLocation(f)
      setOcr(r)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setPicking(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /** 候选 → 只**预选**，要用户点一下才真正填值（铁律 7） */
  const apply = (code: string) => {
    const hit = rows.find((l) => l.code.toUpperCase() === code.toUpperCase())
    if (!hit) {
      message.warning(`识别到「${code}」，但库里没有这个库位 —— 先到「库位」页签新建，或手动选`)
      return
    }
    onChange?.(val(hit) as never, { label: text(hit), value: val(hit) } as never)
    setOcr(null)
    message.success(`已填入库位 ${text(hit)}`)
  }

  return (
    <Space.Compact style={{ width: '100%' }}>
      <Select
        showSearch
        optionFilterProp="label"
        placeholder={placeholder ?? '选库位（没有就先到「库位」页签新建）'}
        options={rows.map((l) => ({ value: val(l), label: text(l) }))}
        notFoundContent={rows.length ? undefined : '库位加载中…'}
        onChange={onChange}
        {...rest}
      />
      <Tooltip title="拍库位标签，自动认库位号">
        {/* ★ F5（2026-10-04 走查核实）：纯图标按钮在手机上没有 hover → Tooltip 永远读不到；
            aria-label + title 双保险（读屏软件/浏览器原生提示都接住） */}
        <Button aria-label="拍照识别库位号" title="拍照识别库位号（识别结果只是候选，点选才填入）" icon={<CameraOutlined />} loading={picking} onClick={() => fileRef.current?.click()} />
      </Tooltip>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      <Modal
        open={!!ocr}
        title="拍照识别库位（识别结果只是候选，点一下才填入）"
        onCancel={() => setOcr(null)}
        footer={null}
        destroyOnHidden
      >
        {!ocr?.available ? (
          <Typography.Paragraph type="secondary">
            还没启用识别服务 —— 到「用户与权限 → 外部集成」填 API Key（智谱 / 通义）。
            <br />现在也可以<b>手动选库位</b>，不影响入库。
          </Typography.Paragraph>
        ) : (ocr.candidates?.length ?? 0) === 0 ? (
          <>
            <Typography.Paragraph type="secondary">{ocr.hint || '没认出库位号'}</Typography.Paragraph>
            {ocr.raw ? (
              <Typography.Paragraph style={{ fontSize: 12 }}>
                模型原始回答：<code>{ocr.raw}</code>
              </Typography.Paragraph>
            ) : null}
          </>
        ) : (
          <List
            size="small"
            dataSource={ocr.candidates}
            renderItem={(c) => {
              const known = rows.some((l) => l.code.toUpperCase() === c.code.toUpperCase())
              return (
                <List.Item
                  actions={[<a key="u" onClick={() => apply(c.code)}>用它</a>]}
                >
                  <Space>
                    <b>{c.code}</b>
                    {known ? <Chip tone="ok">库里有这个库位</Chip> : <Chip tone="warn">库里还没有</Chip>}
                  </Space>
                </List.Item>
              )
            }}
          />
        )}
      </Modal>
    </Space.Compact>
  )
}
