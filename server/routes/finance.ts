import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { requirePermission } from '../auth.js'
import { code, nextSequence, one, q, transaction } from '../db.js'
import {
  ApiError,
  addDays,
  asyncHandler,
  audit,
  dateRangeFromQuery,
  notifyAdmins,
  pagination,
  parseBody,
  parsePatch,
  serialize,
  toDateOnly,
} from '../lib.js'
import {
  contractFinancials,
  generateContractInvoice,
  recordPayment,
  recalcInvoice,
  syncContractRecognitions,
  syncOverdueInvoices,
} from '../services/finance.js'

export const financeRouter = Router()

const contractSchema = z.object({
  customer_id: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  start_date: z.string().date(),
  end_date: z.string().date(),
  contract_type: z.enum(['monthly', 'annual', 'per_trip', 'per_km', 'hybrid']),
  contract_value: z.coerce.number().min(0).default(0),
  unit_rate: z.coerce.number().min(0).nullable().optional(),
  billing_frequency: z.enum(['monthly', 'annual', 'per_trip', 'per_km']).default('monthly'),
  payment_terms: z.string().trim().max(200).nullable().optional(),
  payment_terms_days: z.coerce.number().int().min(0).max(365).default(30),
  grace_days: z.coerce.number().int().min(0).max(365).default(0),
  included_trips: z.coerce.number().int().min(0).nullable().optional(),
  included_hours: z.coerce.number().min(0).nullable().optional(),
  recognition_method: z.enum(['straight_line', 'service_period', 'per_trip', 'usage']).default('straight_line'),
  status: z.enum(['draft', 'active', 'paused', 'expired', 'archived']).default('draft'),
  document_url: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  vehicle_ids: z.array(z.string().uuid()).default([]),
  route_ids: z.array(z.string().uuid()).default([]),
  allocations: z.record(z.string(), z.coerce.number().min(0).max(100)).default({}),
})

const invoiceLineSchema = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().positive().default(1),
  unit_price: z.coerce.number().min(0),
  trip_id: z.string().uuid().nullable().optional(),
  contract_id: z.string().uuid().nullable().optional(),
  revenue_category: z.string().max(40).default('service'),
})

const invoiceSchema = z.object({
  customer_id: z.string().uuid(),
  contract_id: z.string().uuid().nullable().optional(),
  issue_date: z.string().date(),
  due_date: z.string().date(),
  period_start: z.string().date().nullable().optional(),
  period_end: z.string().date().nullable().optional(),
  tax_rate: z.coerce.number().min(0).max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(['draft', 'sent']).default('sent'),
  lines: z.array(invoiceLineSchema).min(1),
})

const expenseSchema = z.object({
  expense_date: z.string().date(),
  category_id: z.string(),
  description: z.string().trim().min(2).max(500),
  amount: z.coerce.number().positive(),
  vendor: z.string().trim().max(160).nullable().optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
  driver_id: z.string().uuid().nullable().optional(),
  trip_id: z.string().uuid().nullable().optional(),
  contract_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  allocations: z
    .array(
      z.object({
        vehicle_id: z.string().uuid().nullable().optional(),
        contract_id: z.string().uuid().nullable().optional(),
        trip_id: z.string().uuid().nullable().optional(),
        allocated_amount: z.coerce.number().min(0),
        method: z.enum(['mileage', 'hours', 'trip_count', 'fixed', 'manual']).default('manual'),
        percent: z.coerce.number().min(0).max(100).nullable().optional(),
        notes: z.string().max(500).nullable().optional(),
      }),
    )
    .default([]),
})

function nullify<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = { ...value }
  for (const key of Object.keys(out)) if (out[key] === '') out[key] = null
  return out as T
}

/* -------------------------------- Contracts -------------------------------- */

financeRouter.get(
  '/contracts',
  requirePermission('view_contracts'),
  asyncHandler(async (req, res) => {
    const status = String(req.query.status || '')
    const customerId = String(req.query.customerId || '')
    const search = String(req.query.search || '').trim()
    const params: unknown[] = []
    const filters = ['c.archived_at IS NULL']
    if (status) { params.push(status); filters.push(`c.status = $${params.length}`) }
    if (customerId) { params.push(customerId); filters.push(`c.customer_id = $${params.length}`) }
    if (search) {
      params.push(`%${search}%`)
      filters.push(`(c.contract_no ILIKE $${params.length} OR c.title ILIKE $${params.length} OR cu.name ILIKE $${params.length})`)
    }
    const contracts = await q<Record<string, unknown>>(
      `SELECT c.*, cu.name AS customer_name, cu.contact_name, cu.phone AS customer_phone,
        (SELECT json_agg(json_build_object('id', v.id, 'plate', v.plate, 'make', v.make, 'model', v.model, 'allocation_percent', cv.allocation_percent))
          FROM contract_vehicles cv JOIN vehicles v ON v.id = cv.vehicle_id WHERE cv.contract_id = c.id) AS vehicles,
        (SELECT json_agg(json_build_object('id', r.id, 'name_en', r.name_en, 'name_ar', r.name_ar))
          FROM contract_routes cr JOIN routes r ON r.id = cr.route_id WHERE cr.contract_id = c.id) AS routes,
        (SELECT COUNT(*) FROM revenue_recognitions rr WHERE rr.contract_id = c.id AND rr.status = 'posted') AS recognition_count
       FROM contracts c JOIN customers cu ON cu.id = c.customer_id
       WHERE ${filters.join(' AND ')}
       ORDER BY CASE c.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END, c.end_date`,
      params,
    )
    const data = []
    for (const contract of contracts) {
      const financials = await contractFinancials(String(contract.id))
      const endDate = toDateOnly(contract.end_date as Date | string)
      const daysToExpiry = Math.ceil((new Date(`${endDate}T12:00:00`).getTime() - Date.now()) / 86_400_000)
      data.push({
        ...contract,
        ...financials,
        days_to_expiry: daysToExpiry,
        renewal_due: contract.status === 'active' && daysToExpiry <= 60 && daysToExpiry >= 0,
      })
    }
    const summary = await q(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (WHERE status = 'draft') AS draft,
        COUNT(*) FILTER (WHERE status = 'active' AND end_date BETWEEN current_date AND current_date + 60) AS expiring,
        COALESCE(SUM(contract_value) FILTER (WHERE status = 'active'),0) AS contracted_value
       FROM contracts WHERE archived_at IS NULL`,
    )
    res.json(serialize({ data, summary: summary[0] }))
  }),
)

financeRouter.get(
  '/contracts/:id',
  requirePermission('view_contracts'),
  asyncHandler(async (req, res) => {
    const contract = await one(
      `SELECT c.*, cu.name AS customer_name, cu.contact_name, cu.phone AS customer_phone, cu.email AS customer_email
       FROM contracts c JOIN customers cu ON cu.id = c.customer_id WHERE c.id = $1`,
      [req.params.id],
    )
    if (!contract) throw new ApiError(404, 'Contract not found', 'NOT_FOUND')
    const vehicles = await q(
      `SELECT v.*, cv.allocation_percent FROM contract_vehicles cv JOIN vehicles v ON v.id = cv.vehicle_id WHERE cv.contract_id = $1`,
      [req.params.id],
    )
    const routes = await q(
      `SELECT r.* FROM contract_routes cr JOIN routes r ON r.id = cr.route_id WHERE cr.contract_id = $1`,
      [req.params.id],
    )
    const recognitions = await q(
      `SELECT * FROM revenue_recognitions WHERE contract_id = $1 ORDER BY period_start DESC`,
      [req.params.id],
    )
    const invoices = await q(
      `SELECT * FROM invoices WHERE contract_id = $1 ORDER BY issue_date DESC`,
      [req.params.id],
    )
    const trips = await q(
      `SELECT t.*, v.plate AS vehicle_plate, d.full_name AS driver_name FROM trips t
       LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id
       WHERE t.contract_id = $1 ORDER BY t.scheduled_departure DESC LIMIT 50`,
      [req.params.id],
    )
    const financials = await contractFinancials(req.params.id)
    res.json(serialize({ contract, vehicles, routes, recognitions, invoices, trips, financials }))
  }),
)

financeRouter.post(
  '/contracts',
  requirePermission('manage_contracts'),
  asyncHandler(async (req, res) => {
    const body = nullify(parseBody(contractSchema, req.body))
    if (body.end_date < body.start_date) throw new ApiError(400, 'End date must be after start date', 'INVALID_PERIOD')
    if (body.allocations) {
      const allocationTotal = Object.values(body.allocations).reduce((sum, value) => sum + Number(value), 0)
      if (allocationTotal > 100.01) throw new ApiError(400, 'Vehicle revenue allocation cannot exceed 100%', 'INVALID_ALLOCATION')
    }
    const seq = await nextSequence('contract')
    const id = randomUUID()
    const row = await transaction(async (tx) => {
      const created = await tx.query(
        `INSERT INTO contracts (id, contract_no, customer_id, title, start_date, end_date, contract_type, contract_value, unit_rate,
          billing_frequency, payment_terms, payment_terms_days, grace_days, included_trips, included_hours,
          recognition_method, status, document_url, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20) RETURNING *`,
        [id, code('CTR', seq, 4), body.customer_id, body.title, body.start_date, body.end_date,
          body.contract_type, body.contract_value, body.unit_rate ?? null, body.billing_frequency,
          body.payment_terms ?? null, body.payment_terms_days, body.grace_days, body.included_trips ?? null,
          body.included_hours ?? null, body.recognition_method, body.status, body.document_url ?? null,
          body.notes ?? null, req.user!.id],
      )
      for (const vehicleId of body.vehicle_ids) {
        await tx.query(
          `INSERT INTO contract_vehicles (contract_id, vehicle_id, allocation_percent) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [id, vehicleId, Number(body.allocations?.[vehicleId] ?? (100 / Math.max(1, body.vehicle_ids.length)))],
        )
      }
      for (const routeId of body.route_ids) {
        await tx.query(`INSERT INTO contract_routes (contract_id, route_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, routeId])
      }
      if (body.status === 'active') await syncContractRecognitions(id, req.user!.id, tx)
      return created.rows[0]
    })
    await audit(req, 'create', 'contract', id, null, row)
    res.status(201).json(serialize(await contractFinancials(id).then((f) => ({ ...row, ...f }))))
  }),
)

financeRouter.patch(
  '/contracts/:id',
  requirePermission('manage_contracts'),
  asyncHandler(async (req, res) => {
    const body = nullify(parsePatch(contractSchema.partial(), req.body))
    const before = await one<Record<string, unknown>>(`SELECT * FROM contracts WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Contract not found', 'NOT_FOUND')
    if (body.start_date && body.end_date && body.end_date < body.start_date) {
      throw new ApiError(400, 'End date must be after start date', 'INVALID_PERIOD')
    }
    const allowed = ['customer_id','title','start_date','end_date','contract_type','contract_value','unit_rate','billing_frequency','payment_terms','payment_terms_days','grace_days','included_trips','included_hours','recognition_method','status','document_url','notes']
    const entries = Object.entries(body).filter(([key]) => allowed.includes(key))
    const row = await transaction(async (tx) => {
      if (entries.length > 0) {
        const assignments = entries.map(([key], index) => `${key} = $${index + 2}`).join(', ')
        await tx.query(
          `UPDATE contracts SET ${assignments}, updated_by = $${entries.length + 2} WHERE id = $1`,
          [req.params.id, ...entries.map(([, value]) => value), req.user!.id],
        )
      }
      if (body.vehicle_ids) {
        await tx.query(`DELETE FROM contract_vehicles WHERE contract_id = $1`, [req.params.id])
        for (const vehicleId of body.vehicle_ids) {
          await tx.query(
            `INSERT INTO contract_vehicles (contract_id, vehicle_id, allocation_percent) VALUES ($1,$2,$3)`,
            [req.params.id, vehicleId, Number(body.allocations?.[vehicleId] ?? (100 / Math.max(1, body.vehicle_ids.length)))],
          )
        }
      }
      if (body.route_ids) {
        await tx.query(`DELETE FROM contract_routes WHERE contract_id = $1`, [req.params.id])
        for (const routeId of body.route_ids) {
          await tx.query(`INSERT INTO contract_routes (contract_id, route_id) VALUES ($1,$2)`, [req.params.id, routeId])
        }
      }
      const status = body.status ?? before.status
      if (status === 'active') await syncContractRecognitions(req.params.id, req.user!.id, tx)
      const updated = await tx.query(`SELECT * FROM contracts WHERE id = $1`, [req.params.id])
      return updated.rows[0]
    })
    await audit(req, 'update', 'contract', req.params.id, before, row)
    res.json(serialize({ ...row, ...(await contractFinancials(req.params.id)) }))
  }),
)

financeRouter.post(
  '/contracts/:id/recognize',
  requirePermission('manage_contracts'),
  asyncHandler(async (req, res) => {
    const before = await one(`SELECT * FROM contracts WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Contract not found', 'NOT_FOUND')
    const result = await transaction(async (tx) => syncContractRecognitions(req.params.id, req.user!.id, tx))
    await audit(req, 'recognize_revenue', 'contract', req.params.id, null, result)
    res.json(serialize({ ...result, financials: await contractFinancials(req.params.id) }))
  }),
)

financeRouter.post(
  '/contracts/:id/invoice',
  requirePermission('manage_finance'),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({ period_start: z.string().date(), period_end: z.string().date() }),
      req.body,
    )
    const result = await transaction(async (tx) =>
      generateContractInvoice(req.params.id, body.period_start, body.period_end, req.user!.id, tx),
    )
    await audit(req, 'generate_invoice', 'contract', req.params.id, null, result)
    res.status(201).json(serialize(result))
  }),
)

financeRouter.post(
  '/contracts/:id/archive',
  requirePermission('manage_contracts'),
  asyncHandler(async (req, res) => {
    const before = await one(`SELECT * FROM contracts WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Contract not found', 'NOT_FOUND')
    const row = await one(
      `UPDATE contracts SET status = 'archived', archived_at = now(), updated_by = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, req.user!.id],
    )
    await audit(req, 'archive', 'contract', req.params.id, before, row)
    res.json(serialize(row))
  }),
)

/* --------------------------------- Invoices -------------------------------- */

financeRouter.get(
  '/invoices',
  requirePermission('view_finance'),
  asyncHandler(async (req, res) => {
    await syncOverdueInvoices()
    const { page, pageSize, offset } = pagination(req.query)
    const { from, to } = dateRangeFromQuery(req.query.from as string, req.query.to as string)
    const params: unknown[] = [from, to]
    const filters = ['i.issue_date BETWEEN $1::date AND $2::date']
    for (const [key, column] of [
      ['status', 'i.status'],
      ['customerId', 'i.customer_id'],
      ['contractId', 'i.contract_id'],
    ] as const) {
      if (req.query[key]) { params.push(String(req.query[key])); filters.push(`${column} = $${params.length}`) }
    }
    const search = String(req.query.search || '').trim()
    if (search) {
      params.push(`%${search}%`)
      filters.push(`(i.invoice_no ILIKE $${params.length} OR c.name ILIKE $${params.length})`)
    }
    const rows = await q(
      `SELECT i.*, c.name AS customer_name, ct.contract_no,
        i.total - i.amount_paid AS balance,
        (SELECT COUNT(*) FROM invoice_lines il WHERE il.invoice_id = i.id) AS line_count,
        (SELECT COUNT(*) FROM payments p WHERE p.invoice_id = i.id) AS payment_count
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       LEFT JOIN contracts ct ON ct.id = i.contract_id
       WHERE ${filters.join(' AND ')}
       ORDER BY i.issue_date DESC, i.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    )
    const count = await one<{ count: string }>(
      `SELECT COUNT(*) AS count FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE ${filters.join(' AND ')}`,
      params,
    )
    const summary = await q(
      `SELECT
        COALESCE(SUM(total) FILTER (WHERE issue_date BETWEEN $1::date AND $2::date AND status <> 'void'),0) AS invoiced,
        COALESCE(SUM(amount_paid) FILTER (WHERE issue_date BETWEEN $1::date AND $2::date AND status <> 'void'),0) AS collected,
        COALESCE(SUM(total - amount_paid) FILTER (WHERE status <> 'void' AND status <> 'paid'),0) AS outstanding,
        COALESCE(SUM(total - amount_paid) FILTER (WHERE status = 'overdue'),0) AS overdue,
        COUNT(*) FILTER (WHERE status = 'overdue') AS overdue_count
       FROM invoices`,
      [from, to],
    )
    res.json(serialize({ data: rows, total: Number(count?.count ?? 0), page, pageSize, summary: summary[0], range: { from, to } }))
  }),
)

financeRouter.get(
  '/invoices/:id',
  requirePermission('view_finance'),
  asyncHandler(async (req, res) => {
    const invoice = await one(
      `SELECT i.*, c.name AS customer_name, c.contact_name, c.phone AS customer_phone, c.email AS customer_email,
        c.address AS customer_address, c.tax_id AS customer_tax_id, ct.contract_no, ct.title AS contract_title,
        i.total - i.amount_paid AS balance
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       LEFT JOIN contracts ct ON ct.id = i.contract_id WHERE i.id = $1`,
      [req.params.id],
    )
    if (!invoice) throw new ApiError(404, 'Invoice not found', 'NOT_FOUND')
    const lines = await q(`SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY created_at`, [req.params.id])
    const payments = await q(
      `SELECT p.*, u.full_name AS created_by_name FROM payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.invoice_id = $1 ORDER BY p.payment_date`,
      [req.params.id],
    )
    const settings = await one(`SELECT * FROM business_settings WHERE id = 1`)
    res.json(serialize({ invoice, lines, payments, settings }))
  }),
)

financeRouter.post(
  '/invoices',
  requirePermission('manage_finance'),
  asyncHandler(async (req, res) => {
    const body = nullify(parseBody(invoiceSchema, req.body))
    if (body.due_date < body.issue_date) throw new ApiError(400, 'Due date must be after issue date', 'INVALID_PERIOD')
    if (body.period_start && body.period_end && body.period_end < body.period_start) {
      throw new ApiError(400, 'Invalid invoice period', 'INVALID_PERIOD')
    }
    if (body.contract_id && body.period_start && body.period_end) {
      const existing = await one<{ invoice_no: string }>(
        `SELECT invoice_no FROM invoices WHERE contract_id = $1 AND period_start = $2::date AND period_end = $3::date AND status <> 'void'`,
        [body.contract_id, body.period_start, body.period_end],
      )
      if (existing) throw new ApiError(409, `Invoice ${existing.invoice_no} already covers this period`, 'DUPLICATE_INVOICE')
    }
    const settings = await one<{ vat_rate: string }>(`SELECT vat_rate FROM business_settings WHERE id = 1`)
    const taxRate = body.tax_rate ?? Number(settings?.vat_rate ?? 0)
    const computed = body.lines.map((line) => ({
      ...line,
      lineTotal: Math.round(line.quantity * line.unit_price * 100) / 100,
    }))
    const subtotal = Math.round(computed.reduce((sum, line) => sum + line.lineTotal, 0) * 100) / 100
    const tax = Math.round(subtotal * taxRate) / 100
    const total = Math.round((subtotal + tax) * 100) / 100
    const seq = await nextSequence('invoice')
    const invoiceNo = `INV-${String(seq).padStart(5, '0')}`
    const id = randomUUID()
    const row = await transaction(async (tx) => {
      const created = await tx.query(
        `INSERT INTO invoices (id, invoice_no, customer_id, contract_id, issue_date, due_date, period_start, period_end,
          subtotal, tax, total, status, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`,
        [id, invoiceNo, body.customer_id, body.contract_id ?? null, body.issue_date, body.due_date,
          body.period_start ?? null, body.period_end ?? null, subtotal, tax, total, body.status,
          body.notes ?? null, req.user!.id],
      )
      for (const line of computed) {
        await tx.query(
          `INSERT INTO invoice_lines (id, invoice_id, trip_id, contract_id, description, quantity, unit_price, line_total, revenue_category)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [randomUUID(), id, line.trip_id ?? null, line.contract_id ?? body.contract_id ?? null, line.description,
            line.quantity, line.unit_price, line.lineTotal, line.revenue_category],
        )
      }
      await notifyAdmins(tx, {
        title: 'Invoice issued',
        message: `${invoiceNo} was issued for ${total.toFixed(2)}`,
        type: 'info',
        link: '/revenue',
      })
      return created.rows[0]
    })
    await audit(req, 'create', 'invoice', id, null, { ...row, lines: computed })
    res.status(201).json(serialize({ ...row, balance: total }))
  }),
)

financeRouter.post(
  '/invoices/:id/payments',
  requirePermission('manage_finance'),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        amount: z.coerce.number().positive(),
        payment_date: z.string().date(),
        method: z.enum(['cash', 'bank_transfer', 'card', 'cheque']),
        reference: z.string().max(160).nullable().optional(),
        notes: z.string().max(1000).nullable().optional(),
        idempotency_key: z.string().min(8).max(100),
      }),
      req.body,
    )
    const invoice = await one<{ invoice_no: string; total: string }>(`SELECT invoice_no, total FROM invoices WHERE id = $1`, [req.params.id])
    if (!invoice) throw new ApiError(404, 'Invoice not found', 'NOT_FOUND')
    const result = await transaction(async (tx) => {
      const payment = await recordPayment(
        {
          invoiceId: req.params.id,
          amount: body.amount,
          paymentDate: body.payment_date,
          method: body.method,
          reference: body.reference ?? null,
          notes: body.notes ?? null,
          idempotencyKey: body.idempotency_key,
        },
        req.user!.id,
        tx,
      )
      await notifyAdmins(tx, {
        title: 'Payment received',
        message: `${payment.paymentNo} · ${body.amount.toFixed(2)} against ${invoice.invoice_no}`,
        type: 'success',
        link: '/revenue',
      })
      return payment
    })
    await audit(req, 'create', 'payment', result.id, null, { invoice_id: req.params.id, ...body })
    res.status(201).json(serialize(result))
  }),
)

financeRouter.post(
  '/invoices/:id/void',
  requirePermission('manage_finance'),
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ reason: z.string().trim().min(3).max(500) }), req.body)
    const before = await one<{ id: string; amount_paid: string; status: string }>(
      `SELECT id, amount_paid, status FROM invoices WHERE id = $1`,
      [req.params.id],
    )
    if (!before) throw new ApiError(404, 'Invoice not found', 'NOT_FOUND')
    if (Number(before.amount_paid) > 0) throw new ApiError(409, 'Invoices with payments cannot be voided', 'INVOICE_HAS_PAYMENTS')
    if (before.status === 'void') throw new ApiError(409, 'Invoice is already void', 'INVOICE_VOID')
    const row = await one(
      `UPDATE invoices SET status = 'void', void_reason = $2, updated_by = $3 WHERE id = $1 RETURNING *`,
      [req.params.id, body.reason, req.user!.id],
    )
    await audit(req, 'void', 'invoice', req.params.id, before, { ...row, reason: body.reason })
    res.json(serialize(row))
  }),
)

financeRouter.get(
  '/payments',
  requirePermission('view_finance'),
  asyncHandler(async (req, res) => {
    const { from, to } = dateRangeFromQuery(req.query.from as string, req.query.to as string)
    const rows = await q(
      `SELECT p.*, i.invoice_no, i.total AS invoice_total, c.name AS customer_name
       FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = i.customer_id
       WHERE p.payment_date BETWEEN $1::date AND $2::date ORDER BY p.payment_date DESC, p.created_at DESC`,
      [from, to],
    )
    const summary = await q(
      `SELECT COALESCE(SUM(amount),0) AS collected, COUNT(*) AS count FROM payments WHERE payment_date BETWEEN $1::date AND $2::date`,
      [from, to],
    )
    res.json(serialize({ data: rows, summary: summary[0], range: { from, to } }))
  }),
)

financeRouter.get(
  '/receivables',
  requirePermission('view_finance'),
  asyncHandler(async (_req, res) => {
    await syncOverdueInvoices()
    const rows = await q(
      `SELECT c.id, c.name, c.customer_no, c.phone,
        COUNT(i.id) FILTER (WHERE i.status <> 'paid' AND i.status <> 'void') AS open_invoices,
        COALESCE(SUM(i.total) FILTER (WHERE i.status <> 'void'),0) AS invoiced,
        COALESCE(SUM(i.amount_paid) FILTER (WHERE i.status <> 'void'),0) AS collected,
        COALESCE(SUM(i.total - i.amount_paid) FILTER (WHERE i.status <> 'void' AND i.status <> 'paid'),0) AS outstanding,
        COALESCE(SUM(i.total - i.amount_paid) FILTER (WHERE i.status = 'overdue'),0) AS overdue
       FROM customers c LEFT JOIN invoices i ON i.customer_id = c.id
       GROUP BY c.id HAVING COALESCE(SUM(i.total - i.amount_paid) FILTER (WHERE i.status <> 'void' AND i.status <> 'paid'),0) > 0
       ORDER BY outstanding DESC`,
    )
    const total = rows.reduce((sum, row) => sum + Number(row.outstanding ?? 0), 0)
    res.json(serialize({ data: rows, total }))
  }),
)

financeRouter.patch(
  '/invoices/:id/recalculate',
  requirePermission('manage_finance'),
  asyncHandler(async (req, res) => {
    await recalcInvoice(req.params.id)
    res.json({ ok: true })
  }),
)

/* --------------------------------- Expenses -------------------------------- */

financeRouter.get(
  '/expenses',
  requirePermission('view_expenses'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = pagination(req.query)
    const { from, to } = dateRangeFromQuery(req.query.from as string, req.query.to as string)
    const params: unknown[] = [from, to]
    const filters = [`e.expense_date BETWEEN $1::date AND $2::date`]
    for (const [key, column] of [
      ['categoryId', 'e.category_id'],
      ['vehicleId', 'e.vehicle_id'],
      ['contractId', 'e.contract_id'],
      ['status', 'e.status'],
    ] as const) {
      if (req.query[key]) { params.push(String(req.query[key])); filters.push(`${column} = $${params.length}`) }
    }
    const search = String(req.query.search || '').trim()
    if (search) {
      params.push(`%${search}%`)
      filters.push(`(e.description ILIKE $${params.length} OR e.expense_no ILIKE $${params.length} OR e.vendor ILIKE $${params.length})`)
    }
    const rows = await q(
      `SELECT e.*, ec.name_en AS category_name_en, ec.name_ar AS category_name_ar, ec.key AS category_key,
        v.plate AS vehicle_plate, d.full_name AS driver_name, c.contract_no, t.trip_no,
        (SELECT json_agg(json_build_object('id', ea.id, 'vehicle_id', ea.vehicle_id, 'contract_id', ea.contract_id,
          'trip_id', ea.trip_id, 'allocated_amount', ea.allocated_amount, 'method', ea.method,
          'percent', ea.percent, 'notes', ea.notes))
         FROM expense_allocations ea WHERE ea.expense_id = e.id) AS allocations
       FROM expenses e
       JOIN expense_categories ec ON ec.id = e.category_id
       LEFT JOIN vehicles v ON v.id = e.vehicle_id
       LEFT JOIN drivers d ON d.id = e.driver_id
       LEFT JOIN contracts c ON c.id = e.contract_id
       LEFT JOIN trips t ON t.id = e.trip_id
       WHERE ${filters.join(' AND ')}
       ORDER BY e.expense_date DESC, e.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    )
    const count = await one<{ count: string }>(
      `SELECT COUNT(*) AS count FROM expenses e WHERE ${filters.join(' AND ')}`,
      params,
    )
    const summary = await q(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'posted'),0) AS total,
        COALESCE(SUM(amount) FILTER (WHERE status = 'posted' AND is_operating),0) AS operating,
        COALESCE(SUM(amount) FILTER (WHERE status = 'posted' AND NOT is_operating),0) AS capital,
        COUNT(*) FILTER (WHERE status = 'posted') AS count
       FROM expenses WHERE expense_date BETWEEN $1::date AND $2::date`,
      [from, to],
    )
    const byCategory = await q(
      `SELECT ec.id, ec.key, ec.name_en, ec.name_ar, COALESCE(SUM(e.amount),0) AS amount, COUNT(e.id) AS count
       FROM expense_categories ec LEFT JOIN expenses e ON e.category_id = ec.id AND e.status = 'posted' AND e.expense_date BETWEEN $1::date AND $2::date
       GROUP BY ec.id ORDER BY amount DESC`,
      [from, to],
    )
    res.json(serialize({ data: rows, total: Number(count?.count ?? 0), page, pageSize, summary: summary[0], byCategory, range: { from, to } }))
  }),
)

function validateAllocations(amount: number, allocations: { allocated_amount: number }[]) {
  const allocated = Math.round(allocations.reduce((sum, item) => sum + item.allocated_amount, 0) * 100) / 100
  if (allocated > amount + 0.005) {
    throw new ApiError(400, 'Expense allocations exceed the total expense amount', 'INVALID_ALLOCATION')
  }
  return allocated
}

financeRouter.post(
  '/expenses',
  requirePermission('manage_expenses'),
  asyncHandler(async (req, res) => {
    const body = nullify(parseBody(expenseSchema, req.body))
    const allocated = validateAllocations(body.amount, body.allocations)
    const seq = await nextSequence('expense')
    const id = randomUUID()
    const row = await transaction(async (tx) => {
      const created = await tx.query(
        `INSERT INTO expenses (id, expense_no, expense_date, category_id, description, amount, vendor, vehicle_id, driver_id, trip_id, contract_id, is_operating, status, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,'posted',$12,$13,$13) RETURNING *`,
        [id, code('EXP', seq, 5), body.expense_date, body.category_id, body.description, body.amount,
          body.vendor ?? null, body.vehicle_id ?? null, body.driver_id ?? null, body.trip_id ?? null,
          body.contract_id ?? null, body.notes ?? null, req.user!.id],
      )
      for (const allocation of body.allocations) {
        await tx.query(
          `INSERT INTO expense_allocations (id, expense_id, vehicle_id, contract_id, trip_id, allocated_amount, method, percent, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [randomUUID(), id, allocation.vehicle_id ?? null, allocation.contract_id ?? null,
            allocation.trip_id ?? null, allocation.allocated_amount, allocation.method,
            allocation.percent ?? null, allocation.notes ?? null],
        )
      }
      return created.rows[0]
    })
    await audit(req, 'create', 'expense', id, null, { ...row, allocations: body.allocations, allocated })
    res.status(201).json(serialize(row))
  }),
)

financeRouter.patch(
  '/expenses/:id',
  requirePermission('manage_expenses'),
  asyncHandler(async (req, res) => {
    const body = nullify(parsePatch(expenseSchema.partial(), req.body))
    const before = await one<Record<string, unknown>>(`SELECT * FROM expenses WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Expense not found', 'NOT_FOUND')
    if (before.status === 'void') throw new ApiError(409, 'Void expenses cannot be edited', 'EXPENSE_VOID')
    if (body.amount && body.allocations) validateAllocations(body.amount, body.allocations)
    const allowed = ['expense_date','category_id','description','amount','vendor','vehicle_id','driver_id','trip_id','contract_id','notes']
    const entries = Object.entries(body).filter(([key]) => allowed.includes(key))
    const row = await transaction(async (tx) => {
      if (entries.length > 0) {
        const assignments = entries.map(([key], index) => `${key} = $${index + 2}`).join(', ')
        await tx.query(
          `UPDATE expenses SET ${assignments}, updated_by = $${entries.length + 2} WHERE id = $1`,
          [req.params.id, ...entries.map(([, value]) => value), req.user!.id],
        )
      }
      if (body.allocations) {
        await tx.query(`DELETE FROM expense_allocations WHERE expense_id = $1`, [req.params.id])
        for (const allocation of body.allocations) {
          await tx.query(
            `INSERT INTO expense_allocations (id, expense_id, vehicle_id, contract_id, trip_id, allocated_amount, method, percent, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [randomUUID(), req.params.id, allocation.vehicle_id ?? null, allocation.contract_id ?? null,
              allocation.trip_id ?? null, allocation.allocated_amount, allocation.method,
              allocation.percent ?? null, allocation.notes ?? null],
          )
        }
      }
      const updated = await tx.query(`SELECT * FROM expenses WHERE id = $1`, [req.params.id])
      return updated.rows[0]
    })
    await audit(req, 'update', 'expense', req.params.id, before, row)
    res.json(serialize(row))
  }),
)

financeRouter.post(
  '/expenses/:id/void',
  requirePermission('manage_expenses'),
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ reason: z.string().trim().min(3).max(500) }), req.body)
    const before = await one(`SELECT * FROM expenses WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Expense not found', 'NOT_FOUND')
    if (before.status === 'void') throw new ApiError(409, 'Expense is already void', 'EXPENSE_VOID')
    const row = await one(
      `UPDATE expenses SET status = 'void', void_reason = $2, updated_by = $3 WHERE id = $1 RETURNING *`,
      [req.params.id, body.reason, req.user!.id],
    )
    await audit(req, 'void', 'expense', req.params.id, before, { ...row, reason: body.reason })
    res.json(serialize(row))
  }),
)

financeRouter.get(
  '/expense-categories',
  requirePermission('view_expenses'),
  asyncHandler(async (_req, res) => {
    const rows = await q(`SELECT * FROM expense_categories ORDER BY is_system DESC, name_en`)
    res.json(serialize({ data: rows }))
  }),
)
