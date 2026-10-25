import { randomUUID } from 'node:crypto'
import type { Queryable } from '../db.js'
import { db, nextSequence, one, q } from '../db.js'
import { ApiError, addDays, daysInclusive, monthPeriods, toDateOnly, todayDate } from '../lib.js'

export interface TripForRecognition {
  id: string
  trip_no: string
  status: string
  contract_id: string | null
  quoted_price: string | number
  additional_charges: string | number
  discount: string | number
}

export function directTripRevenue(trip: TripForRecognition): number {
  return Math.max(
    0,
    Number(trip.quoted_price || 0) + Number(trip.additional_charges || 0) - Number(trip.discount || 0),
  )
}

export async function tripShouldRecognizeRevenue(
  contractId: string | null | undefined,
  runner: Queryable = db,
): Promise<{ recognize: boolean; reason: string }> {
  if (!contractId) return { recognize: true, reason: 'direct' }
  const contract = await runner.query<{ contract_type: string; status: string }>(
    `SELECT contract_type, status FROM contracts WHERE id = $1`,
    [contractId],
  )
  const c = contract.rows[0]
  if (!c) return { recognize: true, reason: 'direct' }
  if (c.contract_type === 'monthly' || c.contract_type === 'annual') {
    return { recognize: false, reason: 'covered_by_fixed_contract' }
  }
  return { recognize: true, reason: 'variable_contract' }
}

export async function syncContractRecognitions(
  contractId: string,
  actorId: string | null,
  runner: Queryable = db,
): Promise<{ posted: number; skipped: number }> {
  const contractResult = await runner.query<{
    id: string
    contract_no: string
    contract_type: string
    contract_value: string
    status: string
    start_date: Date | string
    end_date: Date | string
  }>(
    `SELECT id, contract_no, contract_type, contract_value, status, start_date, end_date
     FROM contracts WHERE id = $1`,
    [contractId],
  )
  const contract = contractResult.rows[0]
  if (!contract) throw new ApiError(404, 'Contract not found', 'NOT_FOUND')
  if (!['active', 'expired', 'paused'].includes(contract.status)) return { posted: 0, skipped: 0 }
  if (!['monthly', 'annual', 'hybrid'].includes(contract.contract_type)) return { posted: 0, skipped: 0 }

  const start = toDateOnly(contract.start_date)
  const end = toDateOnly(contract.end_date)
  const totalDays = daysInclusive(start, end)
  const today = todayDate()
  const periods = monthPeriods(start, end).filter((period) => period.end <= today)
  let posted = 0
  let skipped = 0

  for (const period of periods) {
    const periodDays = daysInclusive(period.start, period.end)
    const amount = Math.round((Number(contract.contract_value) * periodDays * 100) / totalDays) / 100
    if (amount <= 0) continue
    const result = await runner.query(
      `INSERT INTO revenue_recognitions
        (id, contract_id, period_start, period_end, amount, recognition_type, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,'fixed','posted','Monthly contract recognition',$6)
       ON CONFLICT (contract_id, period_start, period_end, recognition_type) DO NOTHING`,
      [randomUUID(), contract.id, period.start, period.end, amount, actorId],
    )
    if (result.rows.length > 0) posted++
    else skipped++
  }
  return { posted, skipped }
}

export async function syncAllContractRecognitions() {
  const contracts = await q<{ id: string }>(
    `SELECT id FROM contracts WHERE status IN ('active','expired') AND contract_type IN ('monthly','annual','hybrid')`,
  )
  for (const contract of contracts) {
    try {
      await syncContractRecognitions(contract.id, null)
    } catch (error) {
      console.error('[recognition] failed for contract', contract.id, error)
    }
  }
}

export async function recalcInvoice(invoiceId: string, runner: Queryable = db) {
  const invoiceResult = await runner.query<{ total: string; due_date: Date | string; status: string }>(
    `SELECT total, due_date, status FROM invoices WHERE id = $1`,
    [invoiceId],
  )
  const invoice = invoiceResult.rows[0]
  if (!invoice) return
  const paidResult = await runner.query<{ paid: string }>(
    `SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE invoice_id = $1`,
    [invoiceId],
  )
  const paid = Math.round(Number(paidResult.rows[0]?.paid ?? 0) * 100) / 100
  const total = Math.round(Number(invoice.total) * 100) / 100
  if (invoice.status === 'void' || invoice.status === 'draft') {
    await runner.query(`UPDATE invoices SET amount_paid = $2 WHERE id = $1`, [invoiceId, paid])
    return
  }
  const overdue = toDateOnly(invoice.due_date) < todayDate()
  let status = 'sent'
  if (paid >= total - 0.005) status = 'paid'
  else if (overdue) status = 'overdue'
  else if (paid > 0) status = 'partial'
  await runner.query(`UPDATE invoices SET amount_paid = $2, status = $3 WHERE id = $1`, [invoiceId, paid, status])
}

export async function syncOverdueInvoices(runner: Queryable = db) {
  await runner.query(
    `UPDATE invoices SET status = 'overdue'
     WHERE status IN ('sent','partial') AND amount_paid < total - 0.005 AND due_date < current_date`,
  )
}

export async function recordPayment(
  input: {
    invoiceId: string
    amount: number
    paymentDate: string
    method: string
    reference?: string | null
    notes?: string | null
    idempotencyKey?: string | null
  },
  actorId: string,
  tx: Queryable = db,
) {
  const invoiceResult = await tx.query<{
    id: string
    invoice_no: string
    total: string
    amount_paid: string
    status: string
    customer_id: string
  }>(`SELECT id, invoice_no, total, amount_paid, status, customer_id FROM invoices WHERE id = $1`, [input.invoiceId])
  const invoice = invoiceResult.rows[0]
  if (!invoice) throw new ApiError(404, 'Invoice not found', 'NOT_FOUND')
  if (invoice.status === 'void') throw new ApiError(409, 'Cannot record a payment against a void invoice', 'INVOICE_VOID')
  if (invoice.status === 'draft') throw new ApiError(409, 'Issue the invoice before recording a payment', 'INVOICE_DRAFT')
  const outstanding = Number(invoice.total) - Number(invoice.amount_paid)
  if (input.amount <= 0) throw new ApiError(400, 'Payment amount must be greater than zero', 'INVALID_AMOUNT')
  if (input.amount > outstanding + 0.005) {
    throw new ApiError(
      409,
      `Payment exceeds the outstanding balance of ${outstanding.toFixed(2)}`,
      'PAYMENT_EXCEEDS_BALANCE',
      { outstanding },
    )
  }

  if (input.idempotencyKey) {
    const existing = await tx.query<{ id: string }>(
      `SELECT id FROM payments WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    )
    if (existing.rows[0]) throw new ApiError(409, 'This payment was already submitted', 'DUPLICATE_PAYMENT')
  }

  const seq = await nextSequence('payment', tx)
  const paymentNo = `PMT-${String(seq).padStart(5, '0')}`
  const id = randomUUID()
  try {
    await tx.query(
      `INSERT INTO payments (id, payment_no, invoice_id, amount, payment_date, method, reference, idempotency_key, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        paymentNo,
        input.invoiceId,
        input.amount,
        input.paymentDate,
        input.method,
        input.reference ?? null,
        input.idempotencyKey ?? null,
        input.notes ?? null,
        actorId,
      ],
    )
  } catch (error) {
    if (String(error).includes('idempotency')) {
      throw new ApiError(409, 'This payment was already submitted', 'DUPLICATE_PAYMENT')
    }
    throw error
  }
  await recalcInvoice(input.invoiceId, tx)
  return { id, paymentNo }
}

export async function generateContractInvoice(
  contractId: string,
  periodStart: string,
  periodEnd: string,
  actorId: string,
  tx: Queryable = db,
) {
  const contractResult = await tx.query<{
    id: string
    contract_no: string
    customer_id: string
    contract_type: string
    contract_value: string
    billing_frequency: string
    status: string
    start_date: Date | string
    end_date: Date | string
    payment_terms_days: number
    title: string
  }>(
    `SELECT id, contract_no, customer_id, contract_type, contract_value, billing_frequency, status,
            start_date, end_date, payment_terms_days, title
     FROM contracts WHERE id = $1`,
    [contractId],
  )
  const contract = contractResult.rows[0]
  if (!contract) throw new ApiError(404, 'Contract not found', 'NOT_FOUND')
  if (contract.status !== 'active') throw new ApiError(409, 'Only active contracts can be invoiced', 'CONTRACT_NOT_ACTIVE')
  if (periodEnd < periodStart) throw new ApiError(400, 'Invalid invoice period', 'INVALID_PERIOD')

  const existingResult = await tx.query<{ id: string; invoice_no: string }>(
    `SELECT id, invoice_no FROM invoices
     WHERE contract_id = $1 AND period_start = $2::date AND period_end = $3::date AND status <> 'void'`,
    [contractId, periodStart, periodEnd],
  )
  const existing = existingResult.rows[0]
  if (existing) {
    throw new ApiError(409, `Invoice ${existing.invoice_no} already exists for this period`, 'DUPLICATE_INVOICE')
  }

  const settingsResult = await tx.query<{ vat_rate: string }>(`SELECT vat_rate FROM business_settings WHERE id = 1`)
  const vatRate = Number(settingsResult.rows[0]?.vat_rate ?? 0)
  const lines: { description: string; quantity: number; unitPrice: number; tripId?: string | null; category: string }[] = []

  const totalTermDays = daysInclusive(toDateOnly(contract.start_date), toDateOnly(contract.end_date))
  const periodDays = daysInclusive(periodStart, periodEnd)
  if (['monthly', 'annual', 'hybrid'].includes(contract.contract_type) && Number(contract.contract_value) > 0) {
    const amount = Math.round((Number(contract.contract_value) * periodDays * 100) / totalTermDays) / 100
    if (amount > 0) {
      lines.push({
        description: `${contract.title} — ${periodStart} to ${periodEnd}`,
        quantity: 1,
        unitPrice: amount,
        category: 'fixed_contract',
      })
    }
  }

  if (['per_trip', 'per_km', 'hybrid'].includes(contract.contract_type)) {
    const trips = await tx.query<{
      id: string
      trip_no: string
      origin: string
      destination: string
      quoted_price: string
      additional_charges: string
      discount: string
      distance_km: string | null
    }>(
      `SELECT t.id, t.trip_no, t.origin, t.destination, t.quoted_price, t.additional_charges, t.discount, t.distance_km
       FROM trips t
       LEFT JOIN invoice_lines il ON il.trip_id = t.id
       WHERE t.contract_id = $1 AND t.status = 'completed'
         AND t.scheduled_departure::date BETWEEN $2::date AND $3::date
         AND il.id IS NULL
       ORDER BY t.scheduled_departure`,
      [contractId, periodStart, periodEnd],
    )
    for (const trip of trips.rows) {
      const amount =
        Math.round(
          (Number(trip.quoted_price) + Number(trip.additional_charges) - Number(trip.discount)) * 100,
        ) / 100
      if (amount <= 0) continue
      lines.push({
        description: `${trip.trip_no} · ${trip.origin} → ${trip.destination}${trip.distance_km ? ` · ${trip.distance_km} km` : ''}`,
        quantity: 1,
        unitPrice: amount,
        tripId: trip.id,
        category: 'contract_trip',
      })
    }
  }

  if (lines.length === 0) {
    throw new ApiError(409, 'There are no billable services for this contract and period', 'NOTHING_TO_INVOICE')
  }

  const subtotal = Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100
  const tax = Math.round(subtotal * vatRate) / 100
  const total = Math.round((subtotal + tax) * 100) / 100
  const seq = await nextSequence('invoice', tx)
  const invoiceNo = `INV-${String(seq).padStart(5, '0')}`
  const invoiceId = randomUUID()
  const issueDate = todayDate()
  const dueDate = addDays(issueDate, Number(contract.payment_terms_days ?? 30))
  await tx.query(
    `INSERT INTO invoices (id, invoice_no, customer_id, contract_id, issue_date, due_date, period_start, period_end,
      subtotal, tax, total, status, notes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'sent',$12,$13,$13)`,
    [
      invoiceId,
      invoiceNo,
      contract.customer_id,
      contract.id,
      issueDate,
      dueDate,
      periodStart,
      periodEnd,
      subtotal,
      tax,
      total,
      `Recurring invoice for ${contract.contract_no}`,
      actorId,
    ],
  )
  for (const line of lines) {
    const lineTotal = Math.round(line.quantity * line.unitPrice * 100) / 100
    await tx.query(
      `INSERT INTO invoice_lines (id, invoice_id, trip_id, contract_id, description, quantity, unit_price, line_total, revenue_category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        invoiceId,
        line.tripId ?? null,
        contractId,
        line.description,
        line.quantity,
        line.unitPrice,
        lineTotal,
        line.category,
      ],
    )
  }
  return { id: invoiceId, invoiceNo, total }
}

export async function customerBalance(customerId: string, runner: Queryable = db) {
  const row = await runner.query<{ outstanding: string; invoiced: string; collected: string }>(
    `SELECT
       COALESCE(SUM(total) FILTER (WHERE status <> 'void'),0) AS invoiced,
       COALESCE(SUM(amount_paid) FILTER (WHERE status <> 'void'),0) AS collected,
       COALESCE(SUM(total - amount_paid) FILTER (WHERE status <> 'void' AND status <> 'paid'),0) AS outstanding
     FROM invoices WHERE customer_id = $1`,
    [customerId],
  )
  return {
    invoiced: Number(row.rows[0]?.invoiced ?? 0),
    collected: Number(row.rows[0]?.collected ?? 0),
    outstanding: Number(row.rows[0]?.outstanding ?? 0),
  }
}

export async function contractFinancials(contractId: string, runner: Queryable = db) {
  const recognition = await runner.query<{ recognized: string; fixed_revenue: string }>(
    `SELECT COALESCE(SUM(amount),0) AS recognized, COALESCE(SUM(amount),0) AS fixed_revenue
     FROM revenue_recognitions WHERE contract_id = $1 AND status = 'posted'`,
    [contractId],
  )
  const variable = await runner.query<{ variable_revenue: string }>(
    `SELECT COALESCE(SUM(recognized_revenue),0) AS variable_revenue FROM trips
     WHERE contract_id = $1 AND status = 'completed'`,
    [contractId],
  )
  const invoices = await runner.query<{ invoiced: string; collected: string; outstanding: string }>(
    `SELECT COALESCE(SUM(total) FILTER (WHERE status <> 'void'),0) AS invoiced,
            COALESCE(SUM(amount_paid) FILTER (WHERE status <> 'void'),0) AS collected,
            COALESCE(SUM(total - amount_paid) FILTER (WHERE status <> 'void' AND status <> 'paid'),0) AS outstanding
     FROM invoices WHERE contract_id = $1`,
    [contractId],
  )
  const costs = await runner.query<{ allocated_costs: string }>(
    `SELECT COALESCE(SUM(x.amount),0) AS allocated_costs FROM (
       SELECT e.id, e.amount FROM expenses e
       WHERE e.status = 'posted' AND e.is_operating = true AND e.contract_id = $1
       UNION
       SELECT e.id, e.amount FROM expenses e
       JOIN expense_allocations ea ON ea.expense_id = e.id
       WHERE e.status = 'posted' AND e.is_operating = true AND ea.contract_id = $1
     ) x`,
    [contractId],
  )
  const recognized = Number(recognition.rows[0]?.recognized ?? 0) + Number(variable.rows[0]?.variable_revenue ?? 0)
  const allocatedCosts = Number(costs.rows[0]?.allocated_costs ?? 0)
  return {
    recognized,
    fixed_revenue: Number(recognition.rows[0]?.fixed_revenue ?? 0),
    variable_revenue: Number(variable.rows[0]?.variable_revenue ?? 0),
    invoiced: Number(invoices.rows[0]?.invoiced ?? 0),
    collected: Number(invoices.rows[0]?.collected ?? 0),
    outstanding: Number(invoices.rows[0]?.outstanding ?? 0),
    allocated_costs: allocatedCosts,
    profit: recognized - allocatedCosts,
  }
}

export async function fleetFinancials(from: string, to: string, runner: Queryable = db) {
  const revenue = await runner.query<{ trip_revenue: string; contract_revenue: string }>(
    `SELECT
      (SELECT COALESCE(SUM(t.recognized_revenue),0) FROM trips t
       WHERE t.status = 'completed' AND t.scheduled_departure::date BETWEEN $1::date AND $2::date) AS trip_revenue,
      (SELECT COALESCE(SUM(r.amount),0) FROM revenue_recognitions r
       WHERE r.status = 'posted' AND r.period_end BETWEEN $1::date AND $2::date) AS contract_revenue`,
    [from, to],
  )
  const expenses = await runner.query<{ amount: string }>(
    `SELECT COALESCE(SUM(amount),0) AS amount FROM expenses
     WHERE status = 'posted' AND is_operating = true AND expense_date BETWEEN $1::date AND $2::date`,
    [from, to],
  )
  return {
    trip_revenue: Number(revenue.rows[0]?.trip_revenue ?? 0),
    contract_revenue: Number(revenue.rows[0]?.contract_revenue ?? 0),
    revenue:
      Number(revenue.rows[0]?.trip_revenue ?? 0) + Number(revenue.rows[0]?.contract_revenue ?? 0),
    expenses: Number(expenses.rows[0]?.amount ?? 0),
  }
}
