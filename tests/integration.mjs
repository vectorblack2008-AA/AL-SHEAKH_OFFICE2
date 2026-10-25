const BASE = process.env.API_URL || 'http://localhost:3001/api'
let cookie = ''

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (cookie) headers.cookie = cookie
  if (options.body && !headers['content-type']) headers['content-type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, { ...options, headers, redirect: 'manual' })
  const setCookie = res.headers.getSetCookie?.() || []
  if (setCookie.length) cookie = setCookie.map((value) => value.split(';')[0]).join('; ')
  const text = await res.text()
  let body = text
  try { body = text ? JSON.parse(text) : null } catch { /* CSV or plain text */ }
  return { status: res.status, body }
}

async function login(email, password) {
  cookie = ''
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

const checks = []
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : ` — ${detail}`}`)
}
const close = (a, b, tolerance = 0.02) => Math.abs(Number(a) - Number(b)) <= tolerance
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const add = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return fmt(d) }
const today = fmt(new Date())

const adminLogin = await login('admin@alsheikh.eg', 'Admin@12345')
check('admin login', adminLogin.status === 200)

const [vehiclesRes, driversRes, customersRes, routesRes] = await Promise.all([
  request('/vehicles?pageSize=100'),
  request('/drivers?pageSize=100'),
  request('/customers?pageSize=100'),
  request('/routes?pageSize=100'),
])
const vehicles = vehiclesRes.body.data
const drivers = driversRes.body.data
const customers = customersRes.body.data
const routes = routesRes.body.data
check('fixtures loaded', vehicles.length >= 11 && drivers.length >= 9 && customers.length >= 8 && routes.length >= 7)

const freeVehicle = vehicles.find((vehicle) => vehicle.status === 'available' && vehicle.archived_at === null)
const secondVehicle = vehicles.filter((vehicle) => vehicle.status === 'available' && vehicle.id !== freeVehicle?.id)[0]
const freeDriver = drivers.find((driver) => driver.status === 'active' && driver.archived_at === null)
check('free vehicle and driver available', Boolean(freeVehicle && secondVehicle && freeDriver))

try {
  /* ----------------------------- Trip lifecycle ---------------------------- */
  const day = add(45)
  const departure = `${day}T03:00:00`
  const arrival = `${day}T04:00:00`
  const tripPayload = {
    trip_type: 'private',
    customer_id: customers[0].id,
    vehicle_id: freeVehicle.id,
    driver_id: freeDriver.id,
    origin: 'Cairo Office',
    destination: 'Test Destination',
    scheduled_departure: departure,
    expected_arrival: arrival,
    distance_km: 40,
    quoted_price: 1500,
    additional_charges: 100,
    discount: 50,
    status: 'confirmed',
    notes: 'Integration test trip',
  }
  const createdTrip = await request('/trips', { method: 'POST', body: JSON.stringify(tripPayload) })
  check('create confirmed trip', createdTrip.status === 201 && createdTrip.body.trip?.id, `${createdTrip.status} ${JSON.stringify(createdTrip.body)}`)
  const tripId = createdTrip.body.trip?.id

  const conflictTrip = await request('/trips', { method: 'POST', body: JSON.stringify({ ...tripPayload, notes: 'conflict' }) })
  check('vehicle/driver conflict rejected', conflictTrip.status === 409 && conflictTrip.body.code === 'SCHEDULE_CONFLICT', `${conflictTrip.status} ${conflictTrip.body.code}`)

  const completedTrip = await request(`/trips/${tripId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed', actual_departure: departure, actual_arrival: arrival }),
  })
  check('complete trip', completedTrip.status === 200 && completedTrip.body.status === 'completed', `${completedTrip.status}`)
  check('recognized revenue = quote + charges - discount', close(completedTrip.body.recognized_revenue, 1550), `${completedTrip.body.recognized_revenue}`)

  /* ---------------------------- Invoice + payments -------------------------- */
  const invoicePayload = {
    customer_id: customers[0].id,
    issue_date: today,
    due_date: add(30),
    tax_rate: 15,
    status: 'sent',
    notes: 'Integration test invoice',
    lines: [
      {
        description: `Test trip ${completedTrip.body.trip_no}`,
        quantity: 1,
        unit_price: 1550,
        trip_id: tripId,
        revenue_category: 'private_trip',
      },
    ],
  }
  const invoiceRes = await request('/invoices', { method: 'POST', body: JSON.stringify(invoicePayload) })
  check('create invoice with tax', invoiceRes.status === 201 && close(invoiceRes.body.total, 1782.5), `${invoiceRes.status} ${invoiceRes.body.total}`)
  const invoiceId = invoiceRes.body.id

  const duplicateTripInvoice = await request('/invoices', {
    method: 'POST',
    body: JSON.stringify({ ...invoicePayload, lines: [{ ...invoicePayload.lines[0], description: 'Second invoice same trip' }] }),
  })
  check('same trip cannot be invoiced twice', duplicateTripInvoice.status === 409, `${duplicateTripInvoice.status} ${duplicateTripInvoice.body.code}`)

  const partial = await request(`/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      amount: 700,
      payment_date: today,
      method: 'bank_transfer',
      reference: 'TEST-PARTIAL',
      idempotency_key: `integration-partial-${invoiceId}`,
    }),
  })
  check('partial payment accepted', partial.status === 201 && Boolean(partial.body.paymentNo), `${partial.status} ${JSON.stringify(partial.body)}`)

  const invoiceDetail = await request(`/invoices/${invoiceId}`)
  check('invoice status partial', invoiceDetail.body.invoice?.status === 'partial', `${invoiceDetail.body.invoice?.status}`)
  check('invoice paid amount reconciles', close(invoiceDetail.body.invoice?.amount_paid, 700), `${invoiceDetail.body.invoice?.amount_paid}`)
  check('invoice balance reconciles', close(invoiceDetail.body.invoice?.balance, 1082.5), `${invoiceDetail.body.invoice?.balance}`)

  const overpay = await request(`/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      amount: 1083,
      payment_date: today,
      method: 'cash',
      idempotency_key: `integration-overpay-${invoiceId}`,
    }),
  })
  check('overpayment rejected', overpay.status === 409 && overpay.body.code === 'PAYMENT_EXCEEDS_BALANCE', `${overpay.status} ${overpay.body.code}`)

  const duplicatePayment = await request(`/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      amount: 100,
      payment_date: today,
      method: 'cash',
      idempotency_key: `integration-partial-${invoiceId}`,
    }),
  })
  check('duplicate payment idempotency rejected', duplicatePayment.status === 409, `${duplicatePayment.status} ${duplicatePayment.body.code}`)

  const finalPayment = await request(`/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      amount: 1082.5,
      payment_date: today,
      method: 'bank_transfer',
      idempotency_key: `integration-final-${invoiceId}`,
    }),
  })
  check('final payment settles invoice', finalPayment.status === 201, `${finalPayment.status}`)
  const settled = await request(`/invoices/${invoiceId}`)
  check('invoice status paid', settled.body.invoice?.status === 'paid', `${settled.body.invoice?.status}`)
  check('no negative balance', Number(settled.body.invoice?.balance) === 0, `${settled.body.invoice?.balance}`)

  /* ----------------------------- Contract + revenue ------------------------- */
  const monthStart = new Date()
  monthStart.setMonth(monthStart.getMonth() - 2, 1)
  const contractStart = fmt(monthStart)
  const contractPayload = {
    customer_id: customers[1].id,
    title: 'Integration Monthly Contract',
    start_date: contractStart,
    end_date: add(60),
    contract_type: 'monthly',
    contract_value: 60000,
    billing_frequency: 'monthly',
    payment_terms_days: 30,
    recognition_method: 'straight_line',
    status: 'active',
    vehicle_ids: [secondVehicle.id],
    route_ids: [routes[0].id],
    allocations: { [secondVehicle.id]: 100 },
  }
  const contractRes = await request('/contracts', { method: 'POST', body: JSON.stringify(contractPayload) })
  check('create active contract with recognition', contractRes.status === 201 && Number(contractRes.body.recognized) > 0, `${contractRes.status} ${contractRes.body.recognized}`)
  const contractId = contractRes.body.id

  const periodEnd = fmt(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0))
  const contractInvoice = await request(`/contracts/${contractId}/invoice`, {
    method: 'POST',
    body: JSON.stringify({ period_start: contractStart, period_end: periodEnd }),
  })
  check('generate contract invoice', contractInvoice.status === 201 && contractInvoice.body.invoiceNo, `${contractInvoice.status} ${JSON.stringify(contractInvoice.body)}`)

  const duplicateContractInvoice = await request(`/contracts/${contractId}/invoice`, {
    method: 'POST',
    body: JSON.stringify({ period_start: contractStart, period_end: periodEnd }),
  })
  check('duplicate contract-period invoice rejected', duplicateContractInvoice.status === 409, `${duplicateContractInvoice.status} ${duplicateContractInvoice.body.code}`)

  const contractAfter = await request(`/contracts/${contractId}`)
  const cf = contractAfter.body.financials
  check('contract revenue recognized once', Number(cf.recognized) > 0 && close(cf.recognized, Number(cf.fixed_revenue) + Number(cf.variable_revenue)), `${cf.recognized}`)
  check('contract invoiced within recognized plus tax', Number(cf.invoiced) >= Number(cf.recognized) * 0.9)

  /* --------------------------------- Expenses ------------------------------- */
  const categories = await request('/expense-categories')
  const fuelCategory = categories.body.data.find((category) => category.key === 'fuel')
  const overAllocated = await request('/expenses', {
    method: 'POST',
    body: JSON.stringify({
      expense_date: today,
      category_id: fuelCategory.id,
      description: 'Over-allocated integration expense',
      amount: 100,
      allocations: [{ vehicle_id: freeVehicle.id, allocated_amount: 150, method: 'manual' }],
    }),
  })
  check('over-allocated expense rejected', overAllocated.status === 400, `${overAllocated.status} ${overAllocated.body.code}`)

  const validExpense = await request('/expenses', {
    method: 'POST',
    body: JSON.stringify({
      expense_date: today,
      category_id: fuelCategory.id,
      description: 'Integration fuel expense',
      amount: 100,
      vendor: 'Test Fuel',
      allocations: [{ vehicle_id: freeVehicle.id, allocated_amount: 100, method: 'fixed' }],
    }),
  })
  check('valid allocated expense', validExpense.status === 201, `${validExpense.status}`)

  /* -------------------------- Maintenance blocking ------------------------- */
  const maintenanceVehicle = secondVehicle
  const maintenanceStart = add(70)
  const maintenanceEnd = add(72)
  const maintenanceRes = await request('/maintenance', {
    method: 'POST',
    body: JSON.stringify({
      vehicle_id: maintenanceVehicle.id,
      maintenance_type: 'Integration service',
      description: 'Scheduled test maintenance',
      start_date: maintenanceStart,
      end_date: maintenanceEnd,
      cost: 500,
      status: 'scheduled',
    }),
  })
  check('create maintenance block', maintenanceRes.status === 201, `${maintenanceRes.status} ${JSON.stringify(maintenanceRes.body)}`)

  const blockedTrip = await request('/trips', {
    method: 'POST',
    body: JSON.stringify({
      trip_type: 'private',
      vehicle_id: maintenanceVehicle.id,
      origin: 'A',
      destination: 'B',
      scheduled_departure: `${maintenanceStart}T10:00:00`,
      expected_arrival: `${maintenanceStart}T11:00:00`,
      quoted_price: 100,
      status: 'confirmed',
    }),
  })
  check('trip blocked by maintenance', blockedTrip.status === 409 && blockedTrip.body.code === 'SCHEDULE_CONFLICT', `${blockedTrip.status} ${blockedTrip.body.code}`)

  /* --------------------------- Unique plate + route ------------------------ */
  const duplicatePlate = await request('/vehicles', {
    method: 'POST',
    body: JSON.stringify({ plate: vehicles[0].plate, make: 'Test', model: 'Duplicate', category: 'van', seats: 5 }),
  })
  check('duplicate plate rejected', duplicatePlate.status === 409, `${duplicatePlate.status} ${duplicatePlate.body.code}`)

  const newRoute = await request('/routes', {
    method: 'POST',
    body: JSON.stringify({
      name_en: 'Integration Test Route',
      name_ar: 'مسار اختبار التكامل',
      origin: 'Test Origin',
      destination: 'Test Destination',
      stops: ['Stop A'],
      operating_days: [0, 1, 2, 3, 4, 5, 6],
      departure_time: '02:00',
      duration_minutes: 30,
      price: 150,
      effective_from: today,
      status: 'active',
    }),
  })
  check('create route', newRoute.status === 201, `${newRoute.status} ${JSON.stringify(newRoute.body)}`)
  const newRouteId = newRoute.body.id
  const genFrom = add(80)
  const genTo = add(84)
  const firstGen = await request(`/routes/${newRouteId}/generate`, { method: 'POST', body: JSON.stringify({ from: genFrom, to: genTo }) })
  check('generate recurring trips', firstGen.status === 200 && firstGen.body.generated >= 5, `${firstGen.status} ${firstGen.body.generated}`)
  const secondGen = await request(`/routes/${newRouteId}/generate`, { method: 'POST', body: JSON.stringify({ from: genFrom, to: genTo }) })
  check('duplicate trip generation prevented', secondGen.status === 200 && secondGen.body.generated === 0 && secondGen.body.skipped.length >= 5, `${secondGen.body.generated}/${secondGen.body.skipped?.length}`)

  const generatedTrips = await request(`/trips?from=${genFrom}&to=${genTo}&routeId=${newRouteId}&pageSize=100`)
  check('generated trips persisted once', generatedTrips.body.total === firstGen.body.generated, `${generatedTrips.body.total} vs ${firstGen.body.generated}`)

  /* -------------------------- Viewer write protection ----------------------- */
  const viewer = await login('viewer@alsheikh.eg', 'Viewer@12345')
  check('viewer login', viewer.status === 200)
  const viewerCreateTrip = await request('/trips', { method: 'POST', body: JSON.stringify(tripPayload) })
  check('viewer create trip forbidden', viewerCreateTrip.status === 403, `${viewerCreateTrip.status}`)
  const viewerPayment = await request(`/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify({ amount: 1, payment_date: today, method: 'cash', idempotency_key: `viewer-${Date.now()}` }),
  })
  check('viewer payment forbidden', viewerPayment.status === 403, `${viewerPayment.status}`)

  /* -------------------------------- Dashboard ------------------------------ */
  await login('admin@alsheikh.eg', 'Admin@12345')
  const dash = await request('/dashboard?from=' + add(-90) + '&to=' + add(90))
  const k = dash.body.kpis
  check('dashboard recognized = trip + contract', close(k.recognizedRevenue, Number(k.tripRevenue) + Number(k.contractRevenue)), `${k.recognizedRevenue}`)
  check('dashboard profit = revenue - expenses', close(k.netOperatingProfit, Number(k.recognizedRevenue) - Number(k.operatingExpenses)), `${k.netOperatingProfit}`)
  check('dashboard outstanding non-negative', Number(k.outstandingReceivables) >= 0)

  /* ------------------------------ Workspace reset -------------------------- */
  const wrongReset = await request('/workspace/reset', {
    method: 'POST',
    body: JSON.stringify({ confirmation: 'please' }),
  })
  check('workspace reset rejects a wrong confirmation', wrongReset.status === 400, `${wrongReset.status}`)

  const workspaceReset = await request('/workspace/reset', {
    method: 'POST',
    body: JSON.stringify({ confirmation: 'RESET' }),
  })
  check('workspace reset succeeds', workspaceReset.status === 200, `${workspaceReset.status} ${JSON.stringify(workspaceReset.body)}`)

  const afterReset = await request('/system-info')
  const resetCounts = afterReset.body.counts || {}
  const operationalTotal = ['vehicles', 'drivers', 'trips', 'contracts', 'invoices', 'payments', 'expenses']
    .reduce((total, key) => total + Number(resetCounts[key] || 0), 0)
  check('workspace reset leaves no operational records', operationalTotal === 0, JSON.stringify(resetCounts))

  const settingsAfterReset = await request('/settings')
  check('workspace reset disables demo mode', settingsAfterReset.body.demo_mode === false)

  const reseed = await request('/demo/seed', { method: 'POST', body: '{}' })
  check('demo data can be loaded after a reset', reseed.status === 201, `${reseed.status} ${JSON.stringify(reseed.body)}`)
} finally {
  const reset = await request('/demo/reset', { method: 'POST' })
  check('demo workspace reset', reset.status === 200, `${reset.status} ${JSON.stringify(reset.body)}`)
}

const failed = checks.filter((item) => !item.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} integration checks passed`)
if (failed.length) {
  console.log(JSON.stringify(failed, null, 2))
  process.exit(1)
}
