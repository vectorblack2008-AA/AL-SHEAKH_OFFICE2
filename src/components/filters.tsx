import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CalendarRange, RefreshCw, TriangleAlert } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { errorMessage } from '../lib/api'
import { rangeFromDays, todayISO, addDaysISO } from '../lib/utils'
import { Button, Panel, Skeleton } from './ui'

/* ------------------------------- Period picker ------------------------------ */

const PRESETS = [
  { days: 7, key: 'common.last7' },
  { days: 30, key: 'common.last30' },
  { days: 90, key: 'common.last90' },
  { days: 365, key: 'common.last365' },
] as const

export interface DateRange {
  from: string
  to: string
}

export function PeriodPicker({
  value,
  onChange,
  className,
}: {
  value: DateRange
  onChange: (range: DateRange) => void
  className?: string
}) {
  const { t } = useApp()
  const [custom, setCustom] = useState(false)

  const activePreset = useMemo(() => {
    return PRESETS.find((preset) => {
      const range = rangeFromDays(preset.days, value.to)
      return range.from === value.from && range.to === value.to
    })?.days
  }, [value])

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-xl border border-border bg-surface-2/70 p-0.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.days}
              type="button"
              onClick={() => {
                setCustom(false)
                onChange(rangeFromDays(preset.days))
              }}
              className={
                activePreset === preset.days
                  ? 'rounded-[0.6rem] bg-accent px-2.5 py-1.5 text-[0.68rem] font-bold text-accent-contrast'
                  : 'rounded-[0.6rem] px-2.5 py-1.5 text-[0.68rem] font-semibold text-muted transition hover:text-text'
              }
            >
              {t(preset.key)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCustom((current) => !current)}
            className={
              custom || !activePreset
                ? 'rounded-[0.6rem] bg-accent px-2.5 py-1.5 text-[0.68rem] font-bold text-accent-contrast'
                : 'rounded-[0.6rem] px-2.5 py-1.5 text-[0.68rem] font-semibold text-muted transition hover:text-text'
            }
          >
            {t('common.custom')}
          </button>
        </div>
        <span className={custom || !activePreset ? 'contents' : 'hidden'}>
          <div className="flex items-center gap-1.5">
            <CalendarRange size={14} className="text-muted" />
            <input
              type="date"
              value={value.from}
              max={value.to}
              onChange={(event) => {
                if (!event.target.value) return
                onChange({ from: event.target.value, to: value.to })
              }}
              className="field h-8 w-[8.6rem] px-2 py-0 text-[0.7rem]"
              aria-label={t('common.from')}
            />
            <span className="text-[0.68rem] text-muted">{t('common.to')}</span>
            <input
              type="date"
              value={value.to}
              min={value.from}
              max={addDaysISO(todayISO(), 365)}
              onChange={(event) => {
                if (!event.target.value) return
                onChange({ from: value.from, to: event.target.value })
              }}
              className="field h-8 w-[8.6rem] px-2 py-0 text-[0.7rem]"
              aria-label={t('common.to')}
            />
          </div>
        </span>
      </div>
    </div>
  )
}

/* -------------------------------- Stat strip ------------------------------- */

export function StatStrip({
  items,
  className,
}: {
  items: Array<{ label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'positive' | 'negative' | 'warning' | 'accent' }>
  className?: string
}) {
  return (
    <Panel className={className}>
      <div
        className="grid gap-px bg-border/60"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))' }}
      >
        {items.map((item, index) => (
          <div
            key={index}
            className="relative bg-surface px-4 py-3.5 sm:px-5"
          >
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.13em] text-muted">{item.label}</p>
            <p
              className={
                item.tone === 'positive'
                  ? 'mt-1 text-[1.05rem] font-semibold tabular text-positive'
                  : item.tone === 'negative'
                    ? 'mt-1 text-[1.05rem] font-semibold tabular text-negative'
                    : item.tone === 'warning'
                      ? 'mt-1 text-[1.05rem] font-semibold tabular text-warning'
                      : item.tone === 'accent'
                        ? 'mt-1 text-[1.05rem] font-semibold tabular text-accent'
                        : 'mt-1 text-[1.05rem] font-semibold tabular text-text'
              }
            >
              {item.value}
            </p>
            {item.hint ? <p className="mt-0.5 text-[0.64rem] leading-snug text-muted">{item.hint}</p> : null}
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ------------------------------- Status states ------------------------------ */

export function PageError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useApp()
  return (
    <Panel className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-negative/25 bg-negative-soft text-negative">
        <TriangleAlert size={20} />
      </div>
      <p className="text-[0.88rem] font-semibold text-text">{t('error.load')}</p>
      <p className="mt-1 max-w-md text-[0.74rem] leading-relaxed text-muted">{errorMessage(error)}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-4" icon={<RefreshCw size={13} />} onClick={onRetry}>
          {t('common.refresh')}
        </Button>
      ) : null}
    </Panel>
  )
}

export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Panel key={index} className="p-5">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="mt-3 h-7 w-32" />
            <Skeleton className="mt-2 h-2 w-20" />
          </Panel>
        ))}
      </div>
      <Panel className="p-4">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 border-b border-border py-3.5 last:border-0">
            <Skeleton className="h-9 w-9 rounded-xl" />
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="ms-auto h-3 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </Panel>
    </div>
  )
}

/* --------------------------------- Hooks ----------------------------------- */

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function usePageState(initialSize = 20) {
  const [page, setPage] = useState(1)
  const [pageSize] = useState(initialSize)
  return { page, pageSize, setPage }
}
