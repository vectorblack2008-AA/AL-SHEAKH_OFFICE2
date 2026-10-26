import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Clock,
  Eye,
  Fingerprint,
  Globe2,
  History,
  RefreshCw,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import type { TranslationKey } from '../i18n/translations'
import { api } from '../lib/api'
import type { AuditLog, UsersResponse } from '../lib/types'
import { cn, formatDateTime } from '../lib/utils'
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  IconButton,
  InfoRow,
  Input,
  PageHeader,
  Pagination,
  Panel,
  SectionHeader,
  Select,
  Sheet,
  type Tone,
} from '../components/ui'
import { PageError, PageSkeleton, StatStrip, usePageState } from '../components/filters'

interface AuditResponse {
  data: AuditLog[]
  total: number
  page: number
  pageSize: number
}

const ACTIONS = [
  'login',
  'logout',
  'create',
  'update',
  'update_permissions',
  'seed_demo',
  'reset_demo',
  'reset_workspace',
  'recognize_revenue',
  'generate_invoice',
  'archive',
  'void',
  'reassign',
  'generate',
] as const

const ENTITIES = [
  'user',
  'role',
  'settings',
  'expense_category',
  'notification',
  'workspace',
  'contract',
  'invoice',
  'payment',
  'expense',
  'vehicle',
  'driver',
  'route',
  'customer',
  'trip',
  'maintenance',
] as const

const ACTION_KEYS: Record<string, TranslationKey> = {
  login: 'audit.action.login',
  logout: 'audit.action.logout',
  create: 'audit.action.create',
  update: 'audit.action.update',
  update_permissions: 'audit.action.update_permissions',
  seed_demo: 'audit.action.seed_demo',
  reset_demo: 'audit.action.reset_demo',
  reset_workspace: 'audit.action.reset_workspace',
  recognize_revenue: 'audit.action.recognize_revenue',
  generate_invoice: 'audit.action.generate_invoice',
  archive: 'audit.action.archive',
  void: 'audit.action.void',
  reassign: 'audit.action.reassign',
  generate: 'audit.action.generate',
}

const ENTITY_KEYS: Record<string, TranslationKey> = {
  user: 'audit.entity.user',
  role: 'audit.entity.role',
  settings: 'audit.entity.settings',
  expense_category: 'audit.entity.expense_category',
  notification: 'audit.entity.notification',
  workspace: 'audit.entity.workspace',
  contract: 'audit.entity.contract',
  invoice: 'audit.entity.invoice',
  payment: 'audit.entity.payment',
  expense: 'audit.entity.expense',
  vehicle: 'audit.entity.vehicle',
  driver: 'audit.entity.driver',
  route: 'audit.entity.route',
  customer: 'audit.entity.customer',
  trip: 'audit.entity.trip',
  maintenance: 'audit.entity.maintenance',
}

function actionTone(action: string): Tone {
  switch (action) {
    case 'create':
    case 'generate':
    case 'generate_invoice':
    case 'recognize_revenue':
      return 'positive'
    case 'update':
    case 'update_permissions':
    case 'login':
      return 'info'
    case 'seed_demo':
    case 'reset_demo':
    case 'reset_workspace':
    case 'reassign':
      return 'warning'
    case 'archive':
      return 'neutral'
    case 'void':
      return 'negative'
    default:
      return 'neutral'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

interface DiffEntry {
  key: string
  before: unknown
  after: unknown
}

function diffEntries(before: unknown, after: unknown): DiffEntry[] | null {
  if (!isRecord(before) || !isRecord(after)) return null
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const entries: DiffEntry[] = []
  for (const key of keys) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue
    entries.push({ key, before: before[key], after: after[key] })
  }
  return entries
}

function previewValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value === '' ? '""' : value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

function jsonBlock(value: unknown): string {
  if (value === null || value === undefined) return '—'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function AuditPage() {
  const { t, language, can } = useApp()

  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const [actorId, setActorId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [selected, setSelected] = useState<AuditLog | null>(null)

  const { page, pageSize, setPage } = usePageState(20)

  useEffect(() => {
    setPage(1)
  }, [entity, action, actorId, from, to, setPage])

  const auditQuery = useQuery({
    queryKey: ['audit', page, pageSize, entity, action, actorId, from, to],
    queryFn: () =>
      api.get<AuditResponse>('/api/audit-logs', {
        page,
        pageSize,
        entityType: entity || undefined,
        action: action || undefined,
        actorId: actorId || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
  })

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<UsersResponse>('/api/users'),
    enabled: can('view_users'),
  })

  const logs = auditQuery.data?.data ?? []
  const total = auditQuery.data?.total ?? 0
  const users = usersQuery.data?.data ?? []

  const pageActors = useMemo(() => new Set(logs.map((log) => log.actor_name || log.actor_id || 'system')).size, [logs])
  const pageEntities = useMemo(() => new Set(logs.map((log) => log.entity_type)).size, [logs])
  const latest = logs[0]?.created_at

  function labelAction(value: string) {
    const key = ACTION_KEYS[value]
    return key ? t(key) : value.replace(/_/g, ' ')
  }

  function labelEntity(value: string) {
    const key = ENTITY_KEYS[value]
    return key ? t(key) : value.replace(/_/g, ' ')
  }

  function resetFilters() {
    setEntity('')
    setAction('')
    setActorId('')
    setFrom('')
    setTo('')
  }

  const hasFilters = Boolean(entity || action || actorId || from || to)
  const diffs = selected ? diffEntries(selected.before_data, selected.after_data) : null

  if (auditQuery.isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow={`${t('nav.administration')} · ${t('nav.audit')}`} title={t('audit.title')} subtitle={t('audit.subtitle')} />
        <PageSkeleton rows={7} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${t('nav.administration')} · ${t('nav.audit')}`}
        title={t('audit.title')}
        subtitle={t('audit.subtitle')}
        actions={
          <IconButton label={t('common.refresh')} variant="secondary" onClick={() => void auditQuery.refetch()}>
            <RefreshCw size={15} className={auditQuery.isFetching ? 'animate-spin' : ''} />
          </IconButton>
        }
      />

      <StatStrip
        items={[
          { label: t('common.total'), value: total.toLocaleString(), tone: 'accent' },
          { label: t('common.showing'), value: logs.length },
          { label: t('audit.actor'), value: pageActors },
          { label: t('audit.entity'), value: pageEntities },
          { label: t('audit.recorded'), value: latest ? formatDateTime(latest, language) : '—' },
        ]}
      />

      <Panel className="p-3 sm:p-4">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal size={13} className="text-muted" />
            <p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-muted">{t('audit.filters')}</p>
          </div>
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={resetFilters}>{t('audit.resetFilters')}</Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={entity} onChange={(event) => setEntity(event.target.value)} className="w-auto min-w-[10.5rem]">
            <option value="">{t('audit.allEntities')}</option>
            {ENTITIES.map((value) => (
              <option key={value} value={value}>{labelEntity(value)}</option>
            ))}
          </Select>
          <Select value={action} onChange={(event) => setAction(event.target.value)} className="w-auto min-w-[10.5rem]">
            <option value="">{t('audit.allActions')}</option>
            {ACTIONS.map((value) => (
              <option key={value} value={value}>{labelAction(value)}</option>
            ))}
          </Select>
          {can('view_users') ? (
            <Select value={actorId} onChange={(event) => setActorId(event.target.value)} className="w-auto min-w-[11rem]">
              <option value="">{t('audit.allActors')}</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.full_name} · {user.email}</option>
              ))}
            </Select>
          ) : null}
          <div className="flex items-center gap-1.5">
            <Input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className="h-[38px] w-[9rem]" aria-label={t('common.from')} />
            <span className="text-[0.68rem] text-muted">{t('common.to')}</span>
            <Input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="h-[38px] w-[9rem]" aria-label={t('common.to')} />
          </div>
        </div>
      </Panel>

      {auditQuery.error ? (
        <PageError error={auditQuery.error} onRetry={() => void auditQuery.refetch()} />
      ) : logs.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<History size={20} />}
            title={t('audit.empty')}
            hint={hasFilters ? t('common.noResultsHint') : t('audit.emptyHint')}
            action={hasFilters ? <Button variant="secondary" size="sm" onClick={resetFilters}>{t('audit.resetFilters')}</Button> : undefined}
          />
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="scroll-x">
            <table className="data-table min-w-[980px]">
              <thead>
                <tr>
                  <th>{t('audit.when')}</th>
                  <th>{t('audit.actor')}</th>
                  <th>{t('audit.action')}</th>
                  <th>{t('audit.entity')}</th>
                  <th>{t('audit.ip')}</th>
                  <th className="text-end">{t('common.details')}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap">
                      <span className="flex items-center gap-1.5 text-[0.68rem] text-text-soft">
                        <Clock size={11} className="text-muted" />
                        {formatDateTime(log.created_at, language)}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Avatar name={log.actor_name || 'System'} size="sm" />
                        <span className="max-w-[12rem] truncate text-[0.7rem] font-medium text-text-soft">
                          {log.actor_name || t('audit.system')}
                        </span>
                      </div>
                    </td>
                    <td>
                      <Badge tone={actionTone(log.action)}>{labelAction(log.action)}</Badge>
                    </td>
                    <td>
                      <span className="block text-[0.7rem] font-medium text-text-soft">{labelEntity(log.entity_type)}</span>
                      {log.entity_id ? (
                        <span className="mt-0.5 block max-w-[12rem] truncate font-mono text-[0.58rem] text-muted">{log.entity_id}</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap font-mono text-[0.64rem] text-muted">{log.ip_address || '—'}</td>
                    <td>
                      <div className="flex justify-end">
                        <IconButton label={t('common.details')} size="sm" onClick={() => setSelected(log)}>
                          <Eye size={13} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border px-3">
            <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
          </div>
        </Panel>
      )}

      <Sheet
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? labelAction(selected.action) : undefined}
        description={selected ? `${labelEntity(selected.entity_type)}${selected.entity_id ? ` · ${selected.entity_id}` : ''}` : undefined}
        width="max-w-2xl"
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={actionTone(selected.action)}>{labelAction(selected.action)}</Badge>
              <Badge tone="neutral">{labelEntity(selected.entity_type)}</Badge>
              <span className="inline-flex items-center gap-1 text-[0.64rem] text-muted">
                <Clock size={11} /> {formatDateTime(selected.created_at, language)}
              </span>
            </div>

            <Panel className="p-4">
              <SectionHeader title={t('audit.details')} />
              <div className="mt-2">
                <InfoRow
                  label={t('audit.actor')}
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      <UserRound size={11} className="text-muted" />
                      {selected.actor_name || t('audit.system')}
                    </span>
                  }
                />
                <InfoRow label={t('audit.action')} value={labelAction(selected.action)} />
                <InfoRow label={t('audit.entity')} value={labelEntity(selected.entity_type)} />
                <InfoRow
                  label={t('audit.entityId')}
                  value={
                    selected.entity_id ? (
                      <span className="inline-flex items-center gap-1 font-mono text-[0.66rem]">
                        <Fingerprint size={11} className="text-muted" />
                        {selected.entity_id}
                      </span>
                    ) : (
                      '—'
                    )
                  }
                />
                <InfoRow
                  label={t('audit.ip')}
                  value={
                    <span className="inline-flex items-center gap-1 font-mono text-[0.66rem]">
                      <Globe2 size={11} className="text-muted" />
                      {selected.ip_address || '—'}
                    </span>
                  }
                />
                <InfoRow label={t('audit.recorded')} value={formatDateTime(selected.created_at, language)} />
              </div>
            </Panel>

            {diffs ? (
              <Panel className="p-4">
                <SectionHeader title={t('audit.changedFields')} hint={`${diffs.length}`} />
                {diffs.length === 0 ? (
                  <p className="mt-3 text-[0.7rem] text-muted">{t('audit.noFieldChanges')}</p>
                ) : (
                  <div className="mt-3 space-y-1.5">
                    {diffs.map((diff) => (
                      <div key={diff.key} className="rounded-xl border border-border bg-surface-2/50 px-3 py-2">
                        <p className="font-mono text-[0.62rem] font-semibold text-text-soft">{diff.key}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[0.62rem]">
                          <span className="max-w-[45%] truncate rounded bg-negative-soft px-1.5 py-0.5 text-negative" title={previewValue(diff.before)}>
                            {previewValue(diff.before)}
                          </span>
                          <span className="text-muted">→</span>
                          <span className="max-w-[45%] truncate rounded bg-positive-soft px-1.5 py-0.5 text-positive" title={previewValue(diff.after)}>
                            {previewValue(diff.after)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            ) : null}

            <div className="grid gap-3 xl:grid-cols-2">
              <Panel className="p-4">
                <SectionHeader title={t('audit.before')} />
                <pre dir="ltr" className={cn('mt-2 max-h-72 overflow-auto rounded-xl border border-border bg-surface-2/60 p-3 font-mono text-[0.62rem] leading-relaxed text-text-soft', selected.before_data == null && 'text-muted')}>
                  {jsonBlock(selected.before_data)}
                </pre>
              </Panel>
              <Panel className="p-4">
                <SectionHeader title={t('audit.after')} />
                <pre dir="ltr" className={cn('mt-2 max-h-72 overflow-auto rounded-xl border border-border bg-surface-2/60 p-3 font-mono text-[0.62rem] leading-relaxed text-text-soft', selected.after_data == null && 'text-muted')}>
                  {jsonBlock(selected.after_data)}
                </pre>
              </Panel>
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  )
}
