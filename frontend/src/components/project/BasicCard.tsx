import { hasPerm } from '../../api/user'
// components/project/BasicCard.tsx —— 由 ProjectDetailPage 拆出（重构 1.6b · 只拆不改）
import type { Project } from '../../api/client'
import {
  Card,
  Typography,
} from 'antd'

import EditableField from '../EditableField'
import {
  type ProjectDetail as Detail,
} from '../../api/client'

export default function BasicCard({
  SOURCES,
  detail,
  save,
  users,
  DASH,
  p
}: {
  SOURCES: string[];
  detail: Detail | null;
  save: any;
  users: { id: number; name: string }[];
  DASH: any;
  p: Project;
}) {

  // ★ 与后端 project.assert_sales_owned 同一把尺子：这些字段只有商务部（contract:edit）能改。
  //   过去对 PM 也画着 ✎，点了必 403 —— 前端可见性必须反映后端门禁（AGENTS 铁律）。
  const canBiz = hasPerm('contract:edit')
  return (
    <>
          <Card id="sec-basic" size="small" title="基本信息" style={{ marginBottom: 16 }}>
            <div className="ef-grid">
              <EditableField editable={canBiz}
                label="项目名称"
                value={p.project_name}
                onSave={(v) => save('project_name', v)}
              />
              <EditableField editable={canBiz}
                label="项目方式"
                value={p.deal_mode}
                type="select"
                options={[
                  { value: '投标', label: '投标' },
                  { value: '直签', label: '直接签合同' },
                ]}
                onSave={(v) => save('deal_mode', v)}
              />
              <EditableField editable={canBiz}
                label="线索来源"
                value={p.source}
                type="select"
                options={SOURCES.map((s) => ({ value: s, label: s }))}
                onSave={(v) => save('source', v)}
              />
              <EditableField editable={canBiz}
                label="销售负责人"
                value={p.sales_id}
                type="select"
                options={users.map((u) => ({ value: u.id, label: u.name }))}
                render={() => detail?.sales_name ?? DASH}
                onSave={(v) => save('sales_id', v)}
              />
              <EditableField editable={canBiz}
                label="项目描述"
                value={p.project_desc}
                type="textarea"
                wide
                onSave={(v) => save('project_desc', v)}
              />
              <EditableField editable={canBiz}
                label="风险标记"
                value={p.risk_note}
                wide
                render={(v) =>
                  v ? <Typography.Text type="danger">{String(v)}</Typography.Text> : DASH
                }
                onSave={(v) => save('risk_note', v)}
              />
            </div>
          </Card>
    </>
  )
}
