import { lazy, Suspense } from 'react'

import { Spin } from 'antd'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import AppLayout from './layouts/AppLayout'
import DomainShell from './components/domain/DomainShell'
import WorkbenchShell from './components/domain/WorkbenchShell'
import { ADMIN_TABS, BASE_TABS, redirectRoutes } from './configs/domain'
import MobileLayout from './layouts/MobileLayout'
import Login from './features/auth/Page'
import NotFound from './features/NotFound'
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
const Projects = lazy(() => import('./features/project/Page'))
const PurchaseWorkbench = lazy(() => import('./features/purchase/Page'))
const Users = lazy(() => import('./features/admin/Page'))
const Warehouse = lazy(() => import('./features/warehouse/Page'))
const Manufacturing = lazy(() => import('./features/manufacturing/Page'))
const Assembly = lazy(() => import('./features/assembly/Page'))
const Shipping = lazy(() => import('./features/shipping/Page'))
const Site = lazy(() => import('./features/site/Page'))
const Service = lazy(() => import('./features/service/Page'))
const ProductionM = lazy(() => import('./features/manufacturing/MobilePage'))
const AssemblyM = lazy(() => import('./features/assembly/MobilePage'))
const ShippingM = lazy(() => import('./features/shipping/MobilePage'))
const SiteM = lazy(() => import('./features/site/MobilePage'))
const ServiceM = lazy(() => import('./features/service/MobilePage'))
const Workbench = lazy(() => import('./features/workbench/Page'))
import ShopShell from './features/workbench/ShopShell'
const DeptWorkbench = lazy(() => import('./features/workbench/DeptWorkbench'))
const EngWorkbench = lazy(() => import('./features/workbench/EngWorkbench'))
const PmWorkbench = lazy(() => import('./features/workbench/PmWorkbench'))
const SalesWorkbench = lazy(() => import('./features/workbench/SalesWorkbench'))
import { useAuth } from './contexts/AuthContext'
import { hasPerm } from './api/user'

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

/**
 * 路由级权限守卫（重整 P3 · docs/10 §3.5 第 3 刀）。
 *
 * 为什么必须有：页签过滤只管“看得见”，管不了有人**直接敲 URL**。
 * 实测过一次真回归：eng_director 打开 /purchase?tab=suppliers —— 他没有任何 purchase:* 码，
 * 页签被过滤成 0 项 → 整页空白，比“看得见但 403”更难自查。
 * 现在：无权限 → 回「我的工作台」（那里人人可进），不渲染空页。
 */
function RequirePerm({ anyOf, children }: { anyOf: string[]; children: JSX.Element }) {
  const loc = useLocation()
  if (!anyOf.some((c) => hasPerm(c))) {
    // ★ docs/11：带着 ?from= 进来却没权限 → 送回他来的那个台（比一律丢去「我的工作台」更近）
    const from = new URLSearchParams(loc.search).get('from')
    return <Navigate to={from ? decodeURIComponent(from) : '/workbench'} replace />
  }
  return children
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
        {/* P0 修正：工作台域 = 角色台 Tab 化（me 动态列表；采购台/仓库台归位） */}
        <Route element={<WorkbenchShell />}>
        <Route path="workbench" element={<Workbench />} />
        <Route path="workbench/sales" element={<SalesWorkbench />} />
        <Route path="workbench/pm" element={<PmWorkbench />} />
        <Route path="workbench/eng" element={<EngWorkbench />} />
        {/* A5：车间台收编制造/装配 —— 台内 card 页签（v2 拍板③：交付执行组保留，双入口中间态） */}
        <Route path="workbench/shop" element={<ShopShell />}>
          <Route index element={<DeptWorkbench kind="shop" />} />
          <Route path="mfg" element={<Manufacturing />} />
          <Route path="assembly" element={<Assembly />} />
        </Route>
        {/* A2：我的台内页签 = URL 子路由（v2 拍板②·组件复用挂入） */}
        <Route path="workbench/tasks" element={<Workbench />} />
        <Route path="workbench/reviews" element={<Workbench />} />
        <Route path="workbench/changes" element={<Workbench />} />
        <Route path="purchase" element={<RequirePerm anyOf={['purchase:view', 'purchase:edit', 'purchase:price']}><PurchaseWorkbench /></RequirePerm>} />
        <Route path="warehouse" element={<RequirePerm anyOf={['warehouse:view', 'warehouse:edit']}><Warehouse /></RequirePerm>} />
        {/* ★ 重整 P1（docs/10 §8.4）：「交付执行」域删除，业务线只在台里跑。
            URL 一个没改（/delivery/shipping|site|service 原样），只是换壳：由 WorkbenchShell 包，
            所以顶部是「我的工作台 · 发运工作台」这种**角色台**条，而不是 6 项流水线域条。 */}
        <Route path="delivery/shipping" element={<RequirePerm anyOf={['ship:edit', 'project:edit']}><Shipping /></RequirePerm>} />
        <Route path="delivery/site" element={<RequirePerm anyOf={['site:edit', 'project:edit', 'acceptance:edit']}><Site /></RequirePerm>} />
        <Route path="delivery/service" element={<RequirePerm anyOf={['service:edit']}><Service /></RequirePerm>} />
        </Route>
        <Route path="projects" element={<Projects />} />
        {/* ★ docs/11：这些页都可能从某个台点进来（26 处跳转），所以一并挂进工作台壳 ——
            台条不再整条消失，配合 ?from= 还能高亮「我从哪个台来」。
            RequirePerm 守卫 + from 传递见 hooks/useFrom。 */}
        <Route element={<WorkbenchShell />}>
        <Route path="projects/new" element={<ProjectCreate />} />
        <Route path="projects/:projectNo" element={<ProjectDetailPage />} />
        <Route path="projects/:projectNo/initiate" element={<ProjectInitiate />} />
        <Route path="projects/:projectNo/design/:equipNo" element={<EquipmentDesign />} />
        </Route>
        {/* ★ 交付域壳已删：制造/装配唯一入口=车间台；发运/现场/售后见上面 WorkbenchShell 内。
            /delivery、/delivery/mfg、/delivery/acceptance 等旧路径走 ROUTE_REDIRECTS 一跳到位。 */}
        <Route path="/admin" element={<DomainShell tabs={ADMIN_TABS} />}>
          <Route index element={<Navigate to="/admin/users" replace />} />
          <Route path="users" element={<RequirePerm anyOf={['admin:users', 'system:admin']}><Users /></RequirePerm>} />
        </Route>
        <Route element={<DomainShell tabs={BASE_TABS} />}>
          <Route path="library" element={<RequirePerm anyOf={['std:view', 'std:edit']}><Library /></RequirePerm>} />
          <Route path="numbering" element={<NumberRules />} />
        </Route>
        {redirectRoutes()}
      </Route>
      {/* ★ F12（2026-10-04 走查核实）：未知路由不再静默踢回工作台 —— 给出真 404（旧路径由上面
          redirectRoutes() 的兼容层一跳到位，不经过这里） */}
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  )
}
