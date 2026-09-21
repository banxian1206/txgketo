import { App, Card, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useState } from 'react'

import { errMsg, listNumberRules } from '../api/client'

interface Rule {
  object_type: string
  name: string
  template: string
  scope: string
  remark?: string | null
}

export default function NumberRules() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<Rule[]>([])
  const [loading, setLoading] = useState(false)

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
  )
}
