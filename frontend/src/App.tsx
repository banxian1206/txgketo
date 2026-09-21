import { Card, Typography } from 'antd'
import { Navigate, Route, Routes } from 'react-router-dom'

import AppLayout from './layouts/AppLayout'
import Changes from './pages/Changes'
import Login from './pages/Login'
import NumberRules from './pages/NumberRules'
import ProjectCreate from './pages/ProjectCreate'
import ProjectDetailPage from './pages/ProjectDetailPage'
import ProjectInitiate from './pages/ProjectInitiate'
import Library from './pages/Library'
import EquipmentDesign from './pages/EquipmentDesign'
import MyTasks from './pages/MyTasks'
import Projects from './pages/Projects'
import PurchaseWorkbench from './pages/PurchaseWorkbench'
import Reviews from './pages/Reviews'
import Suppliers from './pages/Suppliers'
import Users from './pages/Users'
import Warehouse from './pages/Warehouse'
import { TOKEN_KEY } from './api/client'

function RequireAuth({ children }: { children: JSX.Element }) {
  return localStorage.getItem(TOKEN_KEY) ? children : <Navigate to="/login" replace />
}

function Home() {
  return (
    <Card>
      <Typography.Title level={4}>同兴高科项目管理系统</Typography.Title>
      <Typography.Paragraph type="secondary">
        流程：商机 → 立项 → 工程设计（设计BOM + 材料BOM）→ 采购 → 仓库 → 制造 → 装配调试 →
        发货发运 → 现场安装 → 现场调试 → 客户验收 → 质保售后
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        当前已实现：平台基础（组织/用户/角色/权限/操作日志）· 发号引擎 · 商机登记。
      </Typography.Paragraph>
    </Card>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/new" element={<ProjectCreate />} />
        <Route path="projects/:projectNo" element={<ProjectDetailPage />} />
        <Route path="projects/:projectNo/initiate" element={<ProjectInitiate />} />
        <Route path="numbering" element={<NumberRules />} />
        <Route path="users" element={<Users />} />
        <Route path="library" element={<Library />} />
        <Route path="my-tasks" element={<MyTasks />} />
        <Route path="reviews" element={<Reviews />} />
        <Route path="changes" element={<Changes />} />
        <Route path="purchase" element={<PurchaseWorkbench />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="warehouse" element={<Warehouse />} />
        <Route path="projects/:projectNo/design/:equipNo" element={<EquipmentDesign />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
