// components/project/ProjectHeader.tsx —— 由 ProjectDetailPage 拆出（重构 1.6b · 只拆不改）
import type { Project } from '../../api/client'
import {
  Button,
  Card,
  Col,
  Divider,
  Dropdown,
  Row,
  Space,
  Steps,
  Tag,
  Typography,
} from 'antd'
import {useNavigate} from 'react-router-dom'

import { hasPerm } from '../../api/user'

import {
  type DesignOverviewRow,
  type ProjectDetail as Detail,
} from '../../api/client'
import { useBack, useGoFrom } from '../../hooks/useFrom'

export default function ProjectHeader({
  NEXT_HINT,
  STAGE_ORDER,
  design,
  detail,
  openDeal,
  setCloseOpen,
  stepIndex,
  p,
  projectNo
}: {
  NEXT_HINT: Record<string, string>;
  STAGE_ORDER: string[];
  design: DesignOverviewRow[];
  detail: Detail | null;
  openDeal: (...args: any[]) => any;
  setCloseOpen: (...args: any[]) => any;
  stepIndex: any;
  p: Project;
  projectNo: any;
}) {
  const nav = useNavigate()
  const go = useGoFrom()
  // ★ docs/11：从台里点进来的，返回口要回**那个台**（并回到原来那个页签）；没有来源时行为完全不变
  const back = useBack('/projects', '← 返回列表')
  return (
    <>
      <Card style={{ marginBottom: 16 }} styles={{ body: { padding: '16px 20px' } }}>
        <Row align="middle" gutter={16}>
          <Col flex="auto">
            <Space size={8} wrap>
              <a onClick={() => nav(back.to)}>{back.label}</a>
              <Typography.Text strong style={{ fontSize: 16 }}>
                {p.project_no}
              </Typography.Text>
              <Typography.Text style={{ fontSize: 16 }}>{p.project_name}</Typography.Text>
              {p.is_retrofit && <Tag color="orange">旧改</Tag>}
              <Tag color="blue">{p.stage}</Tag>
            </Space>
            <div style={{ marginTop: 6 }}>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                客户：{p.customer_name ?? '—'} · 销售：{detail?.sales_name ?? '—'}
                {p.opportunity_days_left !== null && p.opportunity_days_left !== undefined && (
                  <>
                    {' · '}
                    商机
                    {p.opportunity_days_left < 0
                      ? `已过期 ${-p.opportunity_days_left} 天`
                      : p.opportunity_days_left === 0
                        ? '今天到期'
                        : `还剩 ${p.opportunity_days_left} 天`}
                  </>
                )}
                {p.delivery_days_left !== null && p.delivery_days_left !== undefined && (
                  <>
                    {' · '}项目交期还剩 {p.delivery_days_left} 天
                  </>
                )}
              </Typography.Text>
            </div>
          </Col>
          <Col>
            <Space>
              {p.stage === '线索' && (
                <Button type="primary" onClick={openDeal}>
                  成交登记
                </Button>
              )}
              {p.stage === '成交待立项' && (
                <Button type="primary" onClick={() => go(`/projects/${projectNo}/initiate`)}>
                  立项
                </Button>
              )}
              {/* ★ M-05：关闭订单归商务部（权限码 project:close）—— 没权限就不展示，
                  否则点了必 403（铁律：前端必须反映后端门禁） */}
              {p.stage !== '已关闭' && hasPerm('project:close') && (
                <Dropdown
                  menu={{
                    items: [{ key: 'close', label: '关闭订单', danger: true }],
                    onClick: () => setCloseOpen(true),
                  }}
                >
                  <Button>更多 ▾</Button>
                </Dropdown>
              )}
            </Space>
          </Col>
        </Row>

        <Divider style={{ margin: '14px 0 10px' }} />
        <Steps
          size="small"
          current={stepIndex}
          items={STAGE_ORDER.map((s) => ({ title: s }))}
          status={p.stage === '已关闭' ? 'error' : 'process'}
        />
        <Space>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            💡 {NEXT_HINT[p.stage] ?? ''}
          </Typography.Text>
          {p.stage === '执行中' && design.length > 0 && (
            <Button
              type="link"
              size="small"
              onClick={() => go(`/projects/${projectNo}/design/${design[0].equip_no}`)}
            >
              进入设计 →
            </Button>
          )}
        </Space>
      </Card>
    </>
  )
}
