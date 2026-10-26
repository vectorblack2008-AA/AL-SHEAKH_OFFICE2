import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  Layers,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Trash2,
  Wrench,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import type { TranslationKey } from '../i18n/translations'
import { api, errorMessage } from '../lib/api'
import type {
  Contract,
  Driver,
  Expense,
  ExpenseAllocation,
  ExpenseCategory,
  Trip,
  Vehicle,
} from '../lib/types'
import { formatDate, money, num, percent, rangeFromDays, todayISO } from '../lib/utils'
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
  Pagination,
  Panel,
  Progress,
  SearchInput,
  SectionHeader,
  Select,
  Sheet,
  StatusBadge,
  Textarea,
} from '../components/ui'
import { PageError, PageSkeleton, PeriodPicker, StatStrip, useDebounced, usePageState, type DateRange } from '../components/filters'

interface ExpensesResponse {
  data: Expense[]
  total: number
  page: number
  pageSize: number
  summary: { total: number; operating: number; capital: number; count: number }
  byCategory: Array<{ id: string; key: string; name_en: string; name_ar: string; amount: number; count: number }>
  range: DateRange
}

type AllocationTarget = 'vehicle' | 'contract' | 'trip'

interface AllocationForm {
  target: AllocationTarget
  target_id: string
  allocated_amount: string
  method: string
  percent: string
  notes: string
}

interface ExpenseForm {
  expense_date: string
  category_id: string
  description: string
  amount: string
  vendor: string
  vehicle_id: string
  driver_id: string
  trip_id: string
  contract_id: string
  notes: string
  allocations: AllocationForm[]
}

const METHODS = ['manual', 'mileage', 'hours', 'trip_count', 'fixed'] as const
const STATUSES = ['posted', 'void'] as const

const METHOD_LABELS: Record<string, TranslationKey> = {
  mileage: 'expenses.mileage',
  hours: 'expenses.hours',
  trip_count: 'expenses.tripCount',
  fixed: 'expenses.fixed',
  manual: 'expenses.manual',
}

function emptyAllocation(): AllocationForm {
  return { target: 'vehicle', target_id: '', allocated_amount: '0', method: 'manual', percent: '', notes: '' }
}

function emptyForm(categoryId = ''): ExpenseForm {
  return {
    expense_date: todayISO(),
    category_id: categoryId,
    description: '',
    amount: '',
    vendor: '',
    vehicle_id: '',
    driver_id: '',
    trip_id: '',
    contract_id: '',
    notes: '',
    allocations: [],
  }
}

function allocationTarget(allocation: ExpenseAllocation): AllocationTarget {
  if (allocation.trip_id) return 'trip'
  if (allocation.contract_id) return 'contract'
  return 'vehicle'
}

function allocationTargetId(allocation: ExpenseAllocation): string {
  return String(allocation.trip_id || allocation.contract_id || allocation.vehicle_id || '')
}

function formFromExpense(expense: Expense): ExpenseForm {
  return {
    expense_date: expense.expense_date?.slice(0, 10) ?? todayISO(),
    category_id: expense.category_id,
    description: expense.description,
    amount: String(expense.amount ?? ''),
    vendor: expense.vendor ?? '',
    vehicle_id: expense.vehicle_id ?? '',
    driver_id: expense.driver_id ?? '',
    trip_id: expense.trip_id ?? '',
    contract_id: expense.contract_id ?? '',
    notes: expense.notes ?? '',
    allocations: (expense.allocations ?? []).map((allocation) => ({
      target: allocationTarget(allocation),
      target_id: allocationTargetId(allocation),
      allocated_amount: String(allocation.allocated_amount ?? 0),
      method: allocation.method ?? 'manual',
      percent: allocation.percent === null || allocation.percent === undefined ? '' : String(allocation.percent),
      notes: allocation.notes ?? '',
    })),
  }
}

export function ExpensesPage() {
  const { t, language, currency, can } = useApp()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [range, setRange] = useState<DateRange>(() => rangeFromDays(90))
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [status, setStatus] = useState('')
  const debounced = useDebounced(search)
  const { page, pageSize, setPage } = usePageState(20)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [form, setForm] = useState<ExpenseForm>(emptyForm)
  const [detail, setDetail] = useState<Expense | null>(null)
  const [voidTarget, setVoidTarget] = useState<Expense | null>(null)
  const [voidReason, setVoidReason] = useState('')

  const listQuery = useQuery({
    queryKey: ['expenses', range.from, range.to, debounced, categoryId, vehicleId, status, page, pageSize],
    queryFn: () =>
      api.get<ExpensesResponse>('/api/expenses', {
        from: range.from,
        to: range.to,
        search: debounced,
        categoryId,
        vehicleId,
        status,
        page,
        pageSize,
      }),
  })

  const categoriesQuery = useQuery({
    queryKey: ['expenses', 'categories'],
    queryFn: () => api.get<{ data: ExpenseCategory[] }>('/api/expense-categories'),
  })

  const vehiclesQuery = useQuery({
    queryKey: ['expenses', 'vehicle-options'],
    queryFn: () => api.get<{ data: Vehicle[] }>('/api/vehicles', { pageSize: 200 }),
    enabled: can('view_fleet'),
  })

  const driversQuery = useQuery({
    queryKey: ['expenses', 'driver-options'],
    queryFn: () => api.get<{ data: Driver[] }>('/api/drivers', { pageSize: 200 }),
    enabled: formOpen && can('view_drivers'),
  })

  const contractsQuery = useQuery({
    queryKey: ['expenses', 'contract-options'],
    queryFn: () => api.get<{ data: Contract[] }>('/api/contracts'),
    enabled: (formOpen || Boolean(detail)) && can('view_contracts'),
  })

  const tripsQuery = useQuery({
    queryKey: ['expenses', 'trip-options'],
    queryFn: () => api.get<{ data: Trip[] }>('/api/trips', { pageSize: 200 }),
    enabled: (formOpen || Boolean(detail)) && can('view_trips'),
  })

  const rows = listQuery.data?.data ?? []
  const categories = categoriesQuery.data?.data ?? []
  const vehicles = vehiclesQuery.data?.data ?? []
  const drivers = driversQuery.data?.data ?? []
  const contracts = contractsQuery.data?.data ?? []
  const trips = tripsQuery.data?.data ?? []
  const summary = listQuery.data?.summary
  const byCategory = listQuery.data?.byCategory ?? []

  const activeCategories = useMemo(() => categories.filter((category) => category.is_active), [categories])
  const selectedCategory = activeCategories.find((category) => category.id === form.category_id)
  const canManage = can('manage_expenses')

  const allocationTotal = useMemo(
    () => form.allocations.reduce((total, allocation) => total + num(allocation.allocated_amount), 0),
    [form.allocations],
  )

  const topCategory = byCategory.reduce((max, row) => Math.max(max, num(row.amount)), 0)

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing ? api.patch(`/api/expenses/${editing.id}`, payload) : api.post('/api/expenses', payload),
    onSuccess: () => {
      toast.success(t('common.saved'))
      setFormOpen(false)
      setEditing(null)
      setForm(emptyForm())
      void queryClient.invalidateQueries({ queryKey: ['expenses'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
      void queryClient.invalidateQueries({ queryKey: ['fleet'] })
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const voidMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/api/expenses/${id}/void`, { reason }),
    onSuccess: () => {
      toast.success(t('common.saved'))
      setVoidTarget(null)
      setVoidReason('')
      setDetail(null)
      void queryClient.invalidateQueries({ queryKey: ['expenses'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
      void queryClient.invalidateQueries({ queryKey: ['fleet'] })
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  function openCreate() {
    setEditing(null)
    setForm(emptyForm(activeCategories[0]?.id ?? ''))
    setFormOpen(true)
  }

  function openEdit(expense: Expense) {
    setEditing(expense)
    setForm(formFromExpense(expense))
    setFormOpen(true)
  }

  function updateAllocation(index: number, patch: Partial<AllocationForm>) {
    const allocations = [...form.allocations]
    allocations[index] = { ...allocations[index], ...patch }
    setForm({ ...form, allocations })
  }

  function submit() {
    if (!form.category_id || !form.description.trim() || num(form.amount) <= 0) {
      toast.error(t('error.validation'), t('common.required'))
      return
    }
    if (allocationTotal > num(form.amount) + 0.005) {
      toast.error(t('error.validation'), t('expenses.allocationHint'))
      return
    }
    const allocations = form.allocations
      .filter((allocation) => allocation.target_id && num(allocation.allocated_amount) > 0)
      .map((allocation) => ({
        vehicle_id: allocation.target === 'vehicle' ? allocation.target_id : null,
        contract_id: allocation.target === 'contract' ? allocation.target_id : null,
        trip_id: allocation.target === 'trip' ? allocation.target_id : null,
        allocated_amount: num(allocation.allocated_amount),
        method: allocation.method,
        percent: allocation.percent === '' ? null : num(allocation.percent),
        notes: allocation.notes.trim() || null,
      }))

    saveMutation.mutate({
      expense_date: form.expense_date,
      category_id: form.category_id,
      description: form.description.trim(),
      amount: num(form.amount),
      vendor: form.vendor.trim() || null,
      vehicle_id: form.vehicle_id || null,
      driver_id: form.driver_id || null,
      trip_id: form.trip_id || null,
      contract_id: form.contract_id || null,
      notes: form.notes.trim() || null,
      allocations,
    })
  }

  function submitVoid() {
    if (!voidTarget) return
    if (voidReason.trim().length < 3) {
      toast.error(t('error.validation'), t('expenses.voidReason'))
      return
    }
    voidMutation.mutate({ id: voidTarget.id, reason: voidReason.trim() })
  }

  function targetLabel(allocation: ExpenseAllocation): string {
    if (allocation.trip_id) {
      const trip = trips.find((item) => item.id === allocation.trip_id)
      return trip ? `${t('common.trip')} ${trip.trip_no}` : `${t('common.trip')} · ${allocation.trip_id.slice(0, 8)}`
    }
    if (allocation.contract_id) {
      const contract = contracts.find((item) => item.id === allocation.contract_id)
      return contract ? `${t('common.contract')} ${contract.contract_no}` : `${t('common.contract')} · ${allocation.contract_id.slice(0, 8)}`
    }
    const vehicle = vehicles.find((item) => item.id === allocation.vehicle_id)
    return vehicle ? `${t('common.vehicle')} ${vehicle.plate}` : `${t('common.vehicle')} · ${String(allocation.vehicle_id ?? '').slice(0, 8)}`
  }

  const headerActions = (
    <>
      <PeriodPicker value={range} onChange={(next) => { setRange(next); setPage(1) }} />
      {canManage ? (
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>
          {t('expenses.addExpense')}
        </Button>
      ) : null}
    </>
  )

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${t('nav.finance')} · ${t('nav.expenses')}`}
        title={t('expenses.title')}
        subtitle={t('expenses.subtitle')}
        actions={headerActions}
      />

      {summary ? (
        <StatStrip
          items={[
            { label: t('expenses.totalExpenses'), value: money(summary.total, currency, language, true), tone: 'accent' },
            { label: t('expenses.operating'), value: money(summary.operating, currency, language, true), hint: t('expenses.operatingHint') },
            { label: t('expenses.capital'), value: money(summary.capital, currency, language, true) },
            { label: t('expenses.expenseCount'), value: num(summary.count), hint: `${formatDate(range.from, language)} — ${formatDate(range.to, language)}` },
          ]}
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Panel className="p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1) }} className="w-full sm:w-60" placeholder={t('common.searchPlaceholder')} />
              <Select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1) }} className="w-auto min-w-[10.5rem]">
                <option value="">{t('common.all')} · {t('common.category')}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{language === 'ar' ? category.name_ar : category.name_en}</option>
                ))}
              </Select>
              {can('view_fleet') ? (
                <Select value={vehicleId} onChange={(event) => { setVehicleId(event.target.value); setPage(1) }} className="w-auto min-w-[10rem]">
                  <option value="">{t('common.all')} · {t('common.vehicle')}</option>
                  {vehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.make} {vehicle.model}</option>
                  ))}
                </Select>
              ) : null}
              <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }} className="w-auto min-w-[8.5rem]">
                <option value="">{t('common.all')} · {t('common.status')}</option>
                {STATUSES.map((item) => (
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
                icon={<ReceiptText size={20} />}
                title={t('expenses.empty')}
                hint={t('expenses.emptyHint')}
                action={canManage ? <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>{t('expenses.addExpense')}</Button> : undefined}
              />
            </Panel>
          ) : (
            <Panel className="overflow-hidden">
              <div className="scroll-x">
                <table className="data-table min-w-[1050px]">
                  <thead>
                    <tr>
                      <th>{t('expenses.expenseNo')} / {t('common.description')}</th>
                      <th>{t('common.date')}</th>
                      <th>{t('common.category')}</th>
                      <th>{t('expenses.linkedTo')}</th>
                      <th className="text-end">{t('common.amount')}</th>
                      <th>{t('common.status')}</th>
                      <th className="text-end">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((expense) => (
                      <tr key={expense.id}>
                        <td>
                          <button type="button" className="block max-w-[19rem] text-start" onClick={() => setDetail(expense)}>
                            <span className="block text-[0.74rem] font-semibold text-text">{expense.expense_no}</span>
                            <span className="mt-0.5 block truncate text-[0.64rem] text-muted">{expense.description}</span>
                          </button>
                        </td>
                        <td className="whitespace-nowrap text-[0.7rem] tabular text-muted">{formatDate(expense.expense_date, language)}</td>
                        <td>
                          <span className="block text-[0.7rem] font-medium text-text-soft">{language === 'ar' ? expense.category_name_ar : expense.category_name_en}</span>
                          <span className="text-[0.6rem] text-muted">{expense.vendor || expense.category_key}</span>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {expense.vehicle_plate ? <Badge tone="neutral">{expense.vehicle_plate}</Badge> : null}
                            {expense.contract_no ? <Badge tone="info">{expense.contract_no}</Badge> : null}
                            {expense.trip_no ? <Badge tone="accent">{expense.trip_no}</Badge> : null}
                            {expense.allocations?.length ? <Badge tone="accent">{percent((num(expense.allocations.reduce((total, item) => total + num(item.allocated_amount), 0)) / Math.max(1, num(expense.amount))) * 100, 0, language)} {t('expenses.allocations')}</Badge> : null}
                            {!expense.vehicle_plate && !expense.contract_no && !expense.trip_no && !expense.allocations?.length ? <span className="text-[0.64rem] text-muted">—</span> : null}
                          </div>
                        </td>
                        <td className="text-end tabular text-[0.74rem] font-semibold text-text">{money(expense.amount, currency, language)}</td>
                        <td>
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge status={expense.status} />
                            {expense.is_operating ? <span className="text-[0.58rem] uppercase tracking-wide text-muted">{t('expenses.operating')}</span> : <span className="text-[0.58rem] uppercase tracking-wide text-accent">{t('expenses.capital')}</span>}
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            <IconButton label={t('common.view')} size="sm" onClick={() => setDetail(expense)}><Search size={13} /></IconButton>
                            {canManage && expense.status !== 'void' ? (
                              <IconButton label={t('common.edit')} size="sm" onClick={() => openEdit(expense)}><Pencil size={13} /></IconButton>
                            ) : null}
                            {canManage && expense.status !== 'void' ? (
                              <IconButton label={t('expenses.void')} size="sm" variant="danger" onClick={() => { setVoidTarget(expense); setVoidReason('') }}><Ban size={13} /></IconButton>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {listQuery.data ? (
                <div className="border-t border-border px-3">
                  <Pagination page={page} pageSize={pageSize} total={listQuery.data.total} onPage={setPage} />
                </div>
              ) : null}
            </Panel>
          )}
        </div>

        <Panel className="h-fit p-4">
          <SectionHeader title={t('expenses.byCategory')} hint={t('expenses.operatingHint')} />
          <div className="mt-4 space-y-3">
            {byCategory.filter((row) => num(row.amount) > 0).length ? (
              byCategory
                .filter((row) => num(row.amount) > 0)
                .map((row) => (
                  <div key={row.id}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[0.72rem] font-medium text-text-soft">{language === 'ar' ? row.name_ar : row.name_en}</span>
                        <span className="shrink-0 text-[0.58rem] text-muted">{num(row.count)}</span>
                      </span>
                      <span className="shrink-0 text-[0.68rem] font-semibold tabular text-text">{money(row.amount, currency, language, true)}</span>
                    </div>
                    <Progress value={topCategory ? (num(row.amount) / topCategory) * 100 : 0} height="h-1" />
                  </div>
                ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Layers size={20} className="text-muted" />
                <p className="mt-2 text-[0.74rem] font-medium text-text">{t('common.noData')}</p>
                <p className="mt-0.5 text-[0.66rem] text-muted">{t('expenses.emptyHint')}</p>
              </div>
            )}
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <div className="flex items-center justify-between text-[0.68rem]">
              <span className="text-muted">{t('expenses.totalExpenses')}</span>
              <span className="font-semibold tabular text-accent">{money(summary?.total ?? 0, currency, language)}</span>
            </div>
          </div>
        </Panel>
      </div>

      {/* Expense form */}
      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        title={editing ? t('expenses.editExpense') : t('expenses.addExpense')}
        description={t('expenses.operatingHint')}
        size="2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setFormOpen(false); setEditing(null) }}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={saveMutation.isPending} onClick={submit}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('common.date')} required>
              <Input type="date" value={form.expense_date} max={todayISO()} onChange={(event) => setForm({ ...form, expense_date: event.target.value })} />
            </Field>
            <Field label={t('common.category')} required>
              <Select value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })}>
                <option value="">{t('common.select')}</option>
                {activeCategories.map((category) => (
                  <option key={category.id} value={category.id}>{language === 'ar' ? category.name_ar : category.name_en}{category.is_operating ? '' : ` · ${t('expenses.capital')}`}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('common.amount')} required>
              <Input type="number" min={0.01} step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
            </Field>
            <Field label={t('common.description')} required className="sm:col-span-2">
              <Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder={t('common.description')} />
            </Field>
            <Field label={t('expenses.vendor')}>
              <Input value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} />
            </Field>
            {can('view_fleet') ? (
              <Field label={t('expenses.targetVehicle')}>
                <Select value={form.vehicle_id} onChange={(event) => setForm({ ...form, vehicle_id: event.target.value })}>
                  <option value="">{t('common.none')}</option>
                  {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.make} {vehicle.model}</option>)}
                </Select>
              </Field>
            ) : null}
            {can('view_contracts') ? (
              <Field label={t('expenses.targetContract')}>
                <Select value={form.contract_id} onChange={(event) => setForm({ ...form, contract_id: event.target.value })}>
                  <option value="">{t('common.none')}</option>
                  {contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_no} · {contract.title}</option>)}
                </Select>
              </Field>
            ) : null}
            {can('view_trips') ? (
              <Field label={t('expenses.targetTrip')}>
                <Select value={form.trip_id} onChange={(event) => setForm({ ...form, trip_id: event.target.value })}>
                  <option value="">{t('common.none')}</option>
                  {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.trip_no} · {trip.origin} → {trip.destination}</option>)}
                </Select>
              </Field>
            ) : null}
            {can('view_drivers') ? (
              <Field label={t('common.driver')}>
                <Select value={form.driver_id} onChange={(event) => setForm({ ...form, driver_id: event.target.value })}>
                  <option value="">{t('common.none')}</option>
                  {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.full_name}</option>)}
                </Select>
              </Field>
            ) : null}
            <Field label={t('common.notes')} className="sm:col-span-2 lg:col-span-3">
              <Textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </Field>
          </div>

          {selectedCategory && !selectedCategory.is_operating ? (
            <p className="rounded-xl border border-info/25 bg-info-soft px-3 py-2 text-[0.7rem] leading-relaxed text-info">{t('expenses.operatingHint')}</p>
          ) : null}

          <Panel className="p-4">
            <SectionHeader
              title={t('expenses.allocations')}
              hint={t('expenses.allocationHint')}
              action={
                <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={() => setForm({ ...form, allocations: [...form.allocations, emptyAllocation()] })}>
                  {t('expenses.addAllocation')}
                </Button>
              }
            />
            <div className="mt-3 space-y-2">
              {form.allocations.length ? (
                form.allocations.map((allocation, index) => {
                  const options = allocation.target === 'vehicle' ? vehicles : allocation.target === 'contract' ? contracts : trips
                  return (
                    <div key={index} className="grid gap-2 rounded-xl border border-border bg-surface-2/40 p-2.5 sm:grid-cols-[7.5rem_minmax(0,1fr)_7rem_7.5rem_5rem_auto]">
                      <Field label={index === 0 ? t('common.type') : undefined}>
                        <Select
                          value={allocation.target}
                          onChange={(event) => updateAllocation(index, { target: event.target.value as AllocationTarget, target_id: '' })}
                        >
                          <option value="vehicle">{t('expenses.targetVehicle')}</option>
                          <option value="contract">{t('expenses.targetContract')}</option>
                          <option value="trip">{t('expenses.targetTrip')}</option>
                        </Select>
                      </Field>
                      <Field label={index === 0 ? t('common.name') : undefined}>
                        <Select value={allocation.target_id} onChange={(event) => updateAllocation(index, { target_id: event.target.value })}>
                          <option value="">{t('common.select')}</option>
                          {options.map((option) => {
                            const item = option as Vehicle & Contract & Trip
                            const label = allocation.target === 'vehicle'
                              ? `${item.plate} · ${item.make} ${item.model}`
                              : allocation.target === 'contract'
                                ? `${item.contract_no} · ${item.title}`
                                : `${item.trip_no} · ${item.origin} → ${item.destination}`
                            return <option key={item.id} value={item.id}>{label}</option>
                          })}
                        </Select>
                      </Field>
                      <Field label={index === 0 ? t('expenses.allocatedAmount') : undefined}>
                        <Input type="number" min={0} step="0.01" value={allocation.allocated_amount} onChange={(event) => updateAllocation(index, { allocated_amount: event.target.value })} />
                      </Field>
                      <Field label={index === 0 ? t('expenses.allocationMethod') : undefined}>
                        <Select value={allocation.method} onChange={(event) => updateAllocation(index, { method: event.target.value })}>
                          {METHODS.map((method) => <option key={method} value={method}>{t(METHOD_LABELS[method])}</option>)}
                        </Select>
                      </Field>
                      <Field label={index === 0 ? t('expenses.percent') : undefined}>
                        <Input type="number" min={0} max={100} step="0.1" value={allocation.percent} onChange={(event) => updateAllocation(index, { percent: event.target.value })} />
                      </Field>
                      <div className="flex items-end justify-end">
                        <IconButton label={t('common.delete')} size="sm" variant="danger" onClick={() => setForm({ ...form, allocations: form.allocations.filter((_, itemIndex) => itemIndex !== index) })}>
                          <Trash2 size={12} />
                        </IconButton>
                      </div>
                    </div>
                  )
                })
              ) : (
                <p className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-[0.7rem] text-muted">{t('expenses.allocationHint')}</p>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-[0.7rem]">
              <span className={allocationTotal > num(form.amount) + 0.005 ? 'font-semibold text-negative' : 'text-muted'}>
                {t('expenses.allocatedAmount')}: <span className="tabular">{money(allocationTotal, currency, language)}</span>
                <span className="mx-1">/</span>
                <span className="tabular">{money(num(form.amount), currency, language)}</span>
              </span>
              {num(form.amount) > 0 ? <span className="text-muted">{percent((allocationTotal / num(form.amount)) * 100, 1, language)}</span> : null}
            </div>
          </Panel>
        </div>
      </Modal>

      {/* Expense detail */}
      <Sheet
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? detail.expense_no : undefined}
        description={detail ? (language === 'ar' ? detail.category_name_ar : detail.category_name_en) : undefined}
        footer={
          detail && detail.status !== 'void' && canManage ? (
            <>
              <Button variant="secondary" size="sm" icon={<Pencil size={13} />} onClick={() => { openEdit(detail); setDetail(null) }}>{t('common.edit')}</Button>
              <Button variant="danger" size="sm" icon={<Ban size={13} />} onClick={() => { setVoidTarget(detail); setVoidReason('') }}>{t('expenses.void')}</Button>
            </>
          ) : undefined
        }
      >
        {detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.status} />
              <Badge tone="accent">{money(detail.amount, currency, language)}</Badge>
              <Badge tone={detail.is_operating ? 'positive' : 'info'}>{detail.is_operating ? t('expenses.operating') : t('expenses.capital')}</Badge>
              <Badge tone="neutral">{formatDate(detail.expense_date, language)}</Badge>
            </div>

            <StatStrip
              items={[
                { label: t('common.amount'), value: money(detail.amount, currency, language, true), tone: 'accent' },
                { label: t('expenses.allocations'), value: money((detail.allocations ?? []).reduce((total, item) => total + num(item.allocated_amount), 0), currency, language, true) },
                { label: t('expenses.expenseNo'), value: detail.expense_no },
              ]}
            />

            <Panel className="p-4">
              <SectionHeader title={t('common.details')} />
              <div className="mt-2">
                <InfoRow label={t('common.description')} value={detail.description} />
                <InfoRow label={t('expenses.vendor')} value={detail.vendor || '—'} />
                <InfoRow label={t('common.category')} value={language === 'ar' ? detail.category_name_ar : detail.category_name_en} />
                <InfoRow label={t('common.vehicle')} value={detail.vehicle_plate || '—'} />
                <InfoRow label={t('common.driver')} value={detail.driver_name || '—'} />
                <InfoRow label={t('common.contract')} value={detail.contract_no || '—'} />
                <InfoRow label={t('common.trip')} value={detail.trip_no || '—'} />
                <InfoRow label={t('common.notes')} value={detail.notes || '—'} />
                {detail.void_reason ? <InfoRow label={t('expenses.voidReason')} value={detail.void_reason} /> : null}
              </div>
            </Panel>

            <Panel className="p-4">
              <SectionHeader title={t('expenses.allocations')} hint={t('expenses.allocationHint')} />
              {detail.allocations?.length ? (
                <div className="mt-3 space-y-1.5">
                  {detail.allocations.map((allocation, index) => (
                    <div key={allocation.id ?? index} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Wrench size={13} className="shrink-0 text-accent" />
                        <div className="min-w-0">
                          <p className="truncate text-[0.7rem] font-medium text-text">{targetLabel(allocation)}</p>
                          <p className="text-[0.6rem] text-muted">{t(METHOD_LABELS[allocation.method] ?? 'expenses.manual')}{allocation.percent !== null && allocation.percent !== undefined ? ` · ${percent(allocation.percent, 1, language)}` : ''}</p>
                        </div>
                      </div>
                      <span className="text-[0.72rem] font-semibold tabular text-text">{money(allocation.allocated_amount, currency, language)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[0.7rem] text-muted">{t('common.none')}</p>
              )}
            </Panel>

            {detail.notes ? (
              <Panel className="p-4">
                <SectionHeader title={t('common.notes')} />
                <p className="mt-2 whitespace-pre-wrap text-[0.74rem] leading-relaxed text-text-soft">{detail.notes}</p>
              </Panel>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      {/* Void expense */}
      <Modal
        open={Boolean(voidTarget)}
        onClose={() => setVoidTarget(null)}
        title={t('expenses.void')}
        description={voidTarget ? `${voidTarget.expense_no} · ${money(voidTarget.amount, currency, language)}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoidTarget(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={voidMutation.isPending} onClick={submitVoid}>{t('expenses.void')}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t('expenses.voidReason')} required>
            <Textarea rows={3} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} />
          </Field>
          <p className="rounded-xl border border-warning/25 bg-warning-soft px-3 py-2 text-[0.7rem] leading-relaxed text-warning">{t('expenses.voidWarning')}</p>
        </div>
      </Modal>
    </div>
  )
}
