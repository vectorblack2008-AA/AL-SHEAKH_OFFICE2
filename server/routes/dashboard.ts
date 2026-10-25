import { Router } from 'express'
import type { Request } from 'express'
import { requirePermission } from '../auth.js'
import { one, q } from '../db.js'
import { addDays, asyncHandler, dateRangeFromQuery, daysInclusive, serialize, toDateOnly } from '../lib.js'
import { fleetAvailability, refreshVehicleStatuses } from '../services/scheduling.js'
import { syncOverdueInvoices } from '../services/finance.js'

export const dashboardRouter = Router()

interface TripFilter {
  from: string
  to: string
  where: string
  params: unknown[]
}

function buildTripFilter(req: Request, alias = 't'): TripFilter {
  const { from, to } = dateRangeFromQuery(req.query.from as string, req.query.to as string)
  const params: unknown[] = [from, to]
  const conditions = [`${alias}.scheduled_departure::date BETWEEN $1::date AND $2::date`]
  for (const [key, column] of [
    ['service', `${alias}.trip_type`],
    ['status', `${alias}.status`],
    ['vehicleId', `${alias}.vehicle_id`],
    ['driverId', `${alias}.driver_id`],
    ['routeId', `${alias}.route_id`],
    ['contractId', `${alias}.contract_id`],
    ['customerId', `${alias}.customer_id`],
  ] as const) {
    const value = req.query[key]
    if (value) {
      params.push(String(value))
      conditions.push(`${column} = $${params.length}`)
    }
  }
  return { from, to, where: conditions.join(' AND '), params }
}

async function tripKpis(filter: TripFilter) {
  const rows = await q(
    `SELECT COUNT(*) AS total,
      COUNT(*) FILTER (WHERE t.status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE t.status IN ('confirmed','scheduled')) AS scheduled,
      COUNT(*) FILTER (WHERE t.status = 'cancelled') AS cancelled,
      COUNT(*) FILTER (WHERE t.status = 'missed') AS missed,
      COALESCE(SUM(t.recognized_revenue) FILTER (WHERE t.status = 'completed'),0) AS revenue,
      COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(t.expected_arrival, t.scheduled_departure) - t.scheduled_departure))/3600) FILTER (WHERE t.status = 'completed'),0) AS hours
     FROM trips t WHERE ${filter.where}`,
    filter.params,
  )
  return {
    total: Number(rows[0]?.total ?? 0),
    completed: Number(rows[0]?.completed ?? 0),
    scheduled: Number(rows[0]?.scheduled ?? 0),
    cancelled: Number(rows[0]?.cancelled ?? 0),
    missed: Number(rows[0]?.missed ?? 0),
    revenue: Number(rows[0]?.revenue ?? 0),
    hours: Number(rows[0]?.hours ?? 0),
  }
}

function contractFilterParams(req: Request, from: string, to: string) {
  const params: unknown[] = [from, to]
  const conditions = [`rr.period_end BETWEEN $1::date AND $2::date`, `rr.status = 'posted'`]
  if (req.query.contractId) {
    params.push(String(req.query.contractId))
    conditions.push(`rr.contract_id = $${params.length}`)
  }
  if (req.query.customerId) {
    params.push(String(req.query.customerId))
    conditions.push(`c.customer_id = $${params.length}`)
  }
  if (req.query.routeId) {
    params.push(String(req.query.routeId))
    conditions.push(`EXISTS (SELECT 1 FROM contract_routes cr WHERE cr.contract_id = c.id AND cr.route_id = $${params.length})`)
  }
  return { params, where: conditions.join(' AND ') }
}

async function fixedContractRevenue(req: Request, from: string, to: string) {
  if (req.query.service === 'private') return 0
  const { params, where } = contractFilterParams(req, from, to)
  let expression = 'SUM(rr.amount)'
  let join = ''
  if (req.query.vehicleId) {
    params.push(String(req.query.vehicleId))
    join = `JOIN contract_vehicles cv ON cv.contract_id = c.id AND cv.vehicle_id = $${params.length}`
    expression = 'SUM(rr.amount * cv.allocation_percent / 100)'
  }
  const rows = await q(
    `SELECT COALESCE(${expression},0) AS amount
     FROM revenue_recognitions rr JOIN contracts c ON c.id = rr.contract_id ${join}
     WHERE ${where}`,
    params,
  )
  return Number(rows[0]?.amount ?? 0)
}

async function invoiceCollected(req: Request, from: string, to: string) {
  const params: unknown[] = [from, to]
  const conditions = [`issue_date BETWEEN $1::date AND $2::date`, `status <> 'void'`, `status <> 'draft'`]
  if (req.query.customerId) { params.push(String(req.query.customerId)); conditions.push(`customer_id = $${params.length}`) }
  if (req.query.contractId) { params.push(String(req.query.contractId)); conditions.push(`contract_id = $${params.length}`) }
  const invoices = await q(
    `SELECT COALESCE(SUM(total),0) AS invoiced FROM invoices WHERE ${conditions.join(' AND ')}`,
    params,
  )
  const paymentParams: unknown[] = [from, to]
  const paymentConditions = [`p.payment_date BETWEEN $1::date AND $2::date`]
  if (req.query.customerId) { paymentParams.push(String(req.query.customerId)); paymentConditions.push(`i.customer_id = $${paymentParams.length}`) }
  if (req.query.contractId) { paymentParams.push(String(req.query.contractId)); paymentConditions.push(`i.contract_id = $${paymentParams.length}`) }
  const payments = await q(
    `SELECT COALESCE(SUM(p.amount),0) AS collected FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE ${paymentConditions.join(' AND ')}`,
    paymentParams,
  )
  const outstandingParams: unknown[] = [to]
  const outstandingConditions = [`i.issue_date <= $1::date`, `i.status <> 'void'`, `i.status <> 'paid'`]
  if (req.query.customerId) { outstandingParams.push(String(req.query.customerId)); outstandingConditions.push(`i.customer_id = $${outstandingParams.length}`) }
  if (req.query.contractId) { outstandingParams.push(String(req.query.contractId)); outstandingConditions.push(`i.contract_id = $${outstandingParams.length}`) }
  const outstanding = await q(
    `SELECT COALESCE(SUM(i.total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.payment_date <= $1::date),0)),0) AS outstanding
     FROM invoices i WHERE ${outstandingConditions.join(' AND ')}`,
    outstandingParams,
  )
  return {
    invoiced: Number(invoices[0]?.invoiced ?? 0),
    collected: Number(payments[0]?.collected ?? 0),
    outstanding: Number(outstanding[0]?.outstanding ?? 0),
  }
}

async function expenseTotal(req: Request, from: string, to: string) {
  const params: unknown[] = [from, to]
  const conditions = [`e.status = 'posted'`, `e.is_operating = true`, `e.expense_date BETWEEN $1::date AND $2::date`]
  if (req.query.contractId) { params.push(String(req.query.contractId)); conditions.push(`e.contract_id = $${params.length}`) }
  if (req.query.customerId) {
    params.push(String(req.query.customerId))
    conditions.push(`e.contract_id IN (SELECT id FROM contracts WHERE customer_id = $${params.length})`)
  }
  if (!req.query.vehicleId) {
    const rows = await q(`SELECT COALESCE(SUM(e.amount),0) AS amount FROM expenses e WHERE ${conditions.join(' AND ')}`, params)
    return Number(rows[0]?.amount ?? 0)
  }
  params.push(String(req.query.vehicleId))
  const vehicleParam = `$${params.length}`
  const rows = await q(
    `SELECT COALESCE(SUM(x.amount),0) AS amount FROM (
       SELECT e.amount FROM expenses e WHERE ${conditions.join(' AND ')} AND e.vehicle_id = ${vehicleParam}
       UNION ALL
       SELECT ea.allocated_amount AS amount FROM expense_allocations ea JOIN expenses e ON e.id = ea.expense_id
       WHERE ${conditions.join(' AND ')} AND e.vehicle_id IS NULL AND ea.vehicle_id = ${vehicleParam}
     ) x`,
    params,
  )
  return Number(rows[0]?.amount ?? 0)
}

dashboardRouter.get(
  '/dashboard',
  requirePermission('view_dashboard'),
  asyncHandler(async (req, res) => {
    await refreshVehicleStatuses()
    await syncOverdueInvoices()
    const filter = buildTripFilter(req)
    const days = daysInclusive(filter.from, filter.to)
    const previousFrom = addDays(filter.from, -days)
    const previousTo = addDays(filter.from, -1)
    const previousFilter: TripFilter = {
      ...filter,
      where: filter.where.replace('BETWEEN $1::date AND $2::date', 'BETWEEN $1::date AND $2::date').replace(/\$1::date/g, '$1::date'),
    }
    // Previous period uses the same parameter positions, different values.
    const prevParams = [...filter.params]
    prevParams[0] = previousFrom
    prevParams[1] = previousTo

    const [current, previous, fixedRevenue, previousFixedRevenue, invoiceData, expenses, previousExpenses, fleet, settings] =
      await Promise.all([
        tripKpis(filter),
        tripKpis({ ...previousFilter, params: prevParams }),
        fixedContractRevenue(req, filter.from, filter.to),
        fixedContractRevenue(req, previousFrom, previousTo),
        invoiceCollected(req, filter.from, filter.to),
        expenseTotal(req, filter.from, filter.to),
        expenseTotal(req, previousFrom, previousTo),
        fleetAvailability(),
        one<{ operating_hours_per_day: string; trip_buffer_minutes: number; currency: string; demo_mode: boolean }>(
          `SELECT operating_hours_per_day, trip_buffer_minutes, currency, demo_mode FROM business_settings WHERE id = 1`,
        ),
      ])

    const drivers = await one<{ active: string }>(`SELECT COUNT(*) AS active FROM drivers WHERE status = 'active' AND archived_at IS NULL`)
    const contracts = await one<{ active: string; expiring: string }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (WHERE status = 'active' AND end_date BETWEEN current_date AND current_date + 60) AS expiring
       FROM contracts WHERE archived_at IS NULL`,
    )
    const maintenance = await one<{ hours: string }>(
      `SELECT COALESCE(SUM((end_date - start_date + 1) * $3::numeric),0) AS hours
       FROM maintenance_records WHERE status IN ('scheduled','in_progress')
         AND start_date <= $2::date AND end_date >= $1::date`,
      [filter.from, filter.to, Number(settings?.operating_hours_per_day ?? 12)],
    )
    const fleetCount = req.query.vehicleId ? 1 : fleet.total
    const availableHours = Math.max(
      1,
      fleetCount * days * Number(settings?.operating_hours_per_day ?? 12) - Number(maintenance?.hours ?? 0),
    )
    const utilization = Math.min(100, Math.round((current.hours / availableHours) * 1000) / 10)
    const recognizedRevenue = current.revenue + fixedRevenue
    const previousRevenue = previous.revenue + previousFixedRevenue
    const netProfit = recognizedRevenue - expenses
    const previousProfit = previousRevenue - previousExpenses
    const hasPrevious = previous.total > 0 || previous.revenue > 0 || previousExpenses > 0 || previousFixedRevenue > 0

    const dailyTrips = await q(
      `SELECT to_char(t.scheduled_departure::date, 'YYYY-MM-DD') AS date,
        COALESCE(r.name_en, 'Private trips') AS route,
        COALESCE(r.id::text, 'private') AS route_id,
        COUNT(*) AS trips,
        COUNT(*) FILTER (WHERE t.status = 'completed') AS completed,
        COALESCE(SUM(t.recognized_revenue) FILTER (WHERE t.status = 'completed'),0) AS revenue
       FROM trips t LEFT JOIN routes r ON r.id = t.route_id
       WHERE ${filter.where}
       GROUP BY t.scheduled_departure::date, r.name_en, r.id
       ORDER BY date, route`,
      filter.params,
    )

    const vehicleParams = [...filter.params]
    let contractCondition = ''
    if (req.query.contractId) {
      vehicleParams.push(String(req.query.contractId))
      contractCondition = `AND c.id = $${vehicleParams.length}`
    }
    let vehicleCondition = ''
    let vehicleAllocCondition = ''
    if (req.query.vehicleId) {
      vehicleParams.push(String(req.query.vehicleId))
      vehicleCondition = `AND v.id = $${vehicleParams.length}`
      vehicleAllocCondition = `AND cv.vehicle_id = $${vehicleParams.length}`
    }
    const vehicleFinancials = await q(
      `WITH trip_stats AS (
        SELECT t.vehicle_id,
          COUNT(*) FILTER (WHERE t.status = 'completed') AS trips,
          COALESCE(SUM(t.recognized_revenue) FILTER (WHERE t.status = 'completed'),0) AS trip_revenue,
          COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(t.expected_arrival, t.scheduled_departure) - t.scheduled_departure))/3600) FILTER (WHERE t.status = 'completed'),0) AS hours
        FROM trips t
        WHERE ${filter.where} AND t.vehicle_id IS NOT NULL
        GROUP BY t.vehicle_id
      ),
      fixed_revenue AS (
        SELECT cv.vehicle_id, SUM(rr.amount * cv.allocation_percent / 100) AS amount
        FROM revenue_recognitions rr
        JOIN contracts c ON c.id = rr.contract_id
        JOIN contract_vehicles cv ON cv.contract_id = c.id
        WHERE rr.status = 'posted' AND rr.period_end BETWEEN $1::date AND $2::date
          ${req.query.service === 'private' ? 'AND false' : ''}
          ${contractCondition}
          ${vehicleAllocCondition}
        GROUP BY cv.vehicle_id
      ),
      direct_expenses AS (
        SELECT e.vehicle_id, SUM(e.amount) AS amount FROM expenses e
        WHERE e.status = 'posted' AND e.is_operating = true AND e.vehicle_id IS NOT NULL
          AND e.expense_date BETWEEN $1::date AND $2::date
        GROUP BY e.vehicle_id
      ),
      allocated_expenses AS (
        SELECT ea.vehicle_id, SUM(ea.allocated_amount) AS amount FROM expense_allocations ea
        JOIN expenses e ON e.id = ea.expense_id
        WHERE e.status = 'posted' AND e.is_operating = true AND e.vehicle_id IS NULL AND ea.vehicle_id IS NOT NULL
          AND e.expense_date BETWEEN $1::date AND $2::date
        GROUP BY ea.vehicle_id
      )
      SELECT v.id, v.vehicle_no, v.plate, v.make, v.model, v.status,
        COALESCE(ts.trips,0) AS trips,
        COALESCE(ts.trip_revenue,0) AS trip_revenue,
        COALESCE(fr.amount,0) AS fixed_revenue,
        COALESCE(ts.trip_revenue,0) + COALESCE(fr.amount,0) AS revenue,
        COALESCE(de.amount,0) + COALESCE(ae.amount,0) AS expenses,
        COALESCE(ts.trip_revenue,0) + COALESCE(fr.amount,0) - COALESCE(de.amount,0) - COALESCE(ae.amount,0) AS profit,
        COALESCE(ts.hours,0) AS hours
       FROM vehicles v
       LEFT JOIN trip_stats ts ON ts.vehicle_id = v.id
       LEFT JOIN fixed_revenue fr ON fr.vehicle_id = v.id
       LEFT JOIN direct_expenses de ON de.vehicle_id = v.id
       LEFT JOIN allocated_expenses ae ON ae.vehicle_id = v.id
       WHERE v.archived_at IS NULL ${vehicleCondition}
       ORDER BY revenue DESC, v.vehicle_no`,
      vehicleParams,
    )

    const expenseByVehicleCategory = await q(
      `SELECT x.vehicle_id, x.category_id, x.category_key, x.name_en, x.name_ar, SUM(x.amount) AS amount
       FROM (
         SELECT e.vehicle_id, e.category_id, ec.key AS category_key, ec.name_en, ec.name_ar, e.amount
         FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
         WHERE e.status = 'posted' AND e.is_operating = true AND e.vehicle_id IS NOT NULL
           AND e.expense_date BETWEEN $1::date AND $2::date
         UNION ALL
         SELECT ea.vehicle_id, e.category_id, ec.key, ec.name_en, ec.name_ar, ea.allocated_amount
         FROM expense_allocations ea JOIN expenses e ON e.id = ea.expense_id JOIN expense_categories ec ON ec.id = e.category_id
         WHERE e.status = 'posted' AND e.is_operating = true AND e.vehicle_id IS NULL AND ea.vehicle_id IS NOT NULL
           AND e.expense_date BETWEEN $1::date AND $2::date
       ) x GROUP BY x.vehicle_id, x.category_id, x.category_key, x.name_en, x.name_ar
       ORDER BY amount DESC`,
      [filter.from, filter.to],
    )

    const contractPerfParams: unknown[] = [filter.from, filter.to]
    let contractPerfConditions = ''
    if (req.query.contractId) {
      contractPerfParams.push(String(req.query.contractId))
      contractPerfConditions += ` AND c.id = $${contractPerfParams.length}`
    }
    if (req.query.customerId) {
      contractPerfParams.push(String(req.query.customerId))
      contractPerfConditions += ` AND c.customer_id = $${contractPerfParams.length}`
    }
    if (req.query.service === 'private') contractPerfConditions += ' AND false'
    const contractPerformance = await q(
      `WITH base AS (
        SELECT c.id, c.contract_no, c.title, c.status, c.start_date, c.end_date, cu.name AS customer_name,
          COALESCE((SELECT SUM(rr.amount) FROM revenue_recognitions rr WHERE rr.contract_id = c.id AND rr.status='posted' AND rr.period_end BETWEEN $1::date AND $2::date),0) AS fixed_revenue,
          COALESCE((SELECT SUM(t.recognized_revenue) FROM trips t WHERE t.contract_id = c.id AND t.status='completed' AND t.scheduled_departure::date BETWEEN $1::date AND $2::date),0) AS variable_revenue,
          COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.contract_id = c.id AND i.status <> 'void' AND i.issue_date BETWEEN $1::date AND $2::date),0) AS invoiced,
          COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.contract_id = c.id AND p.payment_date BETWEEN $1::date AND $2::date),0) AS collected,
          COALESCE((SELECT SUM(i.total - i.amount_paid) FROM invoices i WHERE i.contract_id = c.id AND i.status <> 'void' AND i.status <> 'paid'),0) AS outstanding,
          COALESCE((SELECT SUM(x.amount) FROM (
            SELECT e.amount FROM expenses e WHERE e.contract_id = c.id AND e.status='posted' AND e.is_operating = true AND e.expense_date BETWEEN $1::date AND $2::date
            UNION ALL
            SELECT ea.allocated_amount FROM expense_allocations ea JOIN expenses e ON e.id = ea.expense_id WHERE ea.contract_id = c.id AND e.contract_id IS NULL AND e.status='posted' AND e.is_operating = true AND e.expense_date BETWEEN $1::date AND $2::date
          ) x),0) AS allocated_costs
        FROM contracts c JOIN customers cu ON cu.id = c.customer_id
        WHERE c.archived_at IS NULL ${contractPerfConditions}
      )
      SELECT *, fixed_revenue + variable_revenue AS recognized, fixed_revenue + variable_revenue - allocated_costs AS profit
      FROM base ORDER BY recognized DESC LIMIT 12`,
      contractPerfParams,
    )

    const fixedVsPrivate = await q(
      `SELECT t.trip_type,
        COUNT(*) AS trips,
        COUNT(*) FILTER (WHERE t.status = 'completed') AS completed,
        COALESCE(SUM(t.recognized_revenue) FILTER (WHERE t.status = 'completed'),0) AS revenue,
        COALESCE(SUM(x.amount),0) AS expenses
       FROM trips t
       LEFT JOIN (
         SELECT e.trip_id, SUM(e.amount) AS amount FROM expenses e
         WHERE e.status = 'posted' AND e.is_operating = true AND e.trip_id IS NOT NULL
           AND e.expense_date BETWEEN $1::date AND $2::date
         GROUP BY e.trip_id
       ) x ON x.trip_id = t.id
       WHERE ${filter.where}
       GROUP BY t.trip_type`,
      filter.params,
    )

    const recentTrips = await q(
      `SELECT t.id, t.trip_no, t.trip_type, t.origin, t.destination, t.scheduled_departure, t.status,
        t.quoted_price, t.recognized_revenue, v.plate AS vehicle_plate, d.full_name AS driver_name,
        c.name AS customer_name, r.name_en AS route_name
       FROM trips t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id
       LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN routes r ON r.id = t.route_id
       WHERE ${filter.where} ORDER BY t.scheduled_departure DESC LIMIT 6`,
      filter.params,
    )

    res.json(
      serialize({
        range: { from: filter.from, to: filter.to },
        previousRange: { from: previousFrom, to: previousTo },
        hasPrevious,
        currency: settings?.currency ?? 'EGP',
        demoMode: Boolean(settings?.demo_mode),
        kpis: {
          totalTrips: current.total,
          completedTrips: current.completed,
          scheduledTrips: current.scheduled,
          cancelledTrips: current.cancelled,
          missedTrips: current.missed,
          totalVehicles: fleet.total,
          availableVehicles: fleet.available,
          operatingVehicles: fleet.operating,
          maintenanceVehicles: fleet.maintenance,
          activeDrivers: Number(drivers?.active ?? 0),
          activeContracts: Number(contracts?.active ?? 0),
          expiringContracts: Number(contracts?.expiring ?? 0),
          recognizedRevenue,
          tripRevenue: current.revenue,
          contractRevenue: fixedRevenue,
          invoicesIssued: invoiceData.invoiced,
          paymentsCollected: invoiceData.collected,
          outstandingReceivables: invoiceData.outstanding,
          operatingExpenses: expenses,
          netOperatingProfit: netProfit,
          netMargin: recognizedRevenue > 0 ? Math.round((netProfit / recognizedRevenue) * 1000) / 10 : 0,
          utilization,
        },
        previous: hasPrevious
          ? {
              recognizedRevenue: previousRevenue,
              tripRevenue: previous.revenue,
              contractRevenue: previousFixedRevenue,
              operatingExpenses: previousExpenses,
              netOperatingProfit: previousProfit,
              totalTrips: previous.total,
              completedTrips: previous.completed,
            }
          : null,
        charts: {
          dailyTrips,
          vehicleFinancials,
          expenseByVehicleCategory,
          contractPerformance,
          fixedVsPrivate,
        },
        recentTrips,
      }),
    )
  }),
)
