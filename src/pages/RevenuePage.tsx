import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  CreditCard,
  FileText,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  Wallet,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import type { TranslationKey } from '../i18n/translations'
import { api, errorMessage } from '../lib/api'
import type {
  BusinessSettings,
  Contract,
  Customer,
  Invoice,
  InvoiceDetail,
  Payment,
  Receivable,
} from '../lib/types'
import { addDaysISO, formatDate, money, num, percent, rangeFromDays, todayISO, uuid } from '../lib/utils'
import { printDocument, escapeHtml } from '../lib/print'
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
  SearchInput,
  SectionHeader,
  Select,
  Sheet,
  StatusBadge,
  TabPanel,
  Tabs,
  Textarea,
} from '../components/ui'
import { PageError, PageSkeleton, PeriodPicker, StatStrip, useDebounced, usePageState, type DateRange } from '../components/filters'

interface InvoicesResponse {
  data: Invoice[]
  total: number
  page: number
  pageSize: number
  summary: { invoiced: number; collected: number; outstanding: number; overdue: number; overdue_count: number }
  range: DateRange
}

interface PaymentsResponse {
  data: Payment[]
  summary: { collected: number; count: number }
  range: DateRange
}

interface ReceivablesResponse {
  data: Receivable[]
  total: number
}

interface InvoiceLineForm {
  description: string
  quantity: string
  unit_price: string
  revenue_category: string
}

interface InvoiceForm {
  customer_id: string
  contract_id: string
  issue_date: string
  due_date: string
  period_start: string
  period_end: string
  tax_rate: string
  status: string
  notes: string
  lines: InvoiceLineForm[]
}

interface PaymentForm {
  amount: string
  payment_date: string
  method: string
  reference: string
  notes: string
  idempotency_key: string
}

const INVOICE_STATUSES = ['draft', 'sent', 'partial', 'paid', 'overdue', 'void'] as const
const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'cheque'] as const
const REVENUE_CATEGORIES = ['service', 'contract', 'trip'] as const

const METHOD_LABELS: Record<string, TranslationKey> = {
  cash: 'revenue.cash',
  bank_transfer: 'revenue.bankTransfer',
  card: 'revenue.card',
  cheque: 'revenue.cheque',
}

function newLine(): InvoiceLineForm {
  return { description: '', quantity: '1', unit_price: '0', revenue_category: 'service' }
}

function emptyInvoiceForm(): InvoiceForm {
  return {
    customer_id: '',
    contract_id: '',
    issue_date: todayISO(),
    due_date: addDaysISO(todayISO(), 30),
    period_start: '',
    period_end: '',
    tax_rate: '',
    status: 'sent',
    notes: '',
    lines: [newLine()],
  }
}

export function RevenuePage() {
  const { t, language, currency, can } = useApp()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [tab, setTab] = useState<'invoices' | 'payments' | 'receivables'>('invoices')
  const [range, setRange] = useState<DateRange>(() => rangeFromDays(90))
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [customerId, setCustomerId] = useState('')
  const debounced = useDebounced(search)
  const { page, pageSize, setPage } = usePageState(20)

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<InvoiceForm>(emptyInvoiceForm)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [payTarget, setPayTarget] = useState<Invoice | null>(null)
  const [paymentForm, setPaymentForm] = useState<PaymentForm>({
    amount: '',
    payment_date: todayISO(),
    method: 'bank_transfer',
    reference: '',
    notes: '',
    idempotency_key: uuid(),
  })
  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null)
  const [voidReason, setVoidReason] = useState('')

  const invoicesQuery = useQuery({
    queryKey: ['revenue', 'invoices', range.from, range.to, debounced, status, customerId, page, pageSize],
    queryFn: () =>
      api.get<InvoicesResponse>('/api/invoices', {
        from: range.from,
        to: range.to,
        search: debounced,
        status,
        customerId,
        page,
        pageSize,
      }),
    enabled: tab === 'invoices',
  })

  const paymentsQuery = useQuery({
    queryKey: ['revenue', 'payments', range.from, range.to],
    queryFn: () => api.get<PaymentsResponse>('/api/payments', { from: range.from, to: range.to }),
    enabled: tab === 'payments',
  })

  const receivablesQuery = useQuery({
    queryKey: ['revenue', 'receivables'],
    queryFn: () => api.get<ReceivablesResponse>('/api/receivables'),
    enabled: tab === 'receivables',
  })

  const customersQuery = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<{ data: Customer[] }>('/api/customers'),
    enabled: can('view_contracts'),
  })

  const contractsQuery = useQuery({
    queryKey: ['contracts', 'invoice-options'],
    queryFn: () => api.get<{ data: Contract[] }>('/api/contracts', { status: 'active' }),
    enabled: formOpen && can('view_contracts'),
  })

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<BusinessSettings>('/api/settings'),
    enabled: formOpen && can('view_settings'),
  })

  const detailQuery = useQuery({
    queryKey: ['revenue', 'invoice', detailId],
    queryFn: () => api.get<InvoiceDetail>(`/api/invoices/${detailId}`),
    enabled: Boolean(detailId),
  })

  const invoices = invoicesQuery.data?.data ?? []
  const payments = paymentsQuery.data?.data ?? []
  const receivables = receivablesQuery.data?.data ?? []
  const customers = customersQuery.data?.data ?? []
  const contracts = contractsQuery.data?.data ?? []
  const defaultTax = settingsQuery.data?.vat_rate ?? 0
  const summary = invoicesQuery.data?.summary

  const formTotals = useMemo(() => {
    const subtotal = form.lines.reduce((total, line) => total + num(line.quantity) * num(line.unit_price), 0)
    const rate = form.tax_rate === '' ? num(defaultTax) : num(form.tax_rate)
    const tax = Math.round(subtotal * rate) / 100
    return { subtotal, tax, total: subtotal + tax, rate }
  }, [form.lines, form.tax_rate, defaultTax])

  const canFinance = can('manage_finance')

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<Invoice>('/api/invoices', payload),
    onSuccess: () => {
      toast.success(t('common.saved'))
      setFormOpen(false)
      setForm(emptyInvoiceForm())
      void queryClient.invalidateQueries({ queryKey: ['revenue'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const paymentMutation = useMutation({
    mutationFn: ({ invoice, payload }: { invoice: Invoice; payload: Record<string, unknown> }) =>
      api.post(`/api/invoices/${invoice.id}/payments`, payload),
    onSuccess: () => {
      toast.success(t('revenue.recordPayment'))
      setPayTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['revenue'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const voidMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/api/invoices/${id}/void`, { reason }),
    onSuccess: () => {
      toast.success(t('common.saved'))
      setVoidTarget(null)
      setVoidReason('')
      setDetailId(null)
      void queryClient.invalidateQueries({ queryKey: ['revenue'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  function openCreate() {
    setForm(emptyInvoiceForm())
    setFormOpen(true)
  }

  function submitInvoice() {
    if (!form.customer_id || !form.lines.length) {
      toast.error(t('error.validation'), t('common.required'))
      return
    }
    const lines = form.lines
      .filter((line) => line.description.trim())
      .map((line) => ({
        description: line.description.trim(),
        quantity: num(line.quantity),
        unit_price: num(line.unit_price),
        revenue_category: line.revenue_category,
      }))
    if (!lines.length || lines.some((line) => line.quantity <= 0)) {
      toast.error(t('error.validation'), t('revenue.lines'))
      return
    }
    if (form.due_date < form.issue_date) {
      toast.error(t('error.validation'), t('revenue.dueDate'))
      return
    }
    createMutation.mutate({
      customer_id: form.customer_id,
      contract_id: form.contract_id || null,
      issue_date: form.issue_date,
      due_date: form.due_date,
      period_start: form.period_start || null,
      period_end: form.period_end || null,
      tax_rate: form.tax_rate === '' ? null : num(form.tax_rate),
      status: form.status,
      notes: form.notes.trim() || null,
      lines,
    })
  }

  function openPayment(invoice: Invoice) {
    setPayTarget(invoice)
    setPaymentForm({
      amount: String(Math.max(0, num(invoice.balance ?? num(invoice.total) - num(invoice.amount_paid)))),
      payment_date: todayISO(),
      method: 'bank_transfer',
      reference: '',
      notes: '',
      idempotency_key: uuid(),
    })
  }

  function submitPayment() {
    if (!payTarget) return
    const amount = num(paymentForm.amount)
    if (amount <= 0) {
      toast.error(t('error.validation'), t('revenue.paymentAmount'))
      return
    }
    paymentMutation.mutate({
      invoice: payTarget,
      payload: {
        amount,
        payment_date: paymentForm.payment_date,
        method: paymentForm.method,
        reference: paymentForm.reference.trim() || null,
        notes: paymentForm.notes.trim() || null,
        idempotency_key: paymentForm.idempotency_key,
      },
    })
  }

  function printInvoice(data: InvoiceDetail) {
    const invoice = data.invoice
    const settings = data.settings
    const company = language === 'ar' ? settings.company_name_ar : settings.company_name_en
    const dir = language === 'ar' ? 'rtl' : 'ltr'
    const statusLabel = t(`status.${invoice.status}` as TranslationKey)
    const rows = data.lines
      .map(
        (line) => `<tr>
          <td>${escapeHtml(line.description)}${line.revenue_category ? `<div class="muted" style="font-size:9px">${escapeHtml(line.revenue_category)}</div>` : ''}</td>
          <td class="num">${escapeHtml(line.quantity)}</td>
          <td class="num">${escapeHtml(money(line.unit_price, currency, language))}</td>
          <td class="num">${escapeHtml(money(line.line_total, currency, language))}</td>
        </tr>`,
      )
      .join('')
    const paymentRows = data.payments.length
      ? data.payments
          .map(
            (payment) => `<tr>
              <td>${escapeHtml(payment.payment_no)}</td>
              <td>${escapeHtml(formatDate(payment.payment_date, language))}</td>
              <td>${escapeHtml(t(METHOD_LABELS[payment.method] ?? 'revenue.cash'))}</td>
              <td>${escapeHtml(payment.reference || '—')}</td>
              <td class="num">${escapeHtml(money(payment.amount, currency, language))}</td>
            </tr>`,
          )
          .join('')
      : ''
    const html = `
      <div class="doc-head">
        <div class="brand">${escapeHtml(company)}<small>${escapeHtml(t('app.tagline'))}</small></div>
        <div class="doc-title">
          <h1>${escapeHtml(t('revenue.invoiceDetails'))}</h1>
          <p>${escapeHtml(invoice.invoice_no)} · <span class="badge">${escapeHtml(statusLabel)}</span></p>
        </div>
      </div>
      <div class="meta">
        <div><div class="meta-label">${escapeHtml(t('revenue.billTo'))}</div><div class="meta-value">${escapeHtml(invoice.customer_name)}</div><div class="muted">${escapeHtml(invoice.customer_tax_id || '')}</div></div>
        <div><div class="meta-label">${escapeHtml(t('revenue.issueDate'))}</div><div class="meta-value">${escapeHtml(formatDate(invoice.issue_date, language))}</div><div class="muted">${escapeHtml(t('revenue.dueDate'))}: ${escapeHtml(formatDate(invoice.due_date, language))}</div></div>
        <div><div class="meta-label">${escapeHtml(t('contracts.contractNo'))}</div><div class="meta-value">${escapeHtml(invoice.contract_no || '—')}</div><div class="muted">${escapeHtml(invoice.period_start ? `${formatDate(invoice.period_start, language)} — ${formatDate(invoice.period_end, language)}` : '')}</div></div>
      </div>
      <table>
        <thead><tr><th>${escapeHtml(t('revenue.description'))}</th><th class="num">${escapeHtml(t('revenue.quantity'))}</th><th class="num">${escapeHtml(t('revenue.unitPrice'))}</th><th class="num">${escapeHtml(t('revenue.lineTotal'))}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals">
        <div><span>${escapeHtml(t('revenue.subtotal'))}</span><span>${escapeHtml(money(invoice.subtotal, currency, language))}</span></div>
        <div><span>${escapeHtml(t('revenue.tax'))}</span><span>${escapeHtml(money(invoice.tax, currency, language))}</span></div>
        <div class="grand"><span>${escapeHtml(t('revenue.total'))}</span><span>${escapeHtml(money(invoice.total, currency, language))}</span></div>
        <div><span>${escapeHtml(t('revenue.paid'))}</span><span>${escapeHtml(money(invoice.amount_paid, currency, language))}</span></div>
        <div><span>${escapeHtml(t('revenue.balance'))}</span><span>${escapeHtml(money(invoice.balance, currency, language))}</span></div>
      </div>
      ${paymentRows ? `<div class="section-title">${escapeHtml(t('revenue.paymentHistory'))}</div><table><thead><tr><th>${escapeHtml(t('revenue.paymentNo'))}</th><th>${escapeHtml(t('common.date'))}</th><th>${escapeHtml(t('revenue.method'))}</th><th>${escapeHtml(t('revenue.reference'))}</th><th class="num">${escapeHtml(t('common.amount'))}</th></tr></thead><tbody>${paymentRows}</tbody></table>` : ''}
      <div class="foot"><span>${escapeHtml(settings.company_name_en)} · ${escapeHtml(settings.company_name_ar)}</span><span>${escapeHtml(invoice.invoice_no)}</span></div>
    `
    if (!printDocument(`${invoice.invoice_no} · ${invoice.customer_name}`, html, { dir, lang: language })) {
      toast.error(t('error.generic'), t('common.print'))
    }
  }

  const activeTabs = (
    <Tabs
      value={tab}
      onChange={(value) => setTab(value)}
      items={[
        { value: 'invoices', label: t('revenue.invoices'), count: invoicesQuery.data?.total },
        { value: 'payments', label: t('revenue.payments'), count: paymentsQuery.data ? paymentsQuery.data.data.length : undefined },
        { value: 'receivables', label: t('revenue.receivables'), count: receivablesQuery.data ? receivablesQuery.data.data.length : undefined },
      ]}
    />
  )

  const headerActions = (
    <>
      <PeriodPicker value={range} onChange={setRange} />
      {canFinance ? <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>{t('revenue.addInvoice')}</Button> : null}
    </>
  )

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${t('nav.finance')} · ${t('nav.revenue')}`}
        title={t('revenue.title')}
        subtitle={t('revenue.subtitle')}
        actions={headerActions}
      />

      {summary && tab === 'invoices' ? (
        <StatStrip
          items={[
            { label: t('revenue.invoiced'), value: money(summary.invoiced, currency, language, true), tone: 'accent' },
            { label: t('revenue.collected'), value: money(summary.collected, currency, language, true), tone: 'positive' },
            { label: t('revenue.outstanding'), value: money(summary.outstanding, currency, language, true), tone: num(summary.outstanding) > 0 ? 'warning' : 'default' },
            { label: t('revenue.overdue'), value: money(summary.overdue, currency, language, true), hint: `${num(summary.overdue_count)} ${t('revenue.invoices')}`, tone: num(summary.overdue) > 0 ? 'negative' : 'default' },
          ]}
        />
      ) : null}

      {tab === 'payments' && paymentsQuery.data?.summary ? (
        <StatStrip
          items={[
            { label: t('revenue.collected'), value: money(paymentsQuery.data.summary.collected, currency, language, true), tone: 'positive' },
            { label: t('revenue.payments'), value: num(paymentsQuery.data.summary.count), hint: t('common.period') },
            { label: t('common.period'), value: `${formatDate(range.from, language)} — ${formatDate(range.to, language)}` },
          ]}
        />
      ) : null}

      {tab === 'receivables' && receivablesQuery.data ? (
        <StatStrip
          items={[
            { label: t('revenue.outstanding'), value: money(receivablesQuery.data.total, currency, language, true), tone: 'warning' },
            { label: t('revenue.customerLedger'), value: num(receivablesQuery.data.data.length), hint: t('common.customer') },
            { label: t('revenue.openInvoices'), value: num(receivablesQuery.data.data.reduce((total, row) => total + num(row.open_invoices), 0)) },
          ]}
        />
      ) : null}

      <Panel className="p-3 sm:p-4">
        {activeTabs}
        {tab === 'invoices' ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SearchInput value={search} onChange={setSearch} className="w-full sm:w-60" placeholder={t('common.searchPlaceholder')} />
            <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }} className="w-auto min-w-[9rem]">
              <option value="">{t('common.all')} · {t('common.status')}</option>
              {INVOICE_STATUSES.map((item) => <option key={item} value={item}>{t(`status.${item}` as TranslationKey)}</option>)}
            </Select>
            <Select value={customerId} onChange={(event) => { setCustomerId(event.target.value); setPage(1) }} className="w-auto min-w-[11rem]">
              <option value="">{t('common.all')} · {t('contracts.customer')}</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </Select>
            <IconButton label={t('common.refresh')} size="sm" variant="secondary" className="ms-auto" onClick={() => void invoicesQuery.refetch()}>
              <RefreshCw size={14} className={invoicesQuery.isFetching ? 'animate-spin' : ''} />
            </IconButton>
          </div>
        ) : null}
      </Panel>

      {tab === 'invoices' ? (
        invoicesQuery.isLoading ? (
          <PageSkeleton rows={6} />
        ) : invoicesQuery.error ? (
          <PageError error={invoicesQuery.error} onRetry={() => void invoicesQuery.refetch()} />
        ) : invoices.length === 0 ? (
          <Panel><EmptyState icon={<FileText size={20} />} title={t('revenue.emptyInvoices')} hint={t('revenue.emptyInvoicesHint')} action={canFinance ? <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>{t('revenue.addInvoice')}</Button> : undefined} /></Panel>
        ) : (
          <Panel className="overflow-hidden">
            <div className="scroll-x">
              <table className="data-table min-w-[1020px]">
                <thead>
                  <tr>
                    <th>{t('revenue.invoiceNo')} / {t('contracts.customer')}</th>
                    <th>{t('revenue.issueDate')}</th>
                    <th>{t('revenue.dueDate')}</th>
                    <th className="text-end">{t('revenue.total')}</th>
                    <th className="text-end">{t('revenue.paid')}</th>
                    <th className="text-end">{t('revenue.balance')}</th>
                    <th>{t('common.status')}</th>
                    <th className="text-end">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        <button type="button" className="block text-start" onClick={() => setDetailId(invoice.id)}>
                          <span className="block text-[0.74rem] font-semibold text-text">{invoice.invoice_no}</span>
                          <span className="text-[0.62rem] text-muted">{invoice.customer_name}{invoice.contract_no ? ` · ${invoice.contract_no}` : ''}</span>
                        </button>
                      </td>
                      <td className="whitespace-nowrap text-[0.7rem] tabular text-muted">{formatDate(invoice.issue_date, language)}</td>
                      <td className="whitespace-nowrap text-[0.7rem] tabular text-muted">{formatDate(invoice.due_date, language)}</td>
                      <td className="text-end tabular text-[0.72rem] font-semibold">{money(invoice.total, currency, language)}</td>
                      <td className="text-end tabular text-[0.72rem] text-positive">{money(invoice.amount_paid, currency, language)}</td>
                      <td className={`text-end tabular text-[0.72rem] ${num(invoice.balance) > 0 ? 'text-warning' : 'text-muted'}`}>{money(invoice.balance, currency, language)}</td>
                      <td><StatusBadge status={invoice.status} /></td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <IconButton label={t('common.view')} size="sm" onClick={() => setDetailId(invoice.id)}><Search size={13} /></IconButton>
                          {canFinance && num(invoice.balance) > 0 && invoice.status !== 'void' ? (
                            <IconButton label={t('revenue.recordPayment')} size="sm" onClick={() => openPayment(invoice)}><CreditCard size={13} /></IconButton>
                          ) : null}
                          {canFinance && invoice.status !== 'void' ? (
                            <IconButton label={t('revenue.voidInvoice')} size="sm" variant="danger" onClick={() => { setVoidTarget(invoice); setVoidReason('') }}><Ban size={13} /></IconButton>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {invoicesQuery.data ? (
              <div className="border-t border-border px-3">
                <Pagination page={page} pageSize={pageSize} total={invoicesQuery.data.total} onPage={setPage} />
              </div>
            ) : null}
          </Panel>
        )
      ) : null}

      {tab === 'payments' ? (
        paymentsQuery.isLoading ? (
          <PageSkeleton rows={6} />
        ) : paymentsQuery.error ? (
          <PageError error={paymentsQuery.error} onRetry={() => void paymentsQuery.refetch()} />
        ) : payments.length === 0 ? (
          <Panel><EmptyState icon={<Wallet size={20} />} title={t('revenue.emptyPayments')} hint={t('revenue.emptyPaymentsHint')} /></Panel>
        ) : (
          <Panel className="overflow-hidden">
            <div className="scroll-x">
              <table className="data-table min-w-[900px]">
                <thead>
                  <tr>
                    <th>{t('revenue.paymentNo')}</th>
                    <th>{t('revenue.invoiceNo')}</th>
                    <th>{t('contracts.customer')}</th>
                    <th>{t('revenue.paymentDate')}</th>
                    <th>{t('revenue.method')}</th>
                    <th>{t('revenue.reference')}</th>
                    <th className="text-end">{t('common.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={String(payment.id)}>
                      <td className="text-[0.72rem] font-semibold text-text">{payment.payment_no}</td>
                      <td>
                        <button type="button" className="text-[0.7rem] font-medium text-accent hover:underline" onClick={() => setDetailId(payment.invoice_id)}>
                          {payment.invoice_no}
                        </button>
                      </td>
                      <td className="text-[0.7rem] text-text-soft">{payment.customer_name}</td>
                      <td className="whitespace-nowrap text-[0.7rem] tabular text-muted">{formatDate(payment.payment_date, language)}</td>
                      <td><Badge tone="neutral">{t(METHOD_LABELS[payment.method] ?? 'revenue.cash')}</Badge></td>
                      <td className="text-[0.68rem] text-muted">{payment.reference || '—'}</td>
                      <td className="text-end tabular text-[0.72rem] font-semibold text-positive">{money(payment.amount, currency, language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )
      ) : null}

      {tab === 'receivables' ? (
        receivablesQuery.isLoading ? (
          <PageSkeleton rows={5} />
        ) : receivablesQuery.error ? (
          <PageError error={receivablesQuery.error} onRetry={() => void receivablesQuery.refetch()} />
        ) : receivables.length === 0 ? (
          <Panel><EmptyState icon={<Wallet size={20} />} title={t('revenue.emptyReceivables')} hint={t('revenue.emptyReceivablesHint')} /></Panel>
        ) : (
          <Panel className="overflow-hidden">
            <div className="scroll-x">
              <table className="data-table min-w-[820px]">
                <thead>
                  <tr>
                    <th>{t('common.customer')}</th>
                    <th className="text-end">{t('revenue.openInvoices')}</th>
                    <th className="text-end">{t('revenue.invoiced')}</th>
                    <th className="text-end">{t('revenue.collected')}</th>
                    <th className="text-end">{t('revenue.outstanding')}</th>
                    <th className="text-end">{t('revenue.overdue')}</th>
                    <th className="text-end">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {receivables.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span className="block text-[0.74rem] font-semibold text-text">{row.name}</span>
                        <span className="text-[0.62rem] text-muted">{row.customer_no}{row.phone ? ` · ${row.phone}` : ''}</span>
                      </td>
                      <td className="text-end tabular text-[0.72rem]">{num(row.open_invoices)}</td>
                      <td className="text-end tabular text-[0.72rem]">{money(row.invoiced, currency, language)}</td>
                      <td className="text-end tabular text-[0.72rem] text-positive">{money(row.collected, currency, language)}</td>
                      <td className="text-end tabular text-[0.72rem] font-semibold text-warning">{money(row.outstanding, currency, language)}</td>
                      <td className="text-end tabular text-[0.72rem] text-negative">{money(row.overdue, currency, language)}</td>
                      <td className="text-end">
                        <Button variant="ghost" size="sm" onClick={() => { setCustomerId(row.id); setTab('invoices'); setPage(1) }}>{t('revenue.customerLedger')}</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )
      ) : null}

      {/* Create invoice */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={t('revenue.newInvoice')}
        description={t('revenue.contractInvoiceHint')}
        size="2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={createMutation.isPending} onClick={submitInvoice}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('contracts.customer')} required>
              <Select value={form.customer_id} onChange={(event) => setForm({ ...form, customer_id: event.target.value, contract_id: '' })}>
                <option value="">{t('revenue.selectCustomer')}</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.customer_no}</option>)}
              </Select>
            </Field>
            <Field label={t('common.contract')}>
              <Select value={form.contract_id} onChange={(event) => setForm({ ...form, contract_id: event.target.value })}>
                <option value="">{t('common.none')}</option>
                {contracts.filter((contract) => !form.customer_id || contract.customer_id === form.customer_id).map((contract) => (
                  <option key={contract.id} value={contract.id}>{contract.contract_no} · {contract.title}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('common.status')}>
              <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                <option value="draft">{t('revenue.draft')}</option>
                <option value="sent">{t('revenue.sent')}</option>
              </Select>
            </Field>
            <Field label={t('revenue.issueDate')} required><Input type="date" value={form.issue_date} onChange={(event) => setForm({ ...form, issue_date: event.target.value, due_date: addDaysISO(event.target.value, 30) })} /></Field>
            <Field label={t('revenue.dueDate')} required><Input type="date" min={form.issue_date} value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} /></Field>
            <Field label={t('revenue.taxRate')} hint={form.tax_rate === '' ? `${t('common.optional')} · ${percent(defaultTax, 1, language)}` : undefined}>
              <Input type="number" min={0} max={100} step="0.5" value={form.tax_rate} placeholder={String(defaultTax)} onChange={(event) => setForm({ ...form, tax_rate: event.target.value })} />
            </Field>
            <Field label={t('revenue.period')}>
              <div className="grid grid-cols-2 gap-1.5">
                <Input type="date" value={form.period_start} onChange={(event) => setForm({ ...form, period_start: event.target.value })} />
                <Input type="date" min={form.period_start} value={form.period_end} onChange={(event) => setForm({ ...form, period_end: event.target.value })} />
              </div>
            </Field>
            <Field label={t('common.notes')} className="sm:col-span-2">
              <Input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </Field>
          </div>

          <Panel className="p-4">
            <SectionHeader
              title={t('revenue.lines')}
              hint={`${form.lines.length} ${t('common.count')}`}
              action={<Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={() => setForm({ ...form, lines: [...form.lines, newLine()] })}>{t('revenue.addLine')}</Button>}
            />
            <div className="mt-3 space-y-2">
              {form.lines.map((line, index) => {
                const lineTotal = num(line.quantity) * num(line.unit_price)
                return (
                  <div key={index} className="grid gap-2 rounded-xl border border-border bg-surface-2/40 p-2.5 sm:grid-cols-[minmax(0,1fr)_4.5rem_6.5rem_5.5rem_auto]">
                    <Field label={index === 0 ? t('revenue.description') : undefined}>
                      <Input value={line.description} onChange={(event) => {
                        const lines = [...form.lines]
                        lines[index] = { ...line, description: event.target.value }
                        setForm({ ...form, lines })
                      }} placeholder={t('revenue.description')} />
                    </Field>
                    <Field label={index === 0 ? t('revenue.quantity') : undefined}>
                      <Input type="number" min={0.01} step="0.01" value={line.quantity} onChange={(event) => {
                        const lines = [...form.lines]
                        lines[index] = { ...line, quantity: event.target.value }
                        setForm({ ...form, lines })
                      }} />
                    </Field>
                    <Field label={index === 0 ? t('revenue.unitPrice') : undefined}>
                      <Input type="number" min={0} step="0.01" value={line.unit_price} onChange={(event) => {
                        const lines = [...form.lines]
                        lines[index] = { ...line, unit_price: event.target.value }
                        setForm({ ...form, lines })
                      }} />
                    </Field>
                    <Field label={index === 0 ? t('common.category') : undefined}>
                      <Select value={line.revenue_category} onChange={(event) => {
                        const lines = [...form.lines]
                        lines[index] = { ...line, revenue_category: event.target.value }
                        setForm({ ...form, lines })
                      }}>
                        {REVENUE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                      </Select>
                    </Field>
                    <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end sm:justify-end">
                      <span className="text-[0.72rem] font-semibold tabular text-text">{money(lineTotal, currency, language)}</span>
                      <IconButton
                        label={t('common.delete')}
                        size="sm"
                        variant="danger"
                        disabled={form.lines.length === 1}
                        onClick={() => setForm({ ...form, lines: form.lines.filter((_, itemIndex) => itemIndex !== index) })}
                      >
                        <Trash2 size={12} />
                      </IconButton>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-4 ms-auto max-w-xs space-y-1 border-t border-border pt-3">
              <div className="flex justify-between text-[0.72rem] text-muted"><span>{t('revenue.subtotal')}</span><span className="tabular text-text">{money(formTotals.subtotal, currency, language)}</span></div>
              <div className="flex justify-between text-[0.72rem] text-muted"><span>{t('revenue.tax')} ({percent(formTotals.rate, 1, language)})</span><span className="tabular text-text">{money(formTotals.tax, currency, language)}</span></div>
              <div className="flex justify-between border-t border-border pt-1.5 text-[0.82rem] font-bold text-text"><span>{t('revenue.total')}</span><span className="tabular">{money(formTotals.total, currency, language)}</span></div>
            </div>
          </Panel>
        </div>
      </Modal>

      {/* Payment */}
      <Modal
        open={Boolean(payTarget)}
        onClose={() => setPayTarget(null)}
        title={t('revenue.recordPayment')}
        description={payTarget ? `${payTarget.invoice_no} · ${payTarget.customer_name}` : undefined}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPayTarget(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" icon={<CreditCard size={14} />} loading={paymentMutation.isPending} onClick={submitPayment}>{t('common.save')}</Button>
          </>
        }
      >
        {payTarget ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface-2/50 p-3">
              <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">{t('revenue.total')}</p><p className="mt-0.5 text-[0.9rem] font-semibold tabular text-text">{money(payTarget.total, currency, language)}</p></div>
              <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">{t('revenue.balance')}</p><p className="mt-0.5 text-[0.9rem] font-semibold tabular text-warning">{money(payTarget.balance, currency, language)}</p></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('revenue.paymentAmount')} required>
                <Input type="number" min={0.01} step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} />
              </Field>
              <Field label={t('revenue.paymentDate')} required>
                <Input type="date" value={paymentForm.payment_date} onChange={(event) => setPaymentForm({ ...paymentForm, payment_date: event.target.value })} />
              </Field>
              <Field label={t('revenue.method')}>
                <Select value={paymentForm.method} onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })}>
                  {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{t(METHOD_LABELS[method])}</option>)}
                </Select>
              </Field>
              <Field label={t('revenue.reference')}>
                <Input value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} />
              </Field>
              <Field label={t('common.notes')} className="sm:col-span-2">
                <Textarea rows={2} value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })} />
              </Field>
              <Field label={t('revenue.idempotency')} hint={t('revenue.idempotencyHint')} className="sm:col-span-2">
                <Input value={paymentForm.idempotency_key} readOnly dir="ltr" className="bg-surface-2 text-[0.66rem] text-muted" />
              </Field>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Invoice detail */}
      <Sheet
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        width="max-w-2xl"
        title={detailQuery.data?.invoice.invoice_no ?? t('revenue.invoiceDetails')}
        description={detailQuery.data ? detailQuery.data.invoice.customer_name : undefined}
        footer={
          detailQuery.data ? (
            <>
              <Button variant="secondary" size="sm" icon={<Printer size={13} />} onClick={() => printInvoice(detailQuery.data)}>{t('revenue.printInvoice')}</Button>
              {canFinance && detailQuery.data.invoice.status !== 'void' && num(detailQuery.data.invoice.balance) > 0 ? (
                <Button variant="primary" size="sm" icon={<CreditCard size={13} />} onClick={() => openPayment(detailQuery.data.invoice)}>{t('revenue.recordPayment')}</Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        {detailQuery.isLoading ? (
          <PageSkeleton rows={5} />
        ) : detailQuery.error ? (
          <PageError error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />
        ) : detailQuery.data ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detailQuery.data.invoice.status} />
              <Badge tone="accent">{money(detailQuery.data.invoice.total, currency, language)}</Badge>
              <Badge tone="neutral">{t('revenue.dueDate')}: {formatDate(detailQuery.data.invoice.due_date, language)}</Badge>
              {detailQuery.data.invoice.contract_no ? <Badge tone="info">{detailQuery.data.invoice.contract_no}</Badge> : null}
            </div>

            <StatStrip
              items={[
                { label: t('revenue.subtotal'), value: money(detailQuery.data.invoice.subtotal, currency, language, true) },
                { label: t('revenue.tax'), value: money(detailQuery.data.invoice.tax, currency, language, true) },
                { label: t('revenue.paid'), value: money(detailQuery.data.invoice.amount_paid, currency, language, true), tone: 'positive' },
                { label: t('revenue.balance'), value: money(detailQuery.data.invoice.balance, currency, language, true), tone: num(detailQuery.data.invoice.balance) > 0 ? 'warning' : 'positive' },
              ]}
            />

            <Panel className="p-4">
              <SectionHeader title={t('revenue.billTo')} />
              <div className="mt-2">
                <InfoRow label={t('common.customer')} value={detailQuery.data.invoice.customer_name} />
                <InfoRow label={t('customer.contactName')} value={detailQuery.data.invoice.contact_name || '—'} />
                <InfoRow label={t('customer.phone')} value={detailQuery.data.invoice.customer_phone || '—'} />
                <InfoRow label={t('customer.email')} value={detailQuery.data.invoice.customer_email || '—'} />
                <InfoRow label={t('customer.address')} value={detailQuery.data.invoice.customer_address || '—'} />
                <InfoRow label={t('customer.taxId')} value={detailQuery.data.invoice.customer_tax_id || '—'} />
                <InfoRow label={t('revenue.issueDate')} value={formatDate(detailQuery.data.invoice.issue_date, language)} />
                <InfoRow label={t('revenue.period')} value={detailQuery.data.invoice.period_start ? `${formatDate(detailQuery.data.invoice.period_start, language)} — ${formatDate(detailQuery.data.invoice.period_end, language)}` : '—'} />
              </div>
            </Panel>

            <Panel className="overflow-hidden">
              <div className="px-4 pt-4"><SectionHeader title={t('revenue.lines')} /></div>
              <div className="scroll-x mt-2">
                <table className="data-table min-w-[520px]">
                  <thead>
                    <tr>
                      <th>{t('revenue.description')}</th>
                      <th className="text-end">{t('revenue.quantity')}</th>
                      <th className="text-end">{t('revenue.unitPrice')}</th>
                      <th className="text-end">{t('revenue.lineTotal')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailQuery.data.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="text-[0.72rem] text-text">{line.description}<span className="ms-1.5 text-[0.6rem] text-muted">{line.revenue_category}</span></td>
                        <td className="text-end tabular text-[0.7rem]">{num(line.quantity)}</td>
                        <td className="text-end tabular text-[0.7rem]">{money(line.unit_price, currency, language)}</td>
                        <td className="text-end tabular text-[0.72rem] font-semibold">{money(line.line_total, currency, language)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel className="p-4">
              <SectionHeader title={t('revenue.paymentHistory')} hint={`${detailQuery.data.payments.length}`} />
              {detailQuery.data.payments.length ? (
                <div className="mt-2 space-y-1.5">
                  {detailQuery.data.payments.map((payment) => (
                    <div key={String(payment.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2/50 px-2.5 py-2">
                      <div className="min-w-0">
                        <p className="text-[0.7rem] font-semibold text-text">{payment.payment_no} · {t(METHOD_LABELS[payment.method] ?? 'revenue.cash')}</p>
                        <p className="text-[0.62rem] text-muted">{formatDate(payment.payment_date, language)}{payment.reference ? ` · ${payment.reference}` : ''}</p>
                      </div>
                      <span className="text-[0.74rem] font-semibold tabular text-positive">{money(payment.amount, currency, language)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[0.7rem] text-muted">{t('revenue.noPayments')}</p>
              )}
            </Panel>

            {canFinance && detailQuery.data.invoice.status !== 'void' && num(detailQuery.data.invoice.amount_paid) === 0 ? (
              <Button variant="danger" size="sm" icon={<Ban size={13} />} onClick={() => { setVoidTarget(detailQuery.data.invoice); setVoidReason('') }}>
                {t('revenue.voidInvoice')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      {/* Void invoice */}
      <Modal
        open={Boolean(voidTarget)}
        onClose={() => setVoidTarget(null)}
        title={t('revenue.voidInvoice')}
        description={voidTarget ? `${voidTarget.invoice_no} · ${voidTarget.customer_name}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoidTarget(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              loading={voidMutation.isPending}
              onClick={() => {
                if (!voidTarget) return
                if (voidReason.trim().length < 3) {
                  toast.error(t('error.validation'), t('revenue.voidReason'))
                  return
                }
                voidMutation.mutate({ id: voidTarget.id, reason: voidReason.trim() })
              }}
            >
              {t('revenue.voidInvoice')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t('revenue.voidReason')} required>
            <Textarea rows={3} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} />
          </Field>
          <p className="rounded-xl border border-warning/25 bg-warning-soft px-3 py-2 text-[0.7rem] leading-relaxed text-warning">{t('revenue.voidWarning')}</p>
        </div>
      </Modal>
    </div>
  )
}
