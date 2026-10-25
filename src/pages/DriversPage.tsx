import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeAlert, BadgeCheck, Pencil, Plus, RefreshCw, Search, Trash2, UsersRound } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import type { TranslationKey } from '../i18n/translations'
import { api, errorMessage } from '../lib/api'
import type { Driver } from '../lib/types'
import { formatDate, money, num, rangeFromDays, relativeDays } from '../lib/utils'
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  InfoRow,
  Modal,
  PageHeader,
  Panel,
  Pagination,
  SearchInput,
  SectionHeader,
  Select,
  Sheet,
  StatusBadge,
  Textarea,
} from '../components/ui'
import { PageError, PageSkeleton, PeriodPicker, StatStrip, useDebounced, usePageState, type DateRange } from '../components/filters'

interface DriversResponse {
  data: Driver[]
  total: number
  page: number
  pageSize: number
  canViewSalary: boolean
  range: DateRange
}

const DRIVER_STATUSES = ['active', 'on_leave', 'inactive'] as const

interface DriverForm {
  full_name: string
  phone: string
  email: string
  license_no: string
  license_expiry: string
  status: string
  monthly_salary: string
  hire_date: string
  notes: string
}

function emptyForm(): DriverForm {
  return {
    full_name: '',
    phone: '',
    email: '',
    license_no: '',
    license_expiry: '',
    status: 'active',
    monthly_salary: '',
    hire_date: '',
    notes: '',
  }
}

function formFromDriver(driver: Driver): DriverForm {
  return {
    full_name: driver.full_name,
    phone: driver.phone ?? '',
    email: driver.email ?? '',
    license_no: driver.license_no,
    license_expiry: driver.license_expiry?.slice(0, 10) ?? '',
    status: driver.status,
    monthly_salary: driver.monthly_salary !== null ? String(driver.monthly_salary) : '',
    hire_date: driver.hire_date?.slice(0, 10) ?? '',
    notes: driver.notes ?? '',
  }
}

function licenseTone(date: string | null): 'positive' | 'warning' | 'negative' | 'neutral' {
  const days = relativeDays(date)
  if (days === null) return 'neutral'
  if (days < 0) return 'negative'
  if (days <= 45) return 'warning'
  return 'positive'
}

export function DriversPage() {
  const { t, language, currency, can } = useApp()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [range, setRange] = useState<DateRange>(() => rangeFromDays(90))
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const debounced = useDebounced(search)
  const { page, pageSize, setPage } = usePageState(20)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Driver | null>(null)
  const [form, setForm] = useState<DriverForm>(emptyForm)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Driver | null>(null)

  const listQuery = useQuery({
    queryKey: ['drivers', range.from, range.to, debounced, status, page, pageSize],
    queryFn: () =>
      api.get<DriversResponse>('/api/drivers', {
        from: range.from,
        to: range.to,
        search: debounced,
        status,
        page,
        pageSize,
      }),
  })

  const rows = listQuery.data?.data ?? []
  const canViewSalary = listQuery.data?.canViewSalary ?? can('view_driver_compensation')
  const detail = useMemo(() => rows.find((row) => row.id === detailId) ?? null, [rows, detailId])

  const stats = useMemo(() => {
    const active = rows.filter((row) => row.status === 'active').length
    const onLeave = rows.filter((row) => row.status === 'on_leave').length
    const expiring = rows.filter((row) => {
      const days = relativeDays(row.license_expiry)
      return days !== null && days <= 45
    }).length
    const trips = rows.reduce((total, row) => total + num(row.trips), 0)
    const revenue = rows.reduce((total, row) => total + num(row.revenue), 0)
    return { active, onLeave, expiring, trips, revenue }
  }, [rows])

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editing) return api.patch(`/api/drivers/${editing.id}`, payload)
      return api.post('/api/drivers', payload)
    },
    onSuccess: () => {
      toast.success(t('common.saved'))
      setFormOpen(false)
      setEditing(null)
      setForm(emptyForm())
      void queryClient.invalidateQueries({ queryKey: ['drivers'] })
      void queryClient.invalidateQueries({ queryKey: ['fleet'] })
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/drivers/${id}/archive`),
    onSuccess: () => {
      toast.success(t('common.deleted'))
      setArchiveTarget(null)
      setDetailId(null)
      void queryClient.invalidateQueries({ queryKey: ['drivers'] })
      void queryClient.invalidateQueries({ queryKey: ['fleet'] })
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  const canManage = can('manage_drivers')

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setFormOpen(true)
  }

  function openEdit(driver: Driver) {
    setEditing(driver)
    setForm(formFromDriver(driver))
    setFormOpen(true)
  }

  function submit() {
    if (!form.full_name.trim() || !form.license_no.trim()) {
      toast.error(t('error.validation'), t('common.required'))
      return
    }
    const payload: Record<string, unknown> = {
      full_name: form.full_name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      license_no: form.license_no.trim(),
      license_expiry: form.license_expiry || null,
      status: form.status,
      hire_date: form.hire_date || null,
      notes: form.notes.trim() || null,
    }
    if (canViewSalary) payload.monthly_salary = form.monthly_salary ? Number(form.monthly_salary) : null
    saveMutation.mutate(payload)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${t('nav.operations')} · ${t('nav.drivers')}`}
        title={t('drivers.title')}
        subtitle={t('drivers.subtitle')}
        actions={
          <>
            <PeriodPicker value={range} onChange={(next) => { setRange(next); setPage(1) }} />
            {canManage ? (
              <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>
                {t('drivers.addDriver')}
              </Button>
            ) : null}
          </>
        }
      />

      <StatStrip
        items={[
          { label: t('drivers.activeDrivers'), value: stats.active, hint: `${listQuery.data?.total ?? rows.length} ${t('nav.drivers')}`, tone: 'positive' },
          { label: t('drivers.onLeave'), value: stats.onLeave, hint: t('common.status'), tone: 'warning' },
          { label: t('drivers.licenseExpiring'), value: stats.expiring, hint: t('drivers.licenseExpiry'), tone: stats.expiring ? 'negative' : 'positive' },
          { label: t('drivers.totalTrips'), value: stats.trips, hint: t('common.period') },
          { label: t('drivers.revenue'), value: money(stats.revenue, currency, language, true), tone: 'accent' },
          { label: t('reports.revenuePerTrip'), value: money(stats.trips ? stats.revenue / stats.trips : 0, currency, language, true), hint: t('drivers.performance') },
        ]}
      />

      <Panel className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1) }} className="w-full sm:w-64" placeholder={t('common.searchPlaceholder')} />
          <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }} className="w-auto min-w-[10rem]">
            <option value="">{t('common.all')} · {t('common.status')}</option>
            {DRIVER_STATUSES.map((item) => (
              <option key={item} value={item}>{t(`status.${item}` as TranslationKey)}</option>
            ))}
          </Select>
          <IconButton label={t('common.refresh')} size="sm" variant="secondary" className="ms-auto" onClick={() => void listQuery.refetch()}>
            <RefreshCw size={14} className={listQuery.isFetching ? 'animate-spin' : ''} />
          </IconButton>
        </div>
      </Panel>

      {listQuery.isLoading ? (
        <PageSkeleton rows={6} />
      ) : listQuery.error ? (
        <PageError error={listQuery.error} onRetry={() => void listQuery.refetch()} />
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<UsersRound size={20} />}
            title={t('drivers.empty')}
            hint={t('drivers.emptyHint')}
            action={canManage ? <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>{t('drivers.addDriver')}</Button> : undefined}
          />
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="scroll-x">
            <table className="data-table min-w-[1000px]">
              <thead>
                <tr>
                  <th>{t('drivers.fullName')}</th>
                  <th>{t('drivers.licenseNo')}</th>
                  <th>{t('drivers.licenseExpiry')}</th>
                  <th>{t('common.status')}</th>
                  <th className="text-end">{t('drivers.trips')}</th>
                  <th className="text-end">{t('drivers.cancelled')}</th>
                  <th className="text-end">{t('drivers.revenue')}</th>
                  <th className="text-end">{t('drivers.monthlySalary')}</th>
                  <th className="text-end">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((driver) => {
                  const tone = licenseTone(driver.license_expiry)
                  return (
                    <tr key={driver.id}>
                      <td>
                        <button type="button" className="flex items-center gap-2.5 text-start" onClick={() => setDetailId(driver.id)}>
                          <Avatar name={driver.full_name} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate text-[0.76rem] font-semibold text-text">{driver.full_name}</span>
                            <span className="block text-[0.62rem] text-muted">{driver.driver_no}{driver.phone ? ` · ${driver.phone}` : ''}</span>
                          </span>
                        </button>
                      </td>
                      <td className="text-[0.7rem] text-text-soft">{driver.license_no}</td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[0.68rem] text-muted">{formatDate(driver.license_expiry, language)}</span>
                          {tone !== 'positive' && tone !== 'neutral' ? (
                            <Badge tone={tone} className="text-[0.54rem]">{licenseLabel(driver.license_expiry, t)}</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td><StatusBadge status={driver.status} /></td>
                      <td className="text-end tabular text-[0.73rem]">{num(driver.trips)}</td>
                      <td className="text-end tabular text-[0.73rem] text-negative">{num(driver.cancelled)}</td>
                      <td className="text-end tabular text-[0.73rem] text-text">{money(driver.revenue, currency, language, true)}</td>
                      <td className="text-end tabular text-[0.73rem]">
                        {canViewSalary ? (driver.monthly_salary !== null ? money(driver.monthly_salary, currency, language, true) : '—') : (
                          <span className="text-[0.6rem] text-muted" title={t('drivers.salaryHiddenHint')}>{t('drivers.salaryHidden')}</span>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <IconButton label={t('common.view')} size="sm" onClick={() => setDetailId(driver.id)}><Search size={13} /></IconButton>
                          {canManage ? (
                            <>
                              <IconButton label={t('common.edit')} size="sm" onClick={() => openEdit(driver)}><Pencil size={13} /></IconButton>
                              <IconButton label={t('common.archive')} size="sm" variant="danger" onClick={() => setArchiveTarget(driver)}><Trash2 size={13} /></IconButton>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border px-3">
            <Pagination page={page} pageSize={pageSize} total={listQuery.data?.total ?? 0} onPage={setPage} />
          </div>
        </Panel>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('drivers.editDriver') : t('drivers.addDriver')}
        description={t('drivers.subtitle')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={saveMutation.isPending} onClick={submit}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('drivers.fullName')} required><Input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></Field>
          <Field label={t('drivers.phone')}><Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+966 5x xxx xxxx" /></Field>
          <Field label={t('drivers.email')}><Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
          <Field label={t('drivers.licenseNo')} required><Input value={form.license_no} onChange={(event) => setForm({ ...form, license_no: event.target.value })} /></Field>
          <Field label={t('drivers.licenseExpiry')}><Input type="date" value={form.license_expiry} onChange={(event) => setForm({ ...form, license_expiry: event.target.value })} /></Field>
          <Field label={t('drivers.hireDate')}><Input type="date" value={form.hire_date} onChange={(event) => setForm({ ...form, hire_date: event.target.value })} /></Field>
          <Field label={t('common.status')}>
            <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              {DRIVER_STATUSES.map((item) => <option key={item} value={item}>{t(`status.${item}` as TranslationKey)}</option>)}
            </Select>
          </Field>
          <Field
            label={t('drivers.monthlySalary')}
            hint={canViewSalary ? t('drivers.compensation') : t('drivers.salaryHiddenHint')}
          >
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.monthly_salary}
              onChange={(event) => setForm({ ...form, monthly_salary: event.target.value })}
              disabled={!canViewSalary}
              placeholder={canViewSalary ? undefined : t('drivers.salaryHidden')}
            />
          </Field>
          <Field label={t('common.notes')} className="sm:col-span-2">
            <Textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </Field>
        </div>
      </Modal>

      <Sheet
        open={Boolean(detail)}
        onClose={() => setDetailId(null)}
        title={detail?.full_name}
        description={detail ? `${detail.driver_no} · ${t(`status.${detail.status}` as TranslationKey)}` : undefined}
        footer={canManage && detail ? (
          <>
            <Button variant="secondary" size="sm" icon={<Pencil size={13} />} onClick={() => { setDetailId(null); openEdit(detail) }}>{t('common.edit')}</Button>
            <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => setArchiveTarget(detail)}>{t('drivers.archive')}</Button>
          </>
        ) : undefined}
      >
        {detail ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={detail.full_name} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="text-[0.95rem] font-semibold text-text">{detail.full_name}</p>
                <p className="mt-0.5 text-[0.68rem] text-muted">{detail.phone || t('common.notProvided')}</p>
              </div>
              <StatusBadge status={detail.status} />
            </div>
            <StatStrip
              items={[
                { label: t('drivers.trips'), value: num(detail.trips), tone: 'accent' },
                { label: t('drivers.cancelled'), value: num(detail.cancelled), tone: 'negative' },
                { label: t('drivers.revenue'), value: money(detail.revenue, currency, language, true), tone: 'positive' },
                { label: t('drivers.compensation'), value: canViewSalary && detail.monthly_salary !== null ? money(detail.monthly_salary, currency, language, true) : t('drivers.salaryHidden') },
              ]}
            />
            <Panel className="p-4">
              <SectionHeader title={t('common.details')} />
              <div className="mt-2">
                <InfoRow label={t('drivers.driverNo')} value={detail.driver_no} />
                <InfoRow label={t('drivers.email')} value={detail.email || '—'} />
                <InfoRow label={t('drivers.licenseNo')} value={detail.license_no} />
                <InfoRow label={t('drivers.licenseExpiry')} value={<span className="flex items-center gap-2">{formatDate(detail.license_expiry, language)}<Badge tone={licenseTone(detail.license_expiry)}>{licenseLabel(detail.license_expiry, t)}</Badge></span>} />
                <InfoRow label={t('drivers.hireDate')} value={formatDate(detail.hire_date, language)} />
                <InfoRow label={t('common.notes')} value={detail.notes || '—'} />
              </div>
            </Panel>
            {detail.license_expiry && relativeDays(detail.license_expiry) !== null && relativeDays(detail.license_expiry)! <= 45 ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning-soft px-3.5 py-3">
                <BadgeAlert size={16} className="mt-0.5 shrink-0 text-warning" />
                <p className="text-[0.72rem] leading-relaxed text-text-soft">{t('drivers.licenseExpiring')} · {formatDate(detail.license_expiry, language)}</p>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-xl border border-positive/20 bg-positive-soft px-3.5 py-3">
                <BadgeCheck size={16} className="shrink-0 text-positive" />
                <p className="text-[0.72rem] text-text-soft">{t('drivers.performance')}</p>
              </div>
            )}
          </div>
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => archiveTarget && archiveMutation.mutate(archiveTarget.id)}
        title={t('drivers.archive')}
        description={t('drivers.archiveWarning')}
        confirmLabel={t('common.archive')}
        loading={archiveMutation.isPending}
      />
    </div>
  )
}

function licenseLabel(date: string | null, t: (key: TranslationKey) => string) {
  const days = relativeDays(date)
  if (days === null) return t('common.notProvided')
  if (days < 0) return t('status.expired')
  if (days === 0) return t('common.today')
  return `${days} ${t('common.days')}`
}
