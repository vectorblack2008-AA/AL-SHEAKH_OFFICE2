import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BadgeCheck,
  CalendarClock,
  FileText,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  Wallet,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import type { TranslationKey } from '../i18n/translations'
import { api, errorMessage } from '../lib/api'
import type {
  Contract,
  ContractDetail,
  Customer,
  FixedRoute,
  Vehicle,
} from '../lib/types'
import { formatDate, money, num, percent, todayISO, addDaysISO, monthStartISO } from '../lib/utils'
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  InfoRow,
  Input,
  Modal,
  PageHeader,
  Panel,
  Progress,
  SearchInput,
  SectionHeader,
  Select,
  Sheet,
  StatusBadge,
  TabPanel,
  Tabs,
  Textarea,
} from '../components/ui'
import { PageError, PageSkeleton, StatStrip, useDebounced } from '../components/filters'
import { CustomerModal } from '../components/CustomerModal'

interface ContractsResponse {
  data: Contract[]
  summary: { active: number; draft: number; expiring: number; contracted_value: number }
}

interface ContractForm {
  customer_id: string
  title: string
  start_date: string
  end_date: string
  contract_type: string
  contract_value: string
  unit_rate: string
  billing_frequency: string
  payment_terms: string
  payment_terms_days: string
  grace_days: string
  included_trips: string
  included_hours: string
  recognition_method: string
  status: string
  document_url: string
  notes: string
  vehicle_ids: string[]
  route_ids: string[]
  allocations: Record<string, string>
}

const CONTRACT_TYPES = ['monthly', 'annual', 'per_trip', 'per_km', 'hybrid'] as const
const BILLING_FREQUENCIES = ['monthly', 'annual', 'per_trip', 'per_km'] as const
const RECOGNITION_METHODS = ['straight_line', 'service_period', 'per_trip', 'usage'] as const
const CONTRACT_STATUSES = ['draft', 'active', 'paused', 'expired'] as const

const TYPE_LABELS: Record<string, TranslationKey> = {
  monthly: 'contracts.monthly',
  annual: 'contracts.annual',
  per_trip: 'contracts.perTrip',
  per_km: 'contracts.perKm',
  hybrid: 'contracts.hybrid',
}

const RECOGNITION_LABELS: Record<string, TranslationKey> = {
  straight_line: 'contracts.straightLine',
  service_period: 'contracts.servicePeriod',
  per_trip: 'contracts.perTrip',
  usage: 'contracts.usage',
}

function emptyForm(): ContractForm {
  return {
    customer_id: '',
    title: '',
    start_date: todayISO(),
    end_date: addDaysISO(todayISO(), 364),
    contract_type: 'monthly',
    contract_value: '0',
    unit_rate: '',
    billing_frequency: 'monthly',
    payment_terms: '',
    payment_terms_days: '30',
    grace_days: '0',
    included_trips: '',
    included_hours: '',
    recognition_method: 'straight_line',
    status: 'draft',
    document_url: '',
    notes: '',
    vehicle_ids: [],
    route_ids: [],
    allocations: {},
  }
}

function formFromContract(contract: Contract): ContractForm {
  const allocations: Record<string, string> = {}
  for (const vehicle of contract.vehicles ?? []) {
    allocations[vehicle.id] = String(vehicle.allocation_percent ?? 0)
  }
  return {
    customer_id: contract.customer_id,
    title: contract.title,
    start_date: contract.start_date?.slice(0, 10) ?? todayISO(),
    end_date: contract.end_date?.slice(0, 10) ?? addDaysISO(todayISO(), 364),
    contract_type: contract.contract_type,
    contract_value: String(contract.contract_value ?? 0),
    unit_rate: contract.unit_rate === null || contract.unit_rate === undefined ? '' : String(contract.unit_rate),
    billing_frequency: contract.billing_frequency,
    payment_terms: contract.payment_terms ?? '',
    payment_terms_days: String(contract.payment_terms_days ?? 30),
    grace_days: String(contract.grace_days ?? 0),
    included_trips: contract.included_trips === null || contract.included_trips === undefined ? '' : String(contract.included_trips),
    included_hours: contract.included_hours === null || contract.included_hours === undefined ? '' : String(contract.included_hours),
    recognition_method: contract.recognition_method,
    status: contract.status,
    document_url: contract.document_url ?? '',
    notes: contract.notes ?? '',
    vehicle_ids: (contract.vehicles ?? []).map((vehicle) => vehicle.id),
    route_ids: (contract.routes ?? []).map((route) => route.id),
    allocations,
  }
}

export function ContractsPage() {
  const { t, language, currency, can } = useApp()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [customerId, setCustomerId] = useState('')
  const debounced = useDebounced(search)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Contract | null>(null)
  const [form, setForm] = useState<ContractForm>(emptyForm)
  const [customerModalOpen, setCustomerModalOpen] = useState(false)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'overview' | 'recognitions' | 'invoices' | 'trips'>('overview')
  const [archiveTarget, setArchiveTarget] = useState<Contract | null>(null)
  const [invoiceTarget, setInvoiceTarget] = useState<Contract | null>(null)
  const [invoicePeriod, setInvoicePeriod] = useState({ from: monthStartISO(), to: todayISO() })

  const listQuery = useQuery({
    queryKey: ['contracts', debounced, status, customerId],
    queryFn: () =>
      api.get<ContractsResponse>('/api/contracts', {
        search: debounced,
        status,
        customerId,
      }),
  })

  const customersQuery = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<{ data: Customer[] }>('/api/customers'),
  })

  const vehiclesQuery = useQuery({
    queryKey: ['contracts', 'vehicle-options'],
    queryFn: () => api.get<{ data: Vehicle[] }>('/api/vehicles', { pageSize: 200 }),
    enabled: formOpen && can('view_fleet'),
  })

  const routesQuery = useQuery({
    queryKey: ['contracts', 'route-options'],
    queryFn: () => api.get<{ data: FixedRoute[] }>('/api/routes'),
    enabled: formOpen && can('view_routes'),
  })

  const detailQuery = useQuery({
    queryKey: ['contracts', 'detail', detailId],
    queryFn: () => api.get<ContractDetail>(`/api/contracts/${detailId}`),
    enabled: Boolean(detailId),
  })

  const rows = listQuery.data?.data ?? []
  const summary = listQuery.data?.summary
  const customers = customersQuery.data?.data ?? []
  const vehicles = vehiclesQuery.data?.data ?? []
  const routes = routesQuery.data?.data ?? []
  const detail = detailQuery.data

  const allocationTotal = useMemo(
    () => form.vehicle_ids.reduce((total, id) => total + num(form.allocations[id]), 0),
    [form.vehicle_ids, form.allocations],
  )

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing ? api.patch(`/api/contracts/${editing.id}`, payload) : api.post('/api/contracts', payload),
    onSuccess: () => {
      toast.success(t('common.saved'))
      setFormOpen(false)
      setEditing(null)
      setForm(emptyForm())
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/contracts/${id}/archive`),
    onSuccess: () => {
      toast.success(t('common.deleted'))
      setArchiveTarget(null)
      setDetailId(null)
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  const recognizeMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<{ posted: number; skipped: number; financials: Record<string, unknown> }>(`/api/contracts/${id}/recognize`),
    onSuccess: (result) => {
      toast.success(t('contracts.recognizeRevenue'), `${result.posted} · ${t('common.total')}`)
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  const invoiceMutation = useMutation({
    mutationFn: (contract: Contract) =>
      api.post<{ id: string; invoiceNo: string; total: number }>(`/api/contracts/${contract.id}/invoice`, {
        period_start: invoicePeriod.from,
        period_end: invoicePeriod.to,
      }),
    onSuccess: (result) => {
      toast.success(t('contracts.generateInvoice'), `${result.invoiceNo} · ${money(result.total, currency, language)}`)
      setInvoiceTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      void queryClient.invalidateQueries({ queryKey: ['revenue'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  const canManage = can('manage_contracts')
  const canFinance = can('manage_finance')

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setFormOpen(true)
  }

  function openEdit(contract: Contract) {
    setEditing(contract)
    setForm(formFromContract(contract))
    setFormOpen(true)
  }

  function toggleVehicle(id: string, checked: boolean) {
    const nextIds = checked ? [...form.vehicle_ids, id] : form.vehicle_ids.filter((item) => item !== id)
    const allocations = { ...form.allocations }
    if (checked) {
      const share = Math.round((100 / Math.max(1, nextIds.length)) * 100) / 100
      for (const vehicleId of nextIds) allocations[vehicleId] = String(share)
    } else {
      delete allocations[id]
      if (nextIds.length) {
        const share = Math.round((100 / nextIds.length) * 100) / 100
        for (const vehicleId of nextIds) allocations[vehicleId] = String(share)
      }
    }
    setForm({ ...form, vehicle_ids: nextIds, allocations })
  }

  function distributeEvenly() {
    if (!form.vehicle_ids.length) return
    const share = Math.round((100 / form.vehicle_ids.length) * 100) / 100
    const allocations: Record<string, string> = {}
    for (const id of form.vehicle_ids) allocations[id] = String(share)
    setForm({ ...form, allocations })
  }

  function submit() {
    if (!form.customer_id || !form.title.trim()) {
      toast.error(t('error.validation'), t('common.required'))
      return
    }
    if (form.end_date < form.start_date || !form.start_date || !form.end_date) {
      toast.error(t('error.validation'), t('contracts.endDate'))
      return
    }
    if (allocationTotal > 100.01) {
      toast.error(t('error.validation'), t('contracts.allocationsHint'))
      return
    }
    const allocations: Record<string, number> = {}
    for (const id of form.vehicle_ids) allocations[id] = num(form.allocations[id])

    saveMutation.mutate({
      customer_id: form.customer_id,
      title: form.title.trim(),
      start_date: form.start_date,
      end_date: form.end_date,
      contract_type: form.contract_type,
      contract_value: num(form.contract_value),
      unit_rate: form.unit_rate === '' ? null : num(form.unit_rate),
      billing_frequency: form.billing_frequency,
      payment_terms: form.payment_terms.trim() || null,
      payment_terms_days: num(form.payment_terms_days),
      grace_days: num(form.grace_days),
      included_trips: form.included_trips === '' ? null : num(form.included_trips),
      included_hours: form.included_hours === '' ? null : num(form.included_hours),
      recognition_method: form.recognition_method,
      status: form.status,
      document_url: form.document_url.trim() || null,
      notes: form.notes.trim() || null,
      vehicle_ids: form.vehicle_ids,
      route_ids: form.route_ids,
      allocations,
    })
  }

  function openInvoice(contract: Contract) {
    setInvoiceTarget(contract)
    setInvoicePeriod({ from: monthStartISO(), to: todayISO() })
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${t('nav.commercial')} · ${t('nav.contracts')}`}
        title={t('contracts.title')}
        subtitle={t('contracts.subtitle')}
        actions={
          <>
            <IconButton label={t('common.refresh')} variant="secondary" onClick={() => void listQuery.refetch()}>
              <RefreshCw size={15} className={listQuery.isFetching ? 'animate-spin' : ''} />
            </IconButton>
            {canManage ? (
              <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>{t('contracts.addContract')}</Button>
            ) : null}
          </>
        }
      />

      {summary ? (
        <StatStrip
          items={[
            { label: t('contracts.activeContracts'), value: num(summary.active), hint: `${num(summary.draft)} ${t('common.draft')}`, tone: 'positive' },
            { label: t('contracts.contractedValue'), value: money(summary.contracted_value, currency, language, true), tone: 'accent' },
            { label: t('contracts.expiringSoon'), value: num(summary.expiring), hint: t('common.days') + ' ≤ 60', tone: summary.expiring > 0 ? 'warning' : 'default' },
            { label: t('common.total'), value: num(rows.length), hint: t('common.contract') },
          ]}
        />
      ) : null}

      <Panel className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} className="w-full sm:w-64" placeholder={t('common.searchPlaceholder')} />
          <Select value={status} onChange={(event) => setStatus(event.target.value)} className="w-auto min-w-[9rem]">
            <option value="">{t('common.all')} · {t('common.status')}</option>
            {CONTRACT_STATUSES.map((item) => <option key={item} value={item}>{t(`status.${item}` as TranslationKey)}</option>)}
          </Select>
          <Select value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="w-auto min-w-[11rem]">
            <option value="">{t('common.all')} · {t('contracts.customer')}</option>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </Select>
          <Button variant="secondary" size="sm" icon={<UserPlus size={13} />} className="ms-auto" onClick={() => setCustomerModalOpen(true)} disabled={!canManage}>
            {t('customer.addCustomer')}
          </Button>
        </div>
      </Panel>

      {listQuery.isLoading ? (
        <PageSkeleton rows={6} />
      ) : listQuery.error ? (
        <PageError error={listQuery.error} onRetry={() => void listQuery.refetch()} />
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<FileText size={20} />}
            title={t('contracts.empty')}
            hint={t('contracts.emptyHint')}
            action={canManage ? <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>{t('contracts.addContract')}</Button> : undefined}
          />
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="scroll-x">
            <table className="data-table min-w-[1120px]">
              <thead>
                <tr>
                  <th>{t('contracts.contractNo')} / {t('contracts.titleField')}</th>
                  <th>{t('contracts.customer')}</th>
                  <th>{t('common.period')}</th>
                  <th className="text-end">{t('contracts.contractValue')}</th>
                  <th className="text-end">{t('contracts.recognized')}</th>
                  <th className="text-end">{t('contracts.invoiced')}</th>
                  <th className="text-end">{t('contracts.outstanding')}</th>
                  <th>{t('common.status')}</th>
                  <th className="text-end">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((contract) => (
                  <tr key={contract.id}>
                    <td>
                      <button type="button" className="block text-start" onClick={() => { setDetailId(contract.id); setDetailTab('overview') }}>
                        <span className="block text-[0.76rem] font-semibold text-text">{contract.title}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[0.62rem] text-muted">
                          {contract.contract_no}
                          {contract.renewal_due ? <Badge tone="warning">{t('contracts.renewalDue')}</Badge> : null}
                        </span>
                      </button>
                    </td>
                    <td className="text-[0.71rem] text-text-soft">{contract.customer_name}</td>
                    <td className="whitespace-nowrap text-[0.68rem] tabular text-muted">
                      {formatDate(contract.start_date, language)} — {formatDate(contract.end_date, language)}
                    </td>
                    <td className="text-end tabular text-[0.72rem]">{money(contract.contract_value, currency, language, true)}</td>
                    <td className="text-end tabular text-[0.72rem] text-positive">{money(contract.recognized, currency, language, true)}</td>
                    <td className="text-end tabular text-[0.72rem]">{money(contract.invoiced, currency, language, true)}</td>
                    <td className={`text-end tabular text-[0.72rem] ${num(contract.outstanding) > 0 ? 'text-warning' : 'text-muted'}`}>
                      {money(contract.outstanding, currency, language, true)}
                    </td>
                    <td><StatusBadge status={contract.status} /></td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <IconButton label={t('common.view')} size="sm" onClick={() => { setDetailId(contract.id); setDetailTab('overview') }}><Search size={13} /></IconButton>
                        {canManage ? <IconButton label={t('common.edit')} size="sm" onClick={() => openEdit(contract)}><Pencil size={13} /></IconButton> : null}
                        {canFinance && contract.status === 'active' ? (
                          <IconButton label={t('contracts.generateInvoice')} size="sm" onClick={() => openInvoice(contract)}><Receipt size={13} /></IconButton>
                        ) : null}
                        {canManage ? <IconButton label={t('common.archive')} size="sm" variant="danger" onClick={() => setArchiveTarget(contract)}><Trash2 size={13} /></IconButton> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Create / edit */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('contracts.editContract') : t('contracts.addContract')}
        description={t('contracts.subtitle')}
        size="2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={saveMutation.isPending} onClick={submit}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('contracts.customer')} required>
              <div className="flex gap-1.5">
                <Select value={form.customer_id} onChange={(event) => setForm({ ...form, customer_id: event.target.value })}>
                  <option value="">{t('revenue.selectCustomer')}</option>
                  {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.customer_no}</option>)}
                </Select>
                <IconButton label={t('customer.addCustomer')} size="sm" variant="secondary" onClick={() => setCustomerModalOpen(true)}><UserPlus size={13} /></IconButton>
              </div>
            </Field>
            <Field label={t('contracts.titleField')} required className="lg:col-span-2">
              <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </Field>
            <Field label={t('contracts.startDate')} required><Input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} /></Field>
            <Field label={t('contracts.endDate')} required><Input type="date" min={form.start_date} value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} /></Field>
            <Field label={t('common.status')}>
              <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                {CONTRACT_STATUSES.map((item) => <option key={item} value={item}>{t(`status.${item}` as TranslationKey)}</option>)}
              </Select>
            </Field>
            <Field label={t('contracts.contractType')}>
              <Select value={form.contract_type} onChange={(event) => setForm({ ...form, contract_type: event.target.value })}>
                {CONTRACT_TYPES.map((item) => <option key={item} value={item}>{t(TYPE_LABELS[item])}</option>)}
              </Select>
            </Field>
            <Field label={t('contracts.contractValue')}>
              <Input type="number" min={0} step="0.01" value={form.contract_value} onChange={(event) => setForm({ ...form, contract_value: event.target.value })} />
            </Field>
            <Field label={t('contracts.unitRate')}>
              <Input type="number" min={0} step="0.01" value={form.unit_rate} placeholder={t('common.optional')} onChange={(event) => setForm({ ...form, unit_rate: event.target.value })} />
            </Field>
            <Field label={t('contracts.billingFrequency')}>
              <Select value={form.billing_frequency} onChange={(event) => setForm({ ...form, billing_frequency: event.target.value })}>
                {BILLING_FREQUENCIES.map((item) => <option key={item} value={item}>{t(TYPE_LABELS[item])}</option>)}
              </Select>
            </Field>
            <Field label={t('contracts.recognitionMethod')}>
              <Select value={form.recognition_method} onChange={(event) => setForm({ ...form, recognition_method: event.target.value })}>
                {RECOGNITION_METHODS.map((item) => <option key={item} value={item}>{t(RECOGNITION_LABELS[item])}</option>)}
              </Select>
            </Field>
            <Field label={t('contracts.paymentTermsDays')}>
              <Input type="number" min={0} max={365} value={form.payment_terms_days} onChange={(event) => setForm({ ...form, payment_terms_days: event.target.value })} />
            </Field>
            <Field label={t('contracts.graceDays')}>
              <Input type="number" min={0} max={365} value={form.grace_days} onChange={(event) => setForm({ ...form, grace_days: event.target.value })} />
            </Field>
            <Field label={t('contracts.includedTrips')}>
              <Input type="number" min={0} value={form.included_trips} placeholder={t('common.optional')} onChange={(event) => setForm({ ...form, included_trips: event.target.value })} />
            </Field>
            <Field label={t('contracts.includedHours')}>
              <Input type="number" min={0} step="0.5" value={form.included_hours} placeholder={t('common.optional')} onChange={(event) => setForm({ ...form, included_hours: event.target.value })} />
            </Field>
            <Field label={t('contracts.paymentTerms')} className="sm:col-span-2 lg:col-span-3">
              <Input value={form.payment_terms} onChange={(event) => setForm({ ...form, payment_terms: event.target.value })} />
            </Field>
            <Field label={t('common.notes')} className="sm:col-span-2 lg:col-span-3">
              <Textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </Field>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="p-4">
              <SectionHeader
                title={t('contracts.vehicles')}
                hint={t('contracts.addVehiclesHint')}
                action={<Button variant="ghost" size="sm" onClick={distributeEvenly} disabled={!form.vehicle_ids.length}>{percent(100 / Math.max(1, form.vehicle_ids.length), 1, language)}</Button>}
              />
              <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pe-1">
                {vehicles.map((vehicle) => {
                  const checked = form.vehicle_ids.includes(vehicle.id)
                  return (
                    <div key={vehicle.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/40 px-2.5 py-2">
                      <Checkbox checked={checked} onChange={(next) => toggleVehicle(vehicle.id, next)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.72rem] font-medium text-text">{vehicle.plate}</p>
                        <p className="truncate text-[0.6rem] text-muted">{vehicle.make} {vehicle.model} · {vehicle.category}</p>
                      </div>
                      {checked ? (
                        <div className="flex w-20 items-center gap-1">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step="0.5"
                            value={form.allocations[vehicle.id] ?? ''}
                            onChange={(event) => setForm({ ...form, allocations: { ...form.allocations, [vehicle.id]: event.target.value } })}
                            className="h-7 px-1.5 text-end text-[0.66rem]"
                          />
                          <span className="text-[0.6rem] text-muted">%</span>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                {!vehicles.length ? <p className="text-[0.7rem] text-muted">{t('common.noData')}</p> : null}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[0.64rem] text-muted">{t('contracts.allocations')}</span>
                <span className={allocationTotal > 100.01 ? 'text-[0.66rem] font-semibold tabular text-negative' : 'text-[0.66rem] font-semibold tabular text-text'}>
                  {percent(allocationTotal, 1, language)} / 100%
                </span>
              </div>
              <Progress value={allocationTotal} tone={allocationTotal > 100.01 ? 'negative' : 'accent'} className="mt-1.5" />
            </Panel>

            <Panel className="p-4">
              <SectionHeader title={t('contracts.routes')} hint={t('contracts.addRoutesHint')} />
              <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pe-1">
                {routes.map((route) => (
                  <div key={route.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/40 px-2.5 py-2">
                    <Checkbox
                      checked={form.route_ids.includes(route.id)}
                      onChange={(checked) =>
                        setForm({
                          ...form,
                          route_ids: checked ? [...form.route_ids, route.id] : form.route_ids.filter((id) => id !== route.id),
                        })
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.72rem] font-medium text-text">{language === 'ar' ? route.name_ar : route.name_en}</p>
                      <p className="truncate text-[0.6rem] text-muted">{route.route_no} · {route.origin} → {route.destination}</p>
                    </div>
                  </div>
                ))}
                {!routes.length ? <p className="text-[0.7rem] text-muted">{t('common.noData')}</p> : null}
              </div>
            </Panel>
          </div>
        </div>
      </Modal>

      {/* Detail sheet */}
      <Sheet
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        width="max-w-3xl"
        title={detail?.contract.title ?? t('contracts.title')}
        description={detail ? `${detail.contract.contract_no} · ${detail.contract.customer_name}` : undefined}
        footer={
          detail ? (
            <>
              {canManage ? (
                <Button variant="secondary" size="sm" icon={<Pencil size={13} />} onClick={() => { const contract = detail.contract as unknown as Contract; setDetailId(null); openEdit(contract) }}>{t('common.edit')}</Button>
              ) : null}
              {canManage ? (
                <Button variant="secondary" size="sm" icon={<BadgeCheck size={13} />} loading={recognizeMutation.isPending} onClick={() => recognizeMutation.mutate(detail.contract.id)}>
                  {t('contracts.recognizeRevenue')}
                </Button>
              ) : null}
              {canFinance && detail.contract.status === 'active' ? (
                <Button variant="primary" size="sm" icon={<Receipt size={13} />} onClick={() => openInvoice(detail.contract as unknown as Contract)}>
                  {t('contracts.generateInvoice')}
                </Button>
              ) : null}
              {canManage ? (
                <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => setArchiveTarget(detail.contract as unknown as Contract)}>{t('common.archive')}</Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        {detailQuery.isLoading ? (
          <PageSkeleton rows={5} />
        ) : detailQuery.error ? (
          <PageError error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />
        ) : detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.contract.status} />
              <Badge tone="accent">{t(TYPE_LABELS[detail.contract.contract_type] ?? 'contracts.monthly')}</Badge>
              <Badge tone="neutral">{formatDate(detail.contract.start_date, language)} — {formatDate(detail.contract.end_date, language)}</Badge>
              {num(detail.contract.days_to_expiry) <= 60 && num(detail.contract.days_to_expiry) >= 0 ? (
                <Badge tone="warning" dot>{t('contracts.expiryNotice', { n: detail.contract.days_to_expiry })}</Badge>
              ) : null}
            </div>

            <StatStrip
              items={[
                { label: t('contracts.recognized'), value: money(detail.financials.recognized, currency, language, true), tone: 'positive' },
                { label: t('contracts.invoiced'), value: money(detail.financials.invoiced, currency, language, true) },
                { label: t('contracts.collected'), value: money(detail.financials.collected, currency, language, true), tone: 'positive' },
                { label: t('contracts.outstanding'), value: money(detail.financials.outstanding, currency, language, true), tone: num(detail.financials.outstanding) > 0 ? 'warning' : 'default' },
                { label: t('contracts.profit'), value: money(detail.financials.profit, currency, language, true), tone: num(detail.financials.profit) >= 0 ? 'positive' : 'negative' },
              ]}
            />

            <Tabs
              value={detailTab}
              onChange={(value) => setDetailTab(value)}
              items={[
                { value: 'overview', label: t('common.details') },
                { value: 'recognitions', label: t('contracts.recognitionEntries'), count: detail.recognitions.length },
                { value: 'invoices', label: t('contracts.invoices'), count: detail.invoices.length },
                { value: 'trips', label: t('contracts.trips'), count: detail.trips.length },
              ]}
            />

            {detailTab === 'overview' ? (
              <TabPanel className="space-y-4">
                <Panel className="p-4">
                  <SectionHeader title={t('contracts.financials')} hint={t('contracts.recognitionHint')} />
                  <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
                    <div>
                      <InfoRow label={t('contracts.contractNo')} value={detail.contract.contract_no} />
                      <InfoRow label={t('contracts.customer')} value={detail.contract.customer_name} />
                      <InfoRow label={t('customer.contactName')} value={detail.contract.contact_name || '—'} />
                      <InfoRow label={t('customer.phone')} value={detail.contract.customer_phone || '—'} />
                      <InfoRow label={t('contracts.contractValue')} value={money(detail.contract.contract_value, currency, language)} />
                      <InfoRow label={t('contracts.billingFrequency')} value={t(TYPE_LABELS[detail.contract.billing_frequency] ?? 'contracts.monthly')} />
                      <InfoRow label={t('contracts.recognitionMethod')} value={t(RECOGNITION_LABELS[detail.contract.recognition_method] ?? 'contracts.straightLine')} />
                    </div>
                    <div>
                      <InfoRow label={t('contracts.fixedRevenue')} value={money(detail.financials.fixed_revenue, currency, language)} />
                      <InfoRow label={t('contracts.variableRevenue')} value={money(detail.financials.variable_revenue, currency, language)} />
                      <InfoRow label={t('contracts.allocatedCosts')} value={money(detail.financials.allocated_costs, currency, language)} />
                      <InfoRow label={t('contracts.paymentTermsDays')} value={`${detail.contract.payment_terms_days} ${t('common.days')}`} />
                      <InfoRow label={t('contracts.graceDays')} value={`${detail.contract.grace_days} ${t('common.days')}`} />
                      <InfoRow label={t('contracts.paymentTerms')} value={detail.contract.payment_terms || '—'} />
                      <InfoRow label={t('contracts.daysToExpiry')} value={num(detail.contract.days_to_expiry) >= 0 ? detail.contract.days_to_expiry : t('status.expired')} />
                    </div>
                  </div>
                </Panel>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Panel className="p-4">
                    <SectionHeader title={t('contracts.vehicles')} hint={`${detail.vehicles.length}`} />
                    <div className="mt-2 space-y-1.5">
                      {detail.vehicles.map((vehicle) => (
                        <div key={vehicle.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2/50 px-2.5 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-[0.7rem] font-semibold text-text">{vehicle.plate}</p>
                            <p className="truncate text-[0.6rem] text-muted">{vehicle.make} {vehicle.model}</p>
                          </div>
                          <Badge tone="accent">{percent(vehicle.allocation_percent, 1, language)}</Badge>
                        </div>
                      ))}
                      {!detail.vehicles.length ? <p className="text-[0.7rem] text-muted">{t('common.noData')}</p> : null}
                    </div>
                  </Panel>
                  <Panel className="p-4">
                    <SectionHeader title={t('contracts.routes')} hint={`${detail.routes.filter(Boolean).length}`} />
                    <div className="mt-2 space-y-1.5">
                      {detail.routes.filter(Boolean).map((route) => (
                        <div key={route.id} className="rounded-lg border border-border bg-surface-2/50 px-2.5 py-2">
                          <p className="truncate text-[0.7rem] font-semibold text-text">{language === 'ar' ? route.name_ar : route.name_en}</p>
                          <p className="truncate text-[0.6rem] text-muted">{route.route_no} · {route.origin} → {route.destination}</p>
                        </div>
                      ))}
                      {!detail.routes.filter(Boolean).length ? <p className="text-[0.7rem] text-muted">{t('common.noData')}</p> : null}
                    </div>
                  </Panel>
                </div>
                {detail.contract.notes ? (
                  <p className="rounded-xl border border-border bg-surface-2/50 px-3 py-2.5 text-[0.72rem] leading-relaxed text-muted">{detail.contract.notes}</p>
                ) : null}
              </TabPanel>
            ) : null}

            {detailTab === 'recognitions' ? (
              <TabPanel>
                {detail.recognitions.length ? (
                  <div className="scroll-x">
                    <table className="data-table min-w-[560px]">
                      <thead>
                        <tr>
                          <th>{t('common.period')}</th>
                          <th>{t('common.type')}</th>
                          <th className="text-end">{t('common.amount')}</th>
                          <th>{t('common.status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.recognitions.map((entry) => (
                          <tr key={entry.id}>
                            <td className="whitespace-nowrap text-[0.7rem] tabular">{formatDate(entry.period_start, language)} — {formatDate(entry.period_end, language)}</td>
                            <td className="text-[0.68rem] text-muted">{entry.recognition_type.replace(/_/g, ' ')}</td>
                            <td className="text-end tabular text-[0.72rem] font-semibold text-positive">{money(entry.amount, currency, language)}</td>
                            <td><StatusBadge status={entry.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Panel><EmptyState icon={<Sparkles size={20} />} title={t('common.noData')} hint={t('contracts.recognitionHint')} /></Panel>
                )}
              </TabPanel>
            ) : null}

            {detailTab === 'invoices' ? (
              <TabPanel>
                {detail.invoices.length ? (
                  <div className="scroll-x">
                    <table className="data-table min-w-[560px]">
                      <thead>
                        <tr>
                          <th>{t('revenue.invoiceNo')}</th>
                          <th>{t('revenue.issueDate')}</th>
                          <th className="text-end">{t('revenue.total')}</th>
                          <th className="text-end">{t('revenue.paid')}</th>
                          <th>{t('common.status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.invoices.map((invoice) => (
                          <tr key={invoice.id}>
                            <td className="text-[0.72rem] font-semibold text-text">{invoice.invoice_no}</td>
                            <td className="text-[0.7rem] tabular text-muted">{formatDate(invoice.issue_date, language)}</td>
                            <td className="text-end tabular text-[0.72rem]">{money(invoice.total, currency, language)}</td>
                            <td className="text-end tabular text-[0.72rem] text-positive">{money(invoice.amount_paid, currency, language)}</td>
                            <td><StatusBadge status={invoice.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Panel><EmptyState icon={<Receipt size={20} />} title={t('common.noData')} hint={t('contracts.generateInvoice')} /></Panel>
                )}
              </TabPanel>
            ) : null}

            {detailTab === 'trips' ? (
              <TabPanel>
                {detail.trips.length ? (
                  <div className="scroll-x">
                    <table className="data-table min-w-[620px]">
                      <thead>
                        <tr>
                          <th>{t('trips.tripNo')}</th>
                          <th>{t('common.date')}</th>
                          <th>{t('routes.destination')}</th>
                          <th>{t('common.vehicle')}</th>
                          <th className="text-end">{t('common.revenue')}</th>
                          <th>{t('common.status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.trips.map((trip) => (
                          <tr key={trip.id}>
                            <td className="text-[0.7rem] font-semibold text-text">{trip.trip_no}</td>
                            <td className="whitespace-nowrap text-[0.68rem] tabular text-muted">{formatDate(trip.scheduled_departure, language)}</td>
                            <td className="text-[0.7rem] text-text-soft">{trip.origin} → {trip.destination}</td>
                            <td className="text-[0.68rem] text-muted">{trip.vehicle_plate || '—'}</td>
                            <td className="text-end tabular text-[0.7rem] text-positive">{money(trip.recognized_revenue, currency, language)}</td>
                            <td><StatusBadge status={trip.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Panel><EmptyState icon={<CalendarClock size={20} />} title={t('common.noData')} /></Panel>
                )}
              </TabPanel>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      {/* Generate invoice */}
      <Modal
        open={Boolean(invoiceTarget)}
        onClose={() => setInvoiceTarget(null)}
        title={t('contracts.generateInvoice')}
        description={invoiceTarget ? `${invoiceTarget.contract_no} · ${invoiceTarget.customer_name}` : undefined}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setInvoiceTarget(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              icon={<Receipt size={14} />}
              loading={invoiceMutation.isPending}
              onClick={() => invoiceTarget && invoiceMutation.mutate(invoiceTarget)}
            >
              {t('contracts.generateInvoice')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('contracts.invoicePeriod')} required>
              <Input type="date" value={invoicePeriod.from} onChange={(event) => setInvoicePeriod({ ...invoicePeriod, from: event.target.value })} />
            </Field>
            <Field label={t('common.to')} required>
              <Input type="date" min={invoicePeriod.from} value={invoicePeriod.to} onChange={(event) => setInvoicePeriod({ ...invoicePeriod, to: event.target.value })} />
            </Field>
          </div>
          <p className="rounded-xl border border-border bg-surface-2/60 px-3 py-2.5 text-[0.7rem] leading-relaxed text-muted">
            {t('revenue.contractInvoiceHint')}
          </p>
          <div className="flex items-center gap-2 rounded-xl border border-accent/20 bg-accent-softer px-3 py-2.5">
            <Wallet size={15} className="text-accent" />
            <span className="text-[0.7rem] text-text-soft">
              {t('contracts.recognized')}: <strong className="tabular text-accent">{money(invoiceTarget?.recognized, currency, language)}</strong>
            </span>
          </div>
        </div>
      </Modal>

      <CustomerModal open={customerModalOpen} onClose={() => setCustomerModalOpen(false)} onSaved={(customer) => setForm((current) => ({ ...current, customer_id: customer.id }))} />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => archiveTarget && archiveMutation.mutate(archiveTarget.id)}
        title={t('contracts.archive')}
        description={t('contracts.archiveWarning')}
        confirmLabel={t('common.archive')}
        loading={archiveMutation.isPending}
      />
    </div>
  )
}
