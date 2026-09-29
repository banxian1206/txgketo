// components/project/InitiateCards.tsx —— 由 ProjectDetailPage 拆出（重构 1.6b · 只拆不改）
import {
  Card,
  Space,
  Typography,
} from 'antd'

import {
  EquipmentEditor,
  LongLeadEditor,
  MilestoneEditor,
  TeamEditor,
} from '../InitiationEditors'
import { useGoFrom } from '../../hooks/useFrom'

export default function InitiateCards({
  load,
  projectNo,
  users
}: {
  load: any;
  projectNo: any;
  users: { id: number; name: string }[];
}) {
  const go = useGoFrom()
  return (
    <>
              <Card
                id="sec-equipment"
                size="small"
                title="设备清单（任务分配）"
                style={{ marginBottom: 16 }}
                extra={
                  <Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      点设备名右边「设计」进设计工作面（出图 / BOM）
                    </Typography.Text>
                    <a onClick={() => go(`/projects/${projectNo}/initiate`)}>去立项页维护</a>
                  </Space>
                }
              >
                <EquipmentEditor projectNo={projectNo} onChanged={load} />
              </Card>

              <Card id="sec-milestone" size="small" title="节点计划" style={{ marginBottom: 16 }}>
                <MilestoneEditor projectNo={projectNo} users={users} onChanged={load} />
              </Card>

              <Card
                id="sec-longlead"
                size="small"
                title="长周期采购"
                style={{ marginBottom: 16 }}
              >
                <LongLeadEditor projectNo={projectNo} onChanged={load} />
              </Card>

              <Card id="sec-team" size="small" title="项目团队" style={{ marginBottom: 16 }}>
                <TeamEditor projectNo={projectNo} users={users} onChanged={load} />
              </Card>
    </>
  )
}
