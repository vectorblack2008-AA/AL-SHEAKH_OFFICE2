import type { ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import { cn } from '../lib/utils'
import { EmptyState, Panel, SectionHeader } from './ui'
import { BarChart3 } from 'lucide-react'

export function useChartPalette() {
  const { theme } = useApp()
  return theme === 'dark'
    ? ['#D6B15E', '#B9A0F5', '#7CC9A1', '#E38F7D', '#92B6E8', '#8C7A4D', '#A88A5C', '#6F9D8A']
    : ['#49356D', '#B9A0F5', '#2F7D5A', '#B4543F', '#3C6CA8', '#8B73BA', '#9B6C20', '#4F8D79']
}

export function ChartCard({
  title,
  hint,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode
  hint?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <Panel className={cn('flex min-w-0 flex-col overflow-hidden', className)}>
      <div className="px-4 pb-1 pt-4 sm:px-5 sm:pt-5">
        <SectionHeader title={title} hint={hint} action={action} />
      </div>
      <div className={cn('min-w-0 flex-1 px-2 pb-3 pt-2 sm:px-3', bodyClassName)}>{children}</div>
    </Panel>
  )
}

export function ChartEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-[220px] items-center justify-center">
      <EmptyState icon={<BarChart3 size={20} />} title={title} hint={hint} />
    </div>
  )
}

export function ChartTooltip(props: any) {
  const { active, payload, label, labelFormatter, formatter } = props
  if (!active || !payload?.length) return null
  return (
    <div className="min-w-[9rem] rounded-xl border border-border bg-surface/95 px-3 py-2.5 shadow-2xl backdrop-blur-xl">
      <p className="mb-1.5 text-[0.66rem] font-semibold text-muted">
        {labelFormatter ? labelFormatter(label) : label}
      </p>
      <div className="space-y-1">
        {payload.map((item: any, index: number) => (
          <div key={`${item.dataKey}-${index}`} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-[0.68rem] text-text-soft">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color || item.fill }} />
              {item.name}
            </span>
            <span className="text-[0.7rem] font-semibold tabular text-text">
              {formatter ? formatter(item.value, item.name, item) : item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function LegendDots({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 text-[0.66rem] text-muted">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

export const chartAxisStyle = {
  tick: { fontSize: 10, fill: 'var(--muted)' },
  axisLine: false as const,
  tickLine: false as const,
}

export const chartGridStyle = {
  stroke: 'var(--chart-grid)',
  strokeDasharray: '3 3',
  vertical: false as const,
}
