import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { can, requirePermission } from '../auth.js'
import { code, nextSequence, one, q } from '../db.js'
import {
  ApiError,
  asyncHandler,
  audit,
  dateRangeFromQuery,
  daysInclusive,
  pagination,
  parseBody,
  parsePatch,
  serialize,
  toDateOnly,
} from '../lib.js'
import { assertVehicleAvailableForMaintenance } from '../services/scheduling.js'

export const fleetRouter = Router()

const vehicleSchema = z.object({
  plate: z.string().trim().min(2).max(30),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  category: z.string().trim().min(1).max(40).default('van'),
  year: z.coerce.number().int().min(1980).max(2100).nullable().optional(),
  seats: z.coerce.number().int().min(1).max(100),
  status: z.enum(['available', 'scheduled', 'on_trip', 'under_maintenance', 'inactive']).default('available'),
  registration_expiry: z.string().date().nullable().optional(),
  insurance_expiry: z.string().date().nullable().optional(),
  odometer: z.coerce.number().min(0).default(0),
  acquisition_cost: z.coerce.number().min(0).nullable().optional(),
  acquisition_date: z.string().date().nullable().optional(),
  assigned_driver_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

const driverSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().email().max(160).nullable().optional().or(z.literal('')),
  license_no: z.string().trim().min(2).max(60),
  license_expiry: z.string().date().nullable().optional(),
  status: z.enum(['active', 'on_leave', 'inactive']).default('active'),
  monthly_salary: z.coerce.number().min(0).nullable().optional(),
  hire_date: z.string().date().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

function nullify<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = { ...value }
  for (const key of Object.keys(out)) {
    if (out[key] === '') out[key] = null
  }
  return out as T
}

fleetRouter.get(
  '/vehicles',
  requirePermission('view_fleet'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = pagination(req.query)
    const { from, to } = dateRangeFromQuery(req.query.from as string, req.query.to as string)
    const search = String(req.query.search || '').trim()
    const status = String(req.query.status || '')
    const category = String(req.query.category || '')
    const includeArchived = req.query.includeArchived === 'true' && req.user?.role_key === 'admin'
    const params: unknown[] = [from, to, daysInclusive(from, to)]
    const filters: string[] = []
    if (!includeArchived) filters.push('v.archived_at IS NULL')
    if (status) {
      params.push(status)
      filters.push(`v.status = $${params.length}`)
    }
    if (category) {
      params.push(category)
      filters.push(`v.category = $${params.length}`)
    }
    if (search) {
      params.push(`%${search}%`)
      filters.push(`(v.plate ILIKE $${params.length} OR v.make ILIKE $${params.length} OR v.model ILIKE $${params.length} OR v.vehicle_no ILIKE $${params.length})`)
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const settings = await one<{ operating_hours_per_day: string }>(
      `SELECT operating_hours_per_day FROM business_settings WHERE id = 1`,
    )
    const hoursPerDay = Number(settings?.operating_hours_per_day ?? 12)

    const rows = await q(
      `SELECT v.*, d.full_name AS driver_name, d.phone AS driver_phone,
        COALESCE(ts.trips,0) AS trips,
        COALESCE(ts.revenue,0) AS revenue,
        COALESCE(es.expenses,0) AS expenses,
        COALESCE(ts.revenue,0) - COALESCE(es.expenses,0) AS profit,
        COALESCE(ts.hours,0) AS busy_hours,
        LEAST(100, ROUND((COALESCE(ts.hours,0) / NULLIF($3::numeric * $4::numeric,0)) * 100, 1)) AS utilization
      FROM vehicles v
      LEFT JOIN drivers d ON d.id = v.assigned_driver_id
      LEFT JOIN (
        SELECT vehicle_id,
          COUNT(*) FILTER (WHERE status = 'completed') AS trips,
          COALESCE(SUM(recognized_revenue) FILTER (WHERE status = 'completed'),0) AS revenue,
          COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(expected_arrival, scheduled_departure) - scheduled_departure))/3600)
            FILTER (WHERE status = 'completed'),0) AS hours
        FROM trips WHERE scheduled_departure::date BETWEEN $1::date AND $2::date
        GROUP BY vehicle_id
      ) ts ON ts.vehicle_id = v.id
      LEFT JOIN (
        SELECT vehicle_id, SUM(amount) AS expenses FROM (
          SELECT vehicle_id, amount FROM expenses
          WHERE status = 'posted' AND is_operating = true AND vehicle_id IS NOT NULL
            AND expense_date BETWEEN $1::date AND $2::date
          UNION ALL
          SELECT ea.vehicle_id, ea.allocated_amount FROM expense_allocations ea
          JOIN expenses e ON e.id = ea.expense_id
          WHERE e.status = 'posted' AND e.is_operating = true AND e.vehicle_id IS NULL
            AND ea.vehicle_id IS NOT NULL AND e.expense_date BETWEEN $1::date AND $2::date
        ) e GROUP BY vehicle_id
      ) es ON es.vehicle_id = v.id
      ${where}
      ORDER BY v.archived_at NULLS FIRST, v.vehicle_no
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    )

    const totals = await q<{ total: string; available: string; maintenance: string; operating: string; revenue: string; expenses: string; expiring: string }>(
      `SELECT
        COUNT(*) FILTER (WHERE archived_at IS NULL) AS total,
        COUNT(*) FILTER (WHERE archived_at IS NULL AND status = 'available') AS available,
        COUNT(*) FILTER (WHERE archived_at IS NULL AND status = 'under_maintenance') AS maintenance,
        COUNT(*) FILTER (WHERE archived_at IS NULL AND status IN ('scheduled','on_trip')) AS operating,
        COUNT(*) FILTER (WHERE archived_at IS NULL AND (
          (registration_expiry IS NOT NULL AND registration_expiry <= CURRENT_DATE + INTERVAL '30 days')
          OR (insurance_expiry IS NOT NULL AND insurance_expiry <= CURRENT_DATE + INTERVAL '30 days')
        )) AS expiring,
        (SELECT COALESCE(SUM(recognized_revenue),0) FROM trips WHERE status = 'completed' AND scheduled_departure::date BETWEEN $1::date AND $2::date) AS revenue,
        (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE status = 'posted' AND is_operating = true AND expense_date BETWEEN $1::date AND $2::date) AS expenses
       FROM vehicles`,
      [from, to],
    )
    const count = await q<{ count: string }>(
      `SELECT COUNT(*) AS count FROM vehicles v
       WHERE ($1::date IS NOT NULL AND $2::date IS NOT NULL AND $3::int IS NOT NULL)
       ${where ? `AND ${where.replace(/^WHERE /, '')}` : ''}`,
      params,
    )
    const busy = await one<{ hours: string }>(
      `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(expected_arrival, scheduled_departure) - scheduled_departure))/3600),0) AS hours
       FROM trips WHERE status = 'completed' AND scheduled_departure::date BETWEEN $1::date AND $2::date`,
      [from, to],
    )
    const fleetCapacity = Math.max(1, Number(totals[0]?.total ?? 1) * daysInclusive(from, to) * hoursPerDay)
    const utilization = Math.min(100, Math.round((Number(busy?.hours ?? 0) / fleetCapacity) * 1000) / 10)

    res.json(
      serialize({
        data: rows,
        total: Number(count[0]?.count ?? 0),
        page,
        pageSize,
        summary: {
          total: Number(totals[0]?.total ?? 0),
          available: Number(totals[0]?.available ?? 0),
          maintenance: Number(totals[0]?.maintenance ?? 0),
          operating: Number(totals[0]?.operating ?? 0),
          revenue: Number(totals[0]?.revenue ?? 0),
          expenses: Number(totals[0]?.expenses ?? 0),
          expiring: Number(totals[0]?.expiring ?? 0),
          utilization,
        },
        range: { from, to },
      }),
    )
  }),
)

fleetRouter.get(
  '/vehicles/:id',
  requirePermission('view_fleet'),
  asyncHandler(async (req, res) => {
    const vehicle = await one(`SELECT v.*, d.full_name AS driver_name, d.phone AS driver_phone FROM vehicles v LEFT JOIN drivers d ON d.id = v.assigned_driver_id WHERE v.id = $1`, [req.params.id])
    if (!vehicle) throw new ApiError(404, 'Vehicle not found', 'NOT_FOUND')
    const trips = await q(
      `SELECT t.*, c.name AS customer_name, r.name_en AS route_name
       FROM trips t LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN routes r ON r.id = t.route_id
       WHERE t.vehicle_id = $1 ORDER BY t.scheduled_departure DESC LIMIT 25`,
      [req.params.id],
    )
    const maintenance = await q(
      `SELECT * FROM maintenance_records WHERE vehicle_id = $1 ORDER BY start_date DESC LIMIT 20`,
      [req.params.id],
    )
    const financial = await one(
      `SELECT
        COALESCE((SELECT SUM(recognized_revenue) FROM trips WHERE vehicle_id = $1 AND status = 'completed'),0) AS revenue,
        COALESCE((SELECT SUM(amount) FROM expenses WHERE vehicle_id = $1 AND status = 'posted' AND is_operating = true),0)
        + COALESCE((SELECT SUM(ea.allocated_amount) FROM expense_allocations ea JOIN expenses e ON e.id = ea.expense_id WHERE ea.vehicle_id = $1 AND e.vehicle_id IS NULL AND e.status = 'posted' AND e.is_operating = true),0) AS expenses,
        (SELECT COUNT(*) FROM trips WHERE vehicle_id = $1 AND status = 'completed') AS completed_trips,
        (SELECT COUNT(*) FROM trips WHERE vehicle_id = $1 AND status = 'cancelled') AS cancelled_trips`,
      [req.params.id],
    )
    const breakdown = await q(
      `SELECT ec.name_en, ec.name_ar, SUM(e.amount) AS amount FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
       WHERE e.vehicle_id = $1 AND e.status = 'posted' AND e.is_operating = true GROUP BY ec.id, ec.name_en, ec.name_ar ORDER BY amount DESC`,
      [req.params.id],
    )
    res.json(serialize({ vehicle, trips, maintenance, financial, expenseBreakdown: breakdown }))
  }),
)

fleetRouter.post(
  '/vehicles',
  requirePermission('manage_fleet'),
  asyncHandler(async (req, res) => {
    const body = nullify(parseBody(vehicleSchema, req.body))
    const seq = await nextSequence('vehicle')
    const id = randomUUID()
    const row = await one(
      `INSERT INTO vehicles (id, vehicle_no, plate, make, model, category, year, seats, status, registration_expiry,
        insurance_expiry, odometer, acquisition_cost, acquisition_date, assigned_driver_id, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING *`,
      [id, code('VH', seq, 3), body.plate, body.make, body.model, body.category, body.year ?? null, body.seats,
        body.status, body.registration_expiry ?? null, body.insurance_expiry ?? null, body.odometer ?? 0,
        body.acquisition_cost ?? null, body.acquisition_date ?? null, body.assigned_driver_id ?? null,
        body.notes ?? null, req.user!.id],
    )
    await audit(req, 'create', 'vehicle', id, null, row)
    res.status(201).json(serialize(row))
  }),
)

fleetRouter.patch(
  '/vehicles/:id',
  requirePermission('manage_fleet'),
  asyncHandler(async (req, res) => {
    const body = nullify(parsePatch(vehicleSchema.partial(), req.body))
    const before = await one(`SELECT * FROM vehicles WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Vehicle not found', 'NOT_FOUND')
    const allowed = ['plate','make','model','category','year','seats','status','registration_expiry','insurance_expiry','odometer','acquisition_cost','acquisition_date','assigned_driver_id','notes']
    const entries = Object.entries(body).filter(([key]) => allowed.includes(key))
    if (entries.length === 0) throw new ApiError(400, 'No changes supplied', 'VALIDATION_ERROR')
    const assignments = entries.map(([key], index) => `${key} = $${index + 2}`).join(', ')
    const row = await one(
      `UPDATE vehicles SET ${assignments}, updated_by = $${entries.length + 2} WHERE id = $1 RETURNING *`,
      [req.params.id, ...entries.map(([, value]) => value), req.user!.id],
    )
    await audit(req, 'update', 'vehicle', req.params.id, before, row)
    res.json(serialize(row))
  }),
)

fleetRouter.post(
  '/vehicles/:id/archive',
  requirePermission('manage_fleet'),
  asyncHandler(async (req, res) => {
    const before = await one<{ id: string; plate: string; status: string }>(`SELECT id, plate, status FROM vehicles WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Vehicle not found', 'NOT_FOUND')
    if (before.status === 'on_trip') throw new ApiError(409, 'A vehicle on an active trip cannot be archived', 'VEHICLE_ACTIVE')
    const row = await one(
      `UPDATE vehicles SET archived_at = now(), status = 'inactive', updated_by = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, req.user!.id],
    )
    await audit(req, 'archive', 'vehicle', req.params.id, before, row)
    res.json(serialize(row))
  }),
)

fleetRouter.get(
  '/drivers',
  requirePermission('view_drivers'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = pagination(req.query)
    const { from, to } = dateRangeFromQuery(req.query.from as string, req.query.to as string)
    const search = String(req.query.search || '').trim()
    const status = String(req.query.status || '')
    const params: unknown[] = [from, to]
    const filters = ['d.archived_at IS NULL']
    if (status) {
      params.push(status)
      filters.push(`d.status = $${params.length}`)
    }
    if (search) {
      params.push(`%${search}%`)
      filters.push(`(d.full_name ILIKE $${params.length} OR d.license_no ILIKE $${params.length} OR d.driver_no ILIKE $${params.length})`)
    }
    const canViewSalary = can(req.user, 'view_driver_compensation')
    const rows = await q(
      `SELECT d.id, d.driver_no, d.full_name, d.phone, d.email, d.license_no, d.license_expiry, d.status,
        d.hire_date, d.notes, d.archived_at, d.created_at,
        ${canViewSalary ? 'd.monthly_salary' : 'NULL::numeric AS monthly_salary'},
        COALESCE(ts.trips,0) AS trips,
        COALESCE(ts.revenue,0) AS revenue,
        COALESCE(ts.cancelled,0) AS cancelled
       FROM drivers d
       LEFT JOIN (
         SELECT driver_id,
           COUNT(*) FILTER (WHERE status = 'completed') AS trips,
           COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
           COALESCE(SUM(recognized_revenue) FILTER (WHERE status = 'completed'),0) AS revenue
         FROM trips WHERE scheduled_departure::date BETWEEN $1::date AND $2::date AND driver_id IS NOT NULL
         GROUP BY driver_id
       ) ts ON ts.driver_id = d.id
       WHERE ${filters.join(' AND ')}
       ORDER BY d.full_name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    )
    const count = await q<{ count: string }>(
      `SELECT COUNT(*) AS count FROM drivers d
       WHERE ($1::date IS NOT NULL AND $2::date IS NOT NULL) AND ${filters.join(' AND ')}`,
      params,
    )
    const summaryRows = await q<{ active: string; on_leave: string; expiring: string }>(
      `SELECT
        COUNT(*) FILTER (WHERE d.status = 'active') AS active,
        COUNT(*) FILTER (WHERE d.status = 'on_leave') AS on_leave,
        COUNT(*) FILTER (WHERE d.license_expiry IS NOT NULL AND d.license_expiry <= CURRENT_DATE + INTERVAL '45 days') AS expiring
       FROM drivers d WHERE d.archived_at IS NULL`,
    )
    const tripTotals = await q<{ trips: string; revenue: string }>(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'completed') AS trips,
        COALESCE(SUM(recognized_revenue) FILTER (WHERE status = 'completed'),0) AS revenue
       FROM trips WHERE scheduled_departure::date BETWEEN $1::date AND $2::date AND driver_id IS NOT NULL`,
      [from, to],
    )
    res.json(
      serialize({
        data: rows,
        total: Number(count[0]?.count ?? 0),
        page,
        pageSize,
        canViewSalary,
        range: { from, to },
        summary: {
          active: Number(summaryRows[0]?.active ?? 0),
          onLeave: Number(summaryRows[0]?.on_leave ?? 0),
          expiring: Number(summaryRows[0]?.expiring ?? 0),
          trips: Number(tripTotals[0]?.trips ?? 0),
          revenue: Number(tripTotals[0]?.revenue ?? 0),
        },
      }),
    )
  }),
)

fleetRouter.post(
  '/drivers',
  requirePermission('manage_drivers'),
  asyncHandler(async (req, res) => {
    const body = nullify(parseBody(driverSchema, req.body))
    if (body.monthly_salary && !can(req.user, 'view_driver_compensation')) {
      throw new ApiError(403, 'You cannot set driver compensation', 'FORBIDDEN')
    }
    const seq = await nextSequence('driver')
    const id = randomUUID()
    const row = await one(
      `INSERT INTO drivers (id, driver_no, full_name, phone, email, license_no, license_expiry, status, monthly_salary, hire_date, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
      [id, code('DRV', seq, 3), body.full_name, body.phone ?? null, body.email || null, body.license_no,
        body.license_expiry ?? null, body.status, body.monthly_salary ?? null, body.hire_date ?? null, body.notes ?? null, req.user!.id],
    )
    await audit(req, 'create', 'driver', id, null, row)
    res.status(201).json(serialize(row))
  }),
)

fleetRouter.patch(
  '/drivers/:id',
  requirePermission('manage_drivers'),
  asyncHandler(async (req, res) => {
    const body = nullify(parsePatch(driverSchema.partial(), req.body))
    if (body.monthly_salary !== undefined && !can(req.user, 'view_driver_compensation')) {
      throw new ApiError(403, 'You cannot change driver compensation', 'FORBIDDEN')
    }
    const before = await one(`SELECT * FROM drivers WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Driver not found', 'NOT_FOUND')
    const allowed = ['full_name','phone','email','license_no','license_expiry','status','monthly_salary','hire_date','notes']
    const entries = Object.entries(body).filter(([key]) => allowed.includes(key))
    if (entries.length === 0) throw new ApiError(400, 'No changes supplied', 'VALIDATION_ERROR')
    const assignments = entries.map(([key], index) => `${key} = $${index + 2}`).join(', ')
    const row = await one(
      `UPDATE drivers SET ${assignments}, updated_by = $${entries.length + 2} WHERE id = $1 RETURNING *`,
      [req.params.id, ...entries.map(([, value]) => value), req.user!.id],
    )
    await audit(req, 'update', 'driver', req.params.id, before, row)
    res.json(serialize(row))
  }),
)

fleetRouter.post(
  '/drivers/:id/archive',
  requirePermission('manage_drivers'),
  asyncHandler(async (req, res) => {
    const before = await one(`SELECT * FROM drivers WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Driver not found', 'NOT_FOUND')
    const active = await one<{ count: string }>(
      `SELECT COUNT(*) AS count FROM trips WHERE driver_id = $1 AND status IN ('confirmed','scheduled','in_progress')`,
      [req.params.id],
    )
    if (Number(active?.count ?? 0) > 0) throw new ApiError(409, 'Driver has active assignments and cannot be archived', 'DRIVER_ACTIVE')
    const row = await one(
      `UPDATE drivers SET archived_at = now(), status = 'inactive', updated_by = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, req.user!.id],
    )
    await audit(req, 'archive', 'driver', req.params.id, before, row)
    res.json(serialize(row))
  }),
)

fleetRouter.post(
  '/vehicles/:id/maintenance-check',
  requirePermission('manage_maintenance'),
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ start_date: z.string().date(), end_date: z.string().date() }), req.body)
    await assertVehicleAvailableForMaintenance({ vehicleId: req.params.id, startDate: body.start_date, endDate: body.end_date })
    res.json({ ok: true })
  }),
)

export { vehicleSchema, driverSchema, nullify, toDateOnly }
