import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function money(value: unknown, currency = 'EGP', lang: 'en' | 'ar' = 'en', compact = false): string {
  const amount = num(value)
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    notation: compact && Math.abs(amount) >= 100_000 ? 'compact' : 'standard',
    maximumFractionDigits: compact && Math.abs(amount) >= 100_000 ? 1 : 2,
    minimumFractionDigits: compact && Math.abs(amount) >= 100_000 ? 0 : 2,
  }).format(amount)
}

export function decimal(value: unknown, digits = 1, lang: 'en' | 'ar' = 'en'): string {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(num(value))
}

export function percent(value: unknown, digits = 1, lang: 'en' | 'ar' = 'en'): string {
  return `${decimal(value, digits, lang)}%`
}

export function compact(value: unknown, lang: 'en' | 'ar' = 'en'): string {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(num(value))
}

export function parseDateInput(value?: string | null): string {
  if (!value) return ''
  const iso = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : ''
}

export function parseDateTimeInput(value?: string | null): string {
  if (!value) return ''
  const raw = String(value)
  if (raw.includes('T')) return raw.slice(0, 16)
  return raw.replace(' ', 'T').slice(0, 16)
}

export function todayISO(): string {
  return dateToISO(new Date())
}

export function dateToISO(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDaysISO(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() + days)
  return dateToISO(date)
}

export function rangeFromDays(days: number, end = todayISO()): { from: string; to: string } {
  return { from: addDaysISO(end, -(Math.max(1, days) - 1)), to: end }
}

export function monthStartISO(iso = todayISO()): string {
  return `${iso.slice(0, 7)}-01`
}

export function formatDate(value?: string | null, lang: 'en' | 'ar' = 'en', options?: Intl.DateTimeFormatOptions): string {
  if (!value) return '—'
  const date = new Date(String(value).length <= 10 ? `${String(value).slice(0, 10)}T12:00:00` : String(value))
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-ca-gregory-nu-latn' : 'en-EG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...options,
  }).format(date)
}

export function formatDateTime(value?: string | null, lang: 'en' | 'ar' = 'en'): string {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-ca-gregory-nu-latn' : 'en-EG', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatTime(value?: string | null, lang: 'en' | 'ar' = 'en'): string {
  if (!value) return '—'
  if (/^\d{2}:\d{2}/.test(String(value))) return String(value).slice(0, 5)
  const date = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function dateFromTimestamp(value?: string | null): string {
  return value ? String(value).slice(0, 10) : ''
}

export function relativeDays(value?: string | null): number | null {
  if (!value) return null
  const target = new Date(`${String(value).slice(0, 10)}T12:00:00`).getTime()
  const today = new Date(`${todayISO()}T12:00:00`).getTime()
  return Math.round((target - today) / 86_400_000)
}

export function initials(name?: string | null): string {
  if (!name) return '—'
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function localName(row: Record<string, unknown> | null | undefined, base: string, lang: 'en' | 'ar'): string {
  if (!row) return '—'
  const ar = row[`${base}_ar`]
  const en = row[`${base}_en`]
  if (lang === 'ar') return String(ar || en || '—')
  return String(en || ar || '—')
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function delta(current: number, previous: number): number | null {
  if (!previous) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function sortBy<T>(rows: T[], get: (row: T) => number | string, direction: 'asc' | 'desc' = 'asc'): T[] {
  return [...rows].sort((a, b) => {
    const left = get(a)
    const right = get(b)
    if (left === right) return 0
    return (left > right ? 1 : -1) * (direction === 'asc' ? 1 : -1)
  })
}

export function groupBy<T>(rows: T[], get: (row: T) => string): Record<string, T[]> {
  return rows.reduce<Record<string, T[]>>((acc, row) => {
    const key = get(row)
    ;(acc[key] ||= []).push(row)
    return acc
  }, {})
}

export function sum<T>(rows: T[], get: (row: T) => number): number {
  return rows.reduce((total, row) => total + num(get(row)), 0)
}

export function escapeCsv(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
}

export function initialsColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360
  return `hsl(${hash} 32% 42%)`
}
