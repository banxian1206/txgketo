import { App, Button, Card, Col, Input, Row, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useState } from 'react'

import { composeDrawingNo, errMsg, listNumberRules, parseDrawingNo } from '../api/client'

interface Rule {
  object_type: string
  name: string
  template: string
  scope: string
  remark?: string | null
}

interface ParseResult {
  drawing_no: string
  level: number
  parent: string | null
  parsed: Record<string, unknown>
}

export default function NumberRules() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<Rule[]>([])
  const [loading, setLoading] = useState(false)

  // 图号解析
  const [parseNo, setParseNo] = useState('')
  const [parseRes, setParseRes] = useState<ParseResult | null>(null)
  const [parsing, setParsing] = useState(false)

  // 图号组装
  const [cp, setCp] = useState({ project_no: '', equip_no: '', l1: '00', l2: '00', l3: '00', l4: '00' })
  const [composeRes, setComposeRes] = useState<{ drawing_no: string; level: number; parent: string | null } | null>(null)
  const [composing, setComposing] = useState(false)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        setRows(await listNumberRules())
      } catch (e) {
        message.error(errMsg(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [message])

  const doParse = async () => {
    if (!parseNo.trim()) return
    setParsing(true)
    try {
      setParseRes(await parseDrawingNo(parseNo.trim()))
    } catch (e) {
      setParseRes(null)
      message.error(errMsg(e))
    } finally {
      setParsing(false)
    }
  }

  const doCompose = async () => {
    setComposing(true)
    try {
      setComposeRes(await composeDrawingNo(cp))
    } catch (e) {
      setComposeRes(null)
      message.error(errMsg(e))
    } finally {
      setComposing(false)
    }
  }

  const columns: ColumnsType<Rule> = [
    { title: '对象', dataIndex: 'name', width: 240 },
    {
      title: '模板',
      dataIndex: 'template',
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: '取号范围',
      dataIndex: 'scope',
      width: 140,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    { title: '说明', dataIndex: 'remark', width: 260 },
  ]

  return (
    <>
      <Card title="编号规则（依据贵司现行编码规则，系统只做自动发号与校验）">
        <Table<Rule>
          rowKey="object_type"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 900 }}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
          四条铁律：序号一律从 01 起 · 00 表示该层为空 · 现场新增一律重新编号 · 图纸版本 V1/V2 改版走审核发布
        </Typography.Paragraph>
      </Card>

      <Row gutter={16} style={{ marginTop: 16 }}>
        {/* 图号解析 */}
        <Col xs={24} lg={12}>
          <Card size="small" title="图号解析（拆层次码 / 找父级图号）">
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="如 TX26009-01A-01-01-00-00"
                value={parseNo}
                onChange={(e) => setParseNo(e.target.value)}
                onPressEnter={() => void doParse()}
              />
              <Button type="primary" loading={parsing} onClick={() => void doParse()}>
                解析
              </Button>
            </Space.Compact>
            {parseRes && (
              <div style={{ marginTop: 12, fontSize: 13 }}>
                <div>
                  项目 / 设备：<Typography.Text code>{String(parseRes.parsed?.project_no ?? '—')}</Typography.Text>{' '}
                  <Typography.Text code>{String(parseRes.parsed?.equip_no ?? '—')}</Typography.Text>
                </div>
                <div style={{ marginTop: 4 }}>
                  层次码：
                  {(['l1', 'l2', 'l3', 'l4'] as const).map((k) => (
                    <Tag key={k} color="blue">
                      {String(parseRes.parsed?.[k] ?? '—')}
                    </Tag>
                  ))}
                  <Tag color="purple">第 {parseRes.level} 级</Tag>
                </div>
                <div style={{ marginTop: 4 }}>
                  父级图号：<Typography.Text code>{parseRes.parent ?? '（无，总装图）'}</Typography.Text>
                </div>
              </div>
            )}
          </Card>
        </Col>

        {/* 图号组装 */}
        <Col xs={24} lg={12}>
          <Card size="small" title="图号组装（项目 + 设备 + 4 组层次码）">
            <Space wrap>
              <Input
                style={{ width: 130 }}
                placeholder="项目号 TX…"
                value={cp.project_no}
                onChange={(e) => setCp({ ...cp, project_no: e.target.value })}
              />
              <Input
                style={{ width: 90 }}
                placeholder="设备 01A"
                value={cp.equip_no}
                onChange={(e) => setCp({ ...cp, equip_no: e.target.value })}
              />
              {(['l1', 'l2', 'l3', 'l4'] as const).map((k) => (
                <Input
                  key={k}
                  style={{ width: 64 }}
                  placeholder={k}
                  value={cp[k]}
                  onChange={(e) => setCp({ ...cp, [k]: e.target.value })}
                />
              ))}
              <Button type="primary" loading={composing} onClick={() => void doCompose()}>
                组装
              </Button>
            </Space>
            {composeRes && (
              <div style={{ marginTop: 12, fontSize: 13 }}>
                <div>
                  图号：<Typography.Text code copyable>{composeRes.drawing_no}</Typography.Text>
                </div>
                <div style={{ marginTop: 4 }}>
                  <Tag color="purple">第 {composeRes.level} 级</Tag>
                  父级：<Typography.Text code>{composeRes.parent ?? '（无，总装图）'}</Typography.Text>
                </div>
              </div>
            )}
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
              总装图为 <Typography.Text code>00-00-00-00</Typography.Text>；散件一律挂在总装图下，不许跨设备。
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </>
  )
}
