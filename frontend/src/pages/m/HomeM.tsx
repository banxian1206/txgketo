import { App, Card, Col, Row, Statistic, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { errMsg, mobileHome, type MobileHome } from '../../api/client'

/** 手机端首页：按角色给待办数字，点进去干活 */
export default function HomeM() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const [data, setData] = useState<MobileHome | null>(null)

  useEffect(() => {
    mobileHome()
      .then(setData)
      .catch((e) => message.error(errMsg(e)))
  }, [message])

  const c = data?.counts
  const items = [
    { label: '待验收', value: c?.to_inspect ?? 0, to: '/m/warehouse' },
    { label: '待入库', value: c?.to_store ?? 0, to: '/m/warehouse' },
    { label: '领料', value: c?.issues ?? 0, to: '/m/issues' },
    { label: '我的任务', value: c?.my_tasks ?? 0, to: '/my-tasks' },
    { label: '待我审', value: c?.to_review ?? 0, to: '/reviews' },
    { label: '待我裁决', value: c?.to_decide ?? 0, to: '/changes' },
  ]

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Typography.Text strong>{data?.user.name ?? '…'}</Typography.Text>
        <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
          {data?.user.profession ?? ''} {data?.user.position ?? ''}
        </Typography.Text>
      </Card>

      <Row gutter={[12, 12]}>
        {items.map((i) => (
          <Col span={12} key={i.label}>
            <Card size="small" onClick={() => nav(i.to)} style={{ textAlign: 'center' }}>
              <Statistic
                title={i.label}
                value={i.value}
                valueStyle={{ fontSize: 22, color: i.value ? '#1f6feb' : '#999' }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
        手机端先做仓库两条动线：到货验收（看电子图纸 + 拍照 + 合格/不合格 → 入库）与领料。
        不做扫码，清单 + 勾选 + 拍照就够了（03 卷）。
      </Typography.Paragraph>
    </>
  )
}
