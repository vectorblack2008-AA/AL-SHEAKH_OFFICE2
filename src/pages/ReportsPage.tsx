import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Area,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowDownToLine,
  FileSpreadsheet,
  Printer,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import type { TranslationKey } from '../i18n/translations'
import { api, errorMessage } from '../lib/api'
import type { ReportsData } from '../lib/types'
import { downloadBlob, formatDate, money, num, percent } from '../lib/utils'
import { printDocument, escapeHtml } from '../lib/print'
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  PageHeader,
  Pagination,
  Panel,
  Popover,
  Progress,
  SectionHeader,
  StatusBadge,
  Tabs,
  usePopover,
} from '../components/ui'
import { PageError, PageSkeleton, PeriodPicker, StatStrip, type DateRange } from '../components/filters'
import {
  ChartCard,
  ChartEmpty,
  ChartTooltip,
  LegendDots,
  chartAxisStyle,
  chartGridStyle,
  useChartPalette,
} from '../components/charts'
import { rangeFromDays } from '../lib/utils'

type ReportTab = 'overview' | 'fleet' | 'routes' | 'contracts' | 'customers' | 'drivers' | 'expenses' | 'maintenance' | 'receivables'

const EXPORTS = [
  { report: 'trips', label: 'reports.tripRegister' },
  { report: 'invoices', label: 'reports.invoiceRegister' },
  { report: 'expenses', label: 'reports.expenseRegister' },
  { report: 'vehicles', label: 'reports.vehicleRegister' },
  { report: 'drivers', label: 'reports.driverRegister' },
  { report: 'maintenance', label: 'reports.maintenanceReport' },
  { report: 'payments', label: 'revenue.payments' },
] as const

function ExportOption({ report, label, from, to }: { report: string; label: TranslationKey; from: string; to: string }) {
  const { t } = useApp()
  const toast = useToast()
  const { close } = usePopover()
  const mutation = useMutation({
    mutationFn: () => api.download('/api/reports/export', { report, from, to }),
    onSuccess: ({ blob, filename }) => {
      downloadBlob(blob, filename)
      toast.success(t('common.exportCsv'), filename)
      close()
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })
  return (
    <button
      type="button"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[0.72rem] text-text-soft transition hover:bg-surface-2 hover:text-text disabled:opacity-50"
    >
      <FileSpreadsheet size={13} className="text-accent" />
      {t(label)}
      <ArrowDownToLine size={12} className="ms-auto text-muted" />
    </button>
  )
}

export function ReportsPage() {
  const { t, language, currency, can } = useApp()
  const toast = useToast()
  const palette = useChartPalette()
  const [range, setRange] = useState<DateRange>(() => rangeFromDays(90))
  const [tab, setTab] = useState<ReportTab>('overview')
  const [page, setPage] = useState(1)
  const pageSize = 15

  const reportQuery = useQuery({
    queryKey: ['reports', range.from, range.to],
    queryFn: () => api.get<ReportsData>('/api/reports', { from: range.from, to: range.to }),
  })

  const data = reportQuery.data

  const totals = useMemo(() => {
    if (!data) {
      return {
        tripRevenue: 0,
        fixedRevenue: 0,
        totalRevenue: 0,
        operatingExpenses: 0,
        allExpenses: 0,
        netProfit: 0,
        margin: 0,
        trips: 0,
        completed: 0,
        outstanding: 0,
        revenuePerTrip: 0,
        hours: 0,
      }
    }
    const tripRevenue = data.monthly.reduce((total, row) => total + num(row.revenue), 0)
    const fixedRevenue = data.contracts.reduce((total, row) => total + num(row.fixed_revenue), 0)
    const operatingExpenses = data.expenseCategories
      .filter((row) => row.is_operating)
      .reduce((total, row) => total + num(row.amount), 0)
    const allExpenses = data.expenseCategories.reduce((total, row) => total + num(row.amount), 0)
    const totalRevenue = tripRevenue + fixedRevenue
    const netProfit = totalRevenue - operatingExpenses
    const trips = data.daily.reduce((total, row) => total + num(row.trips), 0)
    const completed = data.daily.reduce((total, row) => total + num(row.completed), 0)
    const outstanding = num(data.aging.current) + num(data.aging.days_1_30) + num(data.aging.days_31_60) + num(data.aging.days_60_plus)
    const hours = data.vehicles.reduce((total, row) => total + num(row.hours), 0)
    return {
      tripRevenue,
      fixedRevenue,
      totalRevenue,
      operatingExpenses,
      allExpenses,
      netProfit,
      margin: totalRevenue ? (netProfit / totalRevenue) * 100 : 0,
      trips,
      completed,
      outstanding,
      revenuePerTrip: completed ? totalRevenue / completed : 0,
      hours,
    }
  }, [data])

  const monthly = useMemo(
    () =>
      (data?.monthly ?? []).map((row) => ({
        ...row,
        label: formatDate(`${row.month}-01`, language, { month: 'short', year: '2-digit' }),
      })),
    [data, language],
  )

  const costMix = useMemo(
    () =>
      (data?.expenseCategories ?? [])
        .filter((row) => num(row.amount) > 0)
        .map((row) => ({
          name: language === 'ar' ? row.name_ar : row.name_en,
          amount: num(row.amount),
          isOperating: row.is_operating,
        })),
    [data, language],
  )

  const comparison = useMemo(
    () =>
      (data?.comparison ?? []).map((row) => ({
        ...row,
        name: row.trip_type === 'fixed' ? t('trips.fixed') : t('trips.private'),
      })),
    [data, t],
  )

  const topVehicles = useMemo(
    () =>
      [...(data?.vehicles ?? [])]
        .sort((a, b) => num(b.profit) - num(a.profit))
        .slice(0, 8)
        .map((row) => ({ name: row.plate, profit: num(row.profit), revenue: num(row.revenue) })),
    [data],
  )

  const agingRows = useMemo(() => {
    if (!data) return []
    return [
      { label: t('revenue.agingCurrent'), value: num(data.aging.current), tone: 'positive' as const },
      { label: t('revenue.aging1to30'), value: num(data.aging.days_1_30), tone: 'warning' as const },
      { label: t('revenue.aging31to60'), value: num(data.aging.days_31_60), tone: 'warning' as const },
      { label: t('revenue.aging60plus'), value: num(data.aging.days_60_plus), tone: 'negative' as const },
    ]
  }, [data, t])

  const maxAging = agingRows.reduce((max, row) => Math.max(max, row.value), 0)
  const maxUtilization = useMemo(() => {
    const maxHours = Math.max(1, ...(data?.vehicles ?? []).map((row) => num(row.hours)))
    return maxHours
  }, [data])

  function printReport() {
    if (!data) return
    const dir = language === 'ar' ? 'rtl' : 'ltr'
    const rows = (items: string[][]) =>
      items
        .map((cells) => `<tr>${cells.map((cell, index) => `<td${index > 0 ? ' class="num"' : ''}>${escapeHtml(cell)}</td>`).join('')}</tr>`)
        .join('')
    const fleetRows = data.vehicles
      .slice(0, 25)
      .map((row) => [row.plate, `${num(row.trips)}`, money(row.revenue, currency, language), money(row.expenses, currency, language), money(row.profit, currency, language)])
    const contractRows = data.contracts
      .slice(0, 20)
      .map((row) => [row.contract_no, row.customer_name, money(row.recognized, currency, language), money(row.invoiced, currency, language), money(row.collected, currency, language), money(row.profit, currency, language)])
    const expenseRows = data.expenseCategories
      .filter((row) => num(row.amount) > 0)
      .map((row) => [language === 'ar' ? row.name_ar : row.name_en, `${num(row.count)}`, money(row.amount, currency, language)])
    const receivableRows = data.receivables
      .slice(0, 25)
      .map((row) => [row.invoice_no, row.customer_name, formatDate(row.due_date, language), `${num(row.days_overdue)}`, money(row.balance, currency, language)])
    const html = `
      <div class="doc-head">
        <div class="brand">${escapeHtml(language === 'ar' ? 'مكتب الشيخ' : 'Al-Sheikh Office')}<small>${escapeHtml(t('app.tagline'))}</small></div>
        <div class="doc-title">
          <h1>${escapeHtml(t('reports.title'))}</h1>
          <p>${escapeHtml(formatDate(range.from, language))} — ${escapeHtml(formatDate(range.to, language))}</p>
        </div>
      </div>
      <div class="kpi">
        <div><span class="meta-label">${escapeHtml(t('reports.totalRevenue'))}</span><strong>${escapeHtml(money(totals.totalRevenue, currency, language))}</strong></div>
        <div><span class="meta-label">${escapeHtml(t('reports.totalExpenses'))}</span><strong>${escapeHtml(money(totals.operatingExpenses, currency, language))}</strong></div>
        <div><span class="meta-label">${escapeHtml(t('reports.netProfit'))}</span><strong>${escapeHtml(money(totals.netProfit, currency, language))}</strong></div>
        <div><span class="meta-label">${escapeHtml(t('reports.trips'))}</span><strong>${escapeHtml(`${num(totals.completed)} / ${num(totals.trips)}`)}</strong></div>
      </div>
      <div class="section-title">${escapeHtml(t('reports.fleetPerformance'))}</div>
      <table><thead><tr><th>${escapeHtml(t('fleet.plate'))}</th><th class="num">${escapeHtml(t('reports.trips'))}</th><th class="num">${escapeHtml(t('common.revenue'))}</th><th class="num">${escapeHtml(t('common.expenses'))}</th><th class="num">${escapeHtml(t('common.profit'))}</th></tr></thead><tbody>${rows(fleetRows)}</tbody></table>
      <div class="section-title">${escapeHtml(t('reports.contractProfitability'))}</div>
      <table><thead><tr><th>${escapeHtml(t('contracts.contractNo'))}</th><th>${escapeHtml(t('common.customer'))}</th><th class="num">${escapeHtml(t('contracts.recognized'))}</th><th class="num">${escapeHtml(t('contracts.invoiced'))}</th><th class="num">${escapeHtml(t('contracts.collected'))}</th><th class="num">${escapeHtml(t('common.profit'))}</th></tr></thead><tbody>${rows(contractRows)}</tbody></table>
      <div class="section-title">${escapeHtml(t('reports.expenseBreakdown'))}</div>
      <table><thead><tr><th>${escapeHtml(t('common.category'))}</th><th class="num">${escapeHtml(t('common.count'))}</th><th class="num">${escapeHtml(t('common.amount'))}</th></tr></thead><tbody>${rows(expenseRows)}</tbody></table>
      <div class="section-title">${escapeHtml(t('reports.receivablesAging'))}</div>
      <div class="kpi">
        ${agingRows.map((row) => `<div><span class="meta-label">${escapeHtml(row.label)}</span><strong>${escapeHtml(money(row.value, currency, language))}</strong></div>`).join('')}
      </div>
      <div class="section-title">${escapeHtml(t('revenue.receivables'))}</div>
      <table><thead><tr><th>${escapeHtml(t('revenue.invoiceNo'))}</th><th>${escapeHtml(t('common.customer'))}</th><th>${escapeHtml(t('revenue.dueDate'))}</th><th class="num">${escapeHtml(t('revenue.overdue'))}</th><th class="num">${escapeHtml(t('revenue.balance'))}</th></tr></thead><tbody>${rows(receivableRows)}</tbody></table>
      <div class="foot"><span>${escapeHtml(t('reports.reportHint'))}</span><span>${escapeHtml(t('reports.generated', { date: formatDate(data.generatedAt.slice(0, 10), language) }))}</span></div>
    `
    if (!printDocument(t('reports.title'), html, { dir, lang: language })) {
      toast.error(t('error.generic'), t('common.print'))
    }
  }

  const tabs: Array<{ value: ReportTab; label: string; count?: number }> = [
    { value: 'overview', label: t('reports.overview') },
    { value: 'fleet', label: t('reports.fleetPerformance'), count: data?.vehicles.length },
    { value: 'routes', label: t('reports.routePerformance'), count: data?.routes.length },
    { value: 'contracts', label: t('reports.contractProfitability'), count: data?.contracts.length },
    { value: 'customers', label: t('reports.customerLedger'), count: data?.customers.length },
    { value: 'drivers', label: t('reports.driverPerformance'), count: data?.drivers.length },
    { value: 'expenses', label: t('reports.expenseBreakdown') },
    { value: 'maintenance', label: t('reports.maintenanceReport'), count: data?.maintenance.length },
    { value: 'receivables', label: t('reports.receivablesAging'), count: data?.receivables.length },
  ]

  const headerActions = (
    <>
      <PeriodPicker value={range} onChange={setRange} />
      <Button variant="secondary" size="sm" icon={<Printer size={14} />} onClick={printReport} disabled={!data}>{t('reports.printReport')}</Button>
      {can('export_reports') ? (
        <ExportMenu from={range.from} to={range.to} />
      ) : null}
      <IconButton label={t('common.refresh')} size="sm" variant="secondary" onClick={() => void reportQuery.refetch()}>
        <RefreshCw size={14} className={reportQuery.isFetching ? 'animate-spin' : ''} />
      </IconButton>
    </>
  )

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${t('nav.administration')} · ${t('nav.reports')}`}
        title={t('reports.title')}
        subtitle={t('reports.subtitle')}
        actions={headerActions}
      />

      {data ? (
        <StatStrip
          items={[
            { label: t('reports.totalRevenue'), value: money(totals.totalRevenue, currency, language, true), tone: 'accent', hint: `${t('reports.trips')}: ${money(totals.tripRevenue, currency, language, true)}` },
            { label: t('reports.totalExpenses'), value: money(totals.operatingExpenses, currency, language, true), tone: 'warning' },
            { label: t('reports.netProfit'), value: money(totals.netProfit, currency, language, true), tone: totals.netProfit >= 0 ? 'positive' : 'negative', hint: `${t('common.margin')} ${percent(totals.margin, 1, language)}` },
            { label: t('reports.trips'), value: `${num(totals.completed)} / ${num(totals.trips)}`, hint: t('common.completed') },
            { label: t('revenue.outstanding'), value: money(totals.outstanding, currency, language, true), tone: totals.outstanding > 0 ? 'warning' : 'default' },
          ]}
        />
      ) : null}

      <Panel className="p-3 sm:p-4">
        <Tabs value={tab} onChange={(value) => { setTab(value); setPage(1) }} items={tabs} />
      </Panel>

      {reportQuery.isLoading ? (
        <PageSkeleton rows={6} />
      ) : reportQuery.error ? (
        <PageError error={reportQuery.error} onRetry={() => void reportQuery.refetch()} />
      ) : !data ? (
        <Panel><EmptyState icon={<TriangleAlert size={20} />} title={t('common.noData')} /></Panel>
      ) : tab === 'overview' ? (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
            <ChartCard
              title={t('reports.monthlyTrend')}
              hint={t('reports.reportHint')}
              action={<LegendDots items={[{ label: t('common.revenue'), color: palette[0] }, { label: t('reports.trips'), color: palette[2] }]} />}
            >
              {monthly.length ? (
                <div className="h-[272px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={monthly} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="reportRevenueFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={palette[0]} stopOpacity={0.34} />
                          <stop offset="100%" stopColor={palette[0]} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...chartGridStyle} />
                      <XAxis dataKey="label" {...chartAxisStyle} minTickGap={16} />
                      <YAxis yAxisId="left" {...chartAxisStyle} tickFormatter={(value: number) => money(value, currency, language, true)} width={70} />
                      <YAxis yAxisId="right" orientation="right" {...chartAxisStyle} width={28} allowDecimals={false} />
                      <Tooltip
                        content={
                          <ChartTooltip
                            formatter={(value: number, name: string) => (name === t('reports.trips') ? num(value) : money(value, currency, language))}
                          />
                        }
                      />
                      <Area yAxisId="left" type="monotone" dataKey="revenue" name={t('common.revenue')} stroke={palette[0]} strokeWidth={1.8} fill="url(#reportRevenueFill)" />
                      <Line yAxisId="right" type="monotone" dataKey="completed" name={t('reports.trips')} stroke={palette[2]} strokeWidth={1.6} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <ChartEmpty title={t('dashboard.noCharts')} hint={t('dashboard.noChartsHint')} />
              )}
            </ChartCard>

            <ChartCard title={t('reports.expenseBreakdown')} hint={`${t('common.total')}: ${money(totals.allExpenses, currency, language, true)}`}>
              {costMix.length ? (
                <>
                  <div className="relative h-[184px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={costMix} dataKey="amount" nameKey="name" innerRadius={56} outerRadius={80} paddingAngle={2} stroke="none">
                          {costMix.map((entry, index) => <Cell key={entry.name} fill={palette[index % palette.length]} />)}
                        </Pie>
                        <Tooltip content={<ChartTooltip formatter={(value: number) => money(value, currency, language)} />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[0.56rem] font-semibold uppercase tracking-[0.14em] text-muted">{t('expenses.operating')}</span>
                      <span className="mt-0.5 text-[0.92rem] font-semibold tabular text-text">{money(totals.operatingExpenses, currency, language, true)}</span>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1.5 px-2">
                    {costMix.slice(0, 5).map((entry, index) => (
                      <div key={entry.name} className="flex items-center justify-between gap-2 text-[0.68rem]">
                        <span className="flex min-w-0 items-center gap-1.5 text-text-soft">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: palette[index % palette.length] }} />
                          <span className="truncate">{entry.name}</span>
                        </span>
                        <span className="tabular text-muted">{money(entry.amount, currency, language, true)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <ChartEmpty title={t('expenses.empty')} hint={t('expenses.emptyHint')} />
              )}
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="p-4">
              <SectionHeader title={t('dashboard.fixedVsPrivate')} hint={t('dashboard.fixedVsPrivateHint')} />
              {comparison.length ? (
                <div className="mt-3 h-[196px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparison} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="32%">
                      <CartesianGrid {...chartGridStyle} />
                      <XAxis dataKey="name" {...chartAxisStyle} />
                      <YAxis {...chartAxisStyle} tickFormatter={(value: number) => money(value, currency, language, true)} width={68} />
                      <Tooltip content={<ChartTooltip formatter={(value: number) => money(value, currency, language)} />} cursor={{ fill: 'var(--accent-softer)' }} />
                      <Bar dataKey="revenue" name={t('common.revenue')} fill={palette[0]} radius={[5, 5, 0, 0]} />
                      <Bar dataKey="expenses" name={t('common.expenses')} fill={palette[3]} radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="mt-6 text-[0.72rem] text-muted">{t('common.noData')}</p>
              )}
            </Panel>

            <Panel className="p-4">
              <SectionHeader
                title={t('reports.receivablesAging')}
                hint={t('reports.agingHint')}
                action={<Badge tone={num(data.aging.days_60_plus) > 0 ? 'negative' : 'positive'}>{money(totals.outstanding, currency, language, true)}</Badge>}
              />
              <div className="mt-4 space-y-3.5">
                {agingRows.map((row) => (
                  <div key={row.label}>
                    <div className="mb-1 flex items-center justify-between text-[0.7rem]">
                      <span className="text-text-soft">{row.label}</span>
                      <span className="tabular font-semibold text-text">{money(row.value, currency, language)}</span>
                    </div>
                    <Progress value={maxAging ? (row.value / maxAging) * 100 : 0} tone={row.tone === 'positive' ? 'positive' : row.tone === 'warning' ? 'warning' : 'negative'} height="h-1.5" />
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3">
                <div>
                  <p className="text-[0.6rem] uppercase tracking-wide text-muted">{t('reports.revenuePerTrip')}</p>
                  <p className="mt-0.5 text-[0.86rem] font-semibold tabular text-text">{money(totals.revenuePerTrip, currency, language, true)}</p>
                </div>
                <div>
                  <p className="text-[0.6rem] uppercase tracking-wide text-muted">{t('common.completed')}</p>
                  <p className="mt-0.5 text-[0.86rem] font-semibold tabular text-text">{num(totals.completed)} / {num(totals.trips)}</p>
                </div>
              </div>
            </Panel>
          </div>

          <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
              <SectionHeader title={t('reports.fleetPerformance')} hint={t('reports.reportHint')} />
              <Button variant="ghost" size="sm" onClick={() => setTab('fleet')}>{t('common.viewAll')}</Button>
            </div>
            <div className="scroll-x mt-2">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>{t('common.vehicle')}</th>
                    <th className="text-end">{t('reports.trips')}</th>
                    <th className="text-end">{t('common.revenue')}</th>
                    <th className="text-end">{t('common.expenses')}</th>
                    <th className="text-end">{t('common.profit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.vehicles.slice(0, 6).map((row) => (
                    <tr key={row.plate}>
                      <td>
                        <span className="block text-[0.72rem] font-semibold text-text">{row.plate}</span>
                        <span className="text-[0.62rem] text-muted">{row.make} {row.model}</span>
                      </td>
                      <td className="text-end tabular text-[0.7rem]">{num(row.trips)}</td>
                      <td className="text-end tabular text-[0.7rem]">{money(row.revenue, currency, language)}</td>
                      <td className="text-end tabular text-[0.7rem] text-negative">{money(row.expenses, currency, language)}</td>
                      <td className={`text-end tabular text-[0.72rem] font-semibold ${num(row.profit) >= 0 ? 'text-positive' : 'text-negative'}`}>{money(row.profit, currency, language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      ) : tab === 'fleet' ? (
        <div className="space-y-4">
          <ChartCard title={t('reports.fleetPerformance')} hint={t('reports.reportHint')} action={<Badge tone="accent">{money(data.vehicles.reduce((total, row) => total + num(row.profit), 0), currency, language, true)}</Badge>}>
            {topVehicles.length ? (
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topVehicles} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid {...chartGridStyle} />
                    <XAxis dataKey="name" {...chartAxisStyle} />
                    <YAxis {...chartAxisStyle} tickFormatter={(value: number) => money(value, currency, language, true)} width={68} />
                    <Tooltip content={<ChartTooltip formatter={(value: number) => money(value, currency, language)} />} cursor={{ fill: 'var(--accent-softer)' }} />
                    <Bar dataKey="profit" name={t('common.profit')} radius={[5, 5, 0, 0]}>
                      {topVehicles.map((entry) => <Cell key={entry.name} fill={entry.profit >= 0 ? palette[2] : palette[3]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <ChartEmpty title={t('common.noData')} />}
          </ChartCard>
          <ReportTable
            head={[t('fleet.plate'), t('fleet.category'), t('reports.trips'), t('reports.utilization'), t('common.revenue'), t('common.expenses'), t('common.profit')]}
            rows={data.vehicles.map((row) => [
              <span key="v" className="block">
                <span className="block text-[0.72rem] font-semibold text-text">{row.plate}</span>
                <span className="text-[0.62rem] text-muted">{row.make} {row.model}</span>
              </span>,
              <span key="c" className="text-[0.7rem] text-text-soft">{row.category}</span>,
              <span key="t" className="tabular text-[0.7rem]">{num(row.trips)}</span>,
              <div key="u" className="min-w-[6rem]">
                <div className="flex items-center justify-between text-[0.6rem] text-muted"><span>{num(row.hours).toFixed(0)}h</span></div>
                <Progress value={maxUtilization ? (num(row.hours) / maxUtilization) * 100 : 0} height="h-1" />
              </div>,
              <span key="r" className="tabular text-[0.7rem]">{money(row.revenue, currency, language)}</span>,
              <span key="e" className="tabular text-[0.7rem] text-negative">{money(row.expenses, currency, language)}</span>,
              <span key="p" className={`tabular text-[0.72rem] font-semibold ${num(row.profit) >= 0 ? 'text-positive' : 'text-negative'}`}>{money(row.profit, currency, language)}</span>,
            ])}
          />
        </div>
      ) : tab === 'routes' ? (
        <ReportTable
          head={[t('routes.routeNo'), t('routes.origin'), t('routes.destination'), t('reports.trips'), t('common.revenue'), t('common.expenses'), t('common.profit')]}
          rows={data.routes.map((row) => [
            <span key="r" className="block">
              <span className="block text-[0.72rem] font-semibold text-text">{language === 'ar' ? row.name_ar : row.name_en}</span>
              <span className="text-[0.62rem] text-muted">{row.route_no} · {row.origin} → {row.destination}</span>
            </span>,
            <span key="o" className="text-[0.7rem] text-text-soft">{row.origin}</span>,
            <span key="d" className="text-[0.7rem] text-text-soft">{row.destination}</span>,
            <span key="t" className="tabular text-[0.7rem]">{num(row.completed)} / {num(row.trips)}</span>,
            <span key="v" className="tabular text-[0.7rem]">{money(row.revenue, currency, language)}</span>,
            <span key="e" className="tabular text-[0.7rem] text-negative">{money(row.expenses, currency, language)}</span>,
            <span key="p" className={`tabular text-[0.72rem] font-semibold ${num(row.revenue) - num(row.expenses) >= 0 ? 'text-positive' : 'text-negative'}`}>{money(num(row.revenue) - num(row.expenses), currency, language)}</span>,
          ])}
        />
      ) : tab === 'contracts' ? (
        <ReportTable
          head={[t('contracts.contractNo'), t('common.customer'), t('contracts.recognized'), t('contracts.invoiced'), t('contracts.collected'), t('common.profit')]}
          rows={data.contracts.map((row) => [
            <span key="c" className="block">
              <span className="block text-[0.72rem] font-semibold text-text">{row.contract_no}</span>
              <span className="text-[0.62rem] text-muted">{row.title}</span>
            </span>,
            <span key="cu" className="text-[0.7rem] text-text-soft">{row.customer_name}</span>,
            <span key="r" className="tabular text-[0.7rem]">{money(row.recognized, currency, language)}</span>,
            <span key="i" className="tabular text-[0.7rem]">{money(row.invoiced, currency, language)}</span>,
            <span key="co" className="tabular text-[0.7rem] text-positive">{money(row.collected, currency, language)}</span>,
            <span key="p" className={`tabular text-[0.72rem] font-semibold ${num(row.profit) >= 0 ? 'text-positive' : 'text-negative'}`}>{money(row.profit, currency, language)}</span>,
          ])}
        />
      ) : tab === 'customers' ? (
        <ReportTable
          head={[t('common.customer'), t('contracts.activeContracts'), t('revenue.invoiced'), t('revenue.collected'), t('revenue.outstanding'), t('common.revenue')]}
          rows={data.customers.map((row) => [
            <span key="c" className="block">
              <span className="block text-[0.72rem] font-semibold text-text">{row.name}</span>
              <span className="text-[0.62rem] text-muted">{row.customer_no} · {row.type}</span>
            </span>,
            <span key="a" className="tabular text-[0.7rem]">{num(row.active_contracts)}</span>,
            <span key="i" className="tabular text-[0.7rem]">{money(row.invoiced, currency, language)}</span>,
            <span key="co" className="tabular text-[0.7rem] text-positive">{money(row.collected, currency, language)}</span>,
            <span key="o" className="tabular text-[0.7rem] font-semibold text-warning">{money(row.outstanding, currency, language)}</span>,
            <span key="r" className="tabular text-[0.7rem]">{money(row.trip_revenue, currency, language)}</span>,
          ])}
        />
      ) : tab === 'drivers' ? (
        <div className="space-y-3">
          {data.salaryMasked ? (
            <div className="flex items-center gap-2 rounded-xl border border-warning/25 bg-warning-soft px-3 py-2 text-[0.7rem] text-warning">
              <TriangleAlert size={13} /> {t('reports.noSalaryAccess')}
            </div>
          ) : null}
          <ReportTable
            head={[t('drivers.fullName'), t('drivers.licenseNo'), t('reports.trips'), t('common.revenue'), t('drivers.compensation'), t('drivers.monthlySalary')]}
            rows={data.drivers.map((row) => [
              <span key="n" className="block">
                <span className="block text-[0.72rem] font-semibold text-text">{row.full_name}</span>
                <span className="text-[0.62rem] text-muted">{row.driver_no}{row.phone ? ` · ${row.phone}` : ''}</span>
              </span>,
              <span key="l" className="text-[0.68rem] text-text-soft">
                {row.license_no}
                <span className="block text-[0.6rem] text-muted">{row.license_expiry ? formatDate(row.license_expiry, language) : '—'}</span>
              </span>,
              <span key="t" className="tabular text-[0.7rem]">{num(row.trips)}</span>,
              <span key="r" className="tabular text-[0.7rem]">{money(row.revenue, currency, language)}</span>,
              <span key="c" className="tabular text-[0.7rem]">{money(row.compensation, currency, language)}</span>,
              <span key="s" className={`tabular text-[0.7rem] ${row.monthly_salary === null ? 'text-muted' : 'text-text'}`}>{row.monthly_salary === null ? '—' : money(row.monthly_salary, currency, language)}</span>,
            ])}
          />
        </div>
      ) : tab === 'expenses' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-4">
            <ChartCard title={t('reports.expenseBreakdown')} hint={t('reports.reportHint')}>
              {costMix.length ? (
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={costMix} layout="vertical" margin={{ top: 8, right: 20, left: 10, bottom: 0 }}>
                      <CartesianGrid {...chartGridStyle} horizontal={false} vertical />
                      <XAxis type="number" {...chartAxisStyle} tickFormatter={(value: number) => money(value, currency, language, true)} />
                      <YAxis type="category" dataKey="name" width={110} {...chartAxisStyle} />
                      <Tooltip content={<ChartTooltip formatter={(value: number) => money(value, currency, language)} />} cursor={{ fill: 'var(--accent-softer)' }} />
                      <Bar dataKey="amount" name={t('common.amount')} radius={[0, 5, 5, 0]}>
                        {costMix.map((entry, index) => <Cell key={entry.name} fill={palette[index % palette.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <ChartEmpty title={t('expenses.empty')} hint={t('expenses.emptyHint')} />}
            </ChartCard>
            <ChartCard title={t('dashboard.fixedVsPrivate')} hint={t('reports.reportHint')}>
              {comparison.length ? (
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparison} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barCategoryGap="34%">
                      <CartesianGrid {...chartGridStyle} />
                      <XAxis dataKey="name" {...chartAxisStyle} />
                      <YAxis {...chartAxisStyle} tickFormatter={(value: number) => money(value, currency, language, true)} width={68} />
                      <Tooltip content={<ChartTooltip formatter={(value: number) => money(value, currency, language)} />} cursor={{ fill: 'var(--accent-softer)' }} />
                      <Bar dataKey="revenue" name={t('common.revenue')} fill={palette[0]} radius={[5, 5, 0, 0]} />
                      <Bar dataKey="expenses" name={t('common.expenses')} fill={palette[3]} radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <ChartEmpty title={t('common.noData')} />}
            </ChartCard>
          </div>
          <Panel className="h-fit p-4">
            <SectionHeader title={t('reports.expenseBreakdown')} hint={`${t('common.total')}: ${money(totals.allExpenses, currency, language, true)}`} />
            <div className="mt-4 space-y-3.5">
              {costMix.map((entry, index) => (
                <div key={entry.name}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: palette[index % palette.length] }} />
                      <span className="truncate text-[0.7rem] text-text-soft">{entry.name}</span>
                      {entry.isOperating ? <Badge tone="positive">{t('expenses.operating')}</Badge> : <Badge tone="info">{t('expenses.capital')}</Badge>}
                    </span>
                    <span className="shrink-0 text-[0.68rem] font-semibold tabular text-text">{money(entry.amount, currency, language, true)}</span>
                  </div>
                  <Progress value={totals.allExpenses ? (entry.amount / totals.allExpenses) * 100 : 0} height="h-1" />
                </div>
              ))}
            </div>
          </Panel>
        </div>
      ) : tab === 'maintenance' ? (
        <ReportTable
          head={[t('maintenance.recordNo'), t('common.vehicle'), t('common.period'), t('maintenance.type'), t('maintenance.vendor'), t('maintenance.cost'), t('common.status')]}
          rows={data.maintenance.map((row) => [
            <span key="r" className="block">
              <span className="block text-[0.72rem] font-semibold text-text">{row.record_no}</span>
              <span className="text-[0.62rem] text-muted">{row.description}</span>
            </span>,
            <span key="v" className="text-[0.7rem] text-text-soft">{row.vehicle_plate}<span className="block text-[0.6rem] text-muted">{row.make} {row.model}</span></span>,
            <span key="p" className="whitespace-nowrap text-[0.68rem] tabular text-muted">{formatDate(row.start_date, language)} → {formatDate(row.end_date, language)}</span>,
            <span key="t" className="text-[0.68rem] text-text-soft">{t((`maintenance.${row.maintenance_type}`) as TranslationKey)}</span>,
            <span key="ve" className="text-[0.68rem] text-text-soft">{row.vendor || '—'}</span>,
            <span key="c" className="tabular text-[0.7rem] font-semibold">{money(row.cost, currency, language)}</span>,
            <StatusBadge key="s" status={row.status} />,
          ])}
        />
      ) : (
        <div className="space-y-4">
          <StatStrip
            items={agingRows.map((row) => ({ label: row.label, value: money(row.value, currency, language, true), tone: row.tone }))}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionHeader title={t('revenue.receivables')} hint={t('reports.agingHint')} />
            <Badge tone="warning">{data.receivables.length} {t('revenue.openInvoices')}</Badge>
          </div>
          <Panel className="overflow-hidden">
            <div className="scroll-x">
              <table className="data-table min-w-[880px]">
                <thead>
                  <tr>
                    <th>{t('revenue.invoiceNo')}</th>
                    <th>{t('common.customer')}</th>
                    <th>{t('revenue.issueDate')}</th>
                    <th>{t('revenue.dueDate')}</th>
                    <th className="text-end">{t('revenue.total')}</th>
                    <th className="text-end">{t('revenue.paid')}</th>
                    <th className="text-end">{t('revenue.balance')}</th>
                    <th className="text-end">{t('revenue.overdue')}</th>
                    <th>{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.receivables.slice((page - 1) * pageSize, page * pageSize).map((row) => (
                    <tr key={row.invoice_no}>
                      <td className="text-[0.72rem] font-semibold text-text">{row.invoice_no}</td>
                      <td className="text-[0.7rem] text-text-soft">{row.customer_name}<span className="block text-[0.6rem] text-muted">{row.contract_no || '—'}</span></td>
                      <td className="whitespace-nowrap text-[0.68rem] tabular text-muted">{formatDate(row.issue_date, language)}</td>
                      <td className="whitespace-nowrap text-[0.68rem] tabular text-muted">{formatDate(row.due_date, language)}</td>
                      <td className="text-end tabular text-[0.7rem]">{money(row.total, currency, language)}</td>
                      <td className="text-end tabular text-[0.7rem] text-positive">{money(row.amount_paid, currency, language)}</td>
                      <td className="text-end tabular text-[0.72rem] font-semibold text-warning">{money(row.balance, currency, language)}</td>
                      <td className={`text-end tabular text-[0.7rem] ${num(row.days_overdue) > 0 ? 'text-negative' : 'text-muted'}`}>{num(row.days_overdue) > 0 ? `${num(row.days_overdue)}d` : '—'}</td>
                      <td><StatusBadge status={row.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border px-3">
              <Pagination page={page} pageSize={pageSize} total={data.receivables.length} onPage={setPage} />
            </div>
          </Panel>
        </div>
      )}
    </div>
  )
}

function ExportMenu({ from, to }: { from: string; to: string }) {
  const { t } = useApp()
  return (
    <PopoverWrapper from={from} to={to} label={t('common.export')} />
  )
}

function PopoverWrapper({ from, to, label }: { from: string; to: string; label: string }) {
  const { t } = useApp()
  return (
    <Popover trigger={<Button variant="secondary" size="sm" icon={<FileSpreadsheet size={14} />}>{label}</Button>}>
      <div className="border-b border-border px-2 pb-2 pt-1">
        <p className="text-[0.72rem] font-semibold text-text">{t('reports.exportCsv')}</p>
        <p className="mt-0.5 text-[0.6rem] text-muted">{formatDate(from)} — {formatDate(to)}</p>
      </div>
      <div className="pt-1">
        {EXPORTS.map((item) => <ExportOption key={item.report} report={item.report} label={item.label} from={from} to={to} />)}
      </div>
    </Popover>
  )
}

function ReportTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  const { t } = useApp()
  return (
    <Panel className="overflow-hidden">
      <div className="scroll-x">
        <table className="data-table min-w-[900px]">
          <thead>
            <tr>{head.map((label, index) => <th key={`${label}-${index}`} className={index > 1 ? 'text-end' : undefined}>{label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((cells, rowIndex) => (
              <tr key={rowIndex}>
                {cells.map((cell, cellIndex) => <td key={cellIndex} className={cellIndex > 1 ? 'text-end' : undefined}>{cell}</td>)}
              </tr>
            )) : (
              <tr><td colSpan={head.length} className="py-10 text-center text-[0.72rem] text-muted">{t('common.noData')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
