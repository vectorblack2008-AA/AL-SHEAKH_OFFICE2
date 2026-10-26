import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  MapPin,
  Navigation,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Receipt,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import type { TranslationKey } from '../i18n/translations'
import { api, errorMessage } from '../lib/api'
import type { Contract, Customer, Driver, FixedRoute, Trip, TripDetail, Vehicle } from '../lib/types'
import { formatDate, formatDateTime, money, num, rangeFromDays, todayISO } from '../lib/utils'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  InfoRow,
  Input,
  Modal,
  PageHeader,
  Panel,
  Pagination,
  SearchInput,
  SectionHeader,
  Select,
  Sheet,
  StatusBadge,
  Tabs,
  Textarea,
} from '../components/ui'
import { PageError, PageSkeleton, PeriodPicker, StatStrip, useDebounced, usePageState, type DateRange } from '../components/filters'

interface TripsResponse {
  data: Trip[]
  total: number
  page: number
  pageSize: number
  summary: {
    total: number
    completed: number
    scheduled: number
    cancelled: number
    missed: number
    revenue: number
  }
  range: DateRange
}

const TRIP_STATUSES = [
  'new_request',
  'pending_confirmation',
  'confirmed',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
  'missed',
] as const

const TRIP_TYPES = ['fixed', 'private'] as const

interface TripForm {
  trip_type: string
  route_id: string
  customer_id: string
  contract_id: string
  vehicle_id: string
  driver_id: string
  origin: string
  destination: string
  scheduled_departure: string
  expected_arrival: string
  distance_km: string
  quoted_price: string
  additional_charges: string
  discount: string
  status: string
  cancellation_reason: string
  notes: string
}

function emptyForm(): TripForm {
  const start = `${todayISO()}T09:00`
  return {
    trip_type: 'private',
    route_id: '',
    customer_id: '',
    contract_id: '',
    vehicle_id: '',
    driver_id: '',
    origin: '',
    destination: '',
    scheduled_departure: start,
    expected_arrival: '',
    distance_km: '',
    quoted_price: '0',
    additional_charges: '0',
    discount: '0',
    status: 'new_request',
    cancellation_reason: '',
    notes: '',
  }
}

function toInput(value?: string | null): string {
  if (!value) return ''
  const raw = String(value)
  return raw.includes('T') ? raw.slice(0, 16) : raw.replace(' ', 'T').slice(0, 16)
}

function formFromTrip(trip: Trip): TripForm {
  return {
    trip_type: trip.trip_type,
    route_id: trip.route_id ?? '',
    customer_id: trip.customer_id ?? '',
    contract_id: trip.contract_id ?? '',
    vehicle_id: trip.vehicle_id ?? '',
    driver_id: trip.driver_id ?? '',
    origin: trip.origin,
    destination: trip.destination,
    scheduled_departure: toInput(trip.scheduled_departure),
    expected_arrival: toInput(trip.expected_arrival),
    distance_km: trip.distance_km !== null ? String(trip.distance_km) : '',
    quoted_price: String(num(trip.quoted_price)),
    additional_charges: String(num(trip.additional_charges)),
    discount: String(num(trip.discount)),
    status: trip.status,
    cancellation_reason: trip.cancellation_reason ?? '',
    notes: trip.notes ?? '',
  }
}

function addMinutes(value: string, minutes: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  date.setMinutes(date.getMinutes() + minutes)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function TripsPage() {
  const { t, language, currency, can } = useApp()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [range, setRange] = useState<DateRange>(() => rangeFromDays(90))
  const [search, setSearch] = useState('')
  const [tripType, setTripType] = useState('')
  const [status, setStatus] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const debounced = useDebounced(search)
  const { page, pageSize, setPage } = usePageState(20)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Trip | null>(null)
  const [form, setForm] = useState<TripForm>(emptyForm)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Trip | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  const canManage = can('manage_trips')

  const listQuery = useQuery({
    queryKey: ['trips', range.from, range.to, debounced, tripType, status, vehicleId, page, pageSize],
    queryFn: () =>
      api.get<TripsResponse>('/api/trips', {
        from: range.from,
        to: range.to,
        search: debounced,
        trip_type: tripType,
        status,
        vehicleId,
        page,
        pageSize,
      }),
  })

  const vehiclesQuery = useQuery({
    queryKey: ['trips', 'vehicle-options'],
    queryFn: () => api.get<{ data: Vehicle[] }>('/api/vehicles', { pageSize: 200 }),
    enabled: can('view_fleet'),
  })
  const driversQuery = useQuery({
    queryKey: ['trips', 'driver-options'],
    queryFn: () => api.get<{ data: Driver[] }>('/api/drivers', { pageSize: 200 }),
    enabled: can('view_drivers') && formOpen,
  })
  const customersQuery = useQuery({
    queryKey: ['trips', 'customer-options'],
    queryFn: () => api.get<{ data: Customer[] }>('/api/customers'),
    enabled: can('view_contracts') && formOpen,
  })
  const contractsQuery = useQuery({
    queryKey: ['trips', 'contract-options'],
    queryFn: () => api.get<{ data: Contract[] }>('/api/contracts'),
    enabled: can('view_contracts') && formOpen,
  })
  const routesQuery = useQuery({
    queryKey: ['trips', 'route-options'],
    queryFn: () => api.get<{ data: FixedRoute[] }>('/api/routes', { from: range.from, to: range.to }),
    enabled: can('view_routes') && formOpen,
  })

  const detailQuery = useQuery({
    queryKey: ['trips', 'trip', detailId],
    queryFn: () => api.get<TripDetail>(`/api/trips/${detailId}`),
    enabled: Boolean(detailId),
  })
  const detailTrip = detailQuery.data?.trip ?? null

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editing) return api.patch(`/api/trips/${editing.id}`, payload)
      return api.post<{ conflicts?: unknown[] }>('/api/trips', payload)
    },
    onSuccess: (result) => {
      toast.success(t('common.saved'))
      const conflicts = (result as { conflicts?: unknown[] } | undefined)?.conflicts
      if (conflicts?.length) toast.warning(t('trips.scheduleConflict'), t('trips.assignment'))
      setFormOpen(false)
      setEditing(null)
      setForm(emptyForm())
      void queryClient.invalidateQueries({ queryKey: ['trips'] })
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['fleet'] })
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const statusMutation = useMutation({
    mutationFn: (payload: { id: string; status: string; cancellation_reason?: string }) =>
      api.patch(`/api/trips/${payload.id}`, {
        status: payload.status,
        ...(payload.cancellation_reason ? { cancellation_reason: payload.cancellation_reason } : {}),
      }),
    onSuccess: () => {
      toast.success(t('common.saved'))
      setCancelTarget(null)
      setCancelReason('')
      void queryClient.invalidateQueries({ queryKey: ['trips'] })
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['fleet'] })
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const rows = listQuery.data?.data ?? []
  const summary = listQuery.data?.summary
  const vehicles = vehiclesQuery.data?.data ?? []
  const drivers = driversQuery.data?.data ?? []
  const customers = customersQuery.data?.data ?? []
  const contracts = contractsQuery.data?.data ?? []
  const routes = routesQuery.data?.data ?? []

  const average = useMemo(() => {
    if (!summary?.completed) return 0
    return num(summary.revenue) / num(summary.completed)
  }, [summary])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setFormOpen(true)
  }

  function openEdit(trip: Trip) {
    setEditing(trip)
    setForm(formFromTrip(trip))
    setFormOpen(true)
  }

  function chooseRoute(routeId: string) {
    const route = routes.find((item) => item.id === routeId)
    if (!route) {
      setForm((current) => ({ ...current, route_id: '' }))
      return
    }
    setForm((current) => ({
      ...current,
      route_id: routeId,
      origin: route.origin,
      destination: route.destination,
      quoted_price: String(num(route.price)),
      expected_arrival: current.scheduled_departure ? addMinutes(current.scheduled_departure, route.duration_minutes) : current.expected_arrival,
    }))
  }

  function chooseDeparture(value: string) {
    setForm((current) => {
      const route = routes.find((item) => item.id === current.route_id)
      return {
        ...current,
        scheduled_departure: value,
        expected_arrival: route && value ? addMinutes(value, route.duration_minutes) : current.expected_arrival,
      }
    })
  }

  function submit() {
    if (!form.origin.trim() || !form.destination.trim() || !form.scheduled_departure) {
      toast.error(t('error.validation'), t('common.required'))
      return
    }
    if (form.status === 'cancelled' && !form.cancellation_reason.trim()) {
      toast.error(t('error.validation'), t('trips.cancellationReason'))
      return
    }
    const customerContracts = contracts.filter((contract) => !form.customer_id || contract.customer_id === form.customer_id)
    const contractId = customerContracts.some((contract) => contract.id === form.contract_id) ? form.contract_id : ''
    saveMutation.mutate({
      trip_type: form.trip_type,
      route_id: form.trip_type === 'fixed' && form.route_id ? form.route_id : null,
      customer_id: form.customer_id || null,
      contract_id: contractId || null,
      vehicle_id: form.vehicle_id || null,
      driver_id: form.driver_id || null,
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      scheduled_departure: form.scheduled_departure.replace('T', ' '),
      expected_arrival: form.expected_arrival ? form.expected_arrival.replace('T', ' ') : null,
      distance_km: form.distance_km ? Number(form.distance_km) : null,
      quoted_price: Number(form.quoted_price || 0),
      additional_charges: Number(form.additional_charges || 0),
      discount: Number(form.discount || 0),
      status: form.status,
      cancellation_reason: form.status === 'cancelled' ? form.cancellation_reason.trim() : null,
      notes: form.notes.trim() || null,
    })
  }

  function confirmStatus(trip: Trip, next: string) {
    if (next === 'cancelled') {
      setCancelTarget(trip)
      setCancelReason('')
      return
    }
    statusMutation.mutate({ id: trip.id, status: next })
  }

  const customerContracts = contracts.filter(
    (contract) => (!form.customer_id || contract.customer_id === form.customer_id) && contract.status !== 'archived',
  )

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${t('nav.operations')} · ${t('nav.trips')}`}
        title={t('trips.title')}
        subtitle={t('trips.subtitle')}
        actions={
          <>
            <PeriodPicker value={range} onChange={(next) => { setRange(next); setPage(1) }} />
            {canManage ? (
              <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>
                {t('trips.addTrip')}
              </Button>
            ) : null}
          </>
        }
      />

      {summary ? (
        <StatStrip
          items={[
            { label: t('trips.totalPrivate'), value: num(summary.total), hint: t('common.period'), tone: 'accent' },
            { label: t('trips.completed'), value: num(summary.completed), hint: `${num(summary.scheduled)} ${t('trips.scheduled')}`, tone: 'positive' },
            { label: t('trips.cancelled'), value: num(summary.cancelled), hint: `${num(summary.missed)} ${t('trips.missed')}`, tone: num(summary.cancelled) + num(summary.missed) > 0 ? 'negative' : 'default' },
            { label: t('trips.recognizedRevenue'), value: money(summary.revenue, currency, language, true), hint: t('common.revenue'), tone: 'positive' },
            { label: t('trips.avgValue'), value: money(average, currency, language, true), hint: t('trips.quotedValue'), tone: 'accent' },
          ]}
        />
      ) : null}

      <Panel className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onChange={(value) => { setSearch(value); setPage(1) }}
            className="w-full sm:w-60"
            placeholder={t('common.searchPlaceholder')}
          />
          <Select value={tripType} onChange={(event) => { setTripType(event.target.value); setPage(1) }} className="w-auto min-w-[8.5rem]">
            <option value="">{t('common.all')} · {t('trips.tripType')}</option>
            {TRIP_TYPES.map((item) => (
              <option key={item} value={item}>{t(`trips.${item}` as TranslationKey)}</option>
            ))}
          </Select>
          <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }} className="w-auto min-w-[9.5rem]">
            <option value="">{t('common.all')} · {t('common.status')}</option>
            {TRIP_STATUSES.map((item) => (
              <option key={item} value={item}>{t(`status.${item}` as TranslationKey)}</option>
            ))}
          </Select>
          <Select value={vehicleId} onChange={(event) => { setVehicleId(event.target.value); setPage(1) }} className="w-auto min-w-[9.5rem]" disabled={!can('view_fleet')}>
            <option value="">{t('common.all')} · {t('common.vehicle')}</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>{vehicle.plate}</option>
            ))}
          </Select>
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
            icon={<ClipboardList size={20} />}
            title={t('trips.empty')}
            hint={t('trips.emptyHint')}
            action={canManage ? <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>{t('trips.addTrip')}</Button> : undefined}
          />
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="scroll-x">
            <table className="data-table min-w-[1150px]">
              <thead>
                <tr>
                  <th>{t('trips.tripNo')}</th>
                  <th>{t('common.date')}</th>
                  <th>{t('trips.route')}</th>
                  <th>{t('trips.customer')}</th>
                  <th>{t('trips.vehicle')}</th>
                  <th>{t('trips.driver')}</th>
                  <th className="text-end">{t('trips.quotedPrice')}</th>
                  <th className="text-end">{t('trips.recognizedRevenue')}</th>
                  <th>{t('common.status')}</th>
                  <th className="text-end">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((trip) => (
                  <tr key={trip.id}>
                    <td>
                      <button type="button" className="block text-start" onClick={() => setDetailId(trip.id)}>
                        <span className="font-semibold tabular text-text">{trip.trip_no}</span>
                        <span className="mt-1 flex items-center gap-1.5">
                          <Badge tone={trip.trip_type === 'fixed' ? 'neutral' : 'accent'} className="text-[0.54rem]">
                            {t(`trips.${trip.trip_type}` as TranslationKey)}
                          </Badge>
                          {trip.contract_no ? <span className="text-[0.6rem] text-muted">{trip.contract_no}</span> : null}
                        </span>
                      </button>
                    </td>
                    <td>
                      <span className="block text-[0.71rem] text-text-soft">{formatDateTime(trip.scheduled_departure, language)}</span>
                      <span className="mt-0.5 block text-[0.62rem] text-muted">{formatDate(trip.scheduled_departure, language, { weekday: 'short' })}</span>
                    </td>
                    <td>
                      <span className="block max-w-[12rem] truncate text-[0.71rem] text-text-soft">
                        {language === 'ar' ? trip.route_name_ar || trip.route_name : trip.route_name || `${trip.origin} → ${trip.destination}`}
                      </span>
                      <span className="mt-0.5 flex max-w-[12rem] items-center gap-1 truncate text-[0.62rem] text-muted">
                        <MapPin size={9} />
                        {trip.origin} → {trip.destination}
                      </span>
                    </td>
                    <td className="text-[0.71rem] text-text-soft">{trip.customer_name || <span className="text-muted">—</span>}</td>
                    <td className="text-[0.71rem] text-text-soft">
                      {trip.vehicle_plate ? (
                        <span>
                          <span className="plate">{trip.vehicle_plate}</span>
                          <span className="mt-0.5 block text-[0.6rem] text-muted">{trip.vehicle_make} {trip.vehicle_model}</span>
                        </span>
                      ) : (
                        <Badge tone="warning">{t('dispatch.unassigned')}</Badge>
                      )}
                    </td>
                    <td className="text-[0.71rem] text-text-soft">{trip.driver_name || <span className="text-muted">—</span>}</td>
                    <td className="text-end tabular text-[0.72rem]">{money(trip.quoted_price, currency, language, true)}</td>
                    <td className={`text-end tabular text-[0.72rem] font-semibold ${num(trip.recognized_revenue) > 0 ? 'text-positive' : 'text-muted'}`}>
                      {money(trip.recognized_revenue, currency, language, true)}
                    </td>
                    <td><StatusBadge status={trip.status} /></td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <IconButton label={t('common.view')} size="sm" onClick={() => setDetailId(trip.id)}><Search size={13} /></IconButton>
                        {canManage ? (
                          <>
                            {['new_request', 'pending_confirmation', 'confirmed'].includes(trip.status) ? (
                              <IconButton label={t('trips.startTrip')} size="sm" onClick={() => confirmStatus(trip, 'in_progress')}><Play size={13} /></IconButton>
                            ) : null}
                            {['in_progress', 'confirmed', 'scheduled'].includes(trip.status) ? (
                              <IconButton label={t('trips.completeTrip')} size="sm" onClick={() => confirmStatus(trip, 'completed')}><CheckCircle2 size={13} /></IconButton>
                            ) : null}
                            {!['cancelled', 'completed', 'missed'].includes(trip.status) ? (
                              <IconButton label={t('trips.cancelTrip')} size="sm" variant="danger" onClick={() => confirmStatus(trip, 'cancelled')}><Ban size={13} /></IconButton>
                            ) : null}
                            <IconButton label={t('common.edit')} size="sm" onClick={() => openEdit(trip)}><Pencil size={13} /></IconButton>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
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
        title={editing ? t('trips.editTrip') : t('trips.addTrip')}
        description={t('trips.priceHint')}
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={saveMutation.isPending} onClick={submit}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('trips.tripType')} required>
            <Select
              value={form.trip_type}
              onChange={(event) => {
                const value = event.target.value
                setForm((current) => ({
                  ...current,
                  trip_type: value,
                  route_id: value === 'private' ? '' : current.route_id,
                }))
              }}
            >
              {TRIP_TYPES.map((item) => <option key={item} value={item}>{t(`trips.${item}` as TranslationKey)}</option>)}
            </Select>
          </Field>
          <Field label={t('trips.route')} hint={form.trip_type === 'fixed' ? t('trips.selectRoute') : t('common.optional')}>
            <Select value={form.route_id} onChange={(event) => chooseRoute(event.target.value)} disabled={form.trip_type !== 'fixed' || !can('view_routes')}>
              <option value="">{t('common.none')}</option>
              {routes.filter((route) => route.status === 'active').map((route) => (
                <option key={route.id} value={route.id}>{route.route_no} · {language === 'ar' ? route.name_ar : route.name_en}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.status')}>
            <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              {TRIP_STATUSES.map((item) => <option key={item} value={item}>{t(`status.${item}` as TranslationKey)}</option>)}
            </Select>
          </Field>
          <Field label={t('trips.origin')} required>
            <Input value={form.origin} onChange={(event) => setForm({ ...form, origin: event.target.value })} />
          </Field>
          <Field label={t('trips.destination')} required>
            <Input value={form.destination} onChange={(event) => setForm({ ...form, destination: event.target.value })} />
          </Field>
          <Field label={t('trips.distance')}>
            <Input type="number" min={0} step="0.1" value={form.distance_km} onChange={(event) => setForm({ ...form, distance_km: event.target.value })} />
          </Field>
          <Field label={t('trips.departure')} required>
            <Input type="datetime-local" value={form.scheduled_departure} onChange={(event) => chooseDeparture(event.target.value)} />
          </Field>
          <Field label={t('trips.arrival')}>
            <Input type="datetime-local" value={form.expected_arrival} onChange={(event) => setForm({ ...form, expected_arrival: event.target.value })} />
          </Field>
          <Field label={t('trips.customer')}>
            <Select value={form.customer_id} onChange={(event) => setForm({ ...form, customer_id: event.target.value, contract_id: '' })} disabled={!can('view_contracts')}>
              <option value="">{t('common.none')}</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.customer_no}</option>)}
            </Select>
          </Field>
          <Field label={t('trips.contract')}>
            <Select value={form.contract_id} onChange={(event) => setForm({ ...form, contract_id: event.target.value })} disabled={!can('view_contracts')}>
              <option value="">{t('common.none')}</option>
              {customerContracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_no} · {contract.title}</option>)}
            </Select>
          </Field>
          <Field label={t('trips.vehicle')}>
            <Select value={form.vehicle_id} onChange={(event) => setForm({ ...form, vehicle_id: event.target.value })} disabled={!can('view_fleet')}>
              <option value="">{t('common.unassigned')}</option>
              {vehicles.filter((vehicle) => vehicle.status !== 'inactive').map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.make} {vehicle.model}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('trips.driver')}>
            <Select value={form.driver_id} onChange={(event) => setForm({ ...form, driver_id: event.target.value })} disabled={!can('view_drivers')}>
              <option value="">{t('common.unassigned')}</option>
              {drivers.filter((driver) => driver.status !== 'inactive').map((driver) => (
                <option key={driver.id} value={driver.id}>{driver.full_name} · {driver.driver_no}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('trips.quotedPrice')}><Input type="number" min={0} step="0.01" value={form.quoted_price} onChange={(event) => setForm({ ...form, quoted_price: event.target.value })} /></Field>
          <Field label={t('trips.additionalCharges')}><Input type="number" min={0} step="0.01" value={form.additional_charges} onChange={(event) => setForm({ ...form, additional_charges: event.target.value })} /></Field>
          <Field label={t('trips.discount')}><Input type="number" min={0} step="0.01" value={form.discount} onChange={(event) => setForm({ ...form, discount: event.target.value })} /></Field>
          {form.status === 'cancelled' ? (
            <Field label={t('trips.cancellationReason')} required className="sm:col-span-2 lg:col-span-3">
              <Textarea value={form.cancellation_reason} onChange={(event) => setForm({ ...form, cancellation_reason: event.target.value })} rows={2} />
            </Field>
          ) : null}
          <Field label={t('trips.notes')} className="sm:col-span-2 lg:col-span-3">
            <Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={2} />
          </Field>
        </div>
      </Modal>

      <Sheet
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title={detailQuery.data ? `${detailQuery.data.trip.trip_no} · ${detailQuery.data.trip.origin} → ${detailQuery.data.trip.destination}` : t('trips.tripDetails')}
        description={detailQuery.data ? formatDateTime(detailQuery.data.trip.scheduled_departure, language) : undefined}
        width="max-w-3xl"
        footer={canManage && detailTrip ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {['new_request', 'pending_confirmation', 'confirmed'].includes(detailTrip.status) ? (
              <Button size="sm" icon={<Play size={13} />} onClick={() => confirmStatus(detailTrip, 'in_progress')}>{t('trips.startTrip')}</Button>
            ) : null}
            {['in_progress', 'confirmed', 'scheduled'].includes(detailTrip.status) ? (
              <Button size="sm" variant="primary" icon={<CheckCircle2 size={13} />} onClick={() => confirmStatus(detailTrip, 'completed')}>{t('trips.completeTrip')}</Button>
            ) : null}
            {!['cancelled', 'completed', 'missed'].includes(detailTrip.status) ? (
              <Button size="sm" variant="danger" icon={<Ban size={13} />} onClick={() => confirmStatus(detailTrip, 'cancelled')}>{t('trips.cancelTrip')}</Button>
            ) : null}
            <Button size="sm" icon={<Pencil size={13} />} onClick={() => { setDetailId(null); openEdit(detailTrip) }}>{t('common.edit')}</Button>
          </div>
        ) : undefined}
      >
        {detailQuery.isLoading ? (
          <PageSkeleton rows={4} />
        ) : detailQuery.error || !detailQuery.data ? (
          <PageError error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />
        ) : (
          <TripDetailView detail={detailQuery.data} currency={currency} language={language} />
        )}
      </Sheet>

      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title={t('trips.cancelTrip')}
        description={t('trips.cancelWarning')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>{t('common.back')}</Button>
            <Button
              variant="danger"
              loading={statusMutation.isPending}
              onClick={() => {
                if (!cancelReason.trim()) {
                  toast.error(t('error.validation'), t('trips.cancellationReason'))
                  return
                }
                if (cancelTarget) statusMutation.mutate({ id: cancelTarget.id, status: 'cancelled', cancellation_reason: cancelReason.trim() })
              }}
            >
              {t('trips.cancelTrip')}
            </Button>
          </>
        }
      >
        <Field label={t('trips.cancellationReason')} required>
          <Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} rows={3} autoFocus />
        </Field>
      </Modal>
    </div>
  )
}

function TripDetailView({ detail, currency, language }: { detail: TripDetail; currency: string; language: 'en' | 'ar' }) {
  const { t } = useApp()
  const [tab, setTab] = useState<'overview' | 'timeline' | 'expenses' | 'invoices'>('overview')
  const trip = detail.trip
  const expenses = detail.expenses ?? []
  const invoices = detail.invoices ?? []
  const expenseTotal = expenses.reduce((sum, row) => sum + num(row.amount), 0)
  const recognized = num(trip.recognized_revenue)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={trip.status} />
        <Badge tone={trip.trip_type === 'fixed' ? 'neutral' : 'accent'}>{t(`trips.${trip.trip_type}` as TranslationKey)}</Badge>
        {trip.contract_no ? <Badge tone="neutral">{trip.contract_no}</Badge> : null}
        {trip.vehicle_plate ? <Badge tone="neutral">{trip.vehicle_plate}</Badge> : null}
      </div>

      <StatStrip
        items={[
          { label: t('trips.quotedPrice'), value: money(trip.quoted_price, currency, language, true), tone: 'accent' },
          { label: t('trips.recognizedRevenue'), value: money(recognized, currency, language, true), tone: 'positive' },
          { label: t('trips.expenses'), value: money(expenseTotal, currency, language, true), tone: 'negative' },
          { label: t('common.profit'), value: money(recognized - expenseTotal, currency, language, true), tone: recognized - expenseTotal >= 0 ? 'positive' : 'negative' },
        ]}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: t('common.details') },
          { value: 'timeline', label: t('trips.timeline') },
          { value: 'expenses', label: t('trips.expenses'), count: expenses.length },
          { value: 'invoices', label: t('trips.invoices'), count: invoices.length },
        ]}
      />

      {tab === 'overview' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel className="p-4">
            <SectionHeader title={t('trips.tripDetails')} />
            <div className="mt-2">
              <InfoRow label={t('trips.tripNo')} value={trip.trip_no} />
              <InfoRow label={t('trips.customer')} value={trip.customer_name || '—'} />
              <InfoRow label={t('trips.contract')} value={trip.contract_no || '—'} />
              <InfoRow label={t('trips.route')} value={language === 'ar' ? trip.route_name_ar || trip.route_name || '—' : trip.route_name || '—'} />
              <InfoRow label={t('trips.origin')} value={trip.origin} />
              <InfoRow label={t('trips.destination')} value={trip.destination} />
              <InfoRow label={t('trips.distance')} value={trip.distance_km !== null ? `${num(trip.distance_km)} ${t('common.km')}` : '—'} />
            </div>
          </Panel>
          <Panel className="p-4">
            <SectionHeader title={t('trips.assignment')} />
            <div className="mt-2">
              <InfoRow label={t('trips.vehicle')} value={trip.vehicle_plate ? `${trip.vehicle_plate} · ${trip.vehicle_make} ${trip.vehicle_model}` : t('dispatch.unassigned')} />
              <InfoRow label={t('trips.driver')} value={trip.driver_name || t('dispatch.unassigned')} />
              <InfoRow label={t('trips.additionalCharges')} value={money(trip.additional_charges, currency, language)} />
              <InfoRow label={t('trips.discount')} value={money(trip.discount, currency, language)} />
              <InfoRow label={t('common.notes')} value={trip.notes || '—'} />
              {trip.cancellation_reason ? <InfoRow label={t('trips.cancellationReason')} value={trip.cancellation_reason} /> : null}
            </div>
          </Panel>
        </div>
      ) : null}

      {tab === 'timeline' ? (
        <Panel className="p-4">
          <SectionHeader title={t('trips.timeline')} hint={t('trips.priceHint')} />
          <div className="mt-4 space-y-0">
            <TimelineRow icon={<CalendarClock size={14} />} label={t('trips.departure')} value={formatDateTime(trip.scheduled_departure, language)} tone="accent" />
            <TimelineRow icon={<Navigation size={14} />} label={t('trips.arrival')} value={formatDateTime(trip.expected_arrival, language)} />
            <TimelineRow icon={<Play size={14} />} label={t('trips.inProgress')} value={trip.actual_departure ? formatDateTime(trip.actual_departure, language) : t('common.notProvided')} />
            <TimelineRow icon={<CheckCircle2 size={14} />} label={t('trips.completed')} value={trip.actual_arrival ? formatDateTime(trip.actual_arrival, language) : t('common.notProvided')} last />
          </div>
        </Panel>
      ) : null}

      {tab === 'expenses' ? (
        expenses.length ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="data-table">
              <thead><tr><th>{t('expenses.expenseNo')}</th><th>{t('common.date')}</th><th>{t('common.description')}</th><th className="text-end">{t('common.amount')}</th><th>{t('common.status')}</th></tr></thead>
              <tbody>
                {expenses.map((row) => (
                  <tr key={row.id}>
                    <td className="text-[0.7rem]">{row.expense_no}</td>
                    <td className="text-[0.68rem] text-muted">{formatDate(row.expense_date, language)}</td>
                    <td className="text-[0.7rem]">{row.description}</td>
                    <td className="text-end tabular text-[0.7rem]">{money(row.amount, currency, language, true)}</td>
                    <td><StatusBadge status={row.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon={<Receipt size={18} />} title={t('trips.noExpenses')} hint={t('expenses.emptyHint')} />
      ) : null}

      {tab === 'invoices' ? (
        invoices.length ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="data-table">
              <thead><tr><th>{t('revenue.invoiceNo')}</th><th>{t('revenue.issueDate')}</th><th>{t('common.description')}</th><th className="text-end">{t('revenue.lineTotal')}</th><th>{t('common.status')}</th></tr></thead>
              <tbody>
                {invoices.map((row) => (
                  <tr key={String(row.id)}>
                    <td className="text-[0.7rem]">{String(row.invoice_no ?? '—')}</td>
                    <td className="text-[0.68rem] text-muted">{formatDate(String(row.issue_date ?? ''), language)}</td>
                    <td className="text-[0.7rem]">{String(row.description ?? '—')}</td>
                    <td className="text-end tabular text-[0.7rem]">{money(row.line_total, currency, language, true)}</td>
                    <td><StatusBadge status={String(row.status ?? 'sent')} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon={<FileText size={18} />} title={t('trips.noInvoices')} hint={t('revenue.emptyInvoicesHint')} />
      ) : null}
    </div>
  )
}

function TimelineRow({
  icon,
  label,
  value,
  tone = 'neutral',
  last,
}: {
  icon: ReactNode
  label: string
  value: string
  tone?: 'accent' | 'neutral'
  last?: boolean
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={tone === 'accent' ? 'flex h-7 w-7 items-center justify-center rounded-full border border-accent/30 bg-accent-soft text-accent' : 'flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface-2 text-muted'}>
          {icon}
        </span>
        {!last ? <span className="my-1 w-px flex-1 bg-border" /> : null}
      </div>
      <div className={last ? 'pb-0' : 'pb-5'}>
        <p className="text-[0.67rem] font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
        <p className="mt-0.5 text-[0.8rem] font-medium text-text">{value}</p>
      </div>
    </div>
  )
}
