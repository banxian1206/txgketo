import { Navigate, Route, Routes } from 'react-router-dom'

import AppLayout from './layouts/AppLayout'
import MobileLayout from './layouts/MobileLayout'
import Changes from './pages/Changes'
import Login from './pages/Login'
import AcceptM from './pages/m/AcceptM'
import HomeM from './pages/m/HomeM'
import IssuesM from './pages/m/IssuesM'
import MeM from './pages/m/MeM'
import WarehouseM from './pages/m/WarehouseM'
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
import Workbench from './pages/Workbench'
import DeptWorkbench from './pages/workbench/DeptWorkbench'
import EngWorkbench from './pages/workbench/EngWorkbench'
import PmWorkbench from './pages/workbench/PmWorkbench'
import SalesWorkbench from './pages/workbench/SalesWorkbench'
import { TOKEN_KEY } from './api/client'

function RequireAuth({ children }: { children: JSX.Element }) {
  return localStorage.getItem(TOKEN_KEY) ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
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
        <Route path="projects/:projectNo/design/:equipNo" element={<EquipmentDesign />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
