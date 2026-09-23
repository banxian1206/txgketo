import { DisconnectOutlined } from '@ant-design/icons'
import { Typography } from 'antd'

import { useOnline } from '../hooks/offlineQueue'
import { T } from '../theme/tokens'

/** 离线横幅（重构 3.2）：断网时全站可见 —— 拍照与操作排队、联网自动同步 */
export default function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div
      style={{
        background: T.orange,
        color: T.bg,
        padding: '6px 20px',
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <DisconnectOutlined />
      <Typography.Text style={{ color: T.bg }}>
        离线模式：拍照与操作将排队，联网后自动同步
      </Typography.Text>
    </div>
  )
}
