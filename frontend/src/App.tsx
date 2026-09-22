import { lazy, Suspense } from 'react'

import { Spin } from 'antd'
import { Navigate, Route, Routes } from 'react-router-dom'

import AppLayout from './layouts/AppLayout'
import MobileLayout from './layouts/MobileLayout'
const Changes = lazy(() => import('./features/change/Page'))
import Login from './features/auth/Page'
const AcceptM = lazy(() => import('./features/acceptance/MobilePage'))
const HomeM = lazy(() => import('./features/home/MobilePage'))
const IssuesM = lazy(() => import('./features/warehouse/IssuesPage'))
const MeM = lazy(() => import('./features/home/MePage'))
const WarehouseM = lazy(() => import('./features/warehouse/MobilePage'))
const NumberRules = lazy(() => import('./features/admin/NumberRulesPage'))
const ProjectCreate = lazy(() => import('./features/project/CreatePage'))
const ProjectDetailPage = lazy(() => import('./features/project/DetailPage'))
const ProjectInitiate = lazy(() => import('./features/project/InitiatePage'))
const Library = lazy(() => import('./features/admin/LibraryPage'))
const EquipmentDesign = lazy(() => import('./features/design/Page'))
const MyTasks = lazy(() => import('./features/task/Page'))
const Projects = lazy(() => import('./features/project/Page'))
const PurchaseWorkbench = lazy(() => import('./features/purchase/Page'))
const Reviews = lazy(() => import('./features/review/Page'))
const Suppliers = lazy(() => import('./features/purchase/SuppliersPage'))
const Users = lazy(() => import('./features/admin/Page'))
const Warehouse = lazy(() => import('./features/warehouse/Page'))
const Manufacturing = lazy(() => import('./features/manufacturing/Page'))
const Assembly = lazy(() => import('./features/assembly/Page'))
const Shipping = lazy(() => import('./features/shipping/Page'))
const Site = lazy(() => import('./features/site/Page'))
const AcceptancePage = lazy(() => import('./features/acceptance/Page'))
const Service = lazy(() => import('./features/service/Page'))
const ProductionM = lazy(() => import('./features/manufacturing/MobilePage'))
const AssemblyM = lazy(() => import('./features/assembly/MobilePage'))
const ShippingM = lazy(() => import('./features/shipping/MobilePage'))
const SiteM = lazy(() => import('./features/site/MobilePage'))
const ServiceM = lazy(() => import('./features/service/MobilePage'))
const Workbench = lazy(() => import('./features/workbench/Page'))
const DeptWorkbench = lazy(() => import('./features/workbench/DeptWorkbench'))
const EngWorkbench = lazy(() => import('./features/workbench/EngWorkbench'))
const PmWorkbench = lazy(() => import('./features/workbench/PmWorkbench'))
const SalesWorkbench = lazy(() => import('./features/workbench/SalesWorkbench'))
import { useAuth } from './contexts/AuthContext'

/** 路由懒加载占位（重构 3.1 · 按 feature 分包） */
function RouteLoading() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <Spin />
    </div>
  )
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { token } = useAuth()
  return token ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/m"
        element={
          <RequireAuth>
            <MobileLayout />
          </RequireAuth>
        }
      >
        <Route index element={<HomeM />} />
        <Route path="warehouse" element={<WarehouseM />} />
        <Route path="accept/:requestId" element={<AcceptM />} />
        <Route path="issues" element={<IssuesM />} />
        <Route path="production" element={<ProductionM />} />
        <Route path="assembly" element={<AssemblyM />} />
        <Route path="shipping" element={<ShippingM />} />
        <Route path="site" element={<SiteM />} />
        <Route path="service" element={<ServiceM />} />
        <Route path="me" element={<MeM />} />
      </Route>
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Workbench />} />
        <Route path="workbench" element={<Workbench />} />
        <Route path="workbench/sales" element={<SalesWorkbench />} />
        <Route path="workbench/pm" element={<PmWorkbench />} />
        <Route path="workbench/eng" element={<EngWorkbench />} />
        <Route path="workbench/shop" element={<DeptWorkbench kind="shop" />} />
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
        <Route path="manufacturing" element={<Manufacturing />} />
        <Route path="assembly" element={<Assembly />} />
        <Route path="shipping" element={<Shipping />} />
        <Route path="site" element={<Site />} />
        <Route path="acceptance" element={<AcceptancePage />} />
        <Route path="service" element={<Service />} />
        <Route path="projects/:projectNo/design/:equipNo" element={<EquipmentDesign />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
