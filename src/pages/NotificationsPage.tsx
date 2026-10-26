import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  Info,
  Plus,
  RefreshCw,
  TriangleAlert,
  XCircle,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import type { TranslationKey } from '../i18n/translations'
import { api, errorMessage } from '../lib/api'
import type { Notification, User, UsersResponse } from '../lib/types'
import { cn, formatDateTime } from '../lib/utils'
import {
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Panel,
  Select,
  Tabs,
  TabPanel,
  Textarea,
} from '../components/ui'
import { PageError, PageSkeleton, StatStrip } from '../components/filters'

type NotificationFilter = 'all' | 'unread'
type NotificationType = 'info' | 'success' | 'warning' | 'danger'

interface NotificationForm {
  title: string
  message: string
  type: NotificationType
  link: string
  user_id: string
}

const TYPE_META: Record<
  NotificationType,
  { icon: typeof Info; color: string; bg: string; label: TranslationKey }
> = {
  info: { icon: Info, color: 'text-info', bg: 'bg-info-soft border-info/25', label: 'notifications.info' },
  success: { icon: CheckCircle2, color: 'text-positive', bg: 'bg-positive-soft border-positive/25', label: 'notifications.success' },
  warning: { icon: TriangleAlert, color: 'text-warning', bg: 'bg-warning-soft border-warning/25', label: 'notifications.warning' },
  danger: { icon: XCircle, color: 'text-negative', bg: 'bg-negative-soft border-negative/25', label: 'notifications.error' },
}

function emptyForm(): NotificationForm {
  return { title: '', message: '', type: 'info', link: '', user_id: '' }
}

export function NotificationsPage() {
  const { t, language, can } = useApp()
  const toast = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<NotificationForm>(emptyForm)

  const canManage = can('manage_notifications')
  const canViewUsers = can('view_users')

  const listQuery = useQuery({
    queryKey: ['notifications', 'list', filter],
    queryFn: () => api.get<{ data: Notification[]; unread: number }>('/api/notifications', { unread: filter === 'unread' ? true : undefined }),
  })

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<UsersResponse>('/api/users'),
    enabled: canManage && canViewUsers,
  })

  const notifications = listQuery.data?.data ?? []
  const unread = listQuery.data?.unread ?? 0
  const users = usersQuery.data?.data ?? []

  const lastNotification = useMemo(() => {
    if (!notifications.length) return null
    return [...notifications].sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0]
  }, [notifications])

  const typeCount = useMemo(() => {
    const counts = { info: 0, success: 0, warning: 0, danger: 0 }
    for (const notification of notifications) {
      const type = (notification.type in counts ? notification.type : 'info') as NotificationType
      counts[type] += 1
    }
    return counts
  }, [notifications])

  const markOneMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/api/notifications/${id}/read`),
    onSuccess: () => {
      toast.success(t('notifications.markedRead'))
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  const markAllMutation = useMutation({
    mutationFn: () => api.post('/api/notifications/read-all'),
    onSuccess: () => {
      toast.success(t('notifications.allRead'))
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/api/notifications', payload),
    onSuccess: () => {
      toast.success(t('notifications.sent'))
      setFormOpen(false)
      setForm(emptyForm())
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  function open(notification: Notification) {
    if (!notification.is_read) markOneMutation.mutate(notification.id)
    if (notification.link) navigate(notification.link)
  }

  function submit() {
    if (form.title.trim().length < 2 || form.message.trim().length < 2) {
      toast.error(t('error.validation'), t('common.required'))
      return
    }
    let link = form.link.trim()
    if (link && !link.startsWith('/')) link = `/${link}`
    if (link.length > 300) {
      toast.error(t('error.validation'), t('notifications.link'))
      return
    }
    createMutation.mutate({
      title: form.title.trim(),
      message: form.message.trim(),
      type: form.type,
      link: link || null,
      user_id: form.user_id || null,
    })
  }

  function typeLabel(type: string) {
    const meta = TYPE_META[(type in TYPE_META ? type : 'info') as NotificationType]
    return t(meta.label)
  }

  const headerActions = (
    <>
      <IconButton label={t('common.refresh')} variant="secondary" onClick={() => void listQuery.refetch()}>
        <RefreshCw size={15} className={listQuery.isFetching ? 'animate-spin' : ''} />
      </IconButton>
      {unread > 0 ? (
        <Button
          variant="secondary"
          size="sm"
          icon={<CheckCheck size={14} />}
          loading={markAllMutation.isPending}
          onClick={() => markAllMutation.mutate()}
        >
          {t('notifications.markAllRead')}
        </Button>
      ) : null}
      {canManage ? (
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => { setForm(emptyForm()); setFormOpen(true) }}>
          {t('notifications.createTitle')}
        </Button>
      ) : null}
    </>
  )

  if (listQuery.isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader title={t('notifications.title')} subtitle={t('notifications.subtitle')} />
        <PageSkeleton rows={5} />
      </div>
    )
  }

  if (listQuery.error) {
    return (
      <div className="space-y-5">
        <PageHeader title={t('notifications.title')} subtitle={t('notifications.subtitle')} />
        <PageError error={listQuery.error} onRetry={() => void listQuery.refetch()} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('notifications.title')} subtitle={t('notifications.subtitle')} actions={headerActions} />

      <StatStrip
        items={[
          { label: t('notifications.unread'), value: unread, tone: unread > 0 ? 'warning' : 'positive' },
          { label: filter === 'unread' ? t('notifications.unreadOnly') : t('common.total'), value: notifications.length },
          { label: t('notifications.info'), value: typeCount.info, tone: 'accent' },
          { label: t('notifications.warning'), value: typeCount.warning, tone: typeCount.warning > 0 ? 'warning' : 'default' },
          {
            label: t('common.date'),
            value: lastNotification ? formatDateTime(lastNotification.created_at, language) : '—',
          },
        ]}
      />

      <Tabs<NotificationFilter>
        value={filter}
        onChange={setFilter}
        items={[
          { value: 'all', label: t('common.all'), count: filter === 'all' ? notifications.length : undefined },
          { value: 'unread', label: t('notifications.unread'), count: unread },
        ]}
      />

      <TabPanel>
        {notifications.length === 0 ? (
          <Panel>
            <EmptyState
              icon={filter === 'unread' ? <BellOff size={20} /> : <Bell size={20} />}
              title={t('notifications.empty')}
              hint={t('notifications.emptyHint')}
              action={
                canManage && filter === 'all' ? (
                  <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => { setForm(emptyForm()); setFormOpen(true) }}>
                    {t('notifications.createTitle')}
                  </Button>
                ) : undefined
              }
            />
          </Panel>
        ) : (
          <Panel className="overflow-hidden p-0">
            {notifications.map((notification) => {
              const meta = TYPE_META[(notification.type in TYPE_META ? notification.type : 'info') as NotificationType]
              const Icon = meta.icon
              return (
                <div
                  key={notification.id}
                  className={cn(
                    'flex flex-col gap-3 border-b border-border px-4 py-3.5 transition last:border-0 sm:flex-row sm:items-start',
                    !notification.is_read && 'bg-accent-softer/60',
                  )}
                >
                  <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', meta.bg)}>
                    <Icon size={16} className={meta.color} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[0.78rem] font-semibold text-text">{notification.title}</p>
                      <span className={cn('rounded-full border px-1.5 py-0.5 text-[0.56rem] font-semibold', meta.bg, meta.color)}>
                        {typeLabel(notification.type)}
                      </span>
                      {!notification.is_read ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label={t('notifications.unread')} /> : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-[0.72rem] leading-relaxed text-text-soft">{notification.message}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.62rem] text-muted">
                      <span>{formatDateTime(notification.created_at, language)}</span>
                      {notification.link ? (
                        <span className="inline-flex items-center gap-1 font-mono text-[0.6rem] text-accent">
                          <ExternalLink size={10} /> {notification.link}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1 self-end sm:self-start">
                    {notification.link ? (
                      <Button variant="secondary" size="sm" onClick={() => open(notification)}>
                        {t('notifications.view')}
                      </Button>
                    ) : null}
                    {!notification.is_read ? (
                      <IconButton
                        label={t('notifications.markRead')}
                        size="sm"
                        disabled={markOneMutation.isPending}
                        onClick={() => markOneMutation.mutate(notification.id)}
                      >
                        <Check size={13} />
                      </IconButton>
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center text-muted/60" title={t('notifications.read')}>
                        <CheckCheck size={13} />
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </Panel>
        )}
      </TabPanel>

      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setForm(emptyForm()) }}
        title={t('notifications.createTitle')}
        description={t('notifications.subtitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setFormOpen(false); setForm(emptyForm()) }}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={createMutation.isPending} disabled={Boolean(usersQuery.error)} onClick={submit}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t('notifications.formTitle')} required>
            <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={160} />
          </Field>
          <Field label={t('notifications.message')} required>
            <Textarea rows={4} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} maxLength={1000} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('notifications.type')}>
              <Select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as NotificationType })}>
                {(['info', 'success', 'warning', 'danger'] as const).map((type) => (
                  <option key={type} value={type}>{t(TYPE_META[type].label)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('notifications.recipient')}>
              <Select value={form.user_id} onChange={(event) => setForm({ ...form, user_id: event.target.value })} disabled={!canViewUsers}>
                <option value="">{t('notifications.allUsers')}</option>
                {users.filter((user: User) => user.is_active).map((user) => (
                  <option key={user.id} value={user.id}>{user.full_name}</option>
                ))}
              </Select>
              {usersQuery.error ? <p className="mt-1 text-[0.64rem] text-negative">{errorMessage(usersQuery.error)}</p> : null}
            </Field>
          </div>
          <Field label={t('notifications.link')} hint={t('notifications.linkHint')}>
            <Input value={form.link} onChange={(event) => setForm({ ...form, link: event.target.value })} placeholder="/revenue" maxLength={300} />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
