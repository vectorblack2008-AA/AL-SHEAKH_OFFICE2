const BASE = process.env.API_URL || 'http://localhost:3001/api'
let cookie = ''

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (cookie) headers.cookie = cookie
  if (options.body && !headers['content-type']) headers['content-type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, { ...options, headers, redirect: 'manual' })
  const setCookie = res.headers.getSetCookie?.() || []
  if (setCookie.length) cookie = setCookie.map((value) => value.split(';')[0]).join('; ')
  const type = res.headers.get('content-type') || ''
  const body = type.includes('application/json') ? await res.json() : await res.text()
  return { status: res.status, body, type }
}

async function login(email, password) {
  cookie = ''
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

const failures = []
const checks = []
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail })
  if (!condition) failures.push({ name, detail })
}
function close(actual, expected, tolerance = 0.02) {
  return Math.abs(Number(actual) - Number(expected)) <= tolerance
}

const today = new Date()
const fmt = (value) => {
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const from = fmt(new Date(today.getFullYear(), today.getMonth() - 3, 1))
const to = fmt(today)
const range = `from=${from}&to=${to}`

const adminLogin = await login('admin@alsheikh.eg', 'Admin@12345')
check('admin login', adminLogin.status === 200 && adminLogin.body.user?.role_key === 'admin', `${adminLogin.status}`)
check('admin has all permissions', adminLogin.body.user?.permissions?.length === 27, `${adminLogin.body.user?.permissions?.length}`)

const config = await request('/auth/public/config')
check('public config', config.status === 200 && config.body.companyNameEn, `${config.status}`)
check('demo mode visible', config.body.demoMode === true, `${config.body.demoMode}`)

const dashboard = await request(`/dashboard?${range}`)
check('dashboard 200', dashboard.status === 200, `${dashboard.status}`)
const k = dashboard.body.kpis || {}
check('recognized revenue reconciles', close(k.recognizedRevenue, Number(k.tripRevenue) + Number(k.contractRevenue)), `${k.recognizedRevenue} vs ${Number(k.tripRevenue) + Number(k.contractRevenue)}`)
check('net profit reconciles', close(k.netOperatingProfit, Number(k.recognizedRevenue) - Number(k.operatingExpenses)), `${k.netOperatingProfit}`)
check('trip status totals reconcile', Number(k.completedTrips) + Number(k.scheduledTrips) + Number(k.cancelledTrips) + Number(k.missedTrips) <= Number(k.totalTrips), `${k.totalTrips}`)
check('fleet totals reconcile', Number(k.availableVehicles) + Number(k.operatingVehicles) + Number(k.maintenanceVehicles) <= Number(k.totalVehicles))
check('outstanding receivables present', Number(k.outstandingReceivables) > 0)

const vehicles = await request(`/vehicles?${range}`)
check('vehicles list', vehicles.status === 200 && vehicles.body.data.length > 0, `${vehicles.status}`)
check('fleet summary total', Number(vehicles.body.summary?.total) >= 11, `${vehicles.body.summary?.total}`)

const drivers = await request(`/drivers?${range}`)
check('drivers list', drivers.status === 200 && drivers.body.data.length > 0, `${drivers.status}`)
check('admin sees salary', drivers.body.canViewSalary === true && drivers.body.data.some((row) => Number(row.monthly_salary) > 0))

const vehicleId = vehicles.body.data[0]?.id
const vehicleDetail = await request(`/vehicles/${vehicleId}`)
check('vehicle detail', vehicleDetail.status === 200 && vehicleDetail.body.vehicle?.id === vehicleId, `${vehicleDetail.status}`)

const routes = await request('/routes?pageSize=100')
check('routes list', routes.status === 200 && routes.body.data.length >= 7, `${routes.status}`)
const routeId = routes.body.data[0]?.id

const customers = await request('/customers?pageSize=100')
check('customers list', customers.status === 200 && customers.body.data.length >= 8, `${customers.status}`)

const trips = await request(`/trips?${range}&pageSize=50`)
check('trips list', trips.status === 200 && trips.body.data.length > 0, `${trips.status}`)
check('quoted revenue is separate from recognized', trips.body.data.some((trip) => Number(trip.quoted_price) > 0))
const tripId = trips.body.data[0]?.id

const schedule = await request(`/schedule?${range}`)
check('schedule data', schedule.status === 200 && Array.isArray(schedule.body.vehicles) && Array.isArray(schedule.body.trips), `${schedule.status}`)

const maintenance = await request(`/maintenance?${range}`)
check('maintenance list', maintenance.status === 200 && maintenance.body.data.length > 0, `${maintenance.status}`)

const contracts = await request('/contracts?pageSize=100')
check('contracts list', contracts.status === 200 && contracts.body.data.length >= 7, `${contracts.status}`)
const contractId = contracts.body.data[0]?.id
const contractDetail = await request(`/contracts/${contractId}`)
check('contract detail', contractDetail.status === 200 && contractDetail.body.financials, `${contractDetail.status}`)
const cf = contractDetail.body.financials || {}
check('contract recognized = fixed + variable', close(cf.recognized, Number(cf.fixed_revenue) + Number(cf.variable_revenue)), `${cf.recognized} vs ${Number(cf.fixed_revenue) + Number(cf.variable_revenue)}`)
check('contract paid <= invoiced', Number(cf.collected) <= Number(cf.invoiced) + 0.02, `${cf.collected}/${cf.invoiced}`)

const invoices = await request(`/invoices?${range}&pageSize=100`)
check('invoices list', invoices.status === 200 && invoices.body.data.length > 0, `${invoices.status}`)
const payments = await request(`/payments?${range}`)
check('payments list', payments.status === 200 && payments.body.data.length > 0, `${payments.status}`)
check('payments collected reconciles', close(payments.body.summary?.collected, invoices.body.summary?.collected), `${payments.body.summary?.collected} vs ${invoices.body.summary?.collected}`)
check('invoice balances reconcile', close(invoices.body.summary?.outstanding, Number(invoices.body.summary?.invoiced) - Number(invoices.body.summary?.collected)), `${invoices.body.summary?.outstanding}`)
check('invoice paid <= invoiced', Number(invoices.body.summary?.collected) <= Number(invoices.body.summary?.invoiced) + 0.02)

const receivables = await request('/receivables')
check('receivables list', receivables.status === 200 && receivables.body.data.length > 0, `${receivables.status}`)
check('receivables total matches invoices', close(receivables.body.total, invoices.body.summary?.outstanding, 1), `${receivables.body.total} vs ${invoices.body.summary?.outstanding}`)

const expenses = await request(`/expenses?${range}&pageSize=100`)
check('expenses list', expenses.status === 200 && expenses.body.data.length > 0, `${expenses.status}`)
check('expense operating summary', Number(expenses.body.summary?.operating) > 0)
check('expense allocations do not exceed total', Number(expenses.body.summary?.operating) + Number(expenses.body.summary?.capital) <= Number(expenses.body.summary?.total) + 0.02)

const reports = await request(`/reports?${range}`)
check('reports 200', reports.status === 200, `${reports.status}`)
check('reports contain fleet profitability', Array.isArray(reports.body.vehicles) && reports.body.vehicles.length >= 11)
check('reports contain aging', Boolean(reports.body.aging))

const exportCsv = await request(`/reports/export?report=trips&${range}`)
check('CSV export', exportCsv.status === 200 && String(exportCsv.body).includes('Trip No'), `${exportCsv.status} ${exportCsv.type}`)

const users = await request('/users')
check('users admin', users.status === 200 && users.body.data.length >= 2, `${users.status}`)
check('roles and permissions exposed', users.body.roles?.length >= 2 && users.body.permissions?.length >= 27)
check('no password hash leaks', !String(JSON.stringify(users.body)).includes('password_hash'))

const settings = await request('/settings')
check('settings 200', settings.status === 200 && settings.body.company_name_en, `${settings.status}`)
const categories = await request('/expense-categories')
check('expense categories', categories.status === 200 && categories.body.data.length >= 11, `${categories.status}`)
const notifications = await request('/notifications')
check('notifications list', notifications.status === 200 && notifications.body.data.length > 0, `${notifications.status}`)
const auditLogs = await request('/audit-logs?pageSize=100')
check('audit log present', auditLogs.status === 200 && auditLogs.body.total > 0, `${auditLogs.status}`)
check('audit log has login event', auditLogs.body.data?.some((row) => row.action === 'login'))
const systemInfo = await request('/system-info')
check('system info', systemInfo.status === 200 && Number(systemInfo.body.counts?.vehicles) >= 11, `${systemInfo.status}`)

// Viewer authorization and masking
const viewerLogin = await login('viewer@alsheikh.eg', 'Viewer@12345')
check('viewer login', viewerLogin.status === 200 && viewerLogin.body.user?.role_key === 'viewer', `${viewerLogin.status}`)
check('viewer has no sensitive finance permission', !viewerLogin.body.user?.permissions?.includes('view_sensitive_finance'))
check('viewer has no driver salary permission', !viewerLogin.body.user?.permissions?.includes('view_driver_compensation'))

const viewerDrivers = await request(`/drivers?${range}`)
check('viewer driver salaries masked', viewerDrivers.status === 200 && viewerDrivers.body.canViewSalary === false && viewerDrivers.body.data.every((row) => row.monthly_salary === null), `${viewerDrivers.status}`)
const viewerUsers = await request('/users')
check('viewer blocked from users', viewerUsers.status === 403, `${viewerUsers.status}`)
const viewerAudit = await request('/audit-logs')
check('viewer blocked from audit log', viewerAudit.status === 403, `${viewerAudit.status}`)
const viewerSettingsWrite = await request('/settings', { method: 'PATCH', body: JSON.stringify({ company_name_en: 'Hacked' }) })
check('viewer blocked from settings write', viewerSettingsWrite.status === 403, `${viewerSettingsWrite.status}`)
const viewerTripWrite = await tripId
  ? await request(`/trips/${tripId}`, { method: 'PATCH', body: JSON.stringify({ notes: 'viewer edit' }) })
  : { status: 0 }
check('viewer blocked from trip edit', viewerTripWrite.status === 403, `${viewerTripWrite.status}`)

// Route and trip identifiers stay available for deeper integration tests.
const context = { from, to, vehicleId, routeId, tripId, contractId }
const passed = checks.filter((item) => item.ok).length
console.log(JSON.stringify({ checks: checks.length, passed, failures, context }, null, 2))
process.exit(failures.length ? 1 : 0)
