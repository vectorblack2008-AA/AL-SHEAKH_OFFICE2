import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import type { ZodType } from 'zod'
import type { Queryable } from './db.js'
import { db, q } from './db.js'

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, message: string, code = 'API_ERROR', details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

export function parseBody<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new ApiError(400, 'Please check the highlighted fields', 'VALIDATION_ERROR', result.error.issues)
  }
  return result.data
}

/**
 * Parses a partial update without allowing Zod defaults to overwrite fields the
 * client did not send. Without this, `schema.partial()` re-applies defaults such
 * as `status = 'available'` or an empty allocations array on every PATCH.
 */
export function parsePatch<T>(schema: ZodType<T>, data: unknown): Partial<T> {
  const parsed = parseBody(schema, data)
  const rawKeys = new Set(Object.keys((data ?? {}) as Record<string, unknown>))
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (rawKeys.has(key)) out[key] = value
  }
  return out as Partial<T>
}

const NUMERIC_KEYS = new Set([
  'value',
  'subtotal',
  'tax',
  'total',
  'amount',
  'amount_paid',
  'balance',
  'quoted_price',
  'recognized_revenue',
  'additional_charges',
  'discount',
  'price',
  'cost',
  'contract_value',
  'unit_rate',
  'monthly_salary',
  'odometer',
  'distance_km',
  'acquisition_cost',
  'allocated_amount',
  'percent',
  'allocation_percent',
  'operating_hours_per_day',
  'vat_rate',
  'included_hours',
  'revenue',
  'expenses',
  'profit',
  'operating_expenses',
  'recognized',
  'invoiced',
  'collected',
  'outstanding',
  'allocated_costs',
  'revenue_per_trip',
  'margin',
  'trips',
  'completed',
  'scheduled',
  'cancelled',
  'missed',
  'total_trips',
  'completed_trips',
  'scheduled_trips',
  'cancelled_trips',
  'active_drivers',
  'total_vehicles',
  'available_vehicles',
  'maintenance_vehicles',
  'utilization',
  'previous_revenue',
  'previous_expenses',
  'previous_profit',
  'distance',
  'hours',
  'count',
  'day',
  'quantity',
  'unit_price',
  'line_total',
  'fixed_revenue',
  'variable_revenue',
  'paid',
  'due',
  'total_due',
])

export function serialize<T>(value: T): T {
  return normalize(value) as T
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'password_hash') continue
      if (typeof val === 'string' && NUMERIC_KEYS.has(key) && val.trim() !== '' && !Number.isNaN(Number(val))) {
        out[key] = Number(val)
      } else {
        out[key] = normalize(val)
      }
    }
    return out
  }
  return value
}

export function actorFrom(req: Request) {
  return {
    id: req.user?.id ?? null,
    name: req.user?.full_name ?? 'System',
    ip: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || null,
  }
}

export async function audit(
  req: Request,
  action: string,
  entityType: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
  tx?: Queryable,
) {
  const actor = actorFrom(req)
  const runner = tx ?? db
  await runner.query(
    `INSERT INTO audit_logs (id, actor_id, actor_name, action, entity_type, entity_id, before_data, after_data, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
    [
      randomUUID(),
      actor.id,
      actor.name,
      action,
      entityType,
      entityId,
      before === null || before === undefined ? null : JSON.stringify(before),
      after === null || after === undefined ? null : JSON.stringify(serialize(after)),
      actor.ip,
    ],
  )
}

export async function notifyAdmins(
  tx: Queryable,
  payload: { title: string; message: string; type?: 'info' | 'success' | 'warning' | 'danger'; link?: string },
) {
  const admins = await tx.query<{ id: string }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = 'admin' AND u.is_active = true`,
  )
  for (const admin of admins.rows) {
    await tx.query(
      `INSERT INTO notifications (id, user_id, title, message, type, link) VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), admin.id, payload.title, payload.message, payload.type ?? 'info', payload.link ?? null],
    )
  }
}

export let BUSINESS_TIMEZONE = process.env.SHOP_TIMEZONE || 'Africa/Cairo'

/** Validate an IANA timezone name without throwing. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format()
    return true
  } catch {
    return false
  }
}

/** Keep date helpers aligned with the workspace setting while the process runs. */
export function setBusinessTimezone(timeZone?: string | null) {
  if (!timeZone || !isValidTimeZone(timeZone)) return
  BUSINESS_TIMEZONE = timeZone
}

/**
 * Today's date in the office timezone. Serverless runtimes run in UTC, so using
 * `new Date()` directly would report yesterday during the first hours of a Cairo
 * morning and shift daily reports, overdue checks and invoice dates.
 */
export function todayDate(timeZone = BUSINESS_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function toDateOnly(value: string | Date): string {
  if (value instanceof Date) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(value).slice(0, 10)
}

export function toLocalDateTime(value: string | Date): string {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:00`
  }
  return String(value).replace(' ', 'T').slice(0, 19)
}

export function dateRangeFromQuery(from?: string, to?: string): { from: string; to: string } {
  const today = todayDate()
  const defaultFrom = `${today.slice(0, 7)}-01`
  return {
    from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : defaultFrom,
    to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : today,
  }
}

export function daysInclusive(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1)
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`)
  value.setDate(value.getDate() + days)
  return toDateOnly(value)
}

export function monthPeriods(startDate: string, endDate: string, today = new Date()) {
  const periods: { start: string; end: string }[] = []
  const cursor = new Date(`${startDate}T12:00:00`)
  const end = new Date(`${endDate}T12:00:00`)
  const limit = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
  while (cursor <= end && cursor <= limit) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12)
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 12)
    const clippedStart = monthStart < new Date(`${startDate}T12:00:00`) ? new Date(`${startDate}T12:00:00`) : monthStart
    const clippedEnd = monthEnd > end ? end : monthEnd
    periods.push({ start: toDateOnly(clippedStart), end: toDateOnly(clippedEnd) })
    cursor.setMonth(cursor.getMonth() + 1, 1)
  }
  return periods
}

/** Format a database Date for CSV: date-only values stay dates, timestamps use office time. */
function csvDate(value: Date): string {
  const dateOnly =
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const }),
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  const date = `${part('year')}-${part('month')}-${part('day')}`
  return dateOnly ? date : `${date} ${part('hour')}:${part('minute')}`
}

export function csvEscape(value: unknown): string {
  let text: string
  if (value === null || value === undefined) text = ''
  else if (value instanceof Date) text = csvDate(value)
  else text = String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n')
}

export function requireAdmin(req: Request) {
  if (req.user?.role_key !== 'admin') {
    throw new ApiError(403, 'Administrator access is required', 'ADMIN_REQUIRED')
  }
}

export function pagination(query: Request['query']) {
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(500, Math.max(5, Number(query.pageSize) || 20))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

export async function getSetting<T = string>(key: string, fallback: T): Promise<T> {
  const row = await q<Record<string, unknown>>(`SELECT * FROM business_settings WHERE id = 1`)
  const value = row[0]?.[key]
  return (value ?? fallback) as T
}

export function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}
