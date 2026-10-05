import { Link } from 'react-router-dom'
import { Chip } from '../../components/ds'
import type { FormInstance } from 'antd'
// components/design/DesignHeaderCard.tsx —— 由 EquipmentDesign 拆出（重构 1.6 · 只拆不改）
import { Button, Card, Col, Row, Space, Typography } from 'antd'
import { useBack } from '../../hooks/useFrom'



import { type DesignRoot, type DesignTree } from '../../api/client'
import { DESIGN_STATE as STATE_COLOR, toneOf } from '../../theme/status'

export default function DesignHeaderCard({
data,
  equipNo,
  nav,
  projectNo,
  purchaseForm,
  root,
  setPurchaseOpen,
  setPurchaseResult
}: {
data: DesignTree | null;
  equipNo: string;
  nav: any;
  projectNo: string;
  purchaseForm: FormInstance;
  root: DesignRoot | undefined;
  setPurchaseOpen: (...args: any[]) => any;
  setPurchaseResult: (...args: any[]) => any;
}) {
  // ★ docs/11：从台里点进来的，返回口回**那个台**（含原页签）；无来源时保持「← 返回项目」
  const back = useBack(`/projects/${projectNo}`, '← 返回项目')
  return (
    <>
        <Card style={{ marginBottom: 16 }}>
          <Row align="middle">
            <Col flex="auto">
              <Space size={8} wrap>
                <a onClick={() => nav(back.to)}>{back.label}</a>
                <Typography.Text strong style={{ fontSize: 16 }}>
                  {equipNo} 设计工作面
                </Typography.Text>
                {root && (
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    设备总装图 {root.drawing_no}
                    {root.exists ? '' : '（未创建）'}
                  </Typography.Text>
                )}
                <Chip tone={toneOf(STATE_COLOR[data?.state ?? '未开始'])}>{data?.state}</Chip>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  图 {data?.counts.drawings ?? 0} 张 · 组件 {data?.counts.components ?? 0} · 零件{' '}
                  {data?.counts.parts ?? 0}（自制 {data?.counts.self_made ?? 0} / 外协{' '}
                  {data?.counts.outsource ?? 0}）· 标准件 {data?.counts.std_items ?? 0} · 材料{' '}
                  {data?.counts.materials ?? 0}
                </Typography.Text>
              </Space>
            </Col>
            <Col>
              {/* ★ R2：设备档案 = 这台设备的一生（只读汇总 + 跳各台干活）；
                  设计面只负责"设计"这一环，别互相抄 */}
              <Link to={`/equipment/${projectNo}/${equipNo}`} style={{ marginRight: 8 }}>
                <Button>设备档案</Button>
              </Link>
              <Button
                type="primary"
                onClick={() => {
                  purchaseForm.resetFields()
                  setPurchaseResult(null)
                  setPurchaseOpen(true)
                }}
              >
                生成采购需求（进池）
              </Button>
            </Col>
          </Row>
        </Card>
    </>
  )
}
