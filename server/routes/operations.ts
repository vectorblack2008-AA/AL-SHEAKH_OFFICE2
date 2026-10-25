import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { requirePermission } from '../auth.js'
import { code, nextSequence, one, q, transaction, type Queryable } from '../db.js'
import {
  ApiError,
  addDays,
  asyncHandler,
  audit,
  dateRangeFromQuery,
  toDateOnly,
  toLocalDateTime,
  pagination,
  parseBody,
  parsePatch,
  serialize,
  todayDate,
} from '../lib.js'
import {
  assertSchedulingIsClear,
  assertVehicleAvailableForMaintenance,
  refreshVehicleStatuses,
  schedulingConflicts,
} from '../services/scheduling.js'
import { directTripRevenue, tripShouldRecognizeRevenue } from '../services/finance.js'

export const operationsRouter = Router()

const daySchema = z.array(z.coerce.number().int().min(0).max(6)).min(1)
const routeSchema = z.object({
  name_en: z.string().trim().min(2).max(120),
  name_ar: z.string().trim().min(2).max(120),
  origin: z.string().trim().min(2).max(160),
  destination: z.string().trim().min(2).max(160),
  stops: z.array(z.string().trim().max(160)).default([]),
  operating_days: daySchema,
  departure_time: z.string().regex(/^\d{2}:\d{2}$/),
  duration_minutes: z.coerce.number().int().min(5).max(1440),
  price: z.coerce.number().min(0),
  default_vehicle_id: z.string().uuid().nullable().optional(),
  default_driver_id: z.string().uuid().nullable().optional(),
  effective_from: z.string().date(),
  effective_to: z.string().date().nullable().optional(),
  status: z.enum(['active', 'paused', 'archived']).default('active'),
  notes: z.string().max(2000).nullable().optional(),
})

const customerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  type: z.enum(['company', 'institution', 'individual']).default('company'),
  contact_name: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().email().max(160).nullable().optional().or(z.literal('')),
  tax_id: z.string().trim().max(60).nullable().optional(),
  address: z.string().trim().max(400).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

const tripSchema = z.object({
  trip_type: z.enum(['fixed', 'private']),
  route_id: z.string().uuid().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  contract_id: z.string().uuid().nullable().optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
  driver_id: z.string().uuid().nullable().optional(),
  origin: z.string().trim().min(1).max(200),
  destination: z.string().trim().min(1).max(200),
  stops: z.array(z.string().trim().max(160)).default([]),
  scheduled_departure: z.string().min(16).max(30),
  expected_arrival: z.string().min(16).max(30).nullable().optional(),
  distance_km: z.coerce.number().min(0).nullable().optional(),
  quoted_price: z.coerce.number().min(0).default(0),
  additional_charges: z.coerce.number().min(0).default(0),
  discount: z.coerce.number().min(0).default(0),
  status: z.enum(['new_request','pending_confirmation','confirmed','scheduled','in_progress','completed','cancelled','missed']).default('new_request'),
  cancellation_reason: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

const ACTIVE_TRIP_STATUSES = ['confirmed', 'scheduled', 'in_progress']

function nullify<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = { ...value }
  for (const key of Object.keys(out)) if (out[key] === '') out[key] = null
  return out as T
}

function asTimestamp(value: string): string {
  return value.replace('T', ' ').slice(0, 19)
}

async function tripRevenueForStatus(
  trip: {
    contract_id: string | null
    quoted_price: number
    additional_charges: number
    discount: number
    status: string
  },
  tx: Queryable,
): Promise<number> {
  if (trip.status !== 'completed') return 0
  const rule = await tripShouldRecognizeRevenue(trip.contract_id, tx)
  if (!rule.recognize) return 0
  return directTripRevenue({
    id: '',
    trip_no: '',
    status: trip.status,
    contract_id: trip.contract_id,
    quoted_price: trip.quoted_price,
    additional_charges: trip.additional_charges,
    discount: trip.discount,
  })
}

/* ---------------------------------- Routes --------------------------------- */

operationsRouter.get(
  '/routes',
  requirePermission('view_routes'),
  asyncHandler(async (req, res) => {
    const { from, to } = dateRangeFromQuery(req.query.from as string, req.query.to as string)
    const status = String(req.query.status || '')
    const search = String(req.query.search || '').trim()
    const params: unknown[] = [from, to]
    const filters = ['r.archived_at IS NULL']
    if (status) {
      params.push(status)
      filters.push(`r.status = $${params.length}`)
    }
    if (search) {
      params.push(`%${search}%`)
      filters.push(`(r.name_en ILIKE $${params.length} OR r.name_ar ILIKE $${params.length} OR r.route_no ILIKE $${params.length} OR r.origin ILIKE $${params.length} OR r.destination ILIKE $${params.length})`)
    }
    const rows = await q(
      `SELECT r.*, v.plate AS vehicle_plate, d.full_name AS driver_name,
        COALESCE(t.trips,0) AS trips,
        COALESCE(t.completed,0) AS completed_trips,
        COALESCE(t.cancelled,0) AS cancelled_trips,
        COALESCE(t.revenue,0) AS revenue,
        COALESCE(t.expenses,0) AS expenses,
        COALESCE(t.revenue,0) - COALESCE(t.expenses,0) AS profit,
        (SELECT json_agg(rs ORDER BY rs.effective_from DESC) FROM route_schedules rs WHERE rs.route_id = r.id) AS schedules
       FROM routes r
       LEFT JOIN vehicles v ON v.id = r.default_vehicle_id
       LEFT JOIN drivers d ON d.id = r.default_driver_id
       LEFT JOIN (
         SELECT tr.route_id,
           COUNT(*) AS trips,
           COUNT(*) FILTER (WHERE tr.status = 'completed') AS completed,
           COUNT(*) FILTER (WHERE tr.status = 'cancelled') AS cancelled,
           COALESCE(SUM(tr.recognized_revenue) FILTER (WHERE tr.status = 'completed'),0) AS revenue,
           COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.trip_id IN (SELECT t2.id FROM trips t2 WHERE t2.route_id = tr.route_id AND t2.scheduled_departure::date BETWEEN $1::date AND $2::date) AND e.status = 'posted' AND e.is_operating = true),0) AS expenses
         FROM trips tr WHERE tr.scheduled_departure::date BETWEEN $1::date AND $2::date AND tr.route_id IS NOT NULL
         GROUP BY tr.route_id
       ) t ON t.route_id = r.id
       WHERE ${filters.join(' AND ')}
       ORDER BY r.status, r.route_no`,
      params,
    )
    const summary = await q(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (WHERE status = 'paused') AS paused,
        (SELECT COUNT(*) FROM trips WHERE trip_type = 'fixed' AND scheduled_departure::date BETWEEN $1::date AND $2::date) AS trips,
        (SELECT COALESCE(SUM(recognized_revenue),0) FROM trips WHERE trip_type = 'fixed' AND status = 'completed' AND scheduled_departure::date BETWEEN $1::date AND $2::date) AS revenue
       FROM routes WHERE archived_at IS NULL`,
      [from, to],
    )
    res.json(serialize({ data: rows, summary: summary[0], range: { from, to } }))
  }),
)

operationsRouter.post(
  '/routes',
  requirePermission('manage_routes'),
  asyncHandler(async (req, res) => {
    const body = nullify(parseBody(routeSchema, req.body))
    const seq = await nextSequence('route')
    const id = randomUUID()
    const result = await transaction(async (tx) => {
      const route = await tx.query(
        `INSERT INTO routes (id, route_no, name_en, name_ar, origin, destination, stops, operating_days, departure_time,
          duration_minutes, price, default_vehicle_id, default_driver_id, effective_from, effective_to, status, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18) RETURNING *`,
        [id, code('RT', seq, 3), body.name_en, body.name_ar, body.origin, body.destination,
          JSON.stringify(body.stops ?? []), JSON.stringify(body.operating_days), body.departure_time,
          body.duration_minutes, body.price, body.default_vehicle_id ?? null, body.default_driver_id ?? null,
          body.effective_from, body.effective_to ?? null, body.status, body.notes ?? null, req.user!.id],
      )
      await tx.query(
        `INSERT INTO route_schedules (id, route_id, days_of_week, departure_time, duration_minutes, effective_from, effective_to, status)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8)`,
        [randomUUID(), id, JSON.stringify(body.operating_days), body.departure_time, body.duration_minutes,
          body.effective_from, body.effective_to ?? null, body.status === 'active' ? 'active' : 'paused'],
      )
      return route.rows[0]
    })
    await audit(req, 'create', 'route', id, null, result)
    res.status(201).json(serialize(result))
  }),
)

operationsRouter.patch(
  '/routes/:id',
  requirePermission('manage_routes'),
  asyncHandler(async (req, res) => {
    const body = nullify(parsePatch(routeSchema.partial(), req.body))
    const before = await one<Record<string, unknown>>(`SELECT * FROM routes WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Route not found', 'NOT_FOUND')
    const allowed = ['name_en','name_ar','origin','destination','stops','operating_days','departure_time','duration_minutes','price','default_vehicle_id','default_driver_id','effective_from','effective_to','status','notes']
    const entries = Object.entries(body).filter(([key]) => allowed.includes(key))
    if (entries.length === 0) throw new ApiError(400, 'No changes supplied', 'VALIDATION_ERROR')
    const row = await transaction(async (tx) => {
      const assignments = entries.map(([key], index) => `${key} = $${index + 2}${['stops','operating_days'].includes(key) ? '::jsonb' : ''}`).join(', ')
      const updated = await tx.query(
        `UPDATE routes SET ${assignments}, updated_by = $${entries.length + 2} WHERE id = $1 RETURNING *`,
        [req.params.id, ...entries.map(([key, value]) => (['stops','operating_days'].includes(key) ? JSON.stringify(value) : value)), req.user!.id],
      )
      const scheduleFields = ['operating_days','departure_time','duration_minutes','effective_from','effective_to','status']
      if (entries.some(([key]) => scheduleFields.includes(key))) {
        const current = updated.rows[0] as Record<string, unknown>
        await tx.query(
          `UPDATE route_schedules SET status = 'paused', effective_to = $2::date - 1 WHERE route_id = $1 AND status = 'active'`,
          [req.params.id, todayDate()],
        )
        await tx.query(
          `INSERT INTO route_schedules (id, route_id, days_of_week, departure_time, duration_minutes, effective_from, effective_to, status)
           VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8)`,
          [randomUUID(), req.params.id, JSON.stringify(current.operating_days), current.departure_time,
            current.duration_minutes, current.effective_from, current.effective_to ?? null,
            current.status === 'active' ? 'active' : 'paused'],
        )
      }
      return updated.rows[0]
    })
    await audit(req, 'update', 'route', req.params.id, before, row)
    res.json(serialize(row))
  }),
)

operationsRouter.post(
  '/routes/:id/archive',
  requirePermission('manage_routes'),
  asyncHandler(async (req, res) => {
    const before = await one(`SELECT * FROM routes WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Route not found', 'NOT_FOUND')
    const row = await one(
      `UPDATE routes SET archived_at = now(), status = 'archived', updated_by = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, req.user!.id],
    )
    await q(`UPDATE route_schedules SET status = 'paused' WHERE route_id = $1`, [req.params.id])
    await audit(req, 'archive', 'route', req.params.id, before, row)
    res.json(serialize(row))
  }),
)

operationsRouter.post(
  '/routes/:id/generate',
  requirePermission('manage_trips'),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({ from: z.string().date(), to: z.string().date(), replaceConflicts: z.boolean().default(false) }),
      req.body,
    )
    if (body.to < body.from) throw new ApiError(400, 'End date must be after start date', 'INVALID_PERIOD')
    const route = await one<{
      id: string
      route_no: string
      name_en: string
      origin: string
      destination: string
      stops: unknown
      operating_days: unknown
      departure_time: string
      duration_minutes: number
      price: string
      default_vehicle_id: string | null
      default_driver_id: string | null
      effective_from: Date | string
      effective_to: Date | string | null
      status: string
    }>(`SELECT * FROM routes WHERE id = $1`, [req.params.id])
    if (!route) throw new ApiError(404, 'Route not found', 'NOT_FOUND')
    if (route.status !== 'active') throw new ApiError(409, 'Only active routes can generate trips', 'ROUTE_NOT_ACTIVE')

    const days = Array.isArray(route.operating_days) ? route.operating_days.map(Number) : JSON.parse(String(route.operating_days || '[]'))
    const stops = Array.isArray(route.stops) ? route.stops : JSON.parse(String(route.stops || '[]'))
    const generated: string[] = []
    const skipped: { date: string; reason: string }[] = []
    let cursor = body.from
    const seqStart = await nextSequence('trip')
    let tripSeq = seqStart

    while (cursor <= body.to) {
      const date = new Date(`${cursor}T12:00:00`)
      const day = date.getDay()
      const effectiveFrom = toDateOnly(route.effective_from)
      const effectiveTo = route.effective_to ? toDateOnly(route.effective_to) : null
      if (!days.includes(day) || cursor < effectiveFrom || (effectiveTo && cursor > effectiveTo)) {
        cursor = addDays(cursor, 1)
        continue
      }
      const occurrenceKey = `route:${route.id}:${cursor}:${route.departure_time}`
      const existing = await one<{ trip_no: string }>(`SELECT trip_no FROM trips WHERE occurrence_key = $1`, [occurrenceKey])
      if (existing) {
        skipped.push({ date: cursor, reason: `Already generated as ${existing.trip_no}` })
        cursor = addDays(cursor, 1)
        continue
      }
      const start = `${cursor}T${route.departure_time}:00`
      const endDate = new Date(`${start}`)
      endDate.setMinutes(endDate.getMinutes() + Number(route.duration_minutes))
      const end = toLocalDateTime(endDate)
      if (route.default_vehicle_id || route.default_driver_id) {
        const conflicts = await schedulingConflicts({
          vehicleId: route.default_vehicle_id,
          driverId: route.default_driver_id,
          start,
          end,
        })
        if (conflicts.length > 0) {
          skipped.push({ date: cursor, reason: conflicts[0].message })
          cursor = addDays(cursor, 1)
          continue
        }
      }
      const tripNo = code('TRP', tripSeq++, 5)
      await q(
        `INSERT INTO trips (id, trip_no, trip_type, route_id, schedule_id, occurrence_key, vehicle_id, driver_id,
          origin, destination, stops, scheduled_departure, expected_arrival, quoted_price, status, created_by, updated_by)
         VALUES ($1,$2,'fixed',$3,(SELECT id FROM route_schedules WHERE route_id=$3 AND status='active' ORDER BY effective_from DESC LIMIT 1),
           $4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,'scheduled',$13,$13)
         ON CONFLICT (occurrence_key) DO NOTHING`,
        [randomUUID(), tripNo, route.id, occurrenceKey, route.default_vehicle_id, route.default_driver_id,
          route.origin, route.destination, JSON.stringify(stops), start, end, Number(route.price), req.user!.id],
      )
      generated.push(`${cursor} · ${tripNo}`)
      cursor = addDays(cursor, 1)
    }
    await audit(req, 'generate', 'route', route.id, null, { from: body.from, to: body.to, generated: generated.length, skipped })
    res.json({ generated: generated.length, trips: generated, skipped })
  }),
)

/* -------------------------------- Customers -------------------------------- */

operationsRouter.get(
  '/customers',
  requirePermission('view_contracts'),
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || '').trim()
    const params: unknown[] = []
    let where = 'c.archived_at IS NULL'
    if (search) {
      params.push(`%${search}%`)
      where += ` AND (c.name ILIKE $1 OR c.customer_no ILIKE $1 OR c.phone ILIKE $1)`
    }
    const rows = await q(
      `SELECT c.*,
        COUNT(DISTINCT ct.id) FILTER (WHERE ct.status = 'active') AS active_contracts,
        COALESCE(SUM(i.total) FILTER (WHERE i.status <> 'void'),0) AS invoiced,
        COALESCE(SUM(i.amount_paid) FILTER (WHERE i.status <> 'void'),0) AS collected,
        COALESCE(SUM(i.total - i.amount_paid) FILTER (WHERE i.status <> 'void' AND i.status <> 'paid'),0) AS outstanding
       FROM customers c
       LEFT JOIN contracts ct ON ct.customer_id = c.id
       LEFT JOIN invoices i ON i.customer_id = c.id
       WHERE ${where}
       GROUP BY c.id ORDER BY c.name`,
      params,
    )
    res.json(serialize({ data: rows }))
  }),
)

operationsRouter.post(
  '/customers',
  requirePermission('manage_contracts'),
  asyncHandler(async (req, res) => {
    const body = nullify(parseBody(customerSchema, req.body))
    const seq = await nextSequence('customer')
    const id = randomUUID()
    const row = await one(
      `INSERT INTO customers (id, customer_no, name, type, contact_name, phone, email, tax_id, address, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *`,
      [id, code('CUS', seq, 3), body.name, body.type, body.contact_name ?? null, body.phone ?? null,
        body.email || null, body.tax_id ?? null, body.address ?? null, body.notes ?? null, req.user!.id],
    )
    await audit(req, 'create', 'customer', id, null, row)
    res.status(201).json(serialize(row))
  }),
)

operationsRouter.patch(
  '/customers/:id',
  requirePermission('manage_contracts'),
  asyncHandler(async (req, res) => {
    const body = nullify(parsePatch(customerSchema.partial(), req.body))
    const before = await one(`SELECT * FROM customers WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Customer not found', 'NOT_FOUND')
    const allowed = ['name','type','contact_name','phone','email','tax_id','address','notes']
    const entries = Object.entries(body).filter(([key]) => allowed.includes(key))
    if (!entries.length) throw new ApiError(400, 'No changes supplied', 'VALIDATION_ERROR')
    const assignments = entries.map(([key], index) => `${key} = $${index + 2}`).join(', ')
    const row = await one(
      `UPDATE customers SET ${assignments}, updated_by = $${entries.length + 2} WHERE id = $1 RETURNING *`,
      [req.params.id, ...entries.map(([, value]) => value), req.user!.id],
    )
    await audit(req, 'update', 'customer', req.params.id, before, row)
    res.json(serialize(row))
  }),
)

operationsRouter.post(
  '/customers/:id/archive',
  requirePermission('manage_contracts'),
  asyncHandler(async (req, res) => {
    const before = await one(`SELECT * FROM customers WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Customer not found', 'NOT_FOUND')
    const contracts = await one<{ count: string }>(`SELECT COUNT(*) AS count FROM contracts WHERE customer_id = $1 AND status = 'active'`, [req.params.id])
    if (Number(contracts?.count ?? 0) > 0) throw new ApiError(409, 'Customer has active contracts', 'CUSTOMER_ACTIVE')
    const row = await one(`UPDATE customers SET archived_at = now(), updated_by = $2 WHERE id = $1 RETURNING *`, [req.params.id, req.user!.id])
    await audit(req, 'archive', 'customer', req.params.id, before, row)
    res.json(serialize(row))
  }),
)

/* ---------------------------------- Trips ---------------------------------- */

operationsRouter.get(
  '/trips',
  requirePermission('view_trips'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = pagination(req.query)
    const { from, to } = dateRangeFromQuery(req.query.from as string, req.query.to as string)
    const params: unknown[] = [from, to]
    const filters = [`t.scheduled_departure::date BETWEEN $1::date AND $2::date`]
    for (const [key, column] of [
      ['trip_type', 't.trip_type'],
      ['status', 't.status'],
      ['vehicleId', 't.vehicle_id'],
      ['driverId', 't.driver_id'],
      ['routeId', 't.route_id'],
      ['contractId', 't.contract_id'],
      ['customerId', 't.customer_id'],
    ] as const) {
      const value = req.query[key]
      if (value) {
        params.push(String(value))
        filters.push(`${column} = $${params.length}`)
      }
    }
    const search = String(req.query.search || '').trim()
    if (search) {
      params.push(`%${search}%`)
      filters.push(`(t.trip_no ILIKE $${params.length} OR t.origin ILIKE $${params.length} OR t.destination ILIKE $${params.length} OR c.name ILIKE $${params.length})`)
    }
    const where = filters.join(' AND ')
    const rows = await q(
      `SELECT t.*, c.name AS customer_name, v.plate AS vehicle_plate, v.make AS vehicle_make, v.model AS vehicle_model,
        d.full_name AS driver_name, r.name_en AS route_name, r.name_ar AS route_name_ar,
        ct.contract_no, ct.title AS contract_title
       FROM trips t
       LEFT JOIN customers c ON c.id = t.customer_id
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
       LEFT JOIN drivers d ON d.id = t.driver_id
       LEFT JOIN routes r ON r.id = t.route_id
       LEFT JOIN contracts ct ON ct.id = t.contract_id
       WHERE ${where}
       ORDER BY t.scheduled_departure DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    )
    const count = await one<{ count: string }>(
      `SELECT COUNT(*) AS count FROM trips t LEFT JOIN customers c ON c.id = t.customer_id WHERE ${where}`,
      params,
    )
    const summary = await q(
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status IN ('confirmed','scheduled')) AS scheduled,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
        COUNT(*) FILTER (WHERE status = 'missed') AS missed,
        COALESCE(SUM(recognized_revenue) FILTER (WHERE status = 'completed'),0) AS revenue
       FROM trips t WHERE t.scheduled_departure::date BETWEEN $1::date AND $2::date`,
      [from, to],
    )
    res.json(serialize({ data: rows, total: Number(count?.count ?? 0), page, pageSize, summary: summary[0], range: { from, to } }))
  }),
)

operationsRouter.get(
  '/trips/:id',
  requirePermission('view_trips'),
  asyncHandler(async (req, res) => {
    const trip = await one(
      `SELECT t.*, c.name AS customer_name, v.plate AS vehicle_plate, v.make AS vehicle_make, v.model AS vehicle_model,
        d.full_name AS driver_name, r.name_en AS route_name, r.name_ar AS route_name_ar, ct.contract_no
       FROM trips t LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
       LEFT JOIN drivers d ON d.id = t.driver_id LEFT JOIN routes r ON r.id = t.route_id
       LEFT JOIN contracts ct ON ct.id = t.contract_id WHERE t.id = $1`,
      [req.params.id],
    )
    if (!trip) throw new ApiError(404, 'Trip not found', 'NOT_FOUND')
    const expenses = await q(`SELECT * FROM expenses WHERE trip_id = $1 AND status = 'posted' ORDER BY expense_date`, [req.params.id])
    const invoices = await q(`SELECT i.*, il.description, il.line_total FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE il.trip_id = $1`, [req.params.id])
    res.json(serialize({ trip, expenses, invoices }))
  }),
)

operationsRouter.post(
  '/trips',
  requirePermission('manage_trips'),
  asyncHandler(async (req, res) => {
    const body = nullify(parseBody(tripSchema, req.body))
    if (body.status === 'cancelled' && !body.cancellation_reason) {
      throw new ApiError(400, 'A cancellation reason is required', 'CANCELLATION_REASON_REQUIRED')
    }
    const start = body.scheduled_departure
    let end = body.expected_arrival
    if (!end) {
      const fallback = new Date(start)
      fallback.setHours(fallback.getHours() + 2)
      end = toLocalDateTime(fallback)
    }
    if (new Date(end) <= new Date(start)) throw new ApiError(400, 'Arrival must be after departure', 'INVALID_TIME')

    let conflicts: Awaited<ReturnType<typeof schedulingConflicts>> = []
    if (ACTIVE_TRIP_STATUSES.includes(body.status)) {
      await assertSchedulingIsClear({
        vehicleId: body.vehicle_id,
        driverId: body.driver_id,
        start,
        end,
      })
    } else if (body.vehicle_id || body.driver_id) {
      conflicts = await schedulingConflicts({ vehicleId: body.vehicle_id, driverId: body.driver_id, start, end })
    }

    const seq = await nextSequence('trip')
    const tripNo = code('TRP', seq, 5)
    const id = randomUUID()
    const recognized = await tripRevenueForStatus(
      {
        contract_id: body.contract_id ?? null,
        quoted_price: body.quoted_price,
        additional_charges: body.additional_charges,
        discount: body.discount,
        status: body.status,
      },
      { query: async (sql, params) => ({ rows: await q(sql, params as unknown[]) }) },
    )
    const row = await one(
      `INSERT INTO trips (id, trip_no, trip_type, route_id, customer_id, contract_id, vehicle_id, driver_id, origin, destination,
        stops, scheduled_departure, expected_arrival, distance_km, quoted_price, additional_charges, discount,
        recognized_revenue, status, cancellation_reason, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22) RETURNING *`,
      [id, tripNo, body.trip_type, body.route_id ?? null, body.customer_id ?? null, body.contract_id ?? null,
        body.vehicle_id ?? null, body.driver_id ?? null, body.origin, body.destination, JSON.stringify(body.stops ?? []),
        asTimestamp(start), asTimestamp(end), body.distance_km ?? null, body.quoted_price, body.additional_charges,
        body.discount, recognized, body.status, body.cancellation_reason ?? null, body.notes ?? null, req.user!.id],
    )
    await audit(req, 'create', 'trip', id, null, row)
    if (bodystatusActive(body.status)) await refreshVehicleStatuses()
    res.status(201).json(serialize({ trip: row, conflicts }))
  }),
)

function bodystatusActive(status: string) {
  return ACTIVE_TRIP_STATUSES.includes(status)
}

operationsRouter.patch(
  '/trips/:id',
  requirePermission('manage_trips'),
  asyncHandler(async (req, res) => {
    const body = nullify(parsePatch(tripSchema.partial(), req.body))
    const before = await one<Record<string, unknown>>(`SELECT * FROM trips WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Trip not found', 'NOT_FOUND')
    const resultingStatus = String(body.status ?? before.status)
    if (resultingStatus === 'cancelled' && !(body.cancellation_reason ?? before.cancellation_reason)) {
      throw new ApiError(400, 'A cancellation reason is required', 'CANCELLATION_REASON_REQUIRED')
    }

    const scheduled = String(
      body.scheduled_departure
        ? asTimestamp(String(body.scheduled_departure))
        : toLocalDateTime(before.scheduled_departure as Date | string),
    )
    const expected = body.expected_arrival
      ? asTimestamp(String(body.expected_arrival))
      : before.expected_arrival
        ? toLocalDateTime(before.expected_arrival as Date | string)
        : toLocalDateTime(new Date(new Date(scheduled).getTime() + 2 * 3600000))
    const vehicleId = body.vehicle_id !== undefined ? body.vehicle_id : (before.vehicle_id as string | null)
    const driverId = body.driver_id !== undefined ? body.driver_id : (before.driver_id as string | null)
    const conflictRelevant =
      body.vehicle_id !== undefined ||
      body.driver_id !== undefined ||
      body.scheduled_departure !== undefined ||
      body.expected_arrival !== undefined ||
      body.status !== undefined
    if (conflictRelevant && ACTIVE_TRIP_STATUSES.includes(resultingStatus)) {
      await assertSchedulingIsClear({
        vehicleId,
        driverId,
        start: scheduled,
        end: expected,
        excludeTripId: req.params.id,
      })
    }

    const contractId = body.contract_id !== undefined ? (body.contract_id as string | null) : (before.contract_id as string | null)
    const quoted = body.quoted_price !== undefined ? Number(body.quoted_price) : Number(before.quoted_price)
    const additional = body.additional_charges !== undefined ? Number(body.additional_charges) : Number(before.additional_charges)
    const discount = body.discount !== undefined ? Number(body.discount) : Number(before.discount)
    const recognized = await tripRevenueForStatus(
      {
        contract_id: contractId,
        quoted_price: quoted,
        additional_charges: additional,
        discount,
        status: resultingStatus,
      },
      { query: async (sql, params) => ({ rows: await q(sql, params as unknown[]) }) },
    )

    const allowed = [
      'trip_type','route_id','customer_id','contract_id','vehicle_id','driver_id','origin','destination','stops',
      'scheduled_departure','expected_arrival','actual_departure','actual_arrival','distance_km','quoted_price',
      'additional_charges','discount','status','cancellation_reason','notes',
    ]
    const entries = Object.entries(body).filter(([key]) => allowed.includes(key))
    const timestampKeys = new Set(['scheduled_departure','expected_arrival','actual_departure','actual_arrival'])
    const assignments = entries.map(([key], index) => {
      let placeholder = `$${index + 2}`
      if (key === 'stops') placeholder += '::jsonb'
      return `${key} = ${placeholder}`
    })
    if (!entries.some(([key]) => key === 'status')) {
      assignments.push(`status = $${entries.length + 2}`)
    }
    assignments.push(`recognized_revenue = $${entries.length + (entries.some(([key]) => key === 'status') ? 2 : 3)}`)
    assignments.push(`updated_by = $${entries.length + (entries.some(([key]) => key === 'status') ? 3 : 4)}`)
    const params: unknown[] = [req.params.id]
    for (const [key, value] of entries) {
      if (key === 'stops') params.push(JSON.stringify(value))
      else if (timestampKeys.has(key) && value) params.push(asTimestamp(String(value)))
      else params.push(value)
    }
    if (!entries.some(([key]) => key === 'status')) params.push(resultingStatus)
    params.push(recognized)
    params.push(req.user!.id)
    const row = await one(`UPDATE trips SET ${assignments.join(', ')} WHERE id = $1 RETURNING *`, params)
    await audit(req, 'update', 'trip', req.params.id, before, row)
    if (body.vehicle_id !== undefined || body.driver_id !== undefined) {
      await audit(req, 'reassign', 'trip', req.params.id, { vehicle_id: before.vehicle_id, driver_id: before.driver_id }, { vehicle_id: vehicleId, driver_id: driverId })
    }
    await refreshVehicleStatuses()
    res.json(serialize(row))
  }),
)

/* --------------------------------- Schedule -------------------------------- */

operationsRouter.get(
  '/schedule',
  requirePermission('view_trips'),
  asyncHandler(async (req, res) => {
    const { from, to } = dateRangeFromQuery(req.query.from as string, req.query.to as string)
    const vehicleId = req.query.vehicleId ? String(req.query.vehicleId) : null
    const vehicles = await q(
      `SELECT v.id, v.vehicle_no, v.plate, v.make, v.model, v.category, v.seats, v.status, d.full_name AS driver_name
       FROM vehicles v LEFT JOIN drivers d ON d.id = v.assigned_driver_id
       WHERE v.archived_at IS NULL ${vehicleId ? 'AND v.id = $1' : ''}
       ORDER BY v.vehicle_no`,
      vehicleId ? [vehicleId] : [],
    )
    const trips = await q(
      `SELECT t.id, t.trip_no, t.trip_type, t.origin, t.destination, t.scheduled_departure, t.expected_arrival,
        t.status, t.vehicle_id, t.driver_id, t.route_id, t.customer_id, t.quoted_price, t.recognized_revenue,
        r.name_en AS route_name, r.name_ar AS route_name_ar, c.name AS customer_name, d.full_name AS driver_name,
        v.plate AS vehicle_plate
       FROM trips t
       LEFT JOIN routes r ON r.id = t.route_id
       LEFT JOIN customers c ON c.id = t.customer_id
       LEFT JOIN drivers d ON d.id = t.driver_id
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.scheduled_departure::date BETWEEN $1::date AND $2::date
         AND t.status NOT IN ('cancelled','missed')
         ${vehicleId ? 'AND t.vehicle_id = $3' : ''}
       ORDER BY t.scheduled_departure`,
      vehicleId ? [from, to, vehicleId] : [from, to],
    )
    const maintenance = await q(
      `SELECT m.id, m.record_no, m.vehicle_id, m.maintenance_type, m.description, m.start_date, m.end_date, m.status, m.cost,
        v.plate AS vehicle_plate
       FROM maintenance_records m JOIN vehicles v ON v.id = m.vehicle_id
       WHERE m.status IN ('scheduled','in_progress') AND m.start_date <= $2::date AND m.end_date >= $1::date
         ${vehicleId ? 'AND m.vehicle_id = $3' : ''}
       ORDER BY m.start_date`,
      vehicleId ? [from, to, vehicleId] : [from, to],
    )
    const buffer = await one<{ trip_buffer_minutes: number }>(`SELECT trip_buffer_minutes FROM business_settings WHERE id = 1`)
    res.json(serialize({ vehicles, trips, maintenance, range: { from, to }, bufferMinutes: buffer?.trip_buffer_minutes ?? 30 }))
  }),
)

/* -------------------------------- Maintenance ------------------------------ */

const maintenanceSchema = z.object({
  vehicle_id: z.string().uuid(),
  maintenance_type: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(1000),
  start_date: z.string().date(),
  end_date: z.string().date(),
  cost: z.coerce.number().min(0).default(0),
  vendor: z.string().trim().max(160).nullable().optional(),
  odometer: z.coerce.number().min(0).nullable().optional(),
  status: z.enum(['scheduled','in_progress','completed','cancelled']).default('scheduled'),
  notes: z.string().max(2000).nullable().optional(),
})

async function syncMaintenanceExpense(recordId: string, actorId: string, tx: Queryable) {
  const record = await tx.query<{
    id: string
    record_no: string
    vehicle_id: string
    description: string
    maintenance_type: string
    start_date: Date
    end_date: Date
    cost: string
    status: string
    expense_id: string | null
  }>(`SELECT * FROM maintenance_records WHERE id = $1`, [recordId])
  const m = record.rows[0]
  if (!m) return
  if (m.status === 'completed' && Number(m.cost) > 0) {
    if (m.expense_id) {
      await tx.query(
        `UPDATE expenses SET amount = $2, description = $3, vehicle_id = $4, expense_date = $5, updated_by = $6 WHERE id = $1 AND status = 'posted'`,
        [m.expense_id, Number(m.cost), `Maintenance ${m.record_no}: ${m.description}`, m.vehicle_id, toDateOnly(m.end_date), actorId],
      )
    } else {
      const seq = await nextSequence('expense', tx)
      const expenseId = randomUUID()
      await tx.query(
        `INSERT INTO expenses (id, expense_no, expense_date, category_id, description, amount, vehicle_id, maintenance_id, is_operating, status, created_by, updated_by)
         VALUES ($1,$2,$3,'cat-maintenance',$4,$5,$6,$7,true,'posted',$8,$8)`,
        [expenseId, code('EXP', seq, 5), toDateOnly(m.end_date), `Maintenance ${m.record_no}: ${m.description}`,
          Number(m.cost), m.vehicle_id, m.id, actorId],
      )
      await tx.query(`UPDATE maintenance_records SET expense_id = $2 WHERE id = $1`, [m.id, expenseId])
    }
  } else if (m.expense_id && m.status !== 'completed') {
    await tx.query(
      `UPDATE expenses SET status = 'void', void_reason = 'Maintenance record reverted', updated_by = $2 WHERE id = $1 AND status = 'posted'`,
      [m.expense_id, actorId],
    )
  }
}

operationsRouter.get(
  '/maintenance',
  requirePermission('view_maintenance'),
  asyncHandler(async (req, res) => {
    const from = String(req.query.from || '')
    const to = String(req.query.to || '')
    const status = String(req.query.status || '')
    const params: unknown[] = []
    const filters: string[] = []
    if (from) { params.push(from); filters.push(`m.end_date >= $${params.length}::date`) }
    if (to) { params.push(to); filters.push(`m.start_date <= $${params.length}::date`) }
    if (status) { params.push(status); filters.push(`m.status = $${params.length}`) }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const rows = await q(
      `SELECT m.*, v.plate AS vehicle_plate, v.make, v.model, e.expense_no
       FROM maintenance_records m JOIN vehicles v ON v.id = m.vehicle_id
       LEFT JOIN expenses e ON e.id = m.expense_id
       ${where} ORDER BY m.start_date DESC`,
      params,
    )
    const summary = await q(
      `SELECT
        COUNT(*) FILTER (WHERE status IN ('scheduled','in_progress')) AS active,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COALESCE(SUM(cost) FILTER (WHERE status = 'completed'),0) AS total_cost
       FROM maintenance_records`,
    )
    res.json(serialize({ data: rows, summary: summary[0] }))
  }),
)

operationsRouter.post(
  '/maintenance',
  requirePermission('manage_maintenance'),
  asyncHandler(async (req, res) => {
    const body = nullify(parseBody(maintenanceSchema, req.body))
    if (body.end_date < body.start_date) throw new ApiError(400, 'End date must be after start date', 'INVALID_PERIOD')
    if (['scheduled','in_progress'].includes(body.status)) {
      await assertVehicleAvailableForMaintenance({
        vehicleId: body.vehicle_id,
        startDate: body.start_date,
        endDate: body.end_date,
      })
    }
    const seq = await nextSequence('maintenance')
    const id = randomUUID()
    const row = await transaction(async (tx) => {
      const created = await tx.query(
        `INSERT INTO maintenance_records (id, record_no, vehicle_id, maintenance_type, description, start_date, end_date,
          cost, vendor, odometer, status, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
        [id, code('MNT', seq, 4), body.vehicle_id, body.maintenance_type, body.description, body.start_date,
          body.end_date, body.cost, body.vendor ?? null, body.odometer ?? null, body.status, body.notes ?? null, req.user!.id],
      )
      await syncMaintenanceExpense(id, req.user!.id, tx)
      return created.rows[0]
    })
    await audit(req, 'create', 'maintenance', id, null, row)
    await refreshVehicleStatuses()
    res.status(201).json(serialize(row))
  }),
)

operationsRouter.patch(
  '/maintenance/:id',
  requirePermission('manage_maintenance'),
  asyncHandler(async (req, res) => {
    const body = nullify(parsePatch(maintenanceSchema.partial(), req.body))
    const before = await one<Record<string, unknown>>(`SELECT * FROM maintenance_records WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Maintenance record not found', 'NOT_FOUND')
    const resultingStatus = String(body.status ?? before.status)
    if (['scheduled','in_progress'].includes(resultingStatus)) {
      await assertVehicleAvailableForMaintenance({
        vehicleId: String(body.vehicle_id ?? before.vehicle_id),
        startDate: String(body.start_date ?? toDateOnly(before.start_date as Date | string)),
        endDate: String(body.end_date ?? toDateOnly(before.end_date as Date | string)),
        excludeRecordId: req.params.id,
      })
    }
    const allowed = ['vehicle_id','maintenance_type','description','start_date','end_date','cost','vendor','odometer','status','notes']
    const entries = Object.entries(body).filter(([key]) => allowed.includes(key))
    if (!entries.length) throw new ApiError(400, 'No changes supplied', 'VALIDATION_ERROR')
    const row = await transaction(async (tx) => {
      const assignments = entries.map(([key], index) => `${key} = $${index + 2}`).join(', ')
      const updated = await tx.query(
        `UPDATE maintenance_records SET ${assignments}, updated_by = $${entries.length + 2} WHERE id = $1 RETURNING *`,
        [req.params.id, ...entries.map(([, value]) => value), req.user!.id],
      )
      await syncMaintenanceExpense(req.params.id, req.user!.id, tx)
      return updated.rows[0]
    })
    await audit(req, 'update', 'maintenance', req.params.id, before, row)
    await refreshVehicleStatuses()
    res.json(serialize(row))
  }),
)
