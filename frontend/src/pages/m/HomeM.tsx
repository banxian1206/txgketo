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
    { label: '待下发排产', value: c?.to_dispatch ?? 0, to: '/m/production' },
    { label: '待验收零件', value: c?.to_accept ?? 0, to: '/m/production' },
    { label: '待转运', value: c?.to_transfer ?? 0, to: '/m/production' },
    { label: '装配中', value: c?.assembling ?? 0, to: '/m/assembly' },
    { label: '待厂内调试', value: c?.to_debug ?? 0, to: '/m/assembly' },
    { label: '发运待办', value: c?.shipments_open ?? 0, to: '/m/shipping' },
    { label: '到货待验收', value: c?.shipments_receive ?? 0, to: '/m/shipping' },
    { label: '现场问题', value: c?.site_open_issues ?? 0, to: '/m/site' },
    { label: '待派调试', value: c?.site_to_dispatch ?? 0, to: '/m/site' },
    { label: '待客户验收', value: c?.acceptance_pending ?? 0, to: '/m/site' },
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
        手机端动线（03 卷）：仓库（到货验收 / 入库 / 领料）、车间（制造下发·验收·转运、装配与齐套率）、发运（装车 / 发运 / 到货 / 现场验收）。
        不做扫码，清单 + 勾选 + 拍照就够了。底部入口按你的角色显示。
      </Typography.Paragraph>
    </>
  )
}
