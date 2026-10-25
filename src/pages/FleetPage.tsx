import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BusFront,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TrendingUp,
  Wrench,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import type { TranslationKey } from '../i18n/translations'
import { api, errorMessage } from '../lib/api'
import type { Driver, Trip, Vehicle, VehicleDetail } from '../lib/types'
import { formatDate, money, num, percent, rangeFromDays, relativeDays } from '../lib/utils'
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
  Pagination,
  Progress,
  SearchInput,
  SectionHeader,
  Select,
  Sheet,
  StatusBadge,
  Tabs,
  Textarea,
} from '../components/ui'
import { PageError, PageSkeleton, PeriodPicker, StatStrip, useDebounced, usePageState, type DateRange } from '../components/filters'

interface FleetResponse {
  data: Vehicle[]
  total: number
  page: number
  pageSize: number
  summary: {
    total: number
    available: number
    maintenance: number
    operating: number
    revenue: number
    expenses: number
    utilization: number
  }
  range: DateRange
}

const CATEGORIES = ['van', 'bus', 'minibus', 'suv', 'sedan', 'truck', 'luxury', 'other'] as const
const VEHICLE_STATUSES = ['available', 'scheduled', 'on_trip', 'under_maintenance', 'inactive'] as const

interface VehicleForm {
  plate: string
  make: string
  model: string
  category: string
  year: string
  seats: string
  status: string
  registration_expiry: string
  insurance_expiry: string
  odometer: string
  acquisition_cost: string
  acquisition_date: string
  assigned_driver_id: string
  notes: string
}

function emptyForm(): VehicleForm {
  return {
    plate: '',
    make: '',
    model: '',
    category: 'van',
    year: '',
    seats: '14',
    status: 'available',
    registration_expiry: '',
    insurance_expiry: '',
    odometer: '0',
    acquisition_cost: '',
    acquisition_date: '',
    assigned_driver_id: '',
    notes: '',
  }
}

function formFromVehicle(vehicle: Vehicle): VehicleForm {
  return {
    plate: vehicle.plate,
    make: vehicle.make,
    model: vehicle.model,
    category: vehicle.category,
    year: vehicle.year ? String(vehicle.year) : '',
    seats: String(vehicle.seats),
    status: vehicle.status,
    registration_expiry: vehicle.registration_expiry?.slice(0, 10) ?? '',
    insurance_expiry: vehicle.insurance_expiry?.slice(0, 10) ?? '',
    odometer: String(vehicle.odometer ?? 0),
    acquisition_cost: vehicle.acquisition_cost !== null ? String(vehicle.acquisition_cost) : '',
    acquisition_date: vehicle.acquisition_date?.slice(0, 10) ?? '',
    assigned_driver_id: vehicle.assigned_driver_id ?? '',
    notes: vehicle.notes ?? '',
  }
}

function expiryTone(date: string | null): 'negative' | 'warning' | 'neutral' {
  const days = relativeDays(date)
  if (days === null) return 'neutral'
  if (days < 0) return 'negative'
  if (days <= 30) return 'warning'
  return 'neutral'
}

export function FleetPage() {
  const { t, language, currency, can, isAdmin } = useApp()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [range, setRange] = useState<DateRange>(() => rangeFromDays(90))
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const debounced = useDebounced(search)
  const { page, pageSize, setPage } = usePageState(20)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [form, setForm] = useState<VehicleForm>(emptyForm)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Vehicle | null>(null)

  const listQuery = useQuery({
    queryKey: ['fleet', 'vehicles', range.from, range.to, debounced, status, category, includeArchived, page, pageSize],
    queryFn: () =>
      api.get<FleetResponse>('/api/vehicles', {
        from: range.from,
        to: range.to,
        search: debounced,
        status,
        category,
        includeArchived: includeArchived ? 'true' : undefined,
        page,
        pageSize,
      }),
  })

  const driversQuery = useQuery({
    queryKey: ['fleet', 'driver-options'],
    queryFn: () => api.get<{ data: Driver[] }>('/api/drivers', { pageSize: 200 }),
    enabled: can('view_drivers') && formOpen,
  })

  const detailQuery = useQuery({
    queryKey: ['fleet', 'vehicle', detailId],
    queryFn: () => api.get<VehicleDetail>(`/api/vehicles/${detailId}`),
    enabled: Boolean(detailId),
  })
  const detailVehicle = detailQuery.data?.vehicle ?? null

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editing) return api.patch(`/api/vehicles/${editing.id}`, payload)
      return api.post('/api/vehicles', payload)
    },
    onSuccess: () => {
      toast.success(t('common.saved'))
      setFormOpen(false)
      setEditing(null)
      setForm(emptyForm())
      void queryClient.invalidateQueries({ queryKey: ['fleet'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/vehicles/${id}/archive`),
    onSuccess: () => {
      toast.success(t('common.deleted'))
      setArchiveTarget(null)
      setDetailId(null)
      void queryClient.invalidateQueries({ queryKey: ['fleet'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  const summary = listQuery.data?.summary
  const rows = listQuery.data?.data ?? []

  const expiring = useMemo(() => {
    return rows.filter((vehicle) => {
      const registration = relativeDays(vehicle.registration_expiry)
      const insurance = relativeDays(vehicle.insurance_expiry)
      return (registration !== null && registration <= 30) || (insurance !== null && insurance <= 30)
    }).length
  }, [rows])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setFormOpen(true)
  }

  function openEdit(vehicle: Vehicle) {
    setEditing(vehicle)
    setForm(formFromVehicle(vehicle))
    setFormOpen(true)
  }

  function submit() {
    if (!form.plate.trim() || !form.make.trim() || !form.model.trim() || !form.seats) {
      toast.error(t('error.validation'), t('common.required'))
      return
    }
    saveMutation.mutate({
      plate: form.plate.trim(),
      make: form.make.trim(),
      model: form.model.trim(),
      category: form.category,
      year: form.year ? Number(form.year) : null,
      seats: Number(form.seats),
      status: form.status,
      registration_expiry: form.registration_expiry || null,
      insurance_expiry: form.insurance_expiry || null,
      odometer: form.odometer ? Number(form.odometer) : 0,
      acquisition_cost: form.acquisition_cost ? Number(form.acquisition_cost) : null,
      acquisition_date: form.acquisition_date || null,
      assigned_driver_id: form.assigned_driver_id || null,
      notes: form.notes.trim() || null,
    })
  }

  const canManage = can('manage_fleet')
  const driverOptions = driversQuery.data?.data ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${t('nav.operations')} · ${t('nav.fleet')}`}
        title={t('fleet.title')}
        subtitle={t('fleet.subtitle')}
        actions={
          <>
            <PeriodPicker value={range} onChange={(next) => { setRange(next); setPage(1) }} />
            {canManage ? (
              <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>
                {t('fleet.addVehicle')}
              </Button>
            ) : null}
          </>
        }
      />

      {summary ? (
        <StatStrip
          items={[
            { label: t('fleet.totalFleet'), value: num(summary.total), hint: `${num(summary.available)} ${t('dashboard.available')}`, tone: 'accent' },
            { label: t('dashboard.operating'), value: num(summary.operating), hint: `${num(summary.maintenance)} ${t('dashboard.maintenance')}`, tone: 'warning' },
            { label: t('fleet.expiringDocuments'), value: expiring, hint: t('fleet.compliance'), tone: expiring ? 'negative' : 'positive' },
            { label: t('common.revenue'), value: money(summary.revenue, currency, language, true), hint: t('common.period'), tone: 'positive' },
            { label: t('common.expenses'), value: money(summary.expenses, currency, language, true), hint: t('expenses.operating'), tone: 'negative' },
            { label: t('dashboard.kpiUtilization'), value: percent(summary.utilization, 1, language), hint: t('fleet.busyHours'), tone: 'accent' },
          ]}
        />
      ) : null}

      <Panel className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1) }} className="w-full sm:w-64" placeholder={t('common.searchPlaceholder')} />
          <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }} className="w-auto min-w-[9.5rem]">
            <option value="">{t('common.all')} · {t('common.status')}</option>
            {VEHICLE_STATUSES.map((item) => (
              <option key={item} value={item}>{t(`status.${item}` as Parameters<typeof t>[0])}</option>
            ))}
          </Select>
          <Select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }} className="w-auto min-w-[9.5rem]">
            <option value="">{t('common.all')} · {t('fleet.category')}</option>
            {CATEGORIES.map((item) => (
              <option key={item} value={item}>{t(`category.${item}` as Parameters<typeof t>[0])}</option>
            ))}
          </Select>
          {isAdmin ? (
            <label className="flex cursor-pointer items-center gap-2 text-[0.7rem] text-muted">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => { setIncludeArchived(event.target.checked); setPage(1) }}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              {t('common.archived')}
            </label>
          ) : null}
          <div className="ms-auto flex items-center gap-2">
            <IconButton label={t('common.refresh')} size="sm" variant="secondary" onClick={() => void listQuery.refetch()}>
              <RefreshCw size={14} className={listQuery.isFetching ? 'animate-spin' : ''} />
            </IconButton>
          </div>
        </div>
      </Panel>

      {listQuery.isLoading ? (
        <PageSkeleton rows={6} />
      ) : listQuery.error ? (
        <PageError error={listQuery.error} onRetry={() => void listQuery.refetch()} />
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<BusFront size={20} />}
            title={t('fleet.empty')}
            hint={t('fleet.emptyHint')}
            action={canManage ? <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>{t('fleet.addVehicle')}</Button> : undefined}
          />
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="scroll-x">
            <table className="data-table min-w-[1060px]">
              <thead>
                <tr>
                  <th>{t('common.vehicle')}</th>
                  <th>{t('fleet.category')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('fleet.assignedDriver')}</th>
                  <th className="text-end">{t('fleet.trips')}</th>
                  <th className="w-36">{t('fleet.utilization')}</th>
                  <th className="text-end">{t('common.revenue')}</th>
                  <th className="text-end">{t('common.profit')}</th>
                  <th>{t('fleet.compliance')}</th>
                  <th className="text-end">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((vehicle) => {
                  const regTone = expiryTone(vehicle.registration_expiry)
                  const insTone = expiryTone(vehicle.insurance_expiry)
                  return (
                    <tr key={vehicle.id}>
                      <td>
                        <button type="button" className="block text-start" onClick={() => setDetailId(vehicle.id)}>
                          <span className="plate">{vehicle.plate}</span>
                          <span className="mt-1 block text-[0.64rem] text-muted">{vehicle.vehicle_no} · {vehicle.make} {vehicle.model}{vehicle.year ? ` · ${vehicle.year}` : ''}</span>
                        </button>
                      </td>
                      <td className="text-[0.72rem] text-text-soft">{t(`category.${vehicle.category}` as Parameters<typeof t>[0])}</td>
                      <td><StatusBadge status={vehicle.status} /></td>
                      <td className="text-[0.72rem] text-text-soft">{vehicle.driver_name || <span className="text-muted">{t('common.unassigned')}</span>}</td>
                      <td className="text-end tabular text-[0.73rem]">{num(vehicle.trips)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Progress value={num(vehicle.utilization)} height="h-1" className="min-w-[3rem]" />
                          <span className="w-9 text-end text-[0.66rem] tabular text-muted">{percent(vehicle.utilization, 0, language)}</span>
                        </div>
                      </td>
                      <td className="text-end tabular text-[0.73rem] text-text">{money(vehicle.revenue, currency, language, true)}</td>
                      <td className={`text-end tabular text-[0.73rem] font-semibold ${num(vehicle.profit) >= 0 ? 'text-positive' : 'text-negative'}`}>
                        {money(vehicle.profit, currency, language, true)}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={regTone} className="text-[0.56rem]">{t('fleet.registrationDue')}</Badge>
                          <Badge tone={insTone} className="text-[0.56rem]">{t('fleet.insuranceDue')}</Badge>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <IconButton label={t('common.view')} size="sm" onClick={() => setDetailId(vehicle.id)}><Search size={13} /></IconButton>
                          {canManage ? (
                            <>
                              <IconButton label={t('common.edit')} size="sm" onClick={() => openEdit(vehicle)}><Pencil size={13} /></IconButton>
                              <IconButton label={t('common.archive')} size="sm" variant="danger" onClick={() => setArchiveTarget(vehicle)}><Trash2 size={13} /></IconButton>
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
        title={editing ? t('fleet.editVehicle') : t('fleet.addVehicle')}
        description={t('fleet.subtitle')}
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={saveMutation.isPending} onClick={submit}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('fleet.plate')} required><Input value={form.plate} onChange={(event) => setForm({ ...form, plate: event.target.value })} placeholder="1234 ABC" /></Field>
          <Field label={t('fleet.make')} required><Input value={form.make} onChange={(event) => setForm({ ...form, make: event.target.value })} /></Field>
          <Field label={t('fleet.model')} required><Input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} /></Field>
          <Field label={t('fleet.category')}><Select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{CATEGORIES.map((item) => <option key={item} value={item}>{t(`category.${item}` as Parameters<typeof t>[0])}</option>)}</Select></Field>
          <Field label={t('fleet.year')}><Input type="number" min={1980} max={2100} value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })} /></Field>
          <Field label={t('fleet.seats')} required><Input type="number" min={1} max={100} value={form.seats} onChange={(event) => setForm({ ...form, seats: event.target.value })} /></Field>
          <Field label={t('common.status')}><Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{VEHICLE_STATUSES.map((item) => <option key={item} value={item}>{t(`status.${item}` as Parameters<typeof t>[0])}</option>)}</Select></Field>
          <Field label={t('fleet.registrationExpiry')}><Input type="date" value={form.registration_expiry} onChange={(event) => setForm({ ...form, registration_expiry: event.target.value })} /></Field>
          <Field label={t('fleet.insuranceExpiry')}><Input type="date" value={form.insurance_expiry} onChange={(event) => setForm({ ...form, insurance_expiry: event.target.value })} /></Field>
          <Field label={t('fleet.odometer')}><Input type="number" min={0} value={form.odometer} onChange={(event) => setForm({ ...form, odometer: event.target.value })} /></Field>
          <Field label={t('fleet.acquisitionCost')}><Input type="number" min={0} step="0.01" value={form.acquisition_cost} onChange={(event) => setForm({ ...form, acquisition_cost: event.target.value })} /></Field>
          <Field label={t('fleet.acquisitionDate')}><Input type="date" value={form.acquisition_date} onChange={(event) => setForm({ ...form, acquisition_date: event.target.value })} /></Field>
          <Field label={t('fleet.assignedDriver')} hint={can('view_drivers') ? undefined : t('users.readOnlyRole')}>
            <Select value={form.assigned_driver_id} onChange={(event) => setForm({ ...form, assigned_driver_id: event.target.value })} disabled={!can('view_drivers')}>
              <option value="">{t('common.unassigned')}</option>
              {driverOptions.filter((driver) => driver.status !== 'inactive').map((driver) => (
                <option key={driver.id} value={driver.id}>{driver.full_name} · {driver.driver_no}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.notes')} className="sm:col-span-2 lg:col-span-3">
            <Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={2} />
          </Field>
        </div>
      </Modal>

      <Sheet
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title={detailQuery.data ? `${detailQuery.data.vehicle.plate} · ${detailQuery.data.vehicle.vehicle_no}` : t('fleet.details')}
        description={detailQuery.data ? `${detailQuery.data.vehicle.make} ${detailQuery.data.vehicle.model}` : undefined}
        width="max-w-2xl"
        footer={canManage && detailVehicle ? (
          <>
            <Button variant="secondary" size="sm" icon={<Pencil size={13} />} onClick={() => { setDetailId(null); openEdit(detailVehicle) }}>{t('common.edit')}</Button>
            <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => setArchiveTarget(detailVehicle)}>{t('fleet.archiveVehicle')}</Button>
          </>
        ) : undefined}
      >
        {detailQuery.isLoading ? (
          <PageSkeleton rows={4} />
        ) : detailQuery.error || !detailQuery.data ? (
          <PageError error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />
        ) : (
          <VehicleDetailView detail={detailQuery.data} currency={currency} language={language} />
        )}
      </Sheet>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => archiveTarget && archiveMutation.mutate(archiveTarget.id)}
        title={t('fleet.archiveVehicle')}
        description={t('fleet.archiveWarning')}
        confirmLabel={t('common.archive')}
        loading={archiveMutation.isPending}
      />
    </div>
  )
}

function VehicleDetailView({ detail, currency, language }: { detail: VehicleDetail; currency: string; language: 'en' | 'ar' }) {
  const { t } = useApp()
  const [tab, setTab] = useState<'overview' | 'maintenance' | 'trips' | 'financials'>('overview')
  const vehicle = detail.vehicle
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={vehicle.status} />
        <Badge tone="neutral">{t(`category.${vehicle.category}` as Parameters<typeof t>[0])}</Badge>
        <Badge tone="neutral">{vehicle.seats}</Badge>
        {vehicle.archived_at ? <Badge tone="negative">{t('common.archived')}</Badge> : null}
      </div>

      <StatStrip
        items={[
          { label: t('common.revenue'), value: money(detail.financial.revenue, currency, language, true), tone: 'positive' },
          { label: t('common.expenses'), value: money(detail.financial.expenses, currency, language, true), tone: 'negative' },
          { label: t('common.profit'), value: money(num(detail.financial.revenue) - num(detail.financial.expenses), currency, language, true), tone: num(detail.financial.revenue) - num(detail.financial.expenses) >= 0 ? 'positive' : 'negative' },
          { label: t('common.completed'), value: num(detail.financial.completed_trips), hint: `${num(detail.financial.cancelled_trips)} ${t('trips.cancelled')}` },
        ]}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: t('common.details') },
          { value: 'financials', label: t('fleet.financials') },
          { value: 'maintenance', label: t('fleet.maintenanceHistory'), count: detail.maintenance.length },
          { value: 'trips', label: t('fleet.recentTrips'), count: detail.trips.length },
        ]}
      />

      {tab === 'overview' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel className="p-4">
            <SectionHeader title={t('fleet.details')} />
            <div className="mt-2">
              <InfoRow label={t('fleet.vehicleNo')} value={vehicle.vehicle_no} />
              <InfoRow label={t('fleet.plate')} value={<span className="plate">{vehicle.plate}</span>} />
              <InfoRow label={t('fleet.make')} value={vehicle.make} />
              <InfoRow label={t('fleet.model')} value={vehicle.model} />
              <InfoRow label={t('fleet.year')} value={vehicle.year ?? '—'} />
              <InfoRow label={t('fleet.odometer')} value={`${num(vehicle.odometer).toLocaleString()} ${t('common.km')}`} />
              <InfoRow label={t('fleet.assignedDriver')} value={vehicle.driver_name || t('common.unassigned')} />
            </div>
          </Panel>
          <Panel className="p-4">
            <SectionHeader title={t('fleet.compliance')} />
            <div className="mt-2">
              <InfoRow label={t('fleet.registrationExpiry')} value={<span className="flex items-center gap-2">{formatDate(vehicle.registration_expiry, language)}<Badge tone={expiryTone(vehicle.registration_expiry)}>{expiryLabel(vehicle.registration_expiry, t)}</Badge></span>} />
              <InfoRow label={t('fleet.insuranceExpiry')} value={<span className="flex items-center gap-2">{formatDate(vehicle.insurance_expiry, language)}<Badge tone={expiryTone(vehicle.insurance_expiry)}>{expiryLabel(vehicle.insurance_expiry, t)}</Badge></span>} />
              <InfoRow label={t('fleet.acquisitionDate')} value={formatDate(vehicle.acquisition_date, language)} />
              <InfoRow label={t('fleet.acquisitionCost')} value={vehicle.acquisition_cost !== null ? money(vehicle.acquisition_cost, currency, language) : '—'} />
              <InfoRow label={t('common.notes')} value={vehicle.notes || '—'} />
            </div>
          </Panel>
        </div>
      ) : null}

      {tab === 'financials' ? (
        <div className="space-y-4">
          <Panel className="p-4">
            <SectionHeader title={t('fleet.performance')} hint={t('fleet.utilization')} />
            <div className="mt-3 space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-[0.68rem]"><span className="text-muted">{t('fleet.utilization')}</span><span className="tabular text-text">{percent(vehicle.utilization, 1, language)}</span></div>
                <Progress value={num(vehicle.utilization)} />
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
                <div><p className="text-[0.6rem] uppercase tracking-[0.1em] text-muted">{t('fleet.trips')}</p><p className="mt-1 text-[0.9rem] font-semibold tabular">{num(vehicle.trips)}</p></div>
                <div><p className="text-[0.6rem] uppercase tracking-[0.1em] text-muted">{t('fleet.busyHours')}</p><p className="mt-1 text-[0.9rem] font-semibold tabular">{num(vehicle.busy_hours)}</p></div>
                <div><p className="text-[0.6rem] uppercase tracking-[0.1em] text-muted">{t('common.revenue')}</p><p className="mt-1 text-[0.9rem] font-semibold tabular text-positive">{money(vehicle.revenue, currency, language, true)}</p></div>
                <div><p className="text-[0.6rem] uppercase tracking-[0.1em] text-muted">{t('common.profit')}</p><p className={`mt-1 text-[0.9rem] font-semibold tabular ${num(vehicle.profit) >= 0 ? 'text-positive' : 'text-negative'}`}>{money(vehicle.profit, currency, language, true)}</p></div>
              </div>
            </div>
          </Panel>
          <Panel className="p-4">
            <SectionHeader title={t('fleet.expenseBreakdown')} />
            {detail.expenseBreakdown.length ? (
              <div className="mt-3 space-y-2.5">
                {detail.expenseBreakdown.map((row) => {
                  const max = Math.max(...detail.expenseBreakdown.map((item) => num(item.amount)), 1)
                  return (
                    <div key={`${row.name_en}-${row.amount}`}>
                      <div className="mb-1 flex items-center justify-between text-[0.68rem]">
                        <span className="text-text-soft">{language === 'ar' ? row.name_ar : row.name_en}</span>
                        <span className="tabular text-muted">{money(row.amount, currency, language, true)}</span>
                      </div>
                      <Progress value={(num(row.amount) / max) * 100} height="h-1" />
                    </div>
                  )
                })}
              </div>
            ) : <p className="mt-3 text-[0.72rem] text-muted">{t('common.noData')}</p>}
          </Panel>
        </div>
      ) : null}

      {tab === 'maintenance' ? (
        detail.maintenance.length ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="data-table">
              <thead><tr><th>{t('maintenance.recordNo')}</th><th>{t('maintenance.type')}</th><th>{t('common.period')}</th><th className="text-end">{t('maintenance.cost')}</th><th>{t('common.status')}</th></tr></thead>
              <tbody>
                {detail.maintenance.map((record) => (
                  <tr key={record.id}>
                    <td className="text-[0.7rem]">{record.record_no}</td>
                    <td className="text-[0.7rem]">{record.maintenance_type}</td>
                    <td className="text-[0.68rem] text-muted">{formatDate(record.start_date, language)} → {formatDate(record.end_date, language)}</td>
                    <td className="text-end tabular text-[0.7rem]">{money(record.cost, currency, language, true)}</td>
                    <td><StatusBadge status={record.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon={<Wrench size={18} />} title={t('maintenance.empty')} hint={t('maintenance.emptyHint')} />
      ) : null}

      {tab === 'trips' ? (
        detail.trips.length ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="data-table">
              <thead><tr><th>{t('trips.tripNo')}</th><th>{t('common.date')}</th><th>{t('routes.origin')}</th><th className="text-end">{t('trips.quotedPrice')}</th><th>{t('common.status')}</th></tr></thead>
              <tbody>
                {detail.trips.map((trip: Trip) => (
                  <tr key={trip.id}>
                    <td className="text-[0.7rem]">{trip.trip_no}</td>
                    <td className="text-[0.68rem] text-muted">{formatDate(trip.scheduled_departure, language)}</td>
                    <td className="text-[0.68rem]">{trip.origin} → {trip.destination}</td>
                    <td className="text-end tabular text-[0.7rem]">{money(trip.quoted_price, currency, language, true)}</td>
                    <td><StatusBadge status={trip.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon={<TrendingUp size={18} />} title={t('trips.empty')} hint={t('trips.emptyHint')} />
      ) : null}
    </div>
  )
}

function expiryLabel(date: string | null, t: (key: TranslationKey) => string) {
  const days = relativeDays(date)
  if (days === null) return t('common.notProvided')
  if (days < 0) return t('status.expired')
  if (days === 0) return t('common.today')
  return `${days} ${t('common.days')}`
}
