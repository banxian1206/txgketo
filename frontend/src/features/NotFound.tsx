import { Button, Result, Typography } from 'antd'
import { Link, useLocation } from 'react-router-dom'

/**
 * 真 404 页（F12 · 2026-10-04 走查核实）。
 * 修前：未知路由一律 `<Navigate to="/" replace/>` —— 旧书签/打错地址的人被静默踢到工作台，
 * 没有任何"你原来要找的页面不存在"的提示，会误以为"数据丢了/权限没了"。
 * 注意：**旧路径兼容层（ROUTE_REDIRECTS）不经过这里**——那些是设计内跳转，仍然一跳到位。
 */
export default function NotFound() {
  const loc = useLocation()
  return (
    <div className="center-404">
      <Result
        status="404"
        title="页面不存在"
        subTitle={
          <>
            地址 <Typography.Text code>{loc.pathname}</Typography.Text> 没有对应页面。
            <br />
            可能是：链接过期 / 地址打错 / 该功能还没上线。旧地址（如 /delivery/mfg）仍会自动跳到新位置，
            若你是从旧地址来的而这里出现 = 新位置还没登记，请反馈。
          </>
        }
        extra={
          <Link to="/workbench">
            <Button type="primary">回我的工作台</Button>
          </Link>
        }
      />
    </div>
  )
}
