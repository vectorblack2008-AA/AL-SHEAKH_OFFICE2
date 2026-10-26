import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  Gauge,
  MapPin,
  RefreshCw,
  UsersRound,
  Wrench,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import type { TranslationKey } from '../i18n/translations'
import { api, errorMessage } from '../lib/api'
import type { Driver, MaintenanceRecord, ScheduleData, Trip } from '../lib/types'
import { addDaysISO, cn, dateToISO, formatDate, formatTime, money, num, todayISO } from '../lib/utils'
import {
  Badge,
  Button,
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
  Tabs,
  Textarea,
} from '../components/ui'
import { PageError, PageSkeleton, StatStrip } from '../components/filters'

function startOfWeek(iso = todayISO()): string {
  const date = new Date(`${iso}T12:00:00`)
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return dateToISO(date)
}

function timeOf(value?: string | null): number {
  if (!value) return 0
  const date = new Date(String(value).replace(' ', 'T'))
  const result = date.getTime()
  return Number.isNaN(result) ? 0 : result
}

function endOf(trip: Trip): number {
  const start = timeOf(trip.scheduled_departure)
  if (!start) return 0
  return trip.expected_arrival ? timeOf(trip.expected_arrival) : start + 2 * 3_600_000
}

interface Conflict {
  id: string
  type: 'vehicle' | 'driver' | 'maintenance'
  title: string
  detail: string
}

export function DispatchPage() {
  const { t, language, currency, can } = useApp()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [weekStart, setWeekStart] = useState(() => startOfWeek())
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [showFixed, setShowFixed] = useState(true)
  const [showPrivate, setShowPrivate] = useState(true)
  const [selectedDay, setSelectedDay] = useState(() => {
    const index = Math.round((new Date(`${todayISO()}T12:00:00`).getTime() - new Date(`${startOfWeek()}T12:00:00`).getTime()) / 86_400_000)
    return index >= 0 && index <= 6 ? index : 0
  })
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [assignTrip, setAssignTrip] = useState<Trip | null>(null)
  const [assignVehicle, setAssignVehicle] = useState('')
  const [assignDriver, setAssignDriver] = useState('')
  const [assignNote, setAssignNote] = useState('')

  const canManage = can('manage_trips')
  const weekEnd = addDaysISO(weekStart, 6)
  const weekDates = Array.from({ length: 7 }, (_, index) => addDaysISO(weekStart, index))
  const weekdays = ['day.1.short', 'day.2.short', 'day.3.short', 'day.4.short', 'day.5.short', 'day.6.short', 'day.0.short'] as const

  const scheduleQuery = useQuery({
    queryKey: ['dispatch', weekStart, weekEnd, vehicleFilter],
    queryFn: () => api.get<ScheduleData>('/api/schedule', { from: weekStart, to: weekEnd, vehicleId: vehicleFilter }),
  })

  const driversQuery = useQuery({
    queryKey: ['dispatch', 'driver-options'],
    queryFn: () => api.get<{ data: Driver[] }>('/api/drivers', { pageSize: 200 }),
    enabled: can('view_drivers') && Boolean(assignTrip),
  })

  const assignMutation = useMutation({
    mutationFn: (payload: { id: string; vehicle_id: string | null; driver_id: string | null; notes: string | null }) =>
      api.patch(`/api/trips/${payload.id}`, {
        vehicle_id: payload.vehicle_id,
        driver_id: payload.driver_id,
        notes: payload.notes,
      }),
    onSuccess: () => {
      toast.success(t('common.saved'))
      setAssignTrip(null)
      setSelectedTrip(null)
      setAssignNote('')
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      void queryClient.invalidateQueries({ queryKey: ['trips'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['fleet'] })
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const data = scheduleQuery.data
  const allTrips = data?.trips ?? []
  const buffer = data?.bufferMinutes ?? 30
  const vehicles = data?.vehicles ?? []
  const maintenance = data?.maintenance ?? []

  const visibleTrips = useMemo(
    () =>
      allTrips.filter((trip) => (trip.trip_type === 'fixed' ? showFixed : showPrivate)),
    [allTrips, showFixed, showPrivate],
  )

  const conflicts = useMemo<Conflict[]>(() => {
    const list: Conflict[] = []
    const byVehicle = new Map<string, Trip[]>()
    const byDriver = new Map<string, Trip[]>()
    for (const trip of allTrips) {
      if (trip.vehicle_id) {
        const bucket = byVehicle.get(trip.vehicle_id) ?? []
        bucket.push(trip)
        byVehicle.set(trip.vehicle_id, bucket)
      }
      if (trip.driver_id) {
        const bucket = byDriver.get(trip.driver_id) ?? []
        bucket.push(trip)
        byDriver.set(trip.driver_id, bucket)
      }
    }
    const bufferMs = buffer * 60_000
    const overlaps = (left: Trip, right: Trip) => {
      const leftStart = timeOf(left.scheduled_departure)
      const leftEnd = endOf(left)
      const rightStart = timeOf(right.scheduled_departure)
      const rightEnd = endOf(right)
      return leftStart < rightEnd + bufferMs && rightStart < leftEnd + bufferMs
    }

    for (const group of byVehicle.values()) {
      for (let index = 0; index < group.length; index += 1) {
        for (let other = index + 1; other < group.length; other += 1) {
          if (overlaps(group[index], group[other])) {
            list.push({
              id: `vehicle-${group[index].id}-${group[other].id}`,
              type: 'vehicle',
              title: t('dispatch.vehicleConflict'),
              detail: `${group[index].trip_no} · ${group[other].trip_no} — ${group[index].vehicle_plate ?? ''}`,
            })
          }
        }
      }
    }

    for (const group of byDriver.values()) {
      for (let index = 0; index < group.length; index += 1) {
        for (let other = index + 1; other < group.length; other += 1) {
          if (overlaps(group[index], group[other])) {
            list.push({
              id: `driver-${group[index].id}-${group[other].id}`,
              type: 'driver',
              title: t('dispatch.driverConflict'),
              detail: `${group[index].trip_no} · ${group[other].trip_no} — ${group[index].driver_name ?? ''}`,
            })
          }
        }
      }
    }

    for (const record of maintenance) {
      const blockStart = `${String(record.start_date).slice(0, 10)}T00:00`
      const blockEnd = `${String(record.end_date).slice(0, 10)}T23:59`
      for (const trip of allTrips.filter((item) => item.vehicle_id === record.vehicle_id)) {
        if (overlaps(trip, { ...trip, scheduled_departure: blockStart, expected_arrival: blockEnd } as Trip)) {
          list.push({
            id: `maintenance-${record.id}-${trip.id}`,
            type: 'maintenance',
            title: t('dispatch.maintenanceBlock'),
            detail: `${record.record_no} · ${trip.trip_no} — ${record.vehicle_plate ?? ''}`,
          })
        }
      }
    }

    return list
  }, [allTrips, buffer, maintenance, t])

  const unassigned = allTrips.filter((trip) => !trip.vehicle_id || !trip.driver_id)
  const stats = {
    total: visibleTrips.length,
    scheduled: visibleTrips.filter((trip) => ['confirmed', 'scheduled'].includes(trip.status)).length,
    completed: visibleTrips.filter((trip) => trip.status === 'completed').length,
    maintenance: maintenance.length,
    conflicts: conflicts.length,
    unassigned: unassigned.length,
  }

  function shiftWeek(direction: number) {
    const next = direction === 0 ? startOfWeek() : addDaysISO(weekStart, direction * 7)
    setWeekStart(next)
    const todayIndex = Math.round((new Date(`${todayISO()}T12:00:00`).getTime() - new Date(`${next}T12:00:00`).getTime()) / 86_400_000)
    setSelectedDay(todayIndex >= 0 && todayIndex <= 6 ? todayIndex : 0)
  }

  function openAssign(trip: Trip) {
    setAssignTrip(trip)
    setAssignVehicle(trip.vehicle_id ?? '')
    setAssignDriver(trip.driver_id ?? '')
    setAssignNote(trip.notes ?? '')
  }

  function submitAssign() {
    if (!assignTrip) return
    if (!assignVehicle && !assignDriver) {
      toast.error(t('error.validation'), t('dispatch.assignHint'))
      return
    }
    assignMutation.mutate({
      id: assignTrip.id,
      vehicle_id: assignVehicle || null,
      driver_id: assignDriver || null,
      notes: assignNote.trim() || null,
    })
  }

  const selectedDate = weekDates[selectedDay]
  const dayTrips = visibleTrips
    .filter((trip) => String(trip.scheduled_departure).slice(0, 10) === selectedDate)
    .sort((left, right) => timeOf(left.scheduled_departure) - timeOf(right.scheduled_departure))
  const dayMaintenance = maintenance.filter((record) => String(record.start_date).slice(0, 10) <= selectedDate && String(record.end_date).slice(0, 10) >= selectedDate)

  const vehicleOptions = vehicles.filter((vehicle) => vehicle.status !== 'inactive')
  const boardVehicles = vehicleFilter ? vehicles.filter((vehicle) => vehicle.id === vehicleFilter) : vehicles
  const driverOptions = (driversQuery.data?.data ?? []).filter((driver) => driver.status !== 'inactive')

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${t('nav.operations')} · ${t('nav.dispatch')}`}
        title={t('dispatch.title')}
        subtitle={t('dispatch.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-xl border border-border bg-surface-2/70 p-0.5">
              <IconButton label={t('dispatch.prevWeek')} size="sm" onClick={() => shiftWeek(-1)}>
                <ChevronLeft size={14} className={language === 'ar' ? 'rotate-180' : ''} />
              </IconButton>
              <button type="button" onClick={() => shiftWeek(0)} className="px-2 text-[0.68rem] font-semibold text-muted transition hover:text-text">
                {t('dispatch.thisWeek')}
              </button>
              <IconButton label={t('dispatch.nextWeek')} size="sm" onClick={() => shiftWeek(1)}>
                <ChevronRight size={14} className={language === 'ar' ? 'rotate-180' : ''} />
              </IconButton>
            </div>
            <div className="rounded-xl border border-border bg-surface-2/70 px-3 py-1.5 text-[0.7rem] font-semibold text-text-soft">
              {formatDate(weekStart, language)} — {formatDate(weekEnd, language)}
            </div>
            <IconButton label={t('common.refresh')} size="sm" variant="secondary" onClick={() => void scheduleQuery.refetch()}>
              <RefreshCw size={14} className={scheduleQuery.isFetching ? 'animate-spin' : ''} />
            </IconButton>
          </div>
        }
      />

      <StatStrip
        items={[
          { label: t('dispatch.totalTrips'), value: stats.total, hint: t('dispatch.stats'), tone: 'accent' },
          { label: t('dispatch.scheduled'), value: stats.scheduled, tone: 'info' as 'default' },
          { label: t('dispatch.completed'), value: stats.completed, tone: 'positive' },
          { label: t('dispatch.unassignedCount'), value: stats.unassigned, tone: stats.unassigned ? 'warning' : 'default' },
          { label: t('dispatch.maintenanceBlock'), value: stats.maintenance, tone: 'warning' },
          { label: t('dispatch.conflicts'), value: stats.conflicts, tone: stats.conflicts ? 'negative' : 'positive' },
        ]}
      />

      <Panel className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)} className="w-auto min-w-[11rem]">
            <option value="">{t('dispatch.allVehicles')}</option>
            {vehicleOptions.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.make} {vehicle.model}</option>
            ))}
          </Select>
          <label className="flex cursor-pointer items-center gap-2 text-[0.72rem] text-text-soft">
            <input type="checkbox" checked={showFixed} onChange={(event) => setShowFixed(event.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
            {t('dispatch.showFixed')}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[0.72rem] text-text-soft">
            <input type="checkbox" checked={showPrivate} onChange={(event) => setShowPrivate(event.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
            {t('dispatch.showPrivate')}
          </label>
          <Badge tone="neutral" className="ms-auto">{t('dispatch.buffer', { n: buffer })}</Badge>
        </div>
      </Panel>

      {scheduleQuery.isLoading ? (
        <PageSkeleton rows={6} />
      ) : scheduleQuery.error ? (
        <PageError error={scheduleQuery.error} onRetry={() => void scheduleQuery.refetch()} />
      ) : (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4">
            <Panel className="hidden overflow-hidden p-0 lg:block">
              <div className="scroll-x">
                <div className="min-w-[1040px]">
                  <div className="grid border-b border-border bg-surface-2/60" style={{ gridTemplateColumns: '13rem repeat(7, minmax(0, 1fr))' }}>
                    <div className="px-3 py-2.5 text-[0.6rem] font-bold uppercase tracking-[0.13em] text-muted">{t('dispatch.board')}</div>
                    {weekDates.map((date, index) => (
                      <div key={date} className={cn('border-s border-border px-2 py-2 text-center', date === todayISO() && 'bg-accent-soft')}>
                        <p className="text-[0.58rem] font-bold uppercase tracking-[0.12em] text-muted">{t(weekdays[index])}</p>
                        <p className={cn('mt-0.5 text-[0.78rem] font-semibold tabular', date === todayISO() ? 'text-accent' : 'text-text')}>{date.slice(8)}</p>
                      </div>
                    ))}
                  </div>
                  {boardVehicles.map((vehicle) => {
                    const vehicleTrips = visibleTrips.filter((trip) => trip.vehicle_id === vehicle.id)
                    return (
                      <div key={vehicle.id} className="grid border-b border-border last:border-0" style={{ gridTemplateColumns: '13rem repeat(7, minmax(0, 1fr))' }}>
                        <div className="flex flex-col justify-center gap-1 border-e border-border bg-surface px-3 py-3">
                          <div className="flex items-center gap-2">
                            <span className="plate">{vehicle.plate}</span>
                            <StatusBadge status={vehicle.status} dot={false} className="text-[0.52rem]" />
                          </div>
                          <p className="truncate text-[0.62rem] text-muted">{vehicle.make} {vehicle.model}</p>
                          <p className="truncate text-[0.6rem] text-muted">{vehicle.driver_name || t('dispatch.offDuty')}</p>
                        </div>
                        {weekDates.map((date) => {
                          const dayTripsCell = vehicleTrips
                            .filter((trip) => String(trip.scheduled_departure).slice(0, 10) === date)
                            .sort((left, right) => timeOf(left.scheduled_departure) - timeOf(right.scheduled_departure))
                          const blocks = maintenance.filter(
                            (record) => record.vehicle_id === vehicle.id && String(record.start_date).slice(0, 10) <= date && String(record.end_date).slice(0, 10) >= date,
                          )
                          return (
                            <div key={`${vehicle.id}-${date}`} className={cn('min-h-[6.5rem] space-y-1 border-s border-border px-1.5 py-2', date === todayISO() && 'bg-accent-soft/25')}>
                              {blocks.map((record) => (
                                <div key={record.id} className="rounded-lg border border-warning/25 bg-warning-soft px-1.5 py-1" title={record.description}>
                                  <p className="flex items-center gap-1 text-[0.58rem] font-bold uppercase tracking-[0.08em] text-warning">
                                    <Wrench size={9} /> {t('dispatch.maintenanceBlock')}
                                  </p>
                                  <p className="mt-0.5 truncate text-[0.6rem] text-text-soft">{record.maintenance_type}</p>
                                </div>
                              ))}
                              {dayTripsCell.map((trip) => (
                                <button
                                  key={trip.id}
                                  type="button"
                                  onClick={() => setSelectedTrip(trip)}
                                  className={cn(
                                    'block w-full rounded-lg border px-1.5 py-1 text-start transition hover:border-accent/50',
                                    trip.status === 'completed'
                                      ? 'border-positive/25 bg-positive-soft/70'
                                      : trip.status === 'in_progress'
                                        ? 'border-info/25 bg-info-soft/70'
                                        : trip.status === 'cancelled' || trip.status === 'missed'
                                          ? 'border-negative/25 bg-negative-soft/60'
                                          : 'border-border bg-surface-2/80',
                                  )}
                                >
                                  <p className="flex items-center justify-between gap-1 text-[0.58rem] font-bold tabular text-text">
                                    <span>{formatTime(trip.scheduled_departure, language)}</span>
                                    <span className="truncate font-normal text-muted">{trip.trip_no.slice(-4)}</span>
                                  </p>
                                  <p className="mt-0.5 truncate text-[0.6rem] font-medium text-text-soft">
                                    {language === 'ar' ? trip.route_name_ar || trip.route_name : trip.route_name || trip.destination}
                                  </p>
                                  <p className="truncate text-[0.55rem] text-muted">{trip.customer_name || trip.driver_name || '—'}</p>
                                </button>
                              ))}
                              {!blocks.length && !dayTripsCell.length ? <div className="h-full rounded-lg border border-dashed border-border/50" /> : null}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                  {!boardVehicles.length ? (
                    <EmptyState icon={<Gauge size={18} />} title={t('fleet.empty')} hint={t('fleet.emptyHint')} />
                  ) : null}
                </div>
              </div>
            </Panel>

            <Panel className="overflow-hidden p-0 lg:hidden">
              <div className="scroll-x border-b border-border p-2">
                <div className="flex min-w-max gap-1">
                  {weekDates.map((date, index) => (
                    <button
                      key={date}
                      type="button"
                      onClick={() => setSelectedDay(index)}
                      className={cn(
                        'min-w-[4rem] rounded-xl px-2 py-1.5 text-center transition',
                        selectedDay === index ? 'bg-accent text-accent-contrast' : 'text-muted hover:bg-surface-2 hover:text-text',
                      )}
                    >
                      <span className="block text-[0.56rem] font-bold uppercase tracking-[0.1em]">{t(weekdays[index])}</span>
                      <span className="mt-0.5 block text-[0.78rem] font-semibold tabular">{date.slice(8)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-3">
                <SectionHeader title={`${t('dispatch.agenda')} · ${formatDate(selectedDate, language)}`} hint={t('dispatch.tripCount', { n: dayTrips.length })} />
                <div className="mt-3 space-y-2">
                  {dayMaintenance.map((record) => (
                    <div key={record.id} className="rounded-xl border border-warning/25 bg-warning-soft px-3 py-2">
                      <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-warning"><Wrench size={12} /> {t('dispatch.maintenanceBlock')}</p>
                      <p className="mt-0.5 text-[0.66rem] text-text-soft">{record.vehicle_plate} · {record.maintenance_type}</p>
                    </div>
                  ))}
                  {dayTrips.map((trip) => (
                    <button key={trip.id} type="button" onClick={() => setSelectedTrip(trip)} className="panel-flat block w-full px-3 py-2.5 text-start transition hover:border-accent/40">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[0.7rem] font-semibold tabular text-text"><Clock size={11} className="text-muted" /> {formatTime(trip.scheduled_departure, language)}</span>
                        <StatusBadge status={trip.status} dot={false} className="text-[0.54rem]" />
                      </div>
                      <p className="mt-1 text-[0.74rem] font-medium text-text-soft">{trip.origin} → {trip.destination}</p>
                      <p className="mt-0.5 text-[0.62rem] text-muted">{trip.trip_no} · {trip.vehicle_plate || t('dispatch.unassigned')} · {trip.driver_name || t('dispatch.unassigned')}</p>
                    </button>
                  ))}
                  {!dayTrips.length && !dayMaintenance.length ? <EmptyState icon={<CalendarDays size={18} />} title={t('dispatch.noTrips')} hint={t('dispatch.selectDay')} /> : null}
                </div>
              </div>
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel className="p-4">
              <SectionHeader
                title={t('dispatch.conflicts')}
                hint={t('dispatch.conflictsHint', { n: buffer })}
                action={<Badge tone={conflicts.length ? 'negative' : 'positive'}>{conflicts.length}</Badge>}
              />
              <div className="mt-3 space-y-2">
                {conflicts.length ? conflicts.map((conflict) => (
                  <div key={conflict.id} className="flex items-start gap-2.5 rounded-xl border border-negative/20 bg-negative-soft/60 px-2.5 py-2">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-negative" />
                    <div className="min-w-0">
                      <p className="text-[0.68rem] font-semibold text-text">{conflict.title}</p>
                      <p className="mt-0.5 text-[0.62rem] leading-relaxed text-muted">{conflict.detail}</p>
                    </div>
                  </div>
                )) : (
                  <div className="flex items-center gap-2 rounded-xl border border-positive/20 bg-positive-soft px-3 py-3 text-[0.7rem] font-medium text-positive">
                    <CircleCheck size={14} /> {t('dispatch.noConflicts')}
                  </div>
                )}
              </div>
            </Panel>

            <Panel className="p-4">
              <SectionHeader title={t('dispatch.unassigned')} action={<Badge tone={unassigned.length ? 'warning' : 'positive'}>{unassigned.length}</Badge>} />
              <div className="mt-3 space-y-2">
                {unassigned.length ? unassigned.slice(0, 8).map((trip) => (
                  <div key={trip.id} className="rounded-xl border border-border bg-surface-2/50 px-2.5 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[0.68rem] font-semibold text-text">{trip.trip_no}</p>
                        <p className="mt-0.5 truncate text-[0.6rem] text-muted">{formatDate(trip.scheduled_departure, language)} · {formatTime(trip.scheduled_departure, language)}</p>
                        <p className="mt-0.5 truncate text-[0.6rem] text-muted">{trip.vehicle_id ? t('trips.driver') : t('trips.vehicle')} · {trip.origin} → {trip.destination}</p>
                      </div>
                      {canManage ? (
                        <Button size="sm" variant="secondary" onClick={() => openAssign(trip)}>{t('dispatch.assign')}</Button>
                      ) : null}
                    </div>
                  </div>
                )) : (
                  <div className="flex items-center gap-2 rounded-xl border border-positive/20 bg-positive-soft px-3 py-3 text-[0.7rem] font-medium text-positive">
                    <CircleCheck size={14} /> {t('dispatch.noUnassigned')}
                  </div>
                )}
              </div>
            </Panel>

            <Panel className="p-4">
              <SectionHeader title={t('maintenance.active')} hint={t('maintenance.blocksHint')} />
              <div className="mt-3 space-y-2">
                {maintenance.length ? maintenance.map((record) => (
                  <div key={record.id} className="flex items-start gap-2 rounded-xl border border-warning/20 bg-warning-soft/60 px-2.5 py-2">
                    <Wrench size={12} className="mt-0.5 shrink-0 text-warning" />
                    <div className="min-w-0">
                      <p className="text-[0.66rem] font-semibold text-text">{record.vehicle_plate} · {record.maintenance_type}</p>
                      <p className="mt-0.5 text-[0.6rem] text-muted">{formatDate(record.start_date, language)} → {formatDate(record.end_date, language)}</p>
                    </div>
                  </div>
                )) : <p className="text-[0.68rem] text-muted">{t('maintenance.empty')}</p>}
              </div>
            </Panel>
          </div>
        </div>
      )}

      <Sheet
        open={Boolean(selectedTrip)}
        onClose={() => setSelectedTrip(null)}
        title={selectedTrip ? `${selectedTrip.trip_no} · ${selectedTrip.origin} → ${selectedTrip.destination}` : t('trips.tripDetails')}
        description={selectedTrip ? formatDate(selectedTrip.scheduled_departure, language, { weekday: 'long' }) : undefined}
        width="max-w-lg"
        footer={selectedTrip && canManage ? (
          <Button variant="primary" size="sm" onClick={() => openAssign(selectedTrip)}>{t('trips.assign')}</Button>
        ) : undefined}
      >
        {selectedTrip ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={selectedTrip.status} />
              <Badge tone={selectedTrip.trip_type === 'fixed' ? 'neutral' : 'accent'}>{t(`trips.${selectedTrip.trip_type}` as TranslationKey)}</Badge>
              <Badge tone="neutral">{money(selectedTrip.quoted_price, currency, language)}</Badge>
            </div>
            <StatStrip
              items={[
                { label: t('trips.departure'), value: formatTime(selectedTrip.scheduled_departure, language), tone: 'accent' },
                { label: t('trips.arrival'), value: formatTime(selectedTrip.expected_arrival, language) },
                { label: t('trips.recognizedRevenue'), value: money(selectedTrip.recognized_revenue, currency, language, true), tone: 'positive' },
              ]}
            />
            <Panel className="p-4">
              <div>
                <InfoRow label={t('trips.customer')} value={selectedTrip.customer_name || '—'} />
                <InfoRow label={t('trips.route')} value={language === 'ar' ? selectedTrip.route_name_ar || selectedTrip.route_name || '—' : selectedTrip.route_name || '—'} />
                <InfoRow label={t('trips.vehicle')} value={selectedTrip.vehicle_plate || t('dispatch.unassigned')} />
                <InfoRow label={t('trips.driver')} value={selectedTrip.driver_name || t('dispatch.unassigned')} />
                <InfoRow label={t('trips.origin')} value={selectedTrip.origin} />
                <InfoRow label={t('trips.destination')} value={selectedTrip.destination} />
              </div>
            </Panel>
            {!selectedTrip.vehicle_id || !selectedTrip.driver_id ? (
              <p className="rounded-xl border border-warning/20 bg-warning-soft px-3 py-2 text-[0.68rem] leading-relaxed text-warning">{t('trips.assignHint')}</p>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      <Modal
        open={Boolean(assignTrip)}
        onClose={() => setAssignTrip(null)}
        title={t('trips.assign')}
        description={t('dispatch.assignHint')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssignTrip(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={assignMutation.isPending} onClick={submitAssign}>{t('common.save')}</Button>
          </>
        }
      >
        {assignTrip ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-surface-2/60 px-3 py-2.5">
              <p className="text-[0.76rem] font-semibold text-text">{assignTrip.trip_no} · {assignTrip.origin} → {assignTrip.destination}</p>
              <p className="mt-0.5 text-[0.66rem] text-muted">{formatDate(assignTrip.scheduled_departure, language)} · {formatTime(assignTrip.scheduled_departure, language)} → {formatTime(assignTrip.expected_arrival, language)}</p>
            </div>
            <Field label={t('trips.vehicle')}>
              <Select value={assignVehicle} onChange={(event) => setAssignVehicle(event.target.value)}>
                <option value="">{t('common.unassigned')}</option>
                {vehicleOptions.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.make} {vehicle.model}{vehicle.driver_name ? ` · ${vehicle.driver_name}` : ''}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('trips.driver')}>
              <Select value={assignDriver} onChange={(event) => setAssignDriver(event.target.value)} disabled={!can('view_drivers') || Boolean(driversQuery.error)}>
                <option value="">{t('common.unassigned')}</option>
                {driverOptions.map((driver) => (
                  <option key={driver.id} value={driver.id}>{driver.full_name} · {driver.driver_no}</option>
                ))}
              </Select>
              {driversQuery.error ? <p className="mt-1 text-[0.64rem] text-negative">{errorMessage(driversQuery.error)}</p> : null}
            </Field>
            <Field label={t('trips.notes')}>
              <Textarea value={assignNote} onChange={(event) => setAssignNote(event.target.value)} rows={2} />
            </Field>
            <p className="rounded-xl border border-warning/20 bg-warning-soft px-3 py-2 text-[0.66rem] leading-relaxed text-warning">{t('trips.scheduleConflict')}</p>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
