import {
  Banknote,
  Bell,
  Bus,
  CalendarRange,
  ClipboardList,
  FileBarChart,
  FileSignature,
  Gauge,
  History,
  ListChecks,
  Receipt,
  Route,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TranslationKey } from '../i18n/translations'

export interface NavItem {
  path: string
  labelKey: TranslationKey
  permission: string
  icon: LucideIcon
  end?: boolean
}

export interface NavGroup {
  labelKey: TranslationKey
  items: NavItem[]
}

export const navGroups: NavGroup[] = [
  {
    labelKey: 'nav.overview',
    items: [{ path: '/', labelKey: 'nav.dashboard', permission: 'view_dashboard', icon: Gauge, end: true }],
  },
  {
    labelKey: 'nav.operations',
    items: [
      { path: '/dispatch', labelKey: 'nav.dispatch', permission: 'view_trips', icon: CalendarRange },
      { path: '/trips', labelKey: 'nav.trips', permission: 'view_trips', icon: ClipboardList },
      { path: '/routes', labelKey: 'nav.routes', permission: 'view_routes', icon: Route },
      { path: '/fleet', labelKey: 'nav.fleet', permission: 'view_fleet', icon: Bus },
      { path: '/drivers', labelKey: 'nav.drivers', permission: 'view_drivers', icon: Users },
      { path: '/maintenance', labelKey: 'nav.maintenance', permission: 'view_maintenance', icon: Wrench },
    ],
  },
  {
    labelKey: 'nav.commercial',
    items: [
      { path: '/contracts', labelKey: 'nav.contracts', permission: 'view_contracts', icon: FileSignature },
      { path: '/revenue', labelKey: 'nav.revenue', permission: 'view_finance', icon: Banknote },
    ],
  },
  {
    labelKey: 'nav.finance',
    items: [
      { path: '/expenses', labelKey: 'nav.expenses', permission: 'view_expenses', icon: Receipt },
      { path: '/reports', labelKey: 'nav.reports', permission: 'view_reports', icon: FileBarChart },
    ],
  },
  {
    labelKey: 'nav.administration',
    items: [
      { path: '/users', labelKey: 'nav.users', permission: 'view_users', icon: ShieldCheck },
      { path: '/settings', labelKey: 'nav.settings', permission: 'view_settings', icon: Settings },
      { path: '/audit', labelKey: 'nav.audit', permission: 'view_audit', icon: History },
    ],
  },
]

export const allNavItems = navGroups.flatMap((group) => group.items)

export const notificationNav: NavItem = {
  path: '/notifications',
  labelKey: 'nav.notifications',
  permission: 'view_dashboard',
  icon: Bell,
}

export const registerIcon = ListChecks
