import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowUpRight,
  Banknote,
  BusFront,
  CalendarClock,
  CircleDollarSign,
  Fuel,
  Gauge,
  Receipt,
  RefreshCw,
  Route as RouteIcon,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { api } from '../lib/api'
import type { DashboardData } from '../lib/types'
import { delta, formatDate, money, num, percent, rangeFromDays } from '../lib/utils'
import { Badge, Button, IconButton, KpiCard, PageHeader, Panel, Progress, SectionHeader, StatusBadge } from '../components/ui'
import { ChartCard, ChartEmpty, ChartTooltip, LegendDots, chartAxisStyle, chartGridStyle, useChartPalette } from '../components/charts'
import { PageError, PageSkeleton, PeriodPicker, StatStrip, type DateRange } from '../components/filters'

const ATTENTION_TONES = {
  warning: 'bg-warning',
  negative: 'bg-negative',
  info: 'bg-info',
} as const

export function DashboardPage() {
  const { t, language, currency } = useApp()
  const palette = useChartPalette()
  const [range, setRange] = useState<DateRange>(() => rangeFromDays(90))

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['dashboard', range.from, range.to],
    queryFn: () => api.get<DashboardData>('/api/dashboard', { from: range.from, to: range.to }),
  })

  const daily = useMemo(() => {
    if (!data) return []
    const map = new Map<string, { date: string; revenue: number; trips: number; completed: number }>()
    for (const row of data.charts.dailyTrips) {
      const current = map.get(row.date) || { date: row.date, revenue: 0, trips: 0, completed: 0 }
      current.revenue += num(row.revenue)
      current.trips += num(row.trips)
      current.completed += num(row.completed)
      map.set(row.date, current)
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [data])

  const costMix = useMemo(() => {
    if (!data) return []
    const map = new Map<string, { name: string; amount: number }>()
    for (const row of data.charts.expenseByVehicleCategory) {
      const name = language === 'ar' ? row.name_ar : row.name_en
      const current = map.get(name) || { name, amount: 0 }
      current.amount += num(row.amount)
      map.set(name, current)
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, 7)
  }, [data, language])

  const serviceMix = useMemo(() => {
    if (!data) return []
    return data.charts.fixedVsPrivate
      .filter((row) => num(row.trips) > 0)
      .map((row) => ({
        name: row.trip_type === 'fixed' ? t('trips.fixed') : t('trips.private'),
        revenue: num(row.revenue),
        trips: num(row.trips),
      }))
  }, [data, t])

  if (isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow={t('nav.overview')} title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
        <PageSkeleton rows={6} />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow={t('nav.overview')} title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
        <PageError error={error} onRetry={() => void refetch()} />
      </div>
    )
  }

  const k = data.kpis
  const previous = data.previous ?? {
    recognizedRevenue: 0,
    tripRevenue: 0,
    contractRevenue: 0,
    operatingExpenses: 0,
    netOperatingProfit: 0,
    totalTrips: 0,
    completedTrips: 0,
  }
  const sparkRevenue = daily.slice(-16).map((row) => row.revenue)
  const sparkTrips = daily.slice(-16).map((row) => row.completed)
  const margin = num(k.recognizedRevenue) > 0 ? (num(k.netOperatingProfit) / num(k.recognizedRevenue)) * 100 : 0
  const avgTripValue = k.completedTrips > 0 ? k.tripRevenue / k.completedTrips : 0
  const overdue = num(k.overdueReceivables)
  const attention = [
    { label: t('dashboard.expiringContracts'), value: k.expiringContracts, href: '/contracts', tone: 'warning' as const },
    { label: t('trips.missed'), value: k.missedTrips, href: '/trips', tone: 'negative' as const },
    { label: t('dashboard.maintenance'), value: k.maintenanceVehicles, href: '/maintenance', tone: 'info' as const },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${t('app.office')} · ${t('nav.overview')}`}
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        actions={
          <>
            <PeriodPicker value={range} onChange={(next) => setRange(next)} />
            <IconButton label={t('common.refresh')} size="sm" variant="secondary" onClick={() => void refetch()}>
              <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            </IconButton>
            <Link to="/reports">
              <Button variant="primary" size="sm" icon={<TrendingUp size={14} />}>
                {t('dashboard.viewReports')}
              </Button>
            </Link>
          </>
        }
      >
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[0.66rem] text-muted">
          <Badge tone="neutral">
            {t('dashboard.range')}: {formatDate(data.range.from, language)} — {formatDate(data.range.to, language)}
          </Badge>
          {data.hasPrevious ? (
            <Badge tone="info">
              {t('dashboard.vsPrevious')}: {formatDate(data.previousRange.from, language)} — {formatDate(data.previousRange.to, language)}
            </Badge>
          ) : null}
          <span className="ms-auto hidden items-center gap-1.5 sm:flex">
            <Sparkles size={11} className="text-accent" />
            {t('reports.reportHint')}
          </span>
        </div>
      </PageHeader>

      <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={t('dashboard.kpiRevenue')}
          value={money(k.recognizedRevenue, currency, language, true)}
          icon={<CircleDollarSign size={16} />}
          delta={delta(k.recognizedRevenue, previous.recognizedRevenue)}
          deltaSuffix={` ${t('dashboard.vsPrevious')}`}
          spark={sparkRevenue}
          tone="accent"
        />
        <KpiCard
          label={t('dashboard.kpiProfit')}
          value={money(k.netOperatingProfit, currency, language, true)}
          icon={<TrendingUp size={16} />}
          delta={delta(k.netOperatingProfit, previous.netOperatingProfit)}
          deltaSuffix={` ${t('dashboard.vsPrevious')}`}
          spark={sparkRevenue.map((value) => value * (margin / 100 || 0))}
          tone={k.netOperatingProfit >= 0 ? 'positive' : 'negative'}
        />
        <KpiCard
          label={t('dashboard.kpiTrips')}
          value={num(k.completedTrips).toLocaleString(language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG')}
          icon={<RouteIcon size={16} />}
          delta={delta(k.completedTrips, previous.completedTrips)}
          deltaSuffix={` ${t('dashboard.vsPrevious')}`}
          spark={sparkTrips}
          tone="positive"
        />
        <KpiCard
          label={t('dashboard.kpiUtilization')}
          value={percent(k.utilization, 1, language)}
          icon={<Gauge size={16} />}
          hint={`${num(k.operatingVehicles)} ${t('dashboard.operating')} · ${num(k.availableVehicles)} ${t('dashboard.available')}`}
          spark={sparkTrips}
          tone="accent"
        />
      </div>

      <StatStrip
        items={[
          { label: t('dashboard.invoicesIssued'), value: money(k.invoicesIssued, currency, language, true), hint: `${num(k.totalTrips)} ${t('common.trip')}` },
          { label: t('dashboard.collected'), value: money(k.paymentsCollected, currency, language, true), tone: 'positive', hint: `${percent(num(k.invoicesIssued) ? (k.paymentsCollected / k.invoicesIssued) * 100 : 0, 1, language)}` },
          { label: t('dashboard.outstanding'), value: money(k.outstandingReceivables, currency, language, true), tone: 'warning', hint: `${num(k.expiringContracts)} ${t('contracts.expiringSoon')}` },
          { label: t('expenses.title'), value: money(k.operatingExpenses, currency, language, true), tone: 'negative', hint: `${percent(num(k.recognizedRevenue) ? (k.operatingExpenses / k.recognizedRevenue) * 100 : 0, 1, language)} ${t('dashboard.costMix')}` },
          { label: t('dashboard.activeContracts'), value: num(k.activeContracts), tone: 'accent', hint: `${num(k.expiringContracts)} ${t('dashboard.expiringContracts')}` },
          { label: t('dashboard.activeDrivers'), value: num(k.activeDrivers), hint: `${num(k.scheduledTrips)} ${t('common.pending')}` },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title={t('dashboard.revenueTrend')}
          hint={t('dashboard.revenueTrendHint')}
          action={
            <div className="flex items-center gap-3 text-[0.64rem] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" /> {t('common.revenue')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-lavender" /> {t('common.trip')}
              </span>
            </div>
          }
        >
          {daily.length ? (
            <div className="h-[278px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={daily} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={palette[0]} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={palette[0]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...chartGridStyle} />
                  <XAxis
                    dataKey="date"
                    {...chartAxisStyle}
                    tickFormatter={(value: string) => formatDate(value, language, { day: '2-digit', month: 'short' })}
                    minTickGap={28}
                  />
                  <YAxis yAxisId="left" {...chartAxisStyle} tickFormatter={(value: number) => money(value, currency, language, true)} width={72} />
                  <YAxis yAxisId="right" orientation="right" {...chartAxisStyle} width={30} allowDecimals={false} />
                  <Tooltip
                    content={
                      <ChartTooltip
                        labelFormatter={(value: string) => formatDate(value, language, { weekday: 'short', day: '2-digit', month: 'short' })}
                        formatter={(value: number, name: string) =>
                          name === t('common.trip') ? `${num(value)}` : money(value, currency, language)
                        }
                      />
                    }
                  />
                  <Area yAxisId="left" type="monotone" dataKey="revenue" name={t('common.revenue')} stroke={palette[0]} strokeWidth={1.8} fill="url(#revenueFill)" />
                  <Line yAxisId="right" type="monotone" dataKey="completed" name={t('common.trip')} stroke={palette[2]} strokeWidth={1.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartEmpty title={t('dashboard.noCharts')} hint={t('dashboard.noChartsHint')} />
          )}
        </ChartCard>

        <ChartCard
          title={t('dashboard.costMix')}
          hint={t('dashboard.costMixHint')}
          action={<Badge tone="negative">{money(k.operatingExpenses, currency, language, true)}</Badge>}
        >
          {costMix.length ? (
            <>
              <div className="relative h-[190px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={costMix} dataKey="amount" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={2} stroke="none">
                      {costMix.map((entry, index) => (
                        <Cell key={entry.name} fill={palette[index % palette.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip formatter={(value: number) => money(value, currency, language)} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-muted">{t('expenses.totalExpenses')}</span>
                  <span className="mt-0.5 text-[0.95rem] font-semibold tabular text-text">{money(k.operatingExpenses, currency, language, true)}</span>
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
            <ChartEmpty title={t('dashboard.noCharts')} hint={t('dashboard.noChartsHint')} />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="panel flex flex-col p-4 sm:p-5">
          <SectionHeader title={t('dashboard.fleetStatus')} hint={`${num(k.totalVehicles)} ${t('dashboard.totalFleet')}`} />
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <FleetTile label={t('dashboard.available')} value={k.availableVehicles} total={k.totalVehicles} icon={<BusFront size={15} />} tone="positive" />
            <FleetTile label={t('dashboard.operating')} value={k.operatingVehicles} total={k.totalVehicles} icon={<RouteIcon size={15} />} tone="info" />
            <FleetTile label={t('dashboard.maintenance')} value={k.maintenanceVehicles} total={k.totalVehicles} icon={<Receipt size={15} />} tone="warning" />
            <FleetTile label={t('dashboard.activeDrivers')} value={k.activeDrivers} total={undefined} icon={<Users size={15} />} tone="accent" />
          </div>
          <div className="mt-4 space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-[0.66rem]">
                <span className="text-muted">{t('dashboard.kpiUtilization')}</span>
                <span className="font-semibold tabular text-text">{percent(k.utilization, 1, language)}</span>
              </div>
              <Progress value={k.utilization} tone="accent" />
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
              <div>
                <p className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted">{t('dashboard.avgTripValue')}</p>
                <p className="mt-1 text-[0.9rem] font-semibold tabular text-text">{money(avgTripValue, currency, language, true)}</p>
              </div>
              <div>
                <p className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted">{t('dashboard.margin')}</p>
                <p className={`mt-1 text-[0.9rem] font-semibold tabular ${margin >= 0 ? 'text-positive' : 'text-negative'}`}>{percent(margin, 1, language)}</p>
              </div>
            </div>
          </div>
        </div>

        <ChartCard
          title={t('dashboard.fixedVsPrivate')}
          hint={t('dashboard.fixedVsPrivateHint')}
          action={<RouteIcon size={15} className="text-muted" />}
        >
          {serviceMix.length ? (
            <>
              <div className="h-[176px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serviceMix} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barCategoryGap="34%">
                    <CartesianGrid {...chartGridStyle} />
                    <XAxis dataKey="name" {...chartAxisStyle} />
                    <YAxis {...chartAxisStyle} tickFormatter={(value: number) => money(value, currency, language, true)} width={62} />
                    <Tooltip content={<ChartTooltip formatter={(value: number) => money(value, currency, language)} />} cursor={{ fill: 'var(--accent-softer)' }} />
                    <Bar dataKey="revenue" name={t('common.revenue')} radius={[6, 6, 0, 0]}>
                      {serviceMix.map((entry, index) => (
                        <Cell key={entry.name} fill={palette[index % palette.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1 space-y-2 px-2">
                {serviceMix.map((row, index) => (
                  <div key={row.name} className="flex items-center justify-between gap-2 text-[0.7rem]">
                    <span className="flex items-center gap-1.5 text-text-soft">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: palette[index % palette.length] }} />
                      {row.name}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-muted">{row.trips} {t('common.trip')}</span>
                      <span className="font-semibold tabular text-text">{money(row.revenue, currency, language, true)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <ChartEmpty title={t('dashboard.noCharts')} hint={t('dashboard.noChartsHint')} />
          )}
        </ChartCard>

        <div className="panel flex flex-col p-4 sm:p-5">
          <SectionHeader title={t('dashboard.exceptions')} hint={t('dashboard.expiringHint')} />
          <div className="mt-3 flex-1 space-y-2">
            {attention.map((item) => (
              <Link
                key={item.label}
                to={item.href}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2/50 px-3 py-2.5 transition hover:border-border-strong hover:bg-surface-2"
              >
                <span className="flex items-center gap-2 text-[0.72rem] font-medium text-text-soft">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${ATTENTION_TONES[item.tone]}`}
                  />
                  {item.label}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[0.86rem] font-semibold tabular text-text">{item.value}</span>
                  <ArrowUpRight size={12} className="text-muted" />
                </span>
              </Link>
            ))}
            <div className="rounded-xl border border-accent/20 bg-accent-softer px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-accent">
                <Banknote size={12} /> {t('dashboard.receivables')}
              </p>
              <p className="mt-1 text-[0.92rem] font-semibold tabular text-text">{money(k.outstandingReceivables, currency, language, true)}</p>
              <p className="mt-0.5 text-[0.63rem] text-muted">
                {t('dashboard.outstanding')} · {money(overdue, currency, language, true)} {t('revenue.overdue')}
              </p>
            </div>
          </div>
        </div>
      </div>

      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-1 pt-4 sm:px-5 sm:pt-5">
          <SectionHeader title={t('dashboard.contractPerformance')} hint={t('dashboard.contractPerformanceHint')} />
          <Link to="/contracts" className="text-[0.68rem] font-semibold text-accent hover:underline">
            {t('common.viewAll')}
          </Link>
        </div>
        <div className="scroll-x">
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th>{t('contracts.titleField')}</th>
                <th>{t('common.customer')}</th>
                <th className="text-end">{t('contracts.recognized')}</th>
                <th className="text-end">{t('contracts.collected')}</th>
                <th className="text-end">{t('contracts.outstanding')}</th>
                <th className="text-end">{t('common.profit')}</th>
                <th>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {data.charts.contractPerformance.length ? (
                data.charts.contractPerformance.map((contract) => (
                  <tr key={contract.id}>
                    <td>
                      <Link to="/contracts" className="block">
                        <span className="block text-[0.76rem] font-semibold text-text">{contract.title}</span>
                        <span className="text-[0.62rem] text-muted">{contract.contract_no}</span>
                      </Link>
                    </td>
                    <td className="text-[0.72rem] text-text-soft">{contract.customer_name}</td>
                    <td className="text-end tabular text-[0.74rem] text-text">{money(contract.recognized, currency, language, true)}</td>
                    <td className="text-end tabular text-[0.74rem] text-positive">{money(contract.collected, currency, language, true)}</td>
                    <td className="text-end tabular text-[0.74rem] text-warning">{money(contract.outstanding, currency, language, true)}</td>
                    <td className={`text-end tabular text-[0.74rem] font-semibold ${num(contract.profit) >= 0 ? 'text-text' : 'text-negative'}`}>
                      {money(contract.profit, currency, language, true)}
                    </td>
                    <td><StatusBadge status={contract.status} /></td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[0.74rem] text-muted">{t('dashboard.noCharts')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-1 pt-4 sm:px-5 sm:pt-5">
            <SectionHeader title={t('dashboard.vehiclePerformance')} hint={t('dashboard.vehiclePerformanceHint')} />
            <Link to="/fleet" className="text-[0.68rem] font-semibold text-accent hover:underline">
              {t('common.viewAll')}
            </Link>
          </div>
          <div className="scroll-x">
            <table className="data-table min-w-[560px]">
              <thead>
                <tr>
                  <th>{t('common.vehicle')}</th>
                  <th className="text-end">{t('common.trip')}</th>
                  <th className="text-end">{t('common.revenue')}</th>
                  <th className="text-end">{t('common.expenses')}</th>
                  <th className="text-end">{t('common.profit')}</th>
                </tr>
              </thead>
              <tbody>
                {[...data.charts.vehicleFinancials]
                  .sort((a, b) => num(b.profit) - num(a.profit))
                  .slice(0, 7)
                  .map((vehicle) => (
                    <tr key={vehicle.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <span className="plate">{vehicle.plate}</span>
                          <span className="hidden text-[0.65rem] text-muted sm:block">{vehicle.make} {vehicle.model}</span>
                        </div>
                      </td>
                      <td className="text-end tabular text-[0.72rem]">{vehicle.trips}</td>
                      <td className="text-end tabular text-[0.72rem]">{money(vehicle.revenue, currency, language, true)}</td>
                      <td className="text-end tabular text-[0.72rem] text-negative">{money(vehicle.expenses, currency, language, true)}</td>
                      <td className={`text-end tabular text-[0.72rem] font-semibold ${num(vehicle.profit) >= 0 ? 'text-positive' : 'text-negative'}`}>
                        {money(vehicle.profit, currency, language, true)}
                      </td>
                    </tr>
                  ))}
                {!data.charts.vehicleFinancials.length ? (
                  <tr><td colSpan={5} className="py-10 text-center text-[0.74rem] text-muted">{t('fleet.empty')}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-1 pt-4 sm:px-5 sm:pt-5">
            <SectionHeader title={t('dashboard.recentTrips')} hint={t('dashboard.recentTripsHint')} />
            <Link to="/trips" className="text-[0.68rem] font-semibold text-accent hover:underline">
              {t('common.viewAll')}
            </Link>
          </div>
          <div className="divide-y divide-border">
            {data.recentTrips.slice(0, 7).map((trip) => (
              <div key={trip.id} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-accent-softer sm:px-5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted">
                  {trip.trip_type === 'fixed' ? <RouteIcon size={14} /> : <Fuel size={14} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.73rem] font-semibold text-text">
                    {trip.origin} <span className="text-muted">→</span> {trip.destination}
                  </p>
                  <p className="mt-0.5 truncate text-[0.62rem] text-muted">
                    {trip.trip_no} · {formatDate(trip.scheduled_departure, language)} {trip.vehicle_plate ? `· ${trip.vehicle_plate}` : ''}
                  </p>
                </div>
                <div className="text-end">
                  <p className="text-[0.72rem] font-semibold tabular text-text">{money(trip.quoted_price, currency, language, true)}</p>
                  <StatusBadge status={trip.status} className="mt-1" />
                </div>
              </div>
            ))}
            {!data.recentTrips.length ? <p className="py-10 text-center text-[0.74rem] text-muted">{t('common.noData')}</p> : null}
          </div>
        </Panel>
      </div>

      <Panel className="flex flex-wrap items-center gap-2 p-3">
        <span className="eyebrow me-1 text-[0.56rem]">{t('dashboard.quickActions')}</span>
        <Link to="/trips"><Button size="sm" variant="secondary" icon={<RouteIcon size={13} />}>{t('dashboard.addTrip')}</Button></Link>
        <Link to="/expenses"><Button size="sm" variant="secondary" icon={<Receipt size={13} />}>{t('dashboard.addExpense')}</Button></Link>
        <Link to="/dispatch"><Button size="sm" variant="secondary" icon={<CalendarClock size={13} />}>{t('nav.dispatch')}</Button></Link>
        <Link to="/reports"><Button size="sm" variant="secondary" icon={<TrendingUp size={13} />}>{t('dashboard.viewReports')}</Button></Link>
        <span className="ms-auto hidden items-center gap-1 text-[0.6rem] text-muted/70 sm:flex">
          <span className="h-1 w-1 rounded-full bg-accent" /> {t('reports.generated', { date: formatDate(data.range.to, language) })}
        </span>
      </Panel>
    </div>
  )
}

function FleetTile({
  label,
  value,
  total,
  icon,
  tone,
}: {
  label: string
  value: number
  total?: number
  icon: React.ReactNode
  tone: 'positive' | 'info' | 'warning' | 'accent'
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-positive border-positive/20 bg-positive-soft'
      : tone === 'info'
        ? 'text-info border-info/20 bg-info-soft'
        : tone === 'warning'
          ? 'text-warning border-warning/20 bg-warning-soft'
          : 'text-accent border-accent/20 bg-accent-soft'
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-2.5">
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border ${toneClass}`}>{icon}</span>
      <p className="mt-2 text-[1rem] font-semibold tabular text-text">
        {value}
        {total !== undefined ? <span className="text-[0.66rem] font-normal text-muted"> / {total}</span> : null}
      </p>
      <p className="mt-0.5 text-[0.62rem] text-muted">{label}</p>
    </div>
  )
}
