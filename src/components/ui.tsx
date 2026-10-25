import {
  Children,
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Loader2,
  Search,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'
import { cn, decimal } from '../lib/utils'
import { useApp } from '../context/AppContext'

/* ---------------------------------- Logo ---------------------------------- */

export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="1.5" y="1.5" width="45" height="45" rx="13" fill="#0B0B0B" stroke="url(#gold)" strokeWidth="1.2" />
      <rect x="5.5" y="5.5" width="37" height="37" rx="9.5" stroke="url(#gold)" strokeOpacity="0.32" />
      <path d="M15 34V23.5C15 18.25 19.03 14 24 14C28.97 14 33 18.25 33 23.5V34" stroke="url(#gold)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M20.5 34V24.2C20.5 22.43 22.07 21 24 21C25.93 21 27.5 22.43 27.5 24.2V34" stroke="url(#gold)" strokeOpacity="0.55" strokeWidth="1.1" />
      <path d="M11 34H37" stroke="url(#gold)" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M24 8.2L25 10.2L27 11.2L25 12.2L24 14.2L23 12.2L21 11.2L23 10.2L24 8.2Z" fill="#D6B15E" />
      <defs>
        <linearGradient id="gold" x1="8" y1="6" x2="41" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E8CC85" />
          <stop offset="0.55" stopColor="#D6B15E" />
          <stop offset="1" stopColor="#9F7C35" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function LogoWordmark({ compact = false }: { compact?: boolean }) {
  const { t, language } = useApp()
  return (
    <div className="flex items-center gap-3">
      <LogoMark size={compact ? 34 : 40} />
      <div className="min-w-0">
        <p className={cn('truncate font-semibold tracking-tight text-text', compact ? 'text-sm' : 'text-[0.95rem]')}>
          {language === 'ar' ? t('app.officeArabic') : 'AL-SHEIKH'}
        </p>
        <p className="eyebrow mt-0.5 truncate text-[0.52rem] tracking-[0.22em]">
          {language === 'ar' ? t('app.office') : 'OFFICE · CAIRO'}
        </p>
      </div>
    </div>
  )
}

/* --------------------------------- Buttons -------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      className={cn(
        'btn',
        variant === 'primary' && 'btn-primary',
        variant === 'secondary' && 'btn-secondary',
        variant === 'ghost' && 'btn-ghost',
        variant === 'danger' && 'btn-danger',
        size === 'sm' && 'btn-sm',
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  )
})

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  variant?: ButtonVariant
  size?: 'sm' | 'md'
}

export function IconButton({ label, variant = 'ghost', size = 'md', className, children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'btn btn-icon',
        variant === 'primary' && 'btn-primary',
        variant === 'secondary' && 'btn-secondary',
        variant === 'ghost' && 'btn-ghost',
        variant === 'danger' && 'btn-danger',
        size === 'sm' && 'h-8 w-8 rounded-lg',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/* --------------------------------- Inputs --------------------------------- */

export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label?: string
  hint?: string
  error?: string
  required?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {label ? (
        <label className="label">
          {label}
          {required ? <span className="text-accent"> *</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p className="mt-1 text-[0.7rem] font-medium text-negative">{error}</p> : null}
      {!error && hint ? <p className="hint mt-1">{hint}</p> : null}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn('field', className)} {...props} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn('field', className)} {...props}>
      {children}
    </select>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...props },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn('field resize-y', className)} {...props} />
})

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  description?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <label className={cn('group flex cursor-pointer items-start gap-2.5', disabled && 'cursor-not-allowed opacity-60', className)}>
      <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer h-4 w-4 appearance-none rounded-[4px] border border-border bg-surface-2 transition checked:border-accent checked:bg-accent"
        />
        <svg
          viewBox="0 0 12 12"
          className="pointer-events-none absolute h-2.5 w-2.5 text-accent-contrast opacity-0 transition peer-checked:opacity-100"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 6.2 4.6 8.8 10 3.2" />
        </svg>
      </span>
      {label || description ? (
        <span className="min-w-0">
          {label ? <span className="block text-[0.78rem] font-medium leading-snug text-text">{label}</span> : null}
          {description ? <span className="mt-0.5 block text-[0.68rem] leading-relaxed text-muted">{description}</span> : null}
        </span>
      ) : null}
    </label>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-2.5', disabled && 'cursor-not-allowed opacity-60')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 rounded-full border transition',
          checked ? 'border-accent bg-accent' : 'border-border bg-surface-3',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all',
            checked ? 'start-[1.15rem] bg-accent-contrast' : 'start-0.5 bg-muted',
          )}
        />
      </button>
      {label ? <span className="text-[0.78rem] font-medium text-text">{label}</span> : null}
    </label>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  const { t } = useApp()
  return (
    <div className={cn('relative', className)}>
      <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? t('common.searchPlaceholder')}
        className="field ps-9"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted hover:text-text"
          aria-label={t('common.clear')}
        >
          <X size={13} />
        </button>
      ) : null}
    </div>
  )
}

/* --------------------------------- Layout --------------------------------- */

export function Panel({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'article'
}) {
  return <Tag className={cn('panel', className)}>{children}</Tag>
}

export function SectionHeader({
  title,
  hint,
  action,
  className,
}: {
  title: ReactNode
  hint?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-[0.95rem] font-semibold tracking-tight text-text">{title}</h2>
        {hint ? <p className="mt-0.5 text-[0.72rem] leading-relaxed text-muted">{hint}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  children,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="animate-fade-up">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
          <h1 className="display text-2xl text-text sm:text-[1.75rem]">{title}</h1>
          {subtitle ? <p className="mt-1.5 max-w-2xl text-[0.8rem] leading-relaxed text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('gold-rule my-4', className)} />
}

/* --------------------------------- Badges --------------------------------- */

export type Tone = 'positive' | 'negative' | 'warning' | 'info' | 'neutral' | 'accent'

const toneClasses: Record<Tone, string> = {
  positive: 'border-positive/25 bg-positive-soft text-positive',
  negative: 'border-negative/25 bg-negative-soft text-negative',
  warning: 'border-warning/25 bg-warning-soft text-warning',
  info: 'border-info/25 bg-info-soft text-info',
  neutral: 'border-border bg-surface-2 text-muted',
  accent: 'border-accent/30 bg-accent-soft text-accent',
}

export function Badge({
  tone = 'neutral',
  dot = false,
  children,
  className,
}: {
  tone?: Tone
  dot?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cn('badge', toneClasses[tone], className)}>
      {dot ? <span className="badge-dot" /> : null}
      {children}
    </span>
  )
}

export function statusTone(status: string): Tone {
  switch (status) {
    case 'active':
    case 'available':
    case 'completed':
    case 'paid':
    case 'posted':
    case 'success':
      return 'positive'
    case 'scheduled':
    case 'confirmed':
    case 'on_trip':
    case 'in_progress':
    case 'sent':
    case 'info':
      return 'info'
    case 'pending_confirmation':
    case 'partially_paid':
    case 'partial':
    case 'under_maintenance':
    case 'on_leave':
    case 'paused':
    case 'expiring':
    case 'warning':
      return 'warning'
    case 'cancelled':
    case 'missed':
    case 'overdue':
    case 'void':
    case 'inactive':
    case 'expired':
    case 'error':
      return 'negative'
    case 'new_request':
    case 'draft':
      return 'neutral'
    default:
      return 'neutral'
  }
}

export function StatusBadge({ status, dot = true, className }: { status: string; dot?: boolean; className?: string }) {
  const { t } = useApp()
  const key = `status.${status}` as Parameters<typeof t>[0]
  const label = (() => {
    try {
      return t(key)
    } catch {
      return status.replace(/_/g, ' ')
    }
  })()
  return (
    <Badge tone={statusTone(status)} dot={dot} className={className}>
      {label === key ? status.replace(/_/g, ' ') : label}
    </Badge>
  )
}

export function Delta({ value, suffix }: { value: number | null | undefined; suffix?: string }) {
  const { t } = useApp()
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className="text-[0.68rem] text-muted">{t('dashboard.noPrevious')}</span>
  }
  const positive = value >= 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[0.7rem] font-semibold tabular',
        positive ? 'text-positive' : 'text-negative',
      )}
    >
      {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {positive ? '+' : ''}
      {decimal(value, 1)}%{suffix ? <span className="font-normal text-muted">{suffix}</span> : null}
    </span>
  )
}

/* --------------------------------- Stats ---------------------------------- */

export function Sparkline({ values, tone = 'accent' }: { values: number[]; tone?: 'accent' | 'positive' | 'negative' }) {
  if (!values.length) return null
  const width = 92
  const height = 28
  const max = Math.max(...values)
  const min = Math.min(...values)
  const spread = max - min || 1
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width
      const y = height - ((value - min) / spread) * (height - 4) - 2
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const stroke = tone === 'positive' ? 'var(--positive)' : tone === 'negative' ? 'var(--negative)' : 'var(--accent)'
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden="true">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
    </svg>
  )
}

export function KpiCard({
  label,
  value,
  hint,
  icon,
  delta,
  deltaSuffix,
  spark,
  tone = 'accent',
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  delta?: number | null
  deltaSuffix?: string
  spark?: number[]
  tone?: 'accent' | 'positive' | 'negative'
  className?: string
}) {
  return (
    <div className={cn('panel group relative overflow-hidden p-4 sm:p-5', className)}>
      <div
        className={cn(
          'pointer-events-none absolute -end-8 -top-10 h-28 w-28 rounded-full opacity-60 blur-2xl transition-opacity group-hover:opacity-100',
          tone === 'accent' && 'bg-accent/10',
          tone === 'positive' && 'bg-positive/10',
          tone === 'negative' && 'bg-negative/10',
        )}
      />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="eyebrow text-[0.6rem]">{label}</p>
          <div className="stat-figure mt-2 text-text">{value}</div>
        </div>
        {icon ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2 text-accent">
            {icon}
          </span>
        ) : null}
      </div>
      <div className="relative mt-2 flex min-h-[1.25rem] items-end justify-between gap-2">
        <div className="text-[0.68rem] text-muted">
          {delta !== undefined ? <Delta value={delta} suffix={deltaSuffix} /> : hint}
        </div>
        {spark && spark.length > 1 ? <Sparkline values={spark} tone={tone} /> : null}
      </div>
    </div>
  )
}

export function MiniStat({ label, value, tone = 'text-text' }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div>
      <p className="text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className={cn('mt-1 text-[0.95rem] font-semibold tabular', tone)}>{value}</p>
    </div>
  )
}

export function Progress({
  value,
  tone = 'accent',
  className,
  height = 'h-1.5',
}: {
  value: number
  tone?: 'accent' | 'positive' | 'negative' | 'info' | 'warning'
  className?: string
  height?: string
}) {
  const toneClass =
    tone === 'positive'
      ? 'bg-positive'
      : tone === 'negative'
        ? 'bg-negative'
        : tone === 'info'
          ? 'bg-info'
          : tone === 'warning'
            ? 'bg-warning'
            : 'bg-accent'
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-surface-3', height, className)}>
      <div className={cn('h-full rounded-full transition-all duration-500', toneClass)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

/* --------------------------------- Avatar --------------------------------- */

export function Avatar({ name, size = 'md', className }: { name?: string | null; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const parts = (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent-soft font-semibold text-accent',
        size === 'sm' && 'h-7 w-7 text-[0.62rem]',
        size === 'md' && 'h-9 w-9 text-[0.72rem]',
        size === 'lg' && 'h-12 w-12 text-[0.9rem]',
        className,
      )}
      aria-hidden="true"
    >
      {parts}
    </span>
  )
}

/* --------------------------------- Tabs ----------------------------------- */

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T
  onChange: (value: T) => void
  items: Array<{ value: T; label: string; count?: number }>
  className?: string
}) {
  return (
    <div className={cn('scroll-x flex items-center gap-1 border-b border-border', className)}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          data-active={value === item.value}
          className={cn(
            'relative whitespace-nowrap px-3 py-2.5 text-[0.76rem] font-semibold transition-colors',
            value === item.value ? 'text-text' : 'text-muted hover:text-text',
          )}
        >
          <span className="flex items-center gap-1.5">
            {item.label}
            {item.count !== undefined ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[0.6rem] tabular',
                  value === item.value ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted',
                )}
              >
                {item.count}
              </span>
            ) : null}
          </span>
          {value === item.value ? <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" /> : null}
        </button>
      ))}
    </div>
  )
}

/* -------------------------------- Popover --------------------------------- */

interface PopoverContextValue {
  close: () => void
}

const PopoverContext = createContext<PopoverContextValue>({ close: () => {} })

export function Popover({
  trigger,
  children,
  align = 'end',
  width = 'w-72',
  className,
}: {
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'end'
  width?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((current) => !current)}>{trigger}</div>
      {open ? (
        <div
          className={cn(
            'animate-fade-up absolute top-full z-50 mt-2 rounded-2xl border border-border bg-surface p-2 shadow-2xl',
            align === 'end' ? 'end-0' : 'start-0',
            width,
            className,
          )}
        >
          <PopoverContext.Provider value={{ close: () => setOpen(false) }}>{children}</PopoverContext.Provider>
        </div>
      ) : null}
    </div>
  )
}

export function usePopover() {
  return useContext(PopoverContext)
}

/* --------------------------------- Modal ---------------------------------- */

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl'
const modalSizes: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
  hideClose,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: ModalSize
  className?: string
  hideClose?: boolean
}) {
  const { t } = useApp()
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 backdrop-blur-[3px] sm:items-center sm:p-6">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'animate-fade-up relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-2xl',
          modalSizes[size],
          className,
        )}
      >
        {title || !hideClose ? (
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              {title ? <h3 className="text-[0.95rem] font-semibold tracking-tight text-text">{title}</h3> : null}
              {description ? <p className="mt-0.5 text-[0.72rem] leading-relaxed text-muted">{description}</p> : null}
            </div>
            {!hideClose ? (
              <IconButton label={t('common.close')} onClick={onClose} size="sm" className="-me-1 -mt-1">
                <X size={16} />
              </IconButton>
            ) : null}
          </div>
        ) : null}
        <div className="scroll-x min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-2/50 px-5 py-3.5">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-xl',
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  const { t } = useApp()
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[75] bg-black/55 backdrop-blur-[2px]">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'animate-sheet absolute inset-y-0 end-0 flex w-full flex-col border-s border-border bg-surface shadow-2xl',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {title ? <h3 className="text-[1rem] font-semibold tracking-tight text-text">{title}</h3> : null}
            {description ? <p className="mt-0.5 text-[0.72rem] leading-relaxed text-muted">{description}</p> : null}
          </div>
          <IconButton label={t('common.close')} onClick={onClose} size="sm" className="-me-1">
            <X size={16} />
          </IconButton>
        </div>
        <div className="scroll-x min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-2/50 px-5 py-3.5">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  tone = 'danger',
  loading,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: ReactNode
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  loading?: boolean
}) {
  const { t } = useApp()
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <p className="text-[0.82rem] leading-relaxed text-text-soft">{description}</p>
    </Modal>
  )
}

/* ------------------------------- Pagination ------------------------------- */

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const { t, language } = useApp()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-3">
      <p className="text-[0.7rem] text-muted">
        {t('common.showing')} <span className="tabular text-text-soft">{from}</span>–
        <span className="tabular text-text-soft">{to}</span> {t('common.of')}{' '}
        <span className="tabular text-text-soft">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <IconButton label={t('common.previous')} size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft size={14} className={language === 'ar' ? 'rotate-180' : ''} />
        </IconButton>
        <span className="px-2 text-[0.7rem] tabular text-muted">
          {t('common.page')} {page} / {pages}
        </span>
        <IconButton label={t('common.next')} size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight size={14} className={language === 'ar' ? 'rotate-180' : ''} />
        </IconButton>
      </div>
    </div>
  )
}

/* -------------------------------- Empty/Load ------------------------------- */

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  hint?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-surface-2 text-muted">
        {icon ?? <ChevronsUpDown size={20} />}
      </div>
      <p className="text-[0.86rem] font-semibold text-text">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-[0.73rem] leading-relaxed text-muted">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="panel overflow-hidden p-1">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid gap-4 border-b border-border px-4 py-3.5 last:border-0" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((__, colIndex) => (
            <Skeleton key={colIndex} className={cn('h-3.5', colIndex === 0 ? 'w-4/5' : 'w-2/3')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn('animate-spin text-accent', className)} />
}

/* ------------------------------ Misc helpers ------------------------------ */

export function InfoRow({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-border py-2.5 last:border-0', className)}>
      <span className="text-[0.7rem] text-muted">{label}</span>
      <span className="text-end text-[0.76rem] font-medium text-text">{value}</span>
    </div>
  )
}

export function TabPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('animate-fade-in', className)}>{children}</div>
}

export function Separator({ label }: { label?: string }) {
  if (!label) return <div className="gold-rule my-4" />
  return (
    <div className="my-4 flex items-center gap-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-muted">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

export function CountUp({ value, duration = 550 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0)
  const previous = useRef(0)
  useEffect(() => {
    const from = previous.current
    const to = value
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(from + (to - from) * eased)
      if (progress < 1) frame = requestAnimationFrame(tick)
      else previous.current = to
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])
  return <>{decimal(display, 0)}</>
}

/* Re-export a few commonly used primitives so pages have one import. */
export { Children, useId }
