import { randomUUID } from 'node:crypto'
import type { Queryable } from './db.js'
import { code, db, nextSequence, one, q, seedBaseData, transaction } from './db.js'
import { ApiError, addDays, toDateOnly, toLocalDateTime, monthPeriods } from './lib.js'
import {
  generateContractInvoice,
  recordPayment,
  recalcInvoice,
  syncContractRecognitions,
} from './services/finance.js'
import { refreshVehicleStatuses } from './services/scheduling.js'

let seed = 73021
function random() {
  seed = (seed * 16807) % 2147483647
  return (seed - 1) / 2147483646
}
function pick<T>(items: T[]): T {
  return items[Math.floor(random() * items.length)]
}
function between(min: number, max: number) {
  return Math.round((min + random() * (max - min)) * 100) / 100
}
function intBetween(min: number, max: number) {
  return Math.floor(min + random() * (max - min + 1))
}
function isoDate(date: Date) {
  return toDateOnly(date)
}
function localDateTime(date: string, time: string) {
  return `${date}T${time}:00`
}
function endTime(start: string, minutes: number) {
  const d = new Date(start)
  d.setMinutes(d.getMinutes() + minutes)
  return toLocalDateTime(d)
}

const VEHICLE_DATA = [
  ['س ط ع 4821', 'Toyota', 'Hiace', 'van', 2023, 13],
  ['أ ب ج 7314', 'Hyundai', 'Staria', 'van', 2024, 9],
  ['ن ه و 2658', 'Mercedes-Benz', 'Sprinter', 'minibus', 2022, 16],
  ['ق ر س 9147', 'Ford', 'Transit', 'van', 2023, 14],
  ['م ل ك 6032', 'Toyota', 'Coaster', 'bus', 2021, 23],
  ['ط ص ق 1589', 'GMC', 'Yukon', 'suv', 2023, 7],
  ['ف ع ل 8426', 'Chevrolet', 'Suburban', 'suv', 2022, 7],
  ['ب ت ث 3795', 'Toyota', 'Land Cruiser', 'suv', 2024, 7],
  ['د ذ ر 5218', 'Mercedes-Benz', 'Vito', 'van', 2021, 8],
  ['ز ش ي 4906', 'Hyundai', 'Sonata', 'sedan', 2024, 5],
  ['ح خ غ 7763', 'Nissan', 'Urvan', 'van', 2020, 14],
  ['ض ظ ع 3120', 'Toyota', 'Camry', 'sedan', 2023, 5],
] as const

const DRIVER_DATA = [
  ['Ahmed El-Sayed', '010 4214 8830', 'EG-DL-882411', 12000],
  ['Mohamed Abdelrahman', '011 2301 1187', 'EG-DL-771204', 11500],
  ['Youssef Hassan', '012 8843 3390', 'EG-DL-662918', 11000],
  ['Khaled Mostafa', '010 7724 4416', 'EG-DL-559830', 13000],
  ['Fathy Ibrahim', '011 3139 0842', 'EG-DL-441723', 12500],
  ['Omar Gamal', '012 9682 2013', 'EG-DL-338612', 10500],
  ['Saad El-Masry', '010 4407 7218', 'EG-DL-229501', 13500],
  ['Nader Fawzy', '011 1207 7749', 'EG-DL-117489', 11800],
  ['Tarek Sami', '012 6613 3302', 'EG-DL-006378', 12200],
] as const

const CUSTOMER_DATA = [
  ['Cairo International School', 'institution', 'Nour Hassan', '02 2482 7710', 'operations@cairo-school-demo.eg'],
  ['Nile Logistics', 'company', 'Sherif Kamal', '02 2204 4491', 'transport@nilelogistics-demo.eg'],
  ['Cairo Medical Group', 'institution', 'Dr. Hana El-Saleh', '02 2664 1208', 'facilities@cmg-demo.eg'],
  ['Delta Energy', 'company', 'Bassem El-Hadary', '03 812 3340', 'mobility@deltaenergy-demo.eg'],
  ['Falcon Engineering', 'company', 'Rana El-Amry', '02 2507 8892', 'admin@falcon-demo.eg'],
  ['Orbits Technology', 'company', 'Ziad Nasser', '02 2991 2043', 'people@orbits-demo.eg'],
  ['Al Noor Institute', 'institution', 'Maha El-Rashidy', '02 2338 6612', 'info@alnoor-demo.eg'],
  ['Cairo Events Group', 'company', 'Sami Khoury', '02 2445 7720', 'events@cairoevents-demo.eg'],
] as const

const ROUTE_DATA = [
  ['Nasr City Campus Line', 'خط حرم مدينة نصر', 'Heliopolis Office', 'Nasr City Campus', ['Abbas El Akkad', 'Metro Station'], [0,1,2,3,4], '07:00', 75, 180, 0],
  ['Medical District Shuttle', 'خط الحي الطبي', 'Downtown Office', 'Cairo Medical City', ['Ramses Street'], [0,1,2,3,4], '07:30', 65, 220, 2],
  ['Industrial City Express', 'خط المدينة الصناعية', 'Head Office', '10th of Ramadan City', ['Second Industrial Gate'], [0,1,2,3,4], '06:45', 85, 260, 3],
  ['Garden City Loop', 'خط جاردن سيتي', 'Downtown Office', 'Garden City', ['Corniche El Nil', 'Tahrir Square'], [0,1,2,3,4], '08:00', 55, 160, 4],
  ['University Evening Route', 'خط الجامعة المسائي', 'Downtown', 'Cairo University', ['Dokki'], [0,1,2,3,4,6], '16:30', 70, 190, 5],
  ['Airport Corporate Shuttle', 'خط المطار للشركات', 'Head Office', 'Cairo International Airport', ['Terminal 3'], [0,1,2,3,4,5,6], '18:00', 95, 320, 6],
  ['East District Connector', 'خط الحي الشرقي', 'Heliopolis Office', 'New Cairo', ['Al Rehab'], [0,2,4], '13:00', 60, 175, 7],
] as const

const CONTRACT_DATA = [
  {
    customer: 0, title: 'Cairo International School Annual Transport', start: '2026-01-01', end: '2026-12-31', type: 'annual',
    value: 1450000, rate: 0, freq: 'monthly', recognition: 'straight_line', route: 0, vehicles: [0, 1], status: 'active',
  },
  {
    customer: 1, title: 'Nile Logistics Staff Mobility Agreement', start: '2026-01-01', end: '2026-12-31', type: 'annual',
    value: 1080000, rate: 0, freq: 'monthly', recognition: 'straight_line', route: 2, vehicles: [2, 3], status: 'active',
  },
  {
    customer: 2, title: 'Cairo Medical Group Shuttle Program', start: '2026-02-01', end: '2026-12-31', type: 'hybrid',
    value: 880000, rate: 0, freq: 'monthly', recognition: 'straight_line', route: 1, vehicles: [4], status: 'active',
  },
  {
    customer: 3, title: 'Delta Energy Field Mobility', start: '2026-03-01', end: '2026-12-31', type: 'hybrid',
    value: 960000, rate: 0, freq: 'monthly', recognition: 'straight_line', route: 2, vehicles: [5, 6], status: 'active',
  },
  {
    customer: 4, title: 'Falcon Engineering Executive Transport', start: '2026-01-01', end: '2026-12-15', type: 'annual',
    value: 600000, rate: 0, freq: 'monthly', recognition: 'straight_line', route: 3, vehicles: [7], status: 'active',
  },
  {
    customer: 5, title: 'Orbits Technology Per-Trip Account', start: '2026-01-01', end: '2026-12-31', type: 'per_trip',
    value: 0, rate: 0, freq: 'per_trip', recognition: 'per_trip', route: null, vehicles: [], status: 'active',
  },
  {
    customer: 7, title: 'Cairo Events Seasonal Program', start: '2026-08-01', end: '2026-12-31', type: 'monthly',
    value: 520000, rate: 0, freq: 'monthly', recognition: 'straight_line', route: 6, vehicles: [1], status: 'active',
  },
]

async function insertExpense(
  tx: Queryable,
  input: {
    date: string
    categoryId: string
    description: string
    amount: number
    vehicleId?: string | null
    driverId?: string | null
    tripId?: string | null
    contractId?: string | null
    maintenanceId?: string | null
    vendor?: string | null
    createdBy: string
    allocations?: { vehicleId?: string; contractId?: string; amount: number }[]
  },
) {
  const seq = await nextSequence('expense', tx)
  const id = randomUUID()
  await tx.query(
    `INSERT INTO expenses (id, expense_no, expense_date, category_id, description, amount, vendor, vehicle_id, driver_id,
      trip_id, contract_id, maintenance_id, is_operating, status, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,'posted',$13,$13)`,
    [
      id,
      code('EXP', seq, 5),
      input.date,
      input.categoryId,
      input.description,
      input.amount,
      input.vendor ?? 'Demo vendor',
      input.vehicleId ?? null,
      input.driverId ?? null,
      input.tripId ?? null,
      input.contractId ?? null,
      input.maintenanceId ?? null,
      input.createdBy,
    ],
  )
  for (const allocation of input.allocations ?? []) {
    await tx.query(
      `INSERT INTO expense_allocations (id, expense_id, vehicle_id, contract_id, allocated_amount, method, percent)
       VALUES ($1,$2,$3,$4,$5,'fixed',$6)`,
      [
        randomUUID(),
        id,
        allocation.vehicleId ?? null,
        allocation.contractId ?? null,
        allocation.amount,
        input.amount > 0 ? Math.round((allocation.amount / input.amount) * 10000) / 100 : null,
      ],
    )
  }
  return id
}

export async function seedDemoData(actorId: string): Promise<void> {
  seed = 73021
  const todayDate = new Date()
  const today = isoDate(todayDate)
  const startDay = addDays(today, -75)
  const endDay = addDays(today, 10)
  const admin = await one<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [actorId])
  if (!admin) throw new Error('Seed actor not found')

  await transaction(async (tx) => {
    /* Vehicles */
    const vehicles: { id: string; plate: string; make: string; model: string; status: string }[] = []
    for (let i = 0; i < VEHICLE_DATA.length; i++) {
      const [plate, make, model, category, year, seats] = VEHICLE_DATA[i]
      const id = randomUUID()
      const status = i === 8 ? 'under_maintenance' : i === 11 ? 'inactive' : i === 9 ? 'available' : 'available'
      await tx.query(
        `INSERT INTO vehicles (id, vehicle_no, plate, make, model, category, year, seats, status, registration_expiry,
          insurance_expiry, odometer, acquisition_cost, acquisition_date, notes, documents, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'[]'::jsonb,$16,$16)`,
        [
          id,
          code('VH', await nextSequence('vehicle', tx), 3),
          plate,
          make,
          model,
          category,
          year,
          seats,
          status,
          addDays(today, 45 + i * 9),
          addDays(today, 20 + i * 13),
          42000 + i * 18321 + intBetween(0, 4000),
          1450000 + i * 185000,
          '2024-03-15',
          'Demo fleet record',
          actorId,
        ],
      )
      vehicles.push({ id, plate, make, model, status })
    }

    /* Drivers */
    const drivers: { id: string; name: string; salary: number }[] = []
    for (let i = 0; i < DRIVER_DATA.length; i++) {
      const [name, phone, license, salary] = DRIVER_DATA[i]
      const id = randomUUID()
      await tx.query(
        `INSERT INTO drivers (id, driver_no, full_name, phone, email, license_no, license_expiry, status, monthly_salary, hire_date, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
        [
          id,
          code('DRV', await nextSequence('driver', tx), 3),
          name,
          phone,
          `${name.split(' ')[0].toLowerCase()}.demo@alsheikh.eg`,
          license,
          addDays(today, 120 + i * 17),
          i === 8 ? 'on_leave' : 'active',
          salary,
          addDays(today, -600 - i * 20),
          'Demo driver record',
          actorId,
        ],
      )
      drivers.push({ id, name, salary })
      if (i < vehicles.length - 3) {
        await tx.query(`UPDATE vehicles SET assigned_driver_id = $2 WHERE id = $1`, [vehicles[i].id, id])
      }
    }
    await tx.query(`UPDATE vehicles SET assigned_driver_id = $2 WHERE id = $1`, [vehicles[11].id, drivers[0].id])

    /* Routes */
    const routes: { id: string; name: string; price: number; days: number[]; vehicleId: string; driverId: string }[] = []
    for (let i = 0; i < ROUTE_DATA.length; i++) {
      const [nameEn, nameAr, origin, destination, stops, days, departure, duration, price, driverIndex] = ROUTE_DATA[i]
      const id = randomUUID()
      await tx.query(
        `INSERT INTO routes (id, route_no, name_en, name_ar, origin, destination, stops, operating_days, departure_time,
          duration_minutes, price, default_vehicle_id, default_driver_id, effective_from, effective_to, status, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,'active',$16,$17,$17)`,
        [
          id,
          code('RT', await nextSequence('route', tx), 3),
          nameEn,
          nameAr,
          origin,
          destination,
          JSON.stringify(stops),
          JSON.stringify(days),
          departure,
          duration,
          price,
          vehicles[i % 8].id,
          drivers[Number(driverIndex) % 8].id,
          '2026-01-01',
          null,
          'Demo fixed route',
          actorId,
        ],
      )
      const scheduleId = randomUUID()
      await tx.query(
        `INSERT INTO route_schedules (id, route_id, days_of_week, departure_time, duration_minutes, effective_from, status)
         VALUES ($1,$2,$3::jsonb,$4,$5,'2026-01-01','active')`,
        [scheduleId, id, JSON.stringify(days), departure, duration],
      )
      routes.push({
        id,
        name: nameEn,
        price: Number(price),
        days: [...days],
        vehicleId: vehicles[i % 8].id,
        driverId: drivers[Number(driverIndex) % 8].id,
      })
    }

    /* Customers */
    const customers: { id: string; name: string }[] = []
    for (let i = 0; i < CUSTOMER_DATA.length; i++) {
      const [name, type, contact, phone, email] = CUSTOMER_DATA[i]
      const id = randomUUID()
      await tx.query(
        `INSERT INTO customers (id, customer_no, name, type, contact_name, phone, email, address, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [id, code('CUS', await nextSequence('customer', tx), 3), name, type, contact, phone, email, 'Cairo, Egypt', 'Demo account', actorId],
      )
      customers.push({ id, name })
    }

    /* Contracts */
    const contracts: { id: string; type: string; customerId: string; no: string }[] = []
    for (let i = 0; i < CONTRACT_DATA.length; i++) {
      const c = CONTRACT_DATA[i]
      const id = randomUUID()
      const contractNo = code('CTR', await nextSequence('contract', tx), 4)
      await tx.query(
        `INSERT INTO contracts (id, contract_no, customer_id, title, start_date, end_date, contract_type, contract_value, unit_rate,
          billing_frequency, payment_terms, payment_terms_days, grace_days, included_trips, included_hours,
          recognition_method, status, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,3,$13,120,$14,$15,$16,$17,$17)`,
        [
          id,
          contractNo,
          customers[c.customer].id,
          c.title,
          c.start,
          c.end,
          c.type,
          c.value,
          c.rate,
          c.freq,
          'Net 30',
          c.customer === 2 ? 45 : 30,
          c.type === 'per_trip' ? 180 : 900,
          c.recognition,
          c.status,
          'Demo contract record',
          actorId,
        ],
      )
      for (let v = 0; v < c.vehicles.length; v++) {
        await tx.query(
          `INSERT INTO contract_vehicles (contract_id, vehicle_id, allocation_percent) VALUES ($1,$2,$3)`,
          [id, vehicles[c.vehicles[v]].id, Math.round((100 / Math.max(1, c.vehicles.length)) * 100) / 100],
        )
      }
      if (c.route !== null) {
        await tx.query(`INSERT INTO contract_routes (contract_id, route_id) VALUES ($1,$2)`, [id, routes[c.route].id])
      }
      contracts.push({ id, type: c.type, customerId: customers[c.customer].id, no: contractNo })
    }

    // A draft contract demonstrates the quote/activation workflow.
    await tx.query(
      `INSERT INTO contracts (id, contract_no, customer_id, title, start_date, end_date, contract_type, contract_value,
        billing_frequency, payment_terms_days, recognition_method, status, notes, created_by, updated_by)
       VALUES ($1,$2,$3,'Al Noor Institute Semester Transport','2027-01-01','2027-06-30','per_trip',0,
        'per_trip',30,'per_trip','draft','Draft proposal awaiting signature',$4,$4)`,
      [randomUUID(), code('CTR', await nextSequence('contract', tx), 4), customers[6].id, actorId],
    )

    /* Maintenance */
    const maintenanceRecords = [
      {
        vehicle: 8, type: 'Scheduled service', description: 'Transmission service and brake inspection',
        start: addDays(today, -1), end: addDays(today, 2), cost: 18500, status: 'in_progress', vendor: 'Cairo Fleet Workshop',
      },
      {
        vehicle: 10, type: 'Preventive maintenance', description: 'Full service and tire replacement',
        start: addDays(today, 4), end: addDays(today, 6), cost: 24000, status: 'scheduled', vendor: 'Nasr City Auto Center',
      },
      {
        vehicle: 2, type: 'Repair', description: 'Air conditioning compressor replacement',
        start: addDays(today, -28), end: addDays(today, -26), cost: 32000, status: 'completed', vendor: 'Mercedes Service Cairo',
      },
      {
        vehicle: 4, type: 'Preventive maintenance', description: '60,000 km scheduled service',
        start: addDays(today, -46), end: addDays(today, -45), cost: 11500, status: 'completed', vendor: 'Toyota Egypt Service',
      },
      {
        vehicle: 0, type: 'Tire service', description: 'Replace two rear tires',
        start: addDays(today, -15), end: addDays(today, -15), cost: 7600, status: 'completed', vendor: 'Nile Tyres',
      },
    ]
    for (const record of maintenanceRecords) {
      const id = randomUUID()
      await tx.query(
        `INSERT INTO maintenance_records (id, record_no, vehicle_id, maintenance_type, description, start_date, end_date, cost, vendor, odometer, status, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
        [
          id,
          code('MNT', await nextSequence('maintenance', tx), 4),
          vehicles[record.vehicle].id,
          record.type,
          record.description,
          record.start,
          record.end,
          record.cost,
          record.vendor,
          60000 + intBetween(0, 30000),
          record.status,
          'Demo maintenance record',
          actorId,
        ],
      )
      if (record.status === 'completed') {
        const expenseId = await insertExpense(tx, {
          date: record.end,
          categoryId: 'cat-maintenance',
          description: `Maintenance: ${record.description}`,
          amount: record.cost,
          vehicleId: vehicles[record.vehicle].id,
          maintenanceId: id,
          vendor: record.vendor,
          createdBy: actorId,
        })
        await tx.query(`UPDATE maintenance_records SET expense_id = $2 WHERE id = $1`, [id, expenseId])
      }
    }

    /* Trips */
    const trips: {
      id: string
      date: string
      vehicleId: string
      driverId: string
      contractId: string | null
      customerId: string | null
      routeId: string | null
      status: string
      price: number
      recognized: number
      type: string
    }[] = []
    const fixedContractTypes = new Set(['monthly', 'annual'])
    const contractForRoute: Record<number, (typeof contracts)[number]> = {
      0: contracts[0],
      1: contracts[2],
      2: contracts[1],
      3: contracts[4],
    }
    const pool = vehicles.slice(0, 8)
    const driverPool = drivers.slice(0, 8)
    let dayOffset = 0
    for (let day = startDay; day <= endDay; day = addDays(day, 1)) {
      const dateObj = new Date(`${day}T12:00:00`)
      const weekday = dateObj.getDay()
      const matchingRoutes = routes.filter((r) => r.days.includes(weekday))
      const slotDefs: { time: string; minutes: number; routeIndex: number | null }[] = [
        { time: '07:00', minutes: 75, routeIndex: 0 },
        { time: '09:30', minutes: 65, routeIndex: null },
        { time: '13:00', minutes: 80, routeIndex: 1 },
        { time: '16:30', minutes: 70, routeIndex: null },
      ]
      for (let slot = 0; slot < slotDefs.length; slot++) {
        if (dayOffset % 7 === 6 && slot === 3) continue
        const config = slotDefs[slot]
        const vehicle = pool[(dayOffset + slot * 2) % pool.length]
        const driver = driverPool[(dayOffset + slot * 2) % driverPool.length]
        const route = config.routeIndex !== null ? matchingRoutes[config.routeIndex % Math.max(1, matchingRoutes.length)] : null
        const customerIndex = (dayOffset + slot) % customers.length
        const linkedContract = route ? contractForRoute[routes.indexOf(route)] : random() < 0.2 ? contracts[5] : null
        const contract = linkedContract ?? null
        const customer = contract
          ? customers.find((c) => c.id === contract.customerId) ?? customers[customerIndex]
          : route
            ? customers[0]
            : customers[customerIndex]
        const start = localDateTime(day, config.time)
        const end = endTime(start, config.minutes + intBetween(-10, 20))
        const price = route ? route.price : Math.round(between(650, 3200))
        const added = random() < 0.18 ? intBetween(25, 180) : 0
        const discount = random() < 0.1 ? intBetween(10, 80) : 0
        let status = 'scheduled'
        if (day < today) {
          const roll = random()
          status = roll < 0.9 ? 'completed' : roll < 0.96 ? 'cancelled' : 'missed'
        } else if (day === today) {
          status = slot === 0 ? 'completed' : slot === 1 ? 'in_progress' : 'scheduled'
        }
        const recognize = status === 'completed' && (!contract || !fixedContractTypes.has(contract.type))
        const recognized = recognize ? Math.max(0, price + added - discount) : 0
        const id = randomUUID()
        await tx.query(
          `INSERT INTO trips (id, trip_no, trip_type, route_id, schedule_id, occurrence_key, customer_id, contract_id,
            vehicle_id, driver_id, origin, destination, stops, scheduled_departure, expected_arrival, actual_departure,
            actual_arrival, distance_km, quoted_price, additional_charges, discount, recognized_revenue, status,
            cancellation_reason, notes, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$26)`,
          [
            id,
            code('TRP', await nextSequence('trip', tx), 5),
            route ? 'fixed' : 'private',
            route?.id ?? null,
            route
              ? (await tx.query<{ id: string }>(`SELECT id FROM route_schedules WHERE route_id = $1 ORDER BY effective_from DESC LIMIT 1`, [route.id])).rows[0]?.id ?? null
              : null,
            route ? `seed:route:${route.id}:${day}:${config.time}` : null,
            customer?.id ?? null,
            contract?.id ?? null,
            vehicle.id,
            driver.id,
            route?.name ? route.name : 'Cairo City',
            route ? (ROUTE_DATA[routes.indexOf(route)][3] as string) : pick(['Cairo International Airport', 'Garden City', 'New Cairo', 'Maadi', 'Zamalek', 'Sheikh Zayed', 'Heliopolis']),
            '[]',
            start,
            end,
            status === 'completed' || status === 'in_progress' ? start : null,
            status === 'completed' ? end : null,
            route ? between(18, 45) : between(12, 80),
            price,
            added,
            discount,
            recognized,
            status,
            status === 'cancelled' || status === 'missed' ? pick(['Customer request', 'Driver unavailable', 'Vehicle issue', 'Schedule change']) : null,
            'Demo trip record',
            actorId,
          ],
        )
        trips.push({
          id,
          date: day,
          vehicleId: vehicle.id,
          driverId: driver.id,
          contractId: contract?.id ?? null,
          customerId: customer?.id ?? null,
          routeId: route?.id ?? null,
          status,
          price,
          recognized,
          type: route ? 'fixed' : 'private',
        })
      }
      dayOffset++
    }

    /* Recognized contract revenue (closed monthly service periods) */
    for (const contract of contracts) {
      await syncContractRecognitions(contract.id, actorId, tx)
    }

    /* Recurring contract invoices */
    const invoiceIds: { id: string; total: number; issueDate: string; contractId: string }[] = []
    for (const contract of contracts) {
      const detail = CONTRACT_DATA[contracts.indexOf(contract)]
      const periods = monthPeriods(detail.start, detail.end, todayDate).filter((p) => p.end <= today)
      const selected = periods.slice(-3)
      for (const period of selected) {
        try {
          const invoice = await generateContractInvoice(contract.id, period.start, period.end, actorId, tx)
          const issueDate = addDays(period.end, 1)
          const dueDate = addDays(issueDate, detail.customer === 2 ? 45 : 30)
          await tx.query(`UPDATE invoices SET issue_date = $2, due_date = $3 WHERE id = $1`, [invoice.id, issueDate, dueDate])
          await recalcInvoice(invoice.id, tx)
          invoiceIds.push({ id: invoice.id, total: invoice.total, issueDate, contractId: contract.id })
        } catch (error) {
          if (!(error instanceof ApiError) || error.code !== 'NOTHING_TO_INVOICE') {
            console.error('[seed] invoice generation skipped', String(error))
          }
        }
      }
    }

    /* Direct customer invoices */
    const privateInvoiceCustomers = [customers[2], customers[3], customers[7], customers[5]]
    for (let i = 0; i < privateInvoiceCustomers.length; i++) {
      const customer = privateInvoiceCustomers[i]
      const issueDate = addDays(today, -8 - i * 14)
      const dueDate = addDays(issueDate, 30)
      const subtotal = between(18000, 68000)
      const tax = Math.round(subtotal * 0.14 * 100) / 100
      const total = Math.round((subtotal + tax) * 100) / 100
      const id = randomUUID()
      const invoiceSeq = await nextSequence('invoice', tx)
      await tx.query(
        `INSERT INTO invoices (id, invoice_no, customer_id, issue_date, due_date, subtotal, tax, total, status, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'sent','Demo private charter invoice',$9,$9)`,
        [id, code('INV', invoiceSeq, 5), customer.id, issueDate, dueDate, subtotal, tax, total, actorId],
      )
      await tx.query(
        `INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_price, line_total, revenue_category)
         VALUES ($1,$2,'Private charter services',1,$3,$4,'private_trip')`,
        [randomUUID(), id, subtotal, subtotal],
      )
      invoiceIds.push({ id, total, issueDate, contractId: '' })
    }

    /* Payments and partial collections */
    let paymentIndex = 0
    for (const invoice of invoiceIds) {
      paymentIndex++
      const age = Math.floor((Date.now() - new Date(`${invoice.issueDate}T12:00:00`).getTime()) / 86_400_000)
      const roll = random()
      let fraction = 0
      if (age > 35) fraction = roll < 0.82 ? 1 : roll < 0.93 ? 0.5 : 0
      else if (age > 15) fraction = roll < 0.6 ? 1 : roll < 0.85 ? 0.5 : 0
      else fraction = roll < 0.35 ? 1 : roll < 0.65 ? 0.4 : 0
      if (fraction <= 0) continue
      const amount = Math.round(invoice.total * fraction * 100) / 100
      if (amount <= 0) continue
      const paymentDate = addDays(invoice.issueDate, Math.min(age - 1, intBetween(2, 18)))
      try {
        await recordPayment(
          {
            invoiceId: invoice.id,
            amount,
            paymentDate: paymentDate > today ? today : paymentDate,
            method: pick(['bank_transfer', 'bank_transfer', 'cheque', 'card', 'cash']),
            reference: `DEMO-PAY-${1000 + paymentIndex}`,
            notes: 'Demo collection',
            idempotencyKey: `demo-payment-${invoice.id}-${fraction}`,
          },
          actorId,
          tx,
        )
      } catch (error) {
        console.error('[seed] payment skipped', String(error))
      }
    }

    /* Fuel and trip-linked operating costs */
    for (const trip of trips.filter((t) => t.status === 'completed')) {
      const fuel = Math.round((trip.type === 'fixed' ? between(120, 260) : between(80, 220)) * 100) / 100
      await insertExpense(tx, {
        date: trip.date,
        categoryId: 'cat-fuel',
        description: `Fuel — ${trip.routeId ? 'fixed route service' : 'private trip'}`,
        amount: fuel,
        vehicleId: trip.vehicleId,
        driverId: trip.driverId,
        tripId: trip.id,
        contractId: trip.contractId,
        vendor: 'Wataniya Petroleum',
        createdBy: actorId,
      })
    }

    /* Monthly driver compensation */
    const currentMonth = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1, 12)
    for (let m = 5; m >= 0; m--) {
      const monthDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - m, 1, 12)
      const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 12)
      const date = isoDate(monthEnd > todayDate ? todayDate : monthEnd)
      for (let d = 0; d < driverPool.length; d++) {
        await insertExpense(tx, {
          date,
          categoryId: 'cat-driver_compensation',
          description: `Driver compensation — ${drivers[d].name}`,
          amount: Number(drivers[d].salary),
          vehicleId: vehicles[d].id,
          driverId: drivers[d].id,
          vendor: 'Payroll',
          createdBy: actorId,
        })
      }
      await insertExpense(tx, {
        date,
        categoryId: 'cat-administration',
        description: 'Shared office and dispatch overhead',
        amount: 45000,
        vendor: 'Al-Sheikh Administration',
        createdBy: actorId,
        allocations: pool.map((vehicle) => ({ vehicleId: vehicle.id, amount: 45000 / pool.length })),
      })
      await insertExpense(tx, {
        date,
        categoryId: 'cat-operating_fees',
        description: 'Operating permits and dispatch platform fees',
        amount: 18000,
        vendor: 'Operations',
        createdBy: actorId,
        allocations: pool.map((vehicle) => ({ vehicleId: vehicle.id, amount: 18000 / pool.length })),
      })
    }

    /* Insurance and licensing */
    for (let i = 0; i < vehicles.length; i++) {
      await tx.query(
        `INSERT INTO expenses (id, expense_no, expense_date, category_id, description, amount, vendor, vehicle_id, is_operating, status, created_by, updated_by)
         VALUES ($1,$2,$3,'cat-insurance','Annual fleet insurance',$4,'Misr Insurance',$5,true,'posted',$6,$6)`,
        [randomUUID(), code('EXP', await nextSequence('expense', tx), 5), addDays(today, -200 + i * 4), 18000 + i * 950, vehicles[i].id, actorId],
      )
      await tx.query(
        `INSERT INTO expenses (id, expense_no, expense_date, category_id, description, amount, vendor, vehicle_id, is_operating, status, created_by, updated_by)
         VALUES ($1,$2,$3,'cat-licensing','Vehicle registration and permits',$4,'Traffic Department',$5,true,'posted',$6,$6)`,
        [randomUUID(), code('EXP', await nextSequence('expense', tx), 5), addDays(today, -120 + i * 3), 2400 + i * 120, vehicles[i].id, actorId],
      )
    }

    /* Demo notifications */
    const adminUser = (await tx.query<{ id: string }>(`SELECT id FROM users WHERE role_id = 'role-admin' AND is_active = true ORDER BY created_at LIMIT 1`)).rows[0]
    const viewerUser = (await tx.query<{ id: string }>(`SELECT id FROM users WHERE role_id = 'role-viewer' ORDER BY created_at LIMIT 1`)).rows[0]
    if (adminUser) {
      const notifications = [
        ['Demo workspace ready', 'All figures in this workspace are sample data for evaluation. Reset or replace them before production use.', 'info', '/settings'],
        ['Overdue receivable requires follow-up', 'Some demo invoices have passed their due date. Review collections in Revenue.', 'warning', '/revenue'],
        ['Contract renewal approaching', 'A demo contract expires within 60 days. Review the renewal pipeline.', 'warning', '/contracts'],
        ['Vehicle under maintenance', 'A scheduled maintenance block is currently active and will remain blocked in dispatch.', 'info', '/maintenance'],
      ] as const
      for (const [title, message, type, link] of notifications) {
        await tx.query(
          `INSERT INTO notifications (id, user_id, title, message, type, link) VALUES ($1,$2,$3,$4,$5,$6)`,
          [randomUUID(), adminUser.id, title, message, type, link],
        )
      }
    }
    if (viewerUser) {
      await tx.query(
        `INSERT INTO notifications (id, user_id, title, message, type, link) VALUES ($1,$2,'Welcome to the operations workspace','You have read-only access to fleet operations, finance summaries and reports.','info','/')`,
        [randomUUID(), viewerUser.id],
      )
    }

    await tx.query(`UPDATE business_settings SET demo_mode = true WHERE id = 1`)
  })

  await refreshVehicleStatuses()
}

export async function resetDemoData(): Promise<void> {
  await transaction(async (tx) => {
    await tx.query(`DELETE FROM expense_allocations`)
    await tx.query(`DELETE FROM payments`)
    await tx.query(`DELETE FROM invoice_lines`)
    await tx.query(`DELETE FROM invoices`)
    await tx.query(`DELETE FROM revenue_recognitions`)
    await tx.query(`DELETE FROM expenses`)
    await tx.query(`DELETE FROM maintenance_records`)
    await tx.query(`DELETE FROM trips`)
    await tx.query(`DELETE FROM contract_vehicles`)
    await tx.query(`DELETE FROM contract_routes`)
    await tx.query(`DELETE FROM contracts`)
    await tx.query(`DELETE FROM customers`)
    await tx.query(`DELETE FROM route_schedules`)
    await tx.query(`DELETE FROM routes`)
    await tx.query(`DELETE FROM vehicles`)
    await tx.query(`DELETE FROM drivers`)
    await tx.query(`DELETE FROM notifications`)
    await tx.query(`DELETE FROM audit_logs`)
    for (const sequence of ['vehicle','driver','route','trip','customer','contract','invoice','payment','expense','maintenance']) {
      await tx.query(`ALTER SEQUENCE ${sequence}_seq RESTART WITH 1`)
    }
  })
}

/**
 * Factory reset: clears every operational record and returns the workspace to
 * its default configuration. The two built-in accounts and the acting
 * administrator are preserved so the workspace can still be accessed.
 */
export async function resetWorkspace(actorId: string): Promise<void> {
  await transaction(async (tx) => {
    await tx.query(`DELETE FROM expense_allocations`)
    await tx.query(`DELETE FROM payments`)
    await tx.query(`DELETE FROM invoice_lines`)
    await tx.query(`DELETE FROM invoices`)
    await tx.query(`DELETE FROM revenue_recognitions`)
    await tx.query(`DELETE FROM expenses`)
    await tx.query(`DELETE FROM maintenance_records`)
    await tx.query(`DELETE FROM trips`)
    await tx.query(`DELETE FROM contract_vehicles`)
    await tx.query(`DELETE FROM contract_routes`)
    await tx.query(`DELETE FROM contracts`)
    await tx.query(`DELETE FROM customers`)
    await tx.query(`DELETE FROM route_schedules`)
    await tx.query(`DELETE FROM routes`)
    await tx.query(`DELETE FROM vehicles`)
    await tx.query(`DELETE FROM drivers`)
    await tx.query(`DELETE FROM notifications`)
    await tx.query(`DELETE FROM audit_logs`)

    // Remove custom expense categories and restore the system catalogue.
    await tx.query(`DELETE FROM expense_categories WHERE is_system = false`)
    await tx.query(`UPDATE expense_categories SET is_active = true WHERE is_system = true`)

    // Remove permission overrides, then every account except the built-in
    // accounts and the administrator performing the reset.
    await tx.query(`DELETE FROM user_permissions`)
    await tx.query(
      `DELETE FROM users
       WHERE id <> $1 AND email NOT IN ('admin@alsheikh.eg', 'viewer@alsheikh.eg')`,
      [actorId],
    )
    await tx.query(
      `UPDATE users SET is_active = true WHERE email IN ('admin@alsheikh.eg', 'viewer@alsheikh.eg')`,
    )

    await tx.query(
      `UPDATE business_settings SET
         company_name_en = 'Al-Sheikh Office',
         company_name_ar = 'مكتب الشيخ',
         logo_url = NULL,
         currency = 'EGP',
         vat_rate = 14,
         trip_buffer_minutes = 30,
         operating_hours_per_day = 12,
         timezone = 'Africa/Cairo',
         demo_mode = false,
         invoice_terms_days = 30,
         updated_by = $1,
         updated_at = now()
       WHERE id = 1`,
      [actorId],
    )

    for (const sequence of ['vehicle','driver','route','trip','customer','contract','invoice','payment','expense','maintenance']) {
      await tx.query(`ALTER SEQUENCE ${sequence}_seq RESTART WITH 1`)
    }
  })

  // Recreate the built-in accounts and system categories if they were missing.
  await seedBaseData()
}


export async function seedDemoCli() {
  const { initializeDatabase } = await import('./db.js')
  await initializeDatabase()
  const admin = await one<{ id: string }>(`SELECT id FROM users WHERE role_id = 'role-admin' LIMIT 1`)
  if (!admin) throw new Error('No administrator found')
  const existing = await one<{ count: string }>(`SELECT COUNT(*) AS count FROM vehicles`)
  if (Number(existing?.count ?? 0) > 0 && !process.argv.includes('--reset')) {
    console.log('Demo data already exists. Use --reset to replace it.')
    await db.close()
    return
  }
  if (process.argv.includes('--reset')) await resetDemoData()
  await seedDemoData(admin.id)
  console.log('Demo workspace seeded.')
  await db.close()
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  await seedDemoCli()
}
