// components/project/RequireCard.tsx —— 由 ProjectDetailPage 拆出（重构 1.6b · 只拆不改）
import type { Project } from '../../api/client'
import {
  Card,
} from 'antd'

import EditableField from '../EditableField'

export default function RequireCard({
  save,
  p
}: {
  save: any;
  p: Project;
}) {
  return (
    <>
          <Card id="sec-require" size="small" title="项目要求" style={{ marginBottom: 16 }}>
            <div className="ef-grid">
              <EditableField
                label="客户产品类型"
                value={p.product_type}
                onSave={(v) => save('product_type', v)}
              />
              <EditableField
                label="要求节拍"
                value={p.required_cycle}
                onSave={(v) => save('required_cycle', v)}
              />
              <EditableField
                label="要求产能"
                value={p.required_capacity}
                onSave={(v) => save('required_capacity', v)}
              />
              <EditableField
                label="旧线改造"
                value={p.is_retrofit}
                type="switch"
                suffix="改造要停客户产线，现场窗口紧"
                onSave={(v) => save('is_retrofit', v)}
              />
            </div>
          </Card>
    </>
  )
}
