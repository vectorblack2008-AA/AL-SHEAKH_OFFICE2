import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  CheckCheck,
  ChevronDown,
  Command,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Sparkles,
  Sun,
  X,
} from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useToast } from '../../context/ToastContext'
import { api, errorMessage } from '../../lib/api'
import type { Notification } from '../../lib/types'
import { allNavItems, navGroups } from '../../lib/navigation'
import { cn, formatDateTime } from '../../lib/utils'
import { Avatar, Badge, IconButton, LogoMark, LogoWordmark, Modal, Popover } from '../ui'
import { PageSkeleton } from '../filters'

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t, can, user, demoMode } = useApp()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-16 shrink-0 items-center px-4">
        <Link to="/" onClick={onNavigate} className="rounded-xl transition hover:opacity-90">
          <LogoWordmark />
        </Link>
      </div>
      <div className="mx-4 h-px bg-border" />
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-5">
          {navGroups.map((group) => {
            const items = group.items.filter((item) => can(item.permission))
            if (!items.length) return null
            return (
              <div key={group.labelKey}>
                <p className="mb-1.5 px-2.5 text-[0.56rem] font-bold uppercase tracking-[0.2em] text-muted/70">
                  {t(group.labelKey)}
                </p>
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <NavLink key={item.path} to={item.path} end={item.end} onClick={onNavigate} className="nav-link">
                      <item.icon size={15.5} strokeWidth={1.8} className="nav-icon shrink-0 text-muted" />
                      <span className="truncate">{t(item.labelKey)}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </nav>
      <div className="shrink-0 px-3 pb-3">
        {demoMode ? (
          <div className="rounded-xl border border-accent/20 bg-accent-softer p-3">
            <div className="flex items-center gap-2 text-accent">
              <Sparkles size={13} />
              <p className="text-[0.64rem] font-bold uppercase tracking-[0.14em]">{t('demo.banner')}</p>
            </div>
            <p className="mt-1 text-[0.65rem] leading-relaxed text-muted">{t('demo.bannerText')}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="eyebrow text-[0.52rem]">{t('app.tagline')}</p>
            <p className="mt-1 text-[0.66rem] leading-relaxed text-muted">{user?.email}</p>
          </div>
        )}
        <p className="mt-3 px-1 text-[0.58rem] tracking-wide text-muted/60">{t('app.footer')} · v1.0</p>
      </div>
    </div>
  )
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, can } = useApp()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const items = useMemo(
    () =>
      allNavItems
        .filter((item) => can(item.permission))
        .map((item) => ({ ...item, label: t(item.labelKey) }))
        .filter((item) => !query || item.label.toLowerCase().includes(query.toLowerCase()) || item.path.includes(query.toLowerCase())),
    [can, query, t],
  )

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  return (
    <Modal open={open} onClose={onClose} hideClose size="sm" className="sm:mt-[-16vh]">
      <div className="-mx-5 -my-4">
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search size={16} className="text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('topbar.search')}
            className="h-14 flex-1 bg-transparent text-[0.84rem] text-text outline-none placeholder:text-muted"
          />
          <span className="kbd">ESC</span>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {items.length ? (
            items.map((item) => (
              <button
                key={item.path}
                type="button"
                onClick={() => {
                  navigate(item.path)
                  onClose()
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-[0.8rem] font-medium text-text-soft transition hover:bg-surface-2 hover:text-text"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface-2 text-accent">
                  <item.icon size={14} />
                </span>
                {item.label}
                <span className="ms-auto text-[0.6rem] text-muted">{item.path}</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-8 text-center text-[0.75rem] text-muted">{t('common.noResults')}</p>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[0.6rem] text-muted">
          <span>{t('app.tagline')}</span>
          <span className="flex items-center gap-1">
            <Command size={10} /> K
          </span>
        </div>
      </div>
    </Modal>
  )
}

function NotificationMenu() {
  const { t, language } = useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()

  const { data } = useQuery({
    queryKey: ['notifications', 'topbar'],
    queryFn: () => api.get<{ data: Notification[]; unread: number }>('/api/notifications'),
    refetchInterval: 60_000,
  })

  const markAll = useMutation({
    mutationFn: () => api.post('/api/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  const markOne = useMutation({
    mutationFn: (id: string) => api.patch(`/api/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  const unread = data?.unread ?? 0

  return (
    <Popover
      width="w-[22rem]"
      trigger={
        <button
          type="button"
          className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-muted transition hover:border-border hover:bg-surface-2 hover:text-text"
          aria-label={t('topbar.notifications')}
        >
          <Bell size={17} />
          {unread > 0 ? (
            <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-surface bg-accent px-1 text-[0.54rem] font-bold text-accent-contrast">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </button>
      }
    >
      <div className="flex items-center justify-between px-2 pb-2 pt-1">
        <p className="text-[0.78rem] font-semibold text-text">{t('topbar.notifications')}</p>
        {unread > 0 ? (
          <button
            type="button"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="flex items-center gap-1 text-[0.62rem] font-semibold text-accent transition hover:brightness-110 disabled:opacity-50"
          >
            <CheckCheck size={12} />
            {t('topbar.markAllRead')}
          </button>
        ) : null}
      </div>
      <div className="max-h-[22rem] overflow-y-auto border-t border-border">
        {data?.data.length ? (
          data.data.slice(0, 8).map((notification) => (
            <button
              key={notification.id}
              type="button"
              onClick={() => {
                if (!notification.is_read) markOne.mutate(notification.id)
                if (notification.link) navigate(notification.link)
              }}
              className={cn(
                'flex w-full gap-2.5 border-b border-border px-2 py-3 text-start transition last:border-0 hover:bg-surface-2',
                !notification.is_read && 'bg-accent-softer',
              )}
            >
              <span
                className={cn(
                  'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                  notification.type === 'success' && 'bg-positive',
                  notification.type === 'warning' && 'bg-warning',
                  notification.type === 'error' && 'bg-negative',
                  !['success', 'warning', 'error'].includes(notification.type) && 'bg-accent',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[0.74rem] font-semibold text-text">{notification.title}</span>
                  <span className="shrink-0 text-[0.56rem] text-muted">{formatDateTime(notification.created_at, language)}</span>
                </span>
                <span className="mt-0.5 block text-[0.66rem] leading-relaxed text-muted">{notification.message}</span>
              </span>
            </button>
          ))
        ) : (
          <p className="px-4 py-10 text-center text-[0.72rem] text-muted">{t('topbar.noNotifications')}</p>
        )}
      </div>
      <div className="border-t border-border p-1.5">
        <button
          type="button"
          onClick={() => navigate('/notifications')}
          className="w-full rounded-lg px-3 py-2 text-center text-[0.68rem] font-semibold text-accent transition hover:bg-surface-2"
        >
          {t('common.viewAll')}
        </button>
      </div>
    </Popover>
  )
}

function UserMenu() {
  const { t, user, logout, language, can } = useApp()
  const navigate = useNavigate()
  const toast = useToast()

  const roleLabel = (() => {
    const key = `role.${user?.role_key}` as Parameters<typeof t>[0]
    const translated = t(key)
    return translated === key ? user?.role_key : translated
  })()

  const handleLogout = async () => {
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch (error) {
      toast.error(t('error.generic'), errorMessage(error))
    }
  }

  return (
    <Popover
      width="w-64"
      trigger={
        <button type="button" className="flex items-center gap-2 rounded-xl border border-transparent p-1 transition hover:border-border hover:bg-surface-2">
          <Avatar name={user?.full_name} size="sm" />
          <span className="hidden min-w-0 text-start xl:block">
            <span className="block max-w-[8.5rem] truncate text-[0.72rem] font-semibold text-text">{user?.full_name}</span>
            <span className="block text-[0.58rem] text-muted">{roleLabel}</span>
          </span>
          <ChevronDown size={13} className="hidden text-muted xl:block" />
        </button>
      }
    >
      <div className="border-b border-border px-2 pb-2.5 pt-1">
        <p className="text-[0.78rem] font-semibold text-text">{user?.full_name}</p>
        <p className="mt-0.5 text-[0.64rem] text-muted">{user?.email}</p>
        <Badge tone="accent" className="mt-2">
          {roleLabel}
        </Badge>
      </div>
      <div className="pt-1">
        {can('view_settings') ? (
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[0.74rem] text-text-soft transition hover:bg-surface-2 hover:text-text"
          >
            <Settings size={14} /> {t('nav.settings')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[0.74rem] text-negative transition hover:bg-negative-soft"
        >
          <LogOut size={14} className={language === 'ar' ? 'rotate-180' : ''} /> {t('auth.signOut')}
        </button>
      </div>
    </Popover>
  )
}

function DemoBanner() {
  const { t, demoMode, can } = useApp()
  if (!demoMode) return null
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-accent/20 bg-gradient-to-r from-accent-soft via-accent-softer to-transparent px-3.5 py-2.5">
      <span className="flex items-center gap-1.5 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-accent">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
        </span>
        {t('demo.banner')}
      </span>
      <p className="min-w-0 flex-1 text-[0.68rem] leading-relaxed text-text-soft">{t('demo.bannerText')}</p>
      {can('view_settings') ? (
        <Link to="/settings?tab=demo" className="text-[0.64rem] font-semibold text-accent underline-offset-4 hover:underline">
          {t('demo.manage')}
        </Link>
      ) : null}
    </div>
  )
}

export function AppShell() {
  const { t, language, theme, toggleTheme, toggleLanguage, demoMode, can, user } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!mobileOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [mobileOpen])

  const current = useMemo(() => {
    const matches = allNavItems
      .filter((item) => (item.end ? location.pathname === item.path : location.pathname.startsWith(item.path)))
      .sort((a, b) => b.path.length - a.path.length)
    return matches[0]
  }, [location.pathname])

  useEffect(() => {
    const label = current
      ? t(current.labelKey)
      : location.pathname === '/notifications'
        ? t('notifications.title')
        : t('app.office')
    document.title = `${label} · ${t('app.office')}`
  }, [current, location.pathname, t])

  const today = useMemo(() => {
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG-u-ca-gregory-nu-latn' : 'en-EG', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date())
  }, [language])

  const handleNavigate = useCallback(() => setMobileOpen(false), [])

  return (
    <div className="app-canvas min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-40 hidden border-e border-border bg-bg-elevated/95 backdrop-blur-xl lg:block',
          sidebarCollapsed ? 'w-[76px]' : 'w-[248px]',
        )}
      >
        {sidebarCollapsed ? (
          <div className="flex h-full flex-col items-center py-4">
            <Link to="/" aria-label="Al-Sheikh Office" className="mb-5 transition hover:opacity-90">
              <LogoMark size={38} />
            </Link>
            <nav className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto">
              {navGroups.flatMap((group) =>
                group.items
                  .filter((item) => can(item.permission))
                  .map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.end}
                      title={t(item.labelKey)}
                      className={({ isActive }) =>
                        cn(
                          'flex h-9 w-9 items-center justify-center rounded-xl border transition',
                          isActive
                            ? 'border-accent/30 bg-accent-soft text-accent'
                            : 'border-transparent text-muted hover:border-border hover:bg-surface-2 hover:text-text',
                        )
                      }
                    >
                      <item.icon size={16} />
                    </NavLink>
                  )),
              )}
            </nav>
            <IconButton label={t('common.openMenu')} size="sm" onClick={() => setSidebarCollapsed(false)} className="mt-3">
              <ChevronDown size={15} className="-rotate-90 rtl:rotate-90" />
            </IconButton>
            <div className="mt-2">
              <Avatar name={user?.full_name} size="sm" />
            </div>
          </div>
        ) : (
          <div className="relative h-full">
            <SidebarContent />
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              className="absolute -end-3 top-[4.6rem] z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-md transition hover:text-accent lg:flex"
              aria-label={t('common.collapseSidebar')}
            >
              <ChevronDown size={13} className="rotate-90 rtl:-rotate-90" />
            </button>
          </div>
        )}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <aside className="animate-fade-in absolute inset-y-0 start-0 w-[278px] border-e border-border bg-bg-elevated shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute end-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
              aria-label={t('common.closeMenu')}
            >
              <X size={16} />
            </button>
            <SidebarContent onNavigate={handleNavigate} />
          </aside>
        </div>
      ) : null}

      <div className={cn('relative z-10 min-h-screen transition-[margin] duration-300', sidebarCollapsed ? 'lg:ms-[76px]' : 'lg:ms-[248px]')}>
        <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-2 px-3 sm:px-5 lg:px-7">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-text lg:hidden"
              aria-label={t('common.openMenu')}
            >
              <Menu size={19} />
            </button>
            <div className="flex min-w-0 items-center gap-2.5 lg:hidden">
              <LogoMark size={28} />
              <span className="hidden truncate text-[0.8rem] font-semibold text-text sm:block">{t('app.office')}</span>
            </div>
            <div className="hidden min-w-0 lg:block">
              <p className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-muted">
                {t('app.office')} <span className="mx-1.5 text-border-strong">/</span> {current ? t(current.labelKey) : ''}
              </p>
              <p className="mt-0.5 text-[0.68rem] text-muted/80">{today}</p>
            </div>

            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="group ms-auto hidden h-9 w-[15rem] items-center gap-2 rounded-xl border border-border bg-surface-2/70 px-3 text-start text-[0.7rem] text-muted transition hover:border-border-strong hover:bg-surface-2 md:flex xl:w-[19rem]"
            >
              <Search size={14} />
              <span className="truncate">{t('topbar.search')}</span>
              <span className="kbd ms-auto hidden xl:inline-flex">⌘K</span>
            </button>
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="ms-auto flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-text md:hidden"
              aria-label={t('common.search')}
            >
              <Search size={17} />
            </button>

            <div className="ms-1 flex items-center gap-0.5 sm:ms-2">
              {demoMode ? (
                <Link
                  to={can('view_settings') ? '/settings?tab=demo' : '/settings'}
                  className="me-1 hidden items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft px-2.5 py-1 text-[0.58rem] font-bold uppercase tracking-[0.12em] text-accent sm:flex"
                >
                  <Sparkles size={10} />
                  {t('topbar.demo')}
                </Link>
              ) : null}
              <IconButton label={`${t('common.language')}: ${language === 'en' ? 'العربية' : 'English'}`} onClick={toggleLanguage} size="sm" className="text-[0.66rem] font-bold">
                {language === 'en' ? 'ع' : 'EN'}
              </IconButton>
              <IconButton label={theme === 'dark' ? t('common.light') : t('common.dark')} onClick={toggleTheme} size="sm">
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </IconButton>
              <NotificationMenu />
              <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
              <UserMenu />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] px-3 pb-10 pt-5 sm:px-5 lg:px-7 lg:pt-6">
          <DemoBanner />
          <Suspense fallback={<PageSkeleton rows={7} />}>
            <Outlet />
          </Suspense>
        </main>
        <footer className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-4 text-[0.6rem] text-muted/70 sm:px-6 lg:px-8">
          <span>
            © {new Date().getFullYear()} {t('app.office')} · {t('app.officeArabic')}
          </span>
          <span>{t('app.tagline')}</span>
        </footer>
      </div>

      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
    </div>
  )
}
