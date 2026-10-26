import { Router } from 'express'
import { can, requirePermission } from '../auth.js'
import { one, q } from '../db.js'
import { asyncHandler, dateRangeFromQuery, serialize, toCsv, toDateOnly } from '../lib.js'

export const reportsRouter = Router()

reportsRouter.get(
  '/reports',
  requirePermission('view_reports'),
  asyncHandler(async (req, res) => {
    const { from, to } = dateRangeFromQuery(req.query.from as string, req.query.to as string)
    const shouldMaskSalary = !can(req.user, 'view_driver_compensation')

    const [vehicles, routes, contracts, customers, driverRows, maintenance, expenseCategories, aging, comparison, monthly, daily] =
      await Promise.all([
        q(
          `WITH trip_stats AS (
            SELECT vehicle_id, COUNT(*) FILTER (WHERE status='completed') AS trips,
              COALESCE(SUM(recognized_revenue) FILTER (WHERE status='completed'),0) AS trip_revenue,
              COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(expected_arrival, scheduled_departure) - scheduled_departure))/3600) FILTER (WHERE status='completed'),0) AS hours
            FROM trips WHERE scheduled_departure::date BETWEEN $1::date AND $2::date GROUP BY vehicle_id
          ),
          fixed AS (
            SELECT cv.vehicle_id, SUM(rr.amount * cv.allocation_percent / 100) AS amount
            FROM revenue_recognitions rr JOIN contract_vehicles cv ON cv.contract_id = rr.contract_id
            WHERE rr.status='posted' AND rr.period_end BETWEEN $1::date AND $2::date GROUP BY cv.vehicle_id
          ),
          exp AS (
            SELECT vehicle_id, SUM(amount) AS amount FROM (
              SELECT vehicle_id, amount FROM expenses WHERE status='posted' AND is_operating AND vehicle_id IS NOT NULL AND expense_date BETWEEN $1::date AND $2::date
              UNION ALL
              SELECT ea.vehicle_id, ea.allocated_amount FROM expense_allocations ea JOIN expenses e ON e.id=ea.expense_id
              WHERE e.status='posted' AND e.is_operating AND e.vehicle_id IS NULL AND ea.vehicle_id IS NOT NULL AND e.expense_date BETWEEN $1::date AND $2::date
            ) x GROUP BY vehicle_id
          )
          SELECT v.vehicle_no, v.plate, v.make, v.model, v.category, v.status,
            COALESCE(ts.trips,0) AS trips, COALESCE(ts.trip_revenue,0)+COALESCE(f.amount,0) AS revenue,
            COALESCE(e.amount,0) AS expenses,
            COALESCE(ts.trip_revenue,0)+COALESCE(f.amount,0)-COALESCE(e.amount,0) AS profit,
            COALESCE(ts.hours,0) AS hours
          FROM vehicles v LEFT JOIN trip_stats ts ON ts.vehicle_id=v.id
          LEFT JOIN fixed f ON f.vehicle_id=v.id LEFT JOIN exp e ON e.vehicle_id=v.id
          WHERE v.archived_at IS NULL ORDER BY profit DESC`,
          [from, to],
        ),
        q(
          `SELECT r.route_no, r.name_en, r.name_ar, r.origin, r.destination, r.price, r.status,
            COUNT(t.id) AS trips, COUNT(t.id) FILTER (WHERE t.status='completed') AS completed,
            COALESCE(SUM(t.recognized_revenue) FILTER (WHERE t.status='completed'),0) AS revenue,
            COALESCE(SUM(x.amount),0) AS expenses
          FROM routes r
          LEFT JOIN trips t ON t.route_id=r.id AND t.scheduled_departure::date BETWEEN $1::date AND $2::date
          LEFT JOIN (SELECT trip_id,SUM(amount) AS amount FROM expenses WHERE status='posted' AND is_operating AND trip_id IS NOT NULL GROUP BY trip_id) x ON x.trip_id=t.id
          WHERE r.archived_at IS NULL GROUP BY r.id ORDER BY revenue DESC`,
          [from, to],
        ),
        q(
          `SELECT c.contract_no, c.title, c.contract_type, c.status, c.start_date, c.end_date, c.contract_value, cu.name AS customer_name,
            COALESCE((SELECT SUM(rr.amount) FROM revenue_recognitions rr WHERE rr.contract_id=c.id AND rr.status='posted' AND rr.period_end BETWEEN $1::date AND $2::date),0) AS fixed_revenue,
            COALESCE((SELECT SUM(t.recognized_revenue) FROM trips t WHERE t.contract_id=c.id AND t.status='completed' AND t.scheduled_departure::date BETWEEN $1::date AND $2::date),0) AS variable_revenue,
            COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.contract_id=c.id AND i.status<>'void' AND i.issue_date BETWEEN $1::date AND $2::date),0) AS invoiced,
            COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.contract_id=c.id AND p.payment_date BETWEEN $1::date AND $2::date),0) AS collected,
            COALESCE((SELECT SUM(i.total-i.amount_paid) FROM invoices i WHERE i.contract_id=c.id AND i.status<>'void' AND i.status<>'paid'),0) AS outstanding,
            COALESCE((SELECT SUM(x.amount) FROM (
              SELECT amount FROM expenses WHERE contract_id=c.id AND status='posted' AND is_operating AND expense_date BETWEEN $1::date AND $2::date
              UNION ALL
              SELECT ea.allocated_amount FROM expense_allocations ea JOIN expenses e ON e.id=ea.expense_id WHERE ea.contract_id=c.id AND e.contract_id IS NULL AND e.status='posted' AND e.is_operating AND e.expense_date BETWEEN $1::date AND $2::date
            ) x),0) AS costs
          FROM contracts c JOIN customers cu ON cu.id=c.customer_id WHERE c.archived_at IS NULL ORDER BY fixed_revenue DESC`,
          [from, to],
        ),
        q(
          `SELECT cu.name, cu.customer_no, cu.type,
            COALESCE((SELECT SUM(total) FROM invoices i WHERE i.customer_id=cu.id AND i.status<>'void' AND i.issue_date BETWEEN $1::date AND $2::date),0) AS invoiced,
            COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.customer_id=cu.id AND p.payment_date BETWEEN $1::date AND $2::date),0) AS collected,
            COALESCE((SELECT SUM(i.total-i.amount_paid) FROM invoices i WHERE i.customer_id=cu.id AND i.status<>'void' AND i.status<>'paid'),0) AS outstanding,
            COALESCE((SELECT SUM(t.recognized_revenue) FROM trips t WHERE t.customer_id=cu.id AND t.status='completed' AND t.scheduled_departure::date BETWEEN $1::date AND $2::date),0) AS trip_revenue,
            (SELECT COUNT(*) FROM contracts c WHERE c.customer_id=cu.id AND c.status='active') AS active_contracts
          FROM customers cu WHERE cu.archived_at IS NULL ORDER BY collected DESC`,
          [from, to],
        ),
        q(
          `SELECT d.driver_no, d.full_name, d.phone, d.license_no, d.license_expiry, d.status,
            ${shouldMaskSalary ? 'NULL::numeric AS monthly_salary' : 'd.monthly_salary'},
            COUNT(t.id) FILTER (WHERE t.status='completed') AS trips,
            COALESCE(SUM(t.recognized_revenue) FILTER (WHERE t.status='completed'),0) AS revenue,
            COALESCE((SELECT SUM(amount) FROM expenses WHERE driver_id=d.id AND status='posted' AND is_operating AND expense_date BETWEEN $1::date AND $2::date),0) AS compensation
          FROM drivers d LEFT JOIN trips t ON t.driver_id=d.id AND t.scheduled_departure::date BETWEEN $1::date AND $2::date
          WHERE d.archived_at IS NULL GROUP BY d.id ORDER BY revenue DESC`,
          [from, to],
        ),
        q(
          `SELECT m.record_no, m.maintenance_type, m.description, m.start_date, m.end_date, m.cost, m.status, m.vendor,
            v.plate, v.make, v.model
          FROM maintenance_records m JOIN vehicles v ON v.id=m.vehicle_id
          WHERE m.start_date BETWEEN $1::date AND $2::date OR m.end_date BETWEEN $1::date AND $2::date
          ORDER BY m.start_date DESC`,
          [from, to],
        ),
        q(
          `SELECT ec.key, ec.name_en, ec.name_ar, ec.is_operating, COALESCE(SUM(e.amount),0) AS amount, COUNT(e.id) AS count
          FROM expense_categories ec LEFT JOIN expenses e ON e.category_id=ec.id AND e.status='posted' AND e.expense_date BETWEEN $1::date AND $2::date
          GROUP BY ec.id ORDER BY amount DESC`,
          [from, to],
        ),
        q(
          `SELECT
            COALESCE(SUM(total-amount_paid) FILTER (WHERE due_date >= current_date AND status NOT IN ('paid','void')),0) AS current,
            COALESCE(SUM(total-amount_paid) FILTER (WHERE due_date < current_date AND due_date >= current_date-30 AND status NOT IN ('paid','void')),0) AS days_1_30,
            COALESCE(SUM(total-amount_paid) FILTER (WHERE due_date < current_date-30 AND due_date >= current_date-60 AND status NOT IN ('paid','void')),0) AS days_31_60,
            COALESCE(SUM(total-amount_paid) FILTER (WHERE due_date < current_date-60 AND status NOT IN ('paid','void')),0) AS days_60_plus
          FROM invoices WHERE status <> 'void'`,
        ),
        q(
          `SELECT t.trip_type, COUNT(*) AS trips, COUNT(*) FILTER (WHERE t.status='completed') AS completed,
            COALESCE(SUM(t.recognized_revenue) FILTER (WHERE t.status='completed'),0) AS revenue,
            COALESCE(SUM(x.amount),0) AS expenses
          FROM trips t LEFT JOIN (SELECT trip_id,SUM(amount) AS amount FROM expenses WHERE status='posted' AND is_operating AND trip_id IS NOT NULL GROUP BY trip_id) x ON x.trip_id=t.id
          WHERE t.scheduled_departure::date BETWEEN $1::date AND $2::date GROUP BY t.trip_type`,
          [from, to],
        ),
        q(
          `SELECT to_char(scheduled_departure,'YYYY-MM') AS month, COUNT(*) AS trips,
            COUNT(*) FILTER (WHERE status='completed') AS completed,
            COALESCE(SUM(recognized_revenue) FILTER (WHERE status='completed'),0) AS revenue
          FROM trips WHERE scheduled_departure::date BETWEEN $1::date AND $2::date
          GROUP BY 1 ORDER BY 1`,
          [from, to],
        ),
        q(
          `SELECT to_char(scheduled_departure::date,'YYYY-MM-DD') AS date, COUNT(*) AS trips,
            COUNT(*) FILTER (WHERE status='completed') AS completed,
            COALESCE(SUM(recognized_revenue) FILTER (WHERE status='completed'),0) AS revenue
          FROM trips WHERE scheduled_departure::date BETWEEN $1::date AND $2::date
          GROUP BY 1 ORDER BY 1`,
          [from, to],
        ),
      ])

    const receivables = await q(
      `SELECT i.invoice_no, i.issue_date, i.due_date, i.total, i.amount_paid, i.total-i.amount_paid AS balance, i.status,
        c.name AS customer_name, ct.contract_no,
        CASE WHEN i.due_date < current_date THEN current_date - i.due_date ELSE 0 END AS days_overdue
      FROM invoices i JOIN customers c ON c.id=i.customer_id LEFT JOIN contracts ct ON ct.id=i.contract_id
      WHERE i.status NOT IN ('paid','void','draft') ORDER BY i.due_date`,
    )

    res.json(
      serialize({
        range: { from, to },
        generatedAt: new Date().toISOString(),
        vehicles,
        routes,
        contracts: contracts.map((contract) => ({
          ...contract,
          recognized: Number(contract.fixed_revenue) + Number(contract.variable_revenue),
          profit: Number(contract.fixed_revenue) + Number(contract.variable_revenue) - Number(contract.costs),
        })),
        customers,
        drivers: driverRows,
        salaryMasked: shouldMaskSalary,
        maintenance,
        expenseCategories,
        aging: aging[0],
        comparison,
        monthly,
        daily,
        receivables,
      }),
    )
  }),
)

reportsRouter.get(
  '/reports/export',
  requirePermission('export_reports'),
  asyncHandler(async (req, res) => {
    const report = String(req.query.report || 'trips')
    const { from, to } = dateRangeFromQuery(req.query.from as string, req.query.to as string)
    const maskSalary = !can(req.user, 'view_driver_compensation')
    let headers: string[] = []
    let rows: unknown[][] = []

    if (report === 'trips') {
      const data = await q(
        `SELECT t.trip_no, t.trip_type, t.scheduled_departure, t.origin, t.destination, t.status,
          t.quoted_price, t.recognized_revenue, v.plate, d.full_name AS driver, c.name AS customer, r.name_en AS route
        FROM trips t LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN drivers d ON d.id=t.driver_id
        LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN routes r ON r.id=t.route_id
        WHERE t.scheduled_departure::date BETWEEN $1::date AND $2::date ORDER BY t.scheduled_departure`,
        [from, to],
      )
      headers = ['Trip No','Type','Departure','Origin','Destination','Status','Quoted','Recognized Revenue','Vehicle','Driver','Customer','Route']
      rows = data.map((r) => [r.trip_no, r.trip_type, r.scheduled_departure, r.origin, r.destination, r.status, r.quoted_price, r.recognized_revenue, r.plate, r.driver, r.customer, r.route])
    } else if (report === 'invoices') {
      const data = await q(
        `SELECT i.invoice_no, i.issue_date, i.due_date, c.name, i.subtotal, i.tax, i.total, i.amount_paid, i.total-i.amount_paid AS balance, i.status
        FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.issue_date BETWEEN $1::date AND $2::date ORDER BY i.issue_date`,
        [from, to],
      )
      headers = ['Invoice No','Issue Date','Due Date','Customer','Subtotal','Tax','Total','Paid','Balance','Status']
      rows = data.map((r) => [r.invoice_no, r.issue_date, r.due_date, r.name, r.subtotal, r.tax, r.total, r.amount_paid, r.balance, r.status])
    } else if (report === 'expenses') {
      const data = await q(
        `SELECT e.expense_no, e.expense_date, ec.name_en, e.description, e.amount, v.plate, c.contract_no, e.status
        FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id
        LEFT JOIN vehicles v ON v.id=e.vehicle_id LEFT JOIN contracts c ON c.id=e.contract_id
        WHERE e.expense_date BETWEEN $1::date AND $2::date ORDER BY e.expense_date`,
        [from, to],
      )
      headers = ['Expense No','Date','Category','Description','Amount','Vehicle','Contract','Status']
      rows = data.map((r) => [r.expense_no, r.expense_date, r.name_en, r.description, r.amount, r.plate, r.contract_no, r.status])
    } else if (report === 'vehicles') {
      const data = await q(
        `SELECT v.vehicle_no, v.plate, v.make, v.model, v.category, v.status, v.odometer,
          COALESCE((SELECT SUM(recognized_revenue) FROM trips WHERE vehicle_id=v.id AND status='completed' AND scheduled_departure::date BETWEEN $1::date AND $2::date),0) AS revenue,
          COALESCE((SELECT SUM(amount) FROM expenses WHERE vehicle_id=v.id AND status='posted' AND is_operating AND expense_date BETWEEN $1::date AND $2::date),0) AS expenses
        FROM vehicles v WHERE v.archived_at IS NULL ORDER BY v.vehicle_no`,
        [from, to],
      )
      headers = ['Vehicle No','Plate','Make','Model','Category','Status','Odometer','Revenue','Direct Expenses']
      rows = data.map((r) => [r.vehicle_no, r.plate, r.make, r.model, r.category, r.status, r.odometer, r.revenue, r.expenses])
    } else if (report === 'drivers') {
      const data = await q(
        `SELECT d.driver_no, d.full_name, d.phone, d.license_no, d.license_expiry, d.status, ${maskSalary ? 'NULL::numeric' : 'd.monthly_salary'},
          COUNT(t.id) FILTER (WHERE t.status='completed') AS trips,
          COALESCE(SUM(t.recognized_revenue) FILTER (WHERE t.status='completed'),0) AS revenue
        FROM drivers d LEFT JOIN trips t ON t.driver_id=d.id AND t.scheduled_departure::date BETWEEN $1::date AND $2::date
        WHERE d.archived_at IS NULL GROUP BY d.id ORDER BY d.full_name`,
        [from, to],
      )
      headers = ['Driver No','Name','Phone','License','Expiry','Status','Monthly Salary','Completed Trips','Revenue']
      rows = data.map((r) => [r.driver_no, r.full_name, r.phone, r.license_no, r.license_expiry, r.status, r.monthly_salary, r.trips, r.revenue])
    } else if (report === 'maintenance') {
      const data = await q(
        `SELECT m.record_no, m.start_date, m.end_date, m.maintenance_type, m.description, m.cost, m.vendor, m.status, v.plate
        FROM maintenance_records m JOIN vehicles v ON v.id=m.vehicle_id
        WHERE m.start_date BETWEEN $1::date AND $2::date OR m.end_date BETWEEN $1::date AND $2::date ORDER BY m.start_date`,
        [from, to],
      )
      headers = ['Record No','Start','End','Type','Description','Cost','Vendor','Status','Vehicle']
      rows = data.map((r) => [r.record_no, r.start_date, r.end_date, r.maintenance_type, r.description, r.cost, r.vendor, r.status, r.plate])
    } else {
      const data = await q(
        `SELECT
          (SELECT string_agg(t.trip_no, ', ' ORDER BY t.scheduled_departure)
             FROM invoice_lines il JOIN trips t ON t.id = il.trip_id WHERE il.invoice_id = i.id) AS trip_no,
          (SELECT MIN(t.scheduled_departure)
             FROM invoice_lines il JOIN trips t ON t.id = il.trip_id WHERE il.invoice_id = i.id) AS scheduled_departure,
          c.name, i.invoice_no, p.payment_no, p.payment_date, p.amount, p.method, p.reference
        FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id
        WHERE p.payment_date BETWEEN $1::date AND $2::date ORDER BY p.payment_date`,
        [from, to],
      )
      headers = ['Trip No','Trip Date','Customer','Invoice No','Payment No','Payment Date','Amount','Method','Reference']
      rows = data.map((r) => [r.trip_no, r.scheduled_departure, r.name, r.invoice_no, r.payment_no, r.payment_date, r.amount, r.method, r.reference])
    }

    const csv = toCsv(headers, rows)
    const filename = `al-sheikh-${report}-${from}-${to}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(csv)
  }),
)
