import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  CheckCircle2,
  CirclePlay,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Wrench,
  XCircle,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import type { TranslationKey } from '../i18n/translations'
import { api, errorMessage } from '../lib/api'
import type { MaintenanceRecord, Vehicle } from '../lib/types'
import { addDaysISO, formatDate, money, num, todayISO } from '../lib/utils'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  InfoRow,
  Input,
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

interface MaintenanceResponse {
  data: MaintenanceRecord[]
  summary: { active: string | number; completed: string | number; total_cost: string | number }
}

interface MaintenanceForm {
  vehicle_id: string
  maintenance_type: string
  description: string
  start_date: string
  end_date: string
  cost: string
  vendor: string
  odometer: string
  status: string
  notes: string
}

const TYPES = ['workshop', 'service', 'repair', 'inspection', 'tires'] as const
const STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const
const FILTER_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const

const TYPE_LABELS: Record<string, TranslationKey> = {
  workshop: 'maintenance.workshop',
  service: 'maintenance.service',
  repair: 'maintenance.repair',
  inspection: 'maintenance.inspection',
  tires: 'maintenance.tires',
}

function emptyForm(vehicleId = ''): MaintenanceForm {
  return {
    vehicle_id: vehicleId,
    maintenance_type: 'service',
    description: '',
    start_date: todayISO(),
    end_date: todayISO(),
    cost: '0',
    vendor: '',
    odometer: '',
    status: 'scheduled',
    notes: '',
  }
}

function formFromRecord(record: MaintenanceRecord): MaintenanceForm {
  return {
    vehicle_id: record.vehicle_id,
    maintenance_type: record.maintenance_type,
    description: record.description,
    start_date: record.start_date?.slice(0, 10) ?? todayISO(),
    end_date: record.end_date?.slice(0, 10) ?? todayISO(),
    cost: String(record.cost ?? 0),
    vendor: record.vendor ?? '',
    odometer: record.odometer === null || record.odometer === undefined ? '' : String(record.odometer),
    status: record.status,
    notes: record.notes ?? '',
  }
}

export function MaintenancePage() {
  const { t, language, currency, can } = useApp()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [range, setRange] = useState<DateRange>(() => ({
    from: addDaysISO(todayISO(), -90),
    to: addDaysISO(todayISO(), 60),
  }))
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const debounced = useDebounced(search)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<MaintenanceRecord | null>(null)
  const [form, setForm] = useState<MaintenanceForm>(emptyForm)
  const [detail, setDetail] = useState<MaintenanceRecord | null>(null)
  const [transition, setTransition] = useState<{ record: MaintenanceRecord; status: string } | null>(null)

  const listQuery = useQuery({
    queryKey: ['maintenance', range.from, range.to, status],
    queryFn: () =>
      api.get<MaintenanceResponse>('/api/maintenance', {
        from: range.from,
        to: range.to,
        status,
      }),
  })

  const vehiclesQuery = useQuery({
    queryKey: ['maintenance', 'vehicle-options'],
    queryFn: () => api.get<{ data: Vehicle[] }>('/api/vehicles', { pageSize: 200 }),
    enabled: can('view_fleet'),
  })

  const records = listQuery.data?.data ?? []
  const vehicles = vehiclesQuery.data?.data ?? []
  const summary = listQuery.data?.summary
  const canManage = can('manage_maintenance')

  const filtered = useMemo(() => {
    const term = debounced.trim().toLowerCase()
    return records.filter((record) => {
      if (vehicleId && record.vehicle_id !== vehicleId) return false
      if (!term) return true
      return [record.record_no, record.description, record.vehicle_plate, record.vendor, record.maintenance_type, record.expense_no]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    })
  }, [records, vehicleId, debounced])

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing ? api.patch(`/api/maintenance/${editing.id}`, payload) : api.post('/api/maintenance', payload),
    onSuccess: () => {
      toast.success(t('common.saved'))
      setFormOpen(false)
      setEditing(null)
      setForm(emptyForm())
      void queryClient.invalidateQueries({ queryKey: ['maintenance'] })
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      void queryClient.invalidateQueries({ queryKey: ['expenses'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const transitionMutation = useMutation({
    mutationFn: ({ record, status: nextStatus }: { record: MaintenanceRecord; status: string }) =>
      api.patch<MaintenanceRecord>(`/api/maintenance/${record.id}`, { status: nextStatus }),
    onSuccess: (record) => {
      toast.success(t('common.saved'), record.expense_no ? `${t('maintenance.linkedExpense')}: ${record.expense_no}` : undefined)
      setTransition(null)
      setDetail((current) => (current && current.id === record.id ? { ...current, ...record } : current))
      void queryClient.invalidateQueries({ queryKey: ['maintenance'] })
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      void queryClient.invalidateQueries({ queryKey: ['schedule'] })
      void queryClient.invalidateQueries({ queryKey: ['expenses'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  function openCreate() {
    setEditing(null)
    setForm(emptyForm(vehicles[0]?.id ?? ''))
    setFormOpen(true)
  }

  function openEdit(record: MaintenanceRecord) {
    setEditing(record)
    setForm(formFromRecord(record))
    setFormOpen(true)
  }

  function submit() {
    if (!form.vehicle_id || !form.description.trim()) {
      toast.error(t('error.validation'), t('common.required'))
      return
    }
    if (!form.start_date || !form.end_date || form.end_date < form.start_date) {
      toast.error(t('error.validation'), t('maintenance.endDate'))
      return
    }
    saveMutation.mutate({
      vehicle_id: form.vehicle_id,
      maintenance_type: form.maintenance_type,
      description: form.description.trim(),
      start_date: form.start_date,
      end_date: form.end_date,
      cost: num(form.cost),
      vendor: form.vendor.trim() || null,
      odometer: form.odometer === '' ? null : num(form.odometer),
      status: form.status,
      notes: form.notes.trim() || null,
    })
  }

  const transitionTitle = transition
    ? transition.status === 'completed'
      ? t('maintenance.completed')
      : transition.status === 'in_progress'
        ? t('maintenance.inProgress')
        : t('maintenance.cancelled')
    : ''

  const transitionDescription = transition
    ? transition.status === 'completed'
      ? t('maintenance.completeHint')
      : transition.status === 'cancelled'
        ? t('maintenance.blocksHint')
        : t('maintenance.blocksHint')
    : undefined

  const headerActions = (
    <>
      <PeriodPicker value={range} onChange={setRange} />
      {canManage ? (
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>
          {t('maintenance.addRecord')}
        </Button>
      ) : null}
    </>
  )

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${t('nav.operations')} · ${t('nav.maintenance')}`}
        title={t('maintenance.title')}
        subtitle={t('maintenance.subtitle')}
        actions={headerActions}
      />

      {summary ? (
        <StatStrip
          items={[
            { label: t('maintenance.active'), value: num(summary.active), hint: t('maintenance.blocksHint'), tone: num(summary.active) > 0 ? 'warning' : 'default' },
            { label: t('maintenance.completed'), value: num(summary.completed), tone: 'positive' },
            { label: t('maintenance.totalCost'), value: money(summary.total_cost, currency, language, true), tone: 'accent' },
            { label: t('common.period'), value: `${formatDate(range.from, language)} — ${formatDate(range.to, language)}` },
          ]}
        />
      ) : null}

      <Panel className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} className="w-full sm:w-60" placeholder={t('common.searchPlaceholder')} />
          <Select value={status} onChange={(event) => setStatus(event.target.value)} className="w-auto min-w-[9rem]">
            <option value="">{t('common.all')} · {t('common.status')}</option>
            {FILTER_STATUSES.map((item) => (
              <option key={item} value={item}>{t(`status.${item}` as TranslationKey)}</option>
            ))}
          </Select>
          {can('view_fleet') ? (
            <Select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} className="w-auto min-w-[11rem]">
              <option value="">{t('common.all')} · {t('common.vehicle')}</option>
              {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.make} {vehicle.model}</option>)}
            </Select>
          ) : null}
          <IconButton label={t('common.refresh')} size="sm" variant="secondary" className="ms-auto" onClick={() => void listQuery.refetch()}>
            <RefreshCw size={14} className={listQuery.isFetching ? 'animate-spin' : ''} />
          </IconButton>
        </div>
      </Panel>

      {listQuery.isLoading ? (
        <PageSkeleton rows={6} />
      ) : listQuery.error ? (
        <PageError error={listQuery.error} onRetry={() => void listQuery.refetch()} />
      ) : filtered.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Wrench size={20} />}
            title={t('maintenance.empty')}
            hint={t('maintenance.emptyHint')}
            action={canManage ? <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>{t('maintenance.addRecord')}</Button> : undefined}
          />
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="scroll-x">
            <table className="data-table min-w-[1050px]">
              <thead>
                <tr>
                  <th>{t('maintenance.recordNo')} / {t('maintenance.type')}</th>
                  <th>{t('common.vehicle')}</th>
                  <th>{t('common.period')}</th>
                  <th>{t('expenses.vendor')}</th>
                  <th className="text-end">{t('maintenance.cost')}</th>
                  <th>{t('maintenance.linkedExpense')}</th>
                  <th>{t('common.status')}</th>
                  <th className="text-end">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <button type="button" className="block max-w-[18rem] text-start" onClick={() => setDetail(record)}>
                        <span className="block text-[0.74rem] font-semibold text-text">{record.record_no}</span>
                        <span className="mt-0.5 block truncate text-[0.64rem] text-muted">{t(TYPE_LABELS[record.maintenance_type] ?? 'maintenance.type')} · {record.description}</span>
                      </button>
                    </td>
                    <td>
                      <span className="block text-[0.72rem] font-medium text-text">{record.vehicle_plate}</span>
                      <span className="text-[0.62rem] text-muted">{record.make} {record.model}</span>
                    </td>
                    <td className="whitespace-nowrap text-[0.68rem] tabular text-muted">
                      {formatDate(record.start_date, language)}
                      <span className="mx-1 text-border-strong">→</span>
                      {formatDate(record.end_date, language)}
                    </td>
                    <td className="text-[0.7rem] text-text-soft">{record.vendor || '—'}</td>
                    <td className="text-end tabular text-[0.72rem] font-semibold">{money(record.cost, currency, language)}</td>
                    <td>
                      {record.expense_no ? (
                        <Badge tone="positive"><Link2 size={10} /> {record.expense_no}</Badge>
                      ) : (
                        <span className="text-[0.64rem] text-muted">—</span>
                      )}
                    </td>
                    <td><StatusBadge status={record.status} /></td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {canManage && record.status === 'scheduled' ? (
                          <IconButton label={t('maintenance.inProgress')} size="sm" onClick={() => setTransition({ record, status: 'in_progress' })}><CirclePlay size={13} /></IconButton>
                        ) : null}
                        {canManage && ['scheduled', 'in_progress'].includes(record.status) ? (
                          <IconButton label={t('maintenance.completed')} size="sm" onClick={() => setTransition({ record, status: 'completed' })}><CheckCircle2 size={13} /></IconButton>
                        ) : null}
                        {canManage && ['scheduled', 'in_progress'].includes(record.status) ? (
                          <IconButton label={t('maintenance.cancelled')} size="sm" variant="danger" onClick={() => setTransition({ record, status: 'cancelled' })}><XCircle size={13} /></IconButton>
                        ) : null}
                        <IconButton label={t('common.view')} size="sm" onClick={() => setDetail(record)}><Search size={13} /></IconButton>
                        {canManage ? <IconButton label={t('common.edit')} size="sm" onClick={() => openEdit(record)}><Pencil size={13} /></IconButton> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Maintenance form */}
      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        title={editing ? t('maintenance.editRecord') : t('maintenance.addRecord')}
        description={t('maintenance.blocksHint')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setFormOpen(false); setEditing(null) }}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={saveMutation.isPending} onClick={submit}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('common.vehicle')} required>
              <Select value={form.vehicle_id} onChange={(event) => setForm({ ...form, vehicle_id: event.target.value })}>
                <option value="">{t('common.select')}</option>
                {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.make} {vehicle.model}</option>)}
              </Select>
            </Field>
            <Field label={t('maintenance.type')} required>
              <Select value={form.maintenance_type} onChange={(event) => setForm({ ...form, maintenance_type: event.target.value })}>
                {TYPES.map((type) => <option key={type} value={type}>{t(TYPE_LABELS[type])}</option>)}
              </Select>
            </Field>
            <Field label={t('common.description')} required className="sm:col-span-2">
              <Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder={t('common.description')} />
            </Field>
            <Field label={t('maintenance.startDate')} required>
              <Input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value, end_date: form.end_date < event.target.value ? event.target.value : form.end_date })} />
            </Field>
            <Field label={t('maintenance.endDate')} required>
              <Input type="date" min={form.start_date} value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} />
            </Field>
            <Field label={t('maintenance.cost')} hint={t('maintenance.completeHint')}>
              <Input type="number" min={0} step="0.01" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} />
            </Field>
            <Field label={t('maintenance.vendor')}>
              <Input value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} />
            </Field>
            <Field label={t('maintenance.odometer')}>
              <Input type="number" min={0} step="1" value={form.odometer} onChange={(event) => setForm({ ...form, odometer: event.target.value })} />
            </Field>
            <Field label={t('common.status')}>
              <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                {STATUSES.map((item) => <option key={item} value={item}>{t(`status.${item}` as TranslationKey)}</option>)}
              </Select>
            </Field>
            <Field label={t('common.notes')} className="sm:col-span-2">
              <Textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </Field>
          </div>
          {form.status === 'completed' && num(form.cost) > 0 ? (
            <p className="rounded-xl border border-positive/25 bg-positive-soft px-3 py-2 text-[0.7rem] leading-relaxed text-positive">
              {t('maintenance.completeHint')} · {money(form.cost, currency, language)}
            </p>
          ) : null}
        </div>
      </Modal>

      {/* Maintenance detail */}
      <Sheet
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? detail.record_no : undefined}
        description={detail ? `${detail.vehicle_plate} · ${detail.make} ${detail.model}` : undefined}
        footer={
          detail && canManage ? (
            <>
              {detail.status === 'scheduled' ? (
                <Button variant="secondary" size="sm" icon={<CirclePlay size={13} />} onClick={() => setTransition({ record: detail, status: 'in_progress' })}>{t('maintenance.inProgress')}</Button>
              ) : null}
              {['scheduled', 'in_progress'].includes(detail.status) ? (
                <Button variant="primary" size="sm" icon={<CheckCircle2 size={13} />} onClick={() => setTransition({ record: detail, status: 'completed' })}>{t('maintenance.completed')}</Button>
              ) : null}
              {['scheduled', 'in_progress'].includes(detail.status) ? (
                <Button variant="danger" size="sm" icon={<XCircle size={13} />} onClick={() => setTransition({ record: detail, status: 'cancelled' })}>{t('maintenance.cancelled')}</Button>
              ) : null}
              <Button variant="ghost" size="sm" icon={<Pencil size={13} />} onClick={() => { openEdit(detail); setDetail(null) }}>{t('common.edit')}</Button>
            </>
          ) : undefined
        }
      >
        {detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.status} />
              <Badge tone="accent">{t(TYPE_LABELS[detail.maintenance_type] ?? 'maintenance.type')}</Badge>
              <Badge tone="neutral">{formatDate(detail.start_date, language)} — {formatDate(detail.end_date, language)}</Badge>
            </div>

            <StatStrip
              items={[
                { label: t('maintenance.cost'), value: money(detail.cost, currency, language, true), tone: 'accent' },
                { label: t('maintenance.linkedExpense'), value: detail.expense_no || '—', tone: detail.expense_no ? 'positive' : 'default' },
                { label: t('maintenance.odometer'), value: detail.odometer !== null ? num(detail.odometer).toLocaleString() : '—' },
              ]}
            />

            <Panel className="p-4">
              <SectionHeader title={t('common.details')} />
              <div className="mt-2">
                <InfoRow label={t('common.vehicle')} value={`${detail.vehicle_plate} · ${detail.make} ${detail.model}`} />
                <InfoRow label={t('maintenance.type')} value={t(TYPE_LABELS[detail.maintenance_type] ?? 'maintenance.type')} />
                <InfoRow label={t('maintenance.vendor')} value={detail.vendor || '—'} />
                <InfoRow label={t('maintenance.startDate')} value={formatDate(detail.start_date, language)} />
                <InfoRow label={t('maintenance.endDate')} value={formatDate(detail.end_date, language)} />
                <InfoRow label={t('maintenance.linkedExpense')} value={detail.expense_no || '—'} />
              </div>
            </Panel>

            <Panel className="p-4">
              <SectionHeader title={t('common.description')} />
              <p className="mt-2 whitespace-pre-wrap text-[0.76rem] leading-relaxed text-text-soft">{detail.description}</p>
              {detail.notes ? <p className="mt-3 whitespace-pre-wrap border-t border-border pt-3 text-[0.72rem] leading-relaxed text-muted">{detail.notes}</p> : null}
            </Panel>

            {['scheduled', 'in_progress'].includes(detail.status) ? (
              <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning-soft px-3 py-2.5">
                <CalendarClock size={14} className="mt-0.5 shrink-0 text-warning" />
                <p className="text-[0.7rem] leading-relaxed text-warning">{t('maintenance.blocksHint')}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={Boolean(transition)}
        onClose={() => setTransition(null)}
        onConfirm={() => {
          if (transition) transitionMutation.mutate(transition)
        }}
        title={transitionTitle}
        description={
          <span className="space-y-2">
            <span className="block">{transitionDescription}</span>
            {transition ? <span className="block text-[0.72rem] text-muted">{transition.record.record_no} · {transition.record.vehicle_plate}</span> : null}
            {transition && transition.status === 'completed' && num(transition.record.cost) > 0 ? (
              <span className="block text-[0.72rem] font-semibold text-accent">{t('maintenance.completeHint')} · {money(transition.record.cost, currency, language)}</span>
            ) : null}
          </span>
        }
        confirmLabel={transitionTitle}
        tone={transition?.status === 'cancelled' ? 'danger' : 'primary'}
        loading={transitionMutation.isPending}
      />
    </div>
  )
}
