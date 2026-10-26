import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, ChevronRight, Pencil, Play, Plus, RefreshCw, Route as RouteIcon, Search, Trash2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import type { TranslationKey } from '../i18n/translations'
import { api, errorMessage } from '../lib/api'
import type { Driver, FixedRoute, Vehicle } from '../lib/types'
import { formatDate, formatTime, money, num, rangeFromDays, todayISO, addDaysISO } from '../lib/utils'
import {
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
  SearchInput,
  SectionHeader,
  Select,
  Sheet,
  StatusBadge,
  Textarea,
} from '../components/ui'
import { PageError, PageSkeleton, PeriodPicker, StatStrip, useDebounced, type DateRange } from '../components/filters'

interface RoutesResponse {
  data: FixedRoute[]
  summary: { active: number; paused: number; total: number; trips: number; revenue: number }
  range: DateRange
}

const ROUTE_STATUSES = ['active', 'paused', 'archived'] as const
const DAYS = [0, 1, 2, 3, 4, 5, 6] as const

interface RouteForm {
  name_en: string
  name_ar: string
  origin: string
  destination: string
  stops: string
  operating_days: number[]
  departure_time: string
  duration_minutes: string
  price: string
  default_vehicle_id: string
  default_driver_id: string
  effective_from: string
  effective_to: string
  status: string
  notes: string
}

function emptyForm(): RouteForm {
  return {
    name_en: '',
    name_ar: '',
    origin: '',
    destination: '',
    stops: '',
    operating_days: [0, 1, 2, 3, 4, 5, 6],
    departure_time: '07:00',
    duration_minutes: '60',
    price: '0',
    default_vehicle_id: '',
    default_driver_id: '',
    effective_from: todayISO(),
    effective_to: '',
    status: 'active',
    notes: '',
  }
}

function formFromRoute(route: FixedRoute): RouteForm {
  return {
    name_en: route.name_en,
    name_ar: route.name_ar,
    origin: route.origin,
    destination: route.destination,
    stops: (route.stops ?? []).join(', '),
    operating_days: route.operating_days?.length ? route.operating_days.map(Number) : [0, 1, 2, 3, 4, 5, 6],
    departure_time: formatTime(route.departure_time),
    duration_minutes: String(route.duration_minutes),
    price: String(route.price),
    default_vehicle_id: route.default_vehicle_id ?? '',
    default_driver_id: route.default_driver_id ?? '',
    effective_from: route.effective_from?.slice(0, 10) ?? todayISO(),
    effective_to: route.effective_to?.slice(0, 10) ?? '',
    status: route.status,
    notes: route.notes ?? '',
  }
}

export function RoutesPage() {
  const { t, language, currency, can } = useApp()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [range, setRange] = useState<DateRange>(() => rangeFromDays(90))
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const debounced = useDebounced(search)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<FixedRoute | null>(null)
  const [form, setForm] = useState<RouteForm>(emptyForm)
  const [detail, setDetail] = useState<FixedRoute | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<FixedRoute | null>(null)
  const [generateTarget, setGenerateTarget] = useState<FixedRoute | null>(null)
  const [generateRange, setGenerateRange] = useState<DateRange>(() => ({ from: todayISO(), to: addDaysISO(todayISO(), 14) }))
  const [generation, setGeneration] = useState<{ generated: number; trips: string[]; skipped: { date: string; reason: string }[] } | null>(null)

  const listQuery = useQuery({
    queryKey: ['routes', range.from, range.to, debounced, status],
    queryFn: () =>
      api.get<RoutesResponse>('/api/routes', {
        from: range.from,
        to: range.to,
        search: debounced,
        status,
      }),
  })

  const vehiclesQuery = useQuery({
    queryKey: ['routes', 'vehicle-options'],
    queryFn: () => api.get<{ data: Vehicle[] }>('/api/vehicles', { pageSize: 200 }),
    enabled: formOpen && can('view_fleet'),
  })

  const driversQuery = useQuery({
    queryKey: ['routes', 'driver-options'],
    queryFn: () => api.get<{ data: Driver[] }>('/api/drivers', { pageSize: 200 }),
    enabled: formOpen && can('view_drivers'),
  })

  const rows = listQuery.data?.data ?? []
  const summary = listQuery.data?.summary

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editing) return api.patch(`/api/routes/${editing.id}`, payload)
      return api.post('/api/routes', payload)
    },
    onSuccess: () => {
      toast.success(t('common.saved'))
      setFormOpen(false)
      setEditing(null)
      setForm(emptyForm())
      void queryClient.invalidateQueries({ queryKey: ['routes'] })
      void queryClient.invalidateQueries({ queryKey: ['trips'] })
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/routes/${id}/archive`),
    onSuccess: () => {
      toast.success(t('common.deleted'))
      setArchiveTarget(null)
      setDetail(null)
      void queryClient.invalidateQueries({ queryKey: ['routes'] })
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  const generateMutation = useMutation({
    mutationFn: (id: string) => api.post<{ generated: number; trips: string[]; skipped: { date: string; reason: string }[] }>(`/api/routes/${id}/generate`, generateRange),
    onSuccess: (result) => {
      setGeneration(result)
      void queryClient.invalidateQueries({ queryKey: ['routes'] })
      void queryClient.invalidateQueries({ queryKey: ['trips'] })
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      if (result.generated > 0) toast.success(t('routes.generated'), `${result.generated} ${t('common.trip')}`)
      else toast.info(t('routes.noGenerated'), t('routes.generateHint'))
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  const canManage = can('manage_routes')
  const canGenerate = can('manage_trips')
  const vehicleOptions = vehiclesQuery.data?.data ?? []
  const driverOptions = driversQuery.data?.data ?? []

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setFormOpen(true)
  }

  function openEdit(route: FixedRoute) {
    setEditing(route)
    setForm(formFromRoute(route))
    setFormOpen(true)
  }

  function submit() {
    if (!form.name_en.trim() || !form.name_ar.trim() || !form.origin.trim() || !form.destination.trim() || !form.operating_days.length) {
      toast.error(t('error.validation'), t('common.required'))
      return
    }
    const base = editing ? formFromRoute(editing) : null
    const changed = (key: keyof RouteForm) => {
      if (!base) return true
      const next = form[key]
      const previous = base[key]
      if (Array.isArray(next) || Array.isArray(previous)) {
        return (Array.isArray(next) ? next : []).join(',') !== (Array.isArray(previous) ? previous : []).join(',')
      }
      return String(next) !== String(previous)
    }
    const payload: Record<string, unknown> = {}
    if (changed('name_en')) payload.name_en = form.name_en.trim()
    if (changed('name_ar')) payload.name_ar = form.name_ar.trim()
    if (changed('origin')) payload.origin = form.origin.trim()
    if (changed('destination')) payload.destination = form.destination.trim()
    if (changed('stops')) payload.stops = form.stops.split(',').map((stop) => stop.trim()).filter(Boolean)
    if (changed('operating_days')) payload.operating_days = form.operating_days
    if (changed('departure_time')) payload.departure_time = form.departure_time
    if (changed('duration_minutes')) payload.duration_minutes = Number(form.duration_minutes)
    if (changed('price')) payload.price = Number(form.price)
    if (changed('default_vehicle_id')) payload.default_vehicle_id = form.default_vehicle_id || null
    if (changed('default_driver_id')) payload.default_driver_id = form.default_driver_id || null
    if (changed('effective_from')) payload.effective_from = form.effective_from
    if (changed('effective_to')) payload.effective_to = form.effective_to || null
    if (changed('status')) payload.status = form.status
    if (changed('notes')) payload.notes = form.notes.trim() || null
    if (editing && Object.keys(payload).length === 0) {
      toast.info(t('common.noChanges'), t('routes.noChangesHint'))
      return
    }
    saveMutation.mutate(payload)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${t('nav.operations')} · ${t('nav.routes')}`}
        title={t('routes.title')}
        subtitle={t('routes.subtitle')}
        actions={
          <>
            <PeriodPicker value={range} onChange={setRange} />
            {canManage ? <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>{t('routes.addRoute')}</Button> : null}
          </>
        }
      />

      {summary ? (
        <StatStrip
          items={[
            { label: t('routes.activeRoutes'), value: num(summary.active), hint: `${num(summary.paused)} ${t('routes.pausedRoutes')}`, tone: 'positive' },
            { label: t('routes.scheduledTrips'), value: num(summary.trips), hint: t('common.period') },
            { label: t('routes.routeRevenue'), value: money(summary.revenue, currency, language, true), tone: 'accent' },
            { label: t('routes.totalRoutes'), value: num(summary.total), hint: `${num(summary.active)} ${t('routes.activeRoutes')}` },
          ]}
        />
      ) : null}

      <Panel className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} className="w-full sm:w-64" placeholder={t('common.searchPlaceholder')} />
          <Select value={status} onChange={(event) => setStatus(event.target.value)} className="w-auto min-w-[9.5rem]">
            <option value="">{t('common.all')} · {t('common.status')}</option>
            {ROUTE_STATUSES.map((item) => <option key={item} value={item}>{t(`status.${item}` as TranslationKey)}</option>)}
          </Select>
          <IconButton label={t('common.refresh')} size="sm" variant="secondary" className="ms-auto" onClick={() => void listQuery.refetch()}>
            <RefreshCw size={14} className={listQuery.isFetching ? 'animate-spin' : ''} />
          </IconButton>
        </div>
      </Panel>

      {listQuery.isLoading ? (
        <PageSkeleton rows={5} />
      ) : listQuery.error ? (
        <PageError error={listQuery.error} onRetry={() => void listQuery.refetch()} />
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<RouteIcon size={20} />}
            title={t('routes.empty')}
            hint={t('routes.emptyHint')}
            action={canManage ? <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>{t('routes.addRoute')}</Button> : undefined}
          />
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="scroll-x">
            <table className="data-table min-w-[1050px]">
              <thead>
                <tr>
                  <th>{t('routes.routeNo')} / {t('routes.nameEn')}</th>
                  <th>{t('routes.origin')} → {t('routes.destination')}</th>
                  <th>{t('routes.operatingDays')}</th>
                  <th>{t('routes.departureTime')}</th>
                  <th className="text-end">{t('routes.price')}</th>
                  <th className="text-end">{t('routes.tripCountLabel')}</th>
                  <th className="text-end">{t('routes.routeRevenue')}</th>
                  <th>{t('common.status')}</th>
                  <th className="text-end">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((route) => (
                  <tr key={route.id}>
                    <td>
                      <button type="button" className="block text-start" onClick={() => setDetail(route)}>
                        <span className="block text-[0.76rem] font-semibold text-text">{language === 'ar' ? route.name_ar : route.name_en}</span>
                        <span className="text-[0.62rem] text-muted">{route.route_no}</span>
                      </button>
                    </td>
                    <td className="text-[0.7rem] text-text-soft">{route.origin} <span className="text-muted">→</span> {route.destination}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {(route.operating_days ?? []).map((day) => (
                          <span key={day} className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[0.55rem] font-semibold text-muted">
                            {t(`day.${day}.short` as TranslationKey)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="text-[0.7rem] tabular text-text-soft">{formatTime(route.departure_time)}</td>
                    <td className="text-end tabular text-[0.72rem] text-text">{money(route.price, currency, language, true)}</td>
                    <td className="text-end tabular text-[0.72rem]">{num(route.completed_trips)}<span className="text-[0.6rem] text-muted"> / {num(route.trips)}</span></td>
                    <td className="text-end tabular text-[0.72rem] text-positive">{money(route.revenue, currency, language, true)}</td>
                    <td><StatusBadge status={route.status} /></td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {canGenerate ? <IconButton label={route.status === 'active' ? t('routes.generate') : t('routes.generateInactive')} size="sm" disabled={route.status !== 'active'} onClick={() => { setGenerateTarget(route); setGeneration(null); setGenerateRange({ from: todayISO(), to: addDaysISO(todayISO(), 14) }) }}><Play size={13} /></IconButton> : null}
                        <IconButton label={t('common.view')} size="sm" onClick={() => setDetail(route)}><Search size={13} /></IconButton>
                        {canManage ? (
                          <>
                            <IconButton label={t('common.edit')} size="sm" onClick={() => openEdit(route)}><Pencil size={13} /></IconButton>
                            <IconButton label={t('common.archive')} size="sm" variant="danger" onClick={() => setArchiveTarget(route)}><Trash2 size={13} /></IconButton>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('routes.editRoute') : t('routes.addRoute')}
        description={t('routes.subtitle')}
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={saveMutation.isPending} onClick={submit}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('routes.nameEn')} required><Input value={form.name_en} onChange={(event) => setForm({ ...form, name_en: event.target.value })} /></Field>
          <Field label={t('routes.nameAr')} required><Input value={form.name_ar} onChange={(event) => setForm({ ...form, name_ar: event.target.value })} dir="rtl" /></Field>
          <Field label={t('common.status')}>
            <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              {ROUTE_STATUSES.map((item) => <option key={item} value={item}>{t(`status.${item}` as TranslationKey)}</option>)}
            </Select>
          </Field>
          <Field label={t('routes.origin')} required><Input value={form.origin} onChange={(event) => setForm({ ...form, origin: event.target.value })} /></Field>
          <Field label={t('routes.destination')} required><Input value={form.destination} onChange={(event) => setForm({ ...form, destination: event.target.value })} /></Field>
          <Field label={t('routes.stops')} hint={t('routes.stopsHint')}><Input value={form.stops} onChange={(event) => setForm({ ...form, stops: event.target.value })} /></Field>
          <Field label={t('routes.departureTime')}><Input type="time" value={form.departure_time} onChange={(event) => setForm({ ...form, departure_time: event.target.value })} /></Field>
          <Field label={t('routes.duration')} hint={t('common.minutes')}><Input type="number" min={5} max={1440} value={form.duration_minutes} onChange={(event) => setForm({ ...form, duration_minutes: event.target.value })} /></Field>
          <Field label={t('routes.price')}><Input type="number" min={0} step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></Field>
          <Field label={t('routes.effectiveFrom')}><Input type="date" value={form.effective_from} onChange={(event) => setForm({ ...form, effective_from: event.target.value })} /></Field>
          <Field label={t('routes.effectiveTo')}><Input type="date" value={form.effective_to} onChange={(event) => setForm({ ...form, effective_to: event.target.value })} /></Field>
          <Field label={t('routes.defaultVehicle')}>
            <Select value={form.default_vehicle_id} onChange={(event) => setForm({ ...form, default_vehicle_id: event.target.value })} disabled={!can('view_fleet')}>
              <option value="">{t('common.none')}</option>
              {vehicleOptions.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.make} {vehicle.model}</option>)}
            </Select>
          </Field>
          <Field label={t('routes.defaultDriver')}>
            <Select value={form.default_driver_id} onChange={(event) => setForm({ ...form, default_driver_id: event.target.value })} disabled={!can('view_drivers')}>
              <option value="">{t('common.none')}</option>
              {driverOptions.filter((driver) => driver.status === 'active').map((driver) => <option key={driver.id} value={driver.id}>{driver.full_name}</option>)}
            </Select>
          </Field>
          <Field label={t('routes.operatingDays')} className="sm:col-span-2 lg:col-span-3">
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((day) => {
                const active = form.operating_days.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        operating_days: active ? form.operating_days.filter((value) => value !== day) : [...form.operating_days, day].sort(),
                      })
                    }
                    className={active ? 'rounded-lg border border-accent/40 bg-accent-soft px-3 py-1.5 text-[0.68rem] font-semibold text-accent' : 'rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[0.68rem] font-semibold text-muted hover:text-text'}
                  >
                    {t(`day.${day}` as TranslationKey)}
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label={t('common.notes')} className="sm:col-span-2 lg:col-span-3">
            <Textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(generateTarget)}
        onClose={() => { setGenerateTarget(null); setGeneration(null) }}
        title={t('routes.generateTitle')}
        description={generateTarget ? (language === 'ar' ? generateTarget.name_ar : generateTarget.name_en) : undefined}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setGenerateTarget(null); setGeneration(null) }}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              icon={<CalendarClock size={14} />}
              loading={generateMutation.isPending}
              disabled={generateTarget?.status !== 'active'}
              onClick={() => generateTarget && generateMutation.mutate(generateTarget.id)}
            >
              {generateTarget && generateTarget.status !== 'active' ? t('routes.generateInactive') : t('routes.generate')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('common.from')}><Input type="date" value={generateRange.from} onChange={(event) => setGenerateRange({ ...generateRange, from: event.target.value })} /></Field>
            <Field label={t('common.to')}><Input type="date" min={generateRange.from} value={generateRange.to} onChange={(event) => setGenerateRange({ ...generateRange, to: event.target.value })} /></Field>
          </div>
          <p className="rounded-xl border border-border bg-surface-2/60 px-3 py-2.5 text-[0.7rem] leading-relaxed text-muted">{t('routes.generateHint')}</p>
          {generation ? (
            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="positive">{t('routes.generated')}: {generation.generated}</Badge>
                <Badge tone={generation.skipped.length ? 'warning' : 'neutral'}>{t('routes.skipped')}: {generation.skipped.length}</Badge>
              </div>
              {generation.trips.length ? (
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {generation.trips.map((trip) => <p key={trip} className="rounded-lg bg-surface-2 px-2 py-1 text-[0.66rem] tabular text-text-soft">{trip}</p>)}
                </div>
              ) : null}
              {generation.skipped.length ? (
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {generation.skipped.map((item) => <p key={`${item.date}-${item.reason}`} className="text-[0.64rem] text-warning">{formatDate(item.date, language)} · {item.reason}</p>)}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      <Sheet
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? (language === 'ar' ? detail.name_ar : detail.name_en) : t('routes.title')}
        description={detail ? `${detail.route_no} · ${detail.origin} → ${detail.destination}` : undefined}
        footer={detail && canManage ? (
          <>
            <Button variant="secondary" size="sm" icon={<Pencil size={13} />} onClick={() => { setDetail(null); openEdit(detail) }}>{t('common.edit')}</Button>
            <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => setArchiveTarget(detail)}>{t('common.archive')}</Button>
          </>
        ) : undefined}
      >
        {detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.status} />
              <Badge tone="accent">{money(detail.price, currency, language)}</Badge>
              <Badge tone="neutral">{formatTime(detail.departure_time)} · {detail.duration_minutes} {t('common.minutes')}</Badge>
            </div>
            <StatStrip
              items={[
                { label: t('routes.tripCount'), value: num(detail.trips), hint: `${num(detail.completed_trips)} ${t('common.completed')}` },
                { label: t('common.revenue'), value: money(detail.revenue, currency, language, true), tone: 'positive' },
                { label: t('common.expenses'), value: money(detail.expenses, currency, language, true), tone: 'negative' },
                { label: t('common.profit'), value: money(detail.profit, currency, language, true), tone: num(detail.profit) >= 0 ? 'positive' : 'negative' },
              ]}
            />
            <Panel className="p-4">
              <SectionHeader title={t('common.details')} />
              <div className="mt-2">
                <InfoRow label={t('routes.routeNo')} value={detail.route_no} />
                <InfoRow label={t('routes.nameEn')} value={detail.name_en} />
                <InfoRow label={t('routes.nameAr')} value={detail.name_ar} />
                <InfoRow label={t('routes.stops')} value={detail.stops?.length ? detail.stops.join(' · ') : '—'} />
                <InfoRow label={t('routes.defaultVehicle')} value={detail.vehicle_plate || t('common.unassigned')} />
                <InfoRow label={t('routes.defaultDriver')} value={detail.driver_name || t('common.unassigned')} />
                <InfoRow label={t('routes.effectiveFrom')} value={formatDate(detail.effective_from, language)} />
                <InfoRow label={t('routes.effectiveTo')} value={detail.effective_to ? formatDate(detail.effective_to, language) : t('contracts.noExpiry')} />
              </div>
            </Panel>
            <Panel className="p-4">
              <SectionHeader title={t('routes.schedules')} hint={`${detail.schedules?.length ?? 0} ${t('common.period')}`} />
              <div className="mt-2 space-y-1.5">
                {(detail.schedules ?? []).map((schedule) => (
                  <div key={schedule.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2/50 px-2.5 py-2">
                    <span className="flex items-center gap-1.5 text-[0.66rem] text-text-soft">
                      <ChevronRight size={11} className="text-muted" />
                      {(schedule.days_of_week ?? []).map((day) => t(`day.${day}.short` as TranslationKey)).join(' · ')}
                    </span>
                    <span className="flex items-center gap-2 text-[0.64rem] tabular text-muted">
                      {formatTime(schedule.departure_time)}
                      <StatusBadge status={schedule.status} />
                    </span>
                  </div>
                ))}
                {!detail.schedules?.length ? <p className="text-[0.7rem] text-muted">{t('common.noData')}</p> : null}
              </div>
            </Panel>
            {detail.notes ? <p className="rounded-xl border border-border bg-surface-2/50 px-3 py-2.5 text-[0.72rem] leading-relaxed text-muted">{detail.notes}</p> : null}
          </div>
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => archiveTarget && archiveMutation.mutate(archiveTarget.id)}
        title={t('common.archive')}
        description={t('routes.archiveWarning')}
        confirmLabel={t('common.archive')}
        loading={archiveMutation.isPending}
      />
    </div>
  )
}
