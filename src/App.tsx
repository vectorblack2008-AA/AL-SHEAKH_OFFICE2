import { lazy, useEffect, type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useApp } from './context/AppContext'
import { AppShell } from './components/layout/AppShell'
import { LogoMark, Spinner } from './components/ui'
import { LoginPage } from './pages/LoginPage'
import { AccessDeniedPage, NotFoundPage } from './pages/SystemPages'

const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const FleetPage = lazy(() => import('./pages/FleetPage').then((module) => ({ default: module.FleetPage })))
const DriversPage = lazy(() => import('./pages/DriversPage').then((module) => ({ default: module.DriversPage })))
const RoutesPage = lazy(() => import('./pages/RoutesPage').then((module) => ({ default: module.RoutesPage })))
const TripsPage = lazy(() => import('./pages/TripsPage').then((module) => ({ default: module.TripsPage })))
const DispatchPage = lazy(() => import('./pages/DispatchPage').then((module) => ({ default: module.DispatchPage })))
const ContractsPage = lazy(() => import('./pages/ContractsPage').then((module) => ({ default: module.ContractsPage })))
const RevenuePage = lazy(() => import('./pages/RevenuePage').then((module) => ({ default: module.RevenuePage })))
const ExpensesPage = lazy(() => import('./pages/ExpensesPage').then((module) => ({ default: module.ExpensesPage })))
const MaintenancePage = lazy(() => import('./pages/MaintenancePage').then((module) => ({ default: module.MaintenancePage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const UsersPage = lazy(() => import('./pages/UsersPage').then((module) => ({ default: module.UsersPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then((module) => ({ default: module.NotificationsPage })))
const AuditPage = lazy(() => import('./pages/AuditPage').then((module) => ({ default: module.AuditPage })))

function BootScreen() {
  return (
    <div className="app-canvas flex min-h-screen flex-col items-center justify-center gap-5">
      <LogoMark size={58} />
      <div className="flex items-center gap-2.5 text-[0.74rem] font-medium text-muted">
        <Spinner size={15} />
        Al-Sheikh Office
      </div>
    </div>
  )
}

function ProtectedRoute() {
  const { ready, user } = useApp()
  const location = useLocation()
  if (!ready) return <BootScreen />
  if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  return <Outlet />
}

function Guard({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useApp()
  return can(permission) ? <>{children}</> : <AccessDeniedPage />
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])
  return null
}

function LoginRoute() {
  const { ready } = useApp()
  if (!ready) return <BootScreen />
  return <LoginPage />
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route index element={<Guard permission="view_dashboard"><DashboardPage /></Guard>} />
            <Route path="fleet" element={<Guard permission="view_fleet"><FleetPage /></Guard>} />
            <Route path="drivers" element={<Guard permission="view_drivers"><DriversPage /></Guard>} />
            <Route path="routes" element={<Guard permission="view_routes"><RoutesPage /></Guard>} />
            <Route path="trips" element={<Guard permission="view_trips"><TripsPage /></Guard>} />
            <Route path="dispatch" element={<Guard permission="view_trips"><DispatchPage /></Guard>} />
            <Route path="contracts" element={<Guard permission="view_contracts"><ContractsPage /></Guard>} />
            <Route path="revenue" element={<Guard permission="view_finance"><RevenuePage /></Guard>} />
            <Route path="expenses" element={<Guard permission="view_expenses"><ExpensesPage /></Guard>} />
            <Route path="maintenance" element={<Guard permission="view_maintenance"><MaintenancePage /></Guard>} />
            <Route path="reports" element={<Guard permission="view_reports"><ReportsPage /></Guard>} />
            <Route path="users" element={<Guard permission="view_users"><UsersPage /></Guard>} />
            <Route path="settings" element={<Guard permission="view_settings"><SettingsPage /></Guard>} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="audit" element={<Guard permission="view_audit"><AuditPage /></Guard>} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </>
  )
}
