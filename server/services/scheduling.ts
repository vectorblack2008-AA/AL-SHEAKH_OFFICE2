import type { Queryable } from '../db.js'
import { db, one, q } from '../db.js'
import { ApiError, toDateOnly, toLocalDateTime } from '../lib.js'

interface ConflictInput {
  vehicleId?: string | null
  driverId?: string | null
  start: string
  end: string
  excludeTripId?: string | null
  status?: string
  ignoreMaintenance?: boolean
}

export interface Conflict {
  kind: 'vehicle_trip' | 'driver_trip' | 'vehicle_maintenance' | 'vehicle_unavailable' | 'driver_unavailable'
  message: string
  reference?: string
}

export async function schedulingConflicts(input: ConflictInput, runner: Queryable = db): Promise<Conflict[]> {
  const settings = await runner.query<{ trip_buffer_minutes: number }>(
    `SELECT trip_buffer_minutes FROM business_settings WHERE id = 1`,
  )
  const buffer = Number(settings.rows[0]?.trip_buffer_minutes ?? 30)
  const start = new Date(input.start)
  const end = new Date(input.end)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ApiError(400, 'Invalid trip start or end time', 'INVALID_TIME')
  }
  if (end < start) throw new ApiError(400, 'Arrival time must be after departure time', 'INVALID_TIME')

  const conflicts: Conflict[] = []
  const bufferMs = buffer * 60_000
  const rangeStart = new Date(start.getTime() - 36 * 60 * 60_000)
  const rangeEnd = new Date(end.getTime() + 36 * 60 * 60_000)

  if (input.vehicleId) {
    const vehicle = await runner.query<{ status: string; plate: string; archived_at: Date | null }>(
      `SELECT status, plate, archived_at FROM vehicles WHERE id = $1`,
      [input.vehicleId],
    )
    const v = vehicle.rows[0]
    if (!v) throw new ApiError(400, 'Selected vehicle does not exist', 'VEHICLE_NOT_FOUND')
    if (v.archived_at) conflicts.push({ kind: 'vehicle_unavailable', message: 'Selected vehicle is archived' })
    if (v.status === 'inactive') {
      conflicts.push({ kind: 'vehicle_unavailable', message: `Vehicle ${v.plate} is inactive` })
    }
  }

  if (input.driverId) {
    const driver = await runner.query<{ status: string; full_name: string; archived_at: Date | null }>(
      `SELECT status, full_name, archived_at FROM drivers WHERE id = $1`,
      [input.driverId],
    )
    const d = driver.rows[0]
    if (!d) throw new ApiError(400, 'Selected driver does not exist', 'DRIVER_NOT_FOUND')
    if (d.archived_at || d.status === 'inactive') {
      conflicts.push({ kind: 'driver_unavailable', message: `Driver ${d.full_name} is inactive` })
    }
  }

  const trips = await runner.query<{
    id: string
    trip_no: string
    vehicle_id: string | null
    driver_id: string | null
    scheduled_departure: Date
    expected_arrival: Date | null
    status: string
  }>(
    `SELECT id, trip_no, vehicle_id, driver_id, scheduled_departure, expected_arrival, status
     FROM trips
     WHERE status NOT IN ('cancelled','missed','completed')
       AND scheduled_departure BETWEEN $1::timestamp AND $2::timestamp
       AND ($3::text IS NULL OR id <> $3)`,
    [toLocalDateTime(rangeStart), toLocalDateTime(rangeEnd), input.excludeTripId ?? null],
  )

  for (const trip of trips.rows) {
    const tripStart = new Date(trip.scheduled_departure)
    const tripEnd = trip.expected_arrival ? new Date(trip.expected_arrival) : new Date(tripStart.getTime() + 2 * 3_600_000)
    const overlaps = start.getTime() < tripEnd.getTime() + bufferMs && end.getTime() + bufferMs > tripStart.getTime()
    if (!overlaps) continue
    if (input.vehicleId && trip.vehicle_id === input.vehicleId) {
      conflicts.push({
        kind: 'vehicle_trip',
        message: `Vehicle is already assigned to ${trip.trip_no} at this time`,
        reference: trip.trip_no,
      })
    }
    if (input.driverId && trip.driver_id === input.driverId) {
      conflicts.push({
        kind: 'driver_trip',
        message: `Driver is already assigned to ${trip.trip_no} at this time`,
        reference: trip.trip_no,
      })
    }
  }

  if (input.vehicleId && !input.ignoreMaintenance) {
    const maintenance = await runner.query<{
      record_no: string
      start_date: Date | string
      end_date: Date | string
      maintenance_type: string
    }>(
      `SELECT record_no, start_date, end_date, maintenance_type
       FROM maintenance_records
       WHERE vehicle_id = $1 AND status IN ('scheduled','in_progress')
         AND end_date >= $2::date - 1 AND start_date <= $3::date + 1`,
      [input.vehicleId, toDateOnly(start), toDateOnly(end)],
    )
    const startDay = toDateOnly(start)
    const endDay = toDateOnly(end)
    for (const record of maintenance.rows) {
      const blockStart = toDateOnly(record.start_date)
      const blockEnd = toDateOnly(record.end_date)
      if (startDay <= blockEnd && endDay >= blockStart) {
        conflicts.push({
          kind: 'vehicle_maintenance',
          message: `Vehicle is blocked for ${record.maintenance_type} (${record.record_no})`,
          reference: record.record_no,
        })
      }
    }
  }

  return conflicts
}

export async function assertSchedulingIsClear(input: ConflictInput, runner: Queryable = db) {
  const conflicts = await schedulingConflicts(input, runner)
  if (conflicts.length > 0) {
    throw new ApiError(409, conflicts[0].message, 'SCHEDULE_CONFLICT', conflicts)
  }
}

export async function tripDurationMinutes(vehicleId: string | null, driverId: string | null, start: string, end: string) {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000))
}

export async function fleetAvailability(runner: Queryable = db) {
  const rows = await runner.query<{
    total: string
    available: string
    operating: string
    maintenance: string
  }>(`
    SELECT
      count(*) FILTER (WHERE archived_at IS NULL) AS total,
      count(*) FILTER (WHERE archived_at IS NULL AND status = 'available') AS available,
      count(*) FILTER (WHERE archived_at IS NULL AND status IN ('scheduled','on_trip')) AS operating,
      count(*) FILTER (WHERE archived_at IS NULL AND status = 'under_maintenance') AS maintenance
    FROM vehicles
  `)
  return {
    total: Number(rows.rows[0]?.total ?? 0),
    available: Number(rows.rows[0]?.available ?? 0),
    operating: Number(rows.rows[0]?.operating ?? 0),
    maintenance: Number(rows.rows[0]?.maintenance ?? 0),
  }
}

export async function refreshVehicleStatuses(runner: Queryable = db) {
  const now = new Date()
  const current = now.toISOString()
  await runner.query(
    `UPDATE vehicles SET status = 'on_trip'
     WHERE status IN ('available','scheduled') AND archived_at IS NULL AND id IN (
       SELECT vehicle_id FROM trips
       WHERE vehicle_id IS NOT NULL AND status = 'in_progress'
     )`,
  )
  await runner.query(
    `UPDATE vehicles SET status = 'scheduled'
     WHERE status = 'available' AND archived_at IS NULL AND id IN (
       SELECT vehicle_id FROM trips
       WHERE vehicle_id IS NOT NULL AND status IN ('confirmed','scheduled')
         AND scheduled_departure <= ($1::timestamptz + interval '24 hours')
         AND scheduled_departure >= ($1::timestamptz - interval '1 hour')
     )`,
    [current],
  )
  await runner.query(
    `UPDATE vehicles SET status = 'under_maintenance'
     WHERE status NOT IN ('on_trip','inactive') AND archived_at IS NULL AND id IN (
       SELECT vehicle_id FROM maintenance_records
       WHERE status = 'in_progress' OR (status = 'scheduled' AND start_date <= current_date AND end_date >= current_date)
     )`,
  )
  await runner.query(
    `UPDATE vehicles SET status = 'available'
     WHERE status IN ('scheduled','under_maintenance') AND archived_at IS NULL
       AND id NOT IN (SELECT vehicle_id FROM trips WHERE vehicle_id IS NOT NULL AND status = 'in_progress')
       AND id NOT IN (SELECT vehicle_id FROM maintenance_records WHERE status = 'in_progress' OR (status = 'scheduled' AND start_date <= current_date AND end_date >= current_date))
       AND id NOT IN (SELECT vehicle_id FROM trips WHERE vehicle_id IS NOT NULL AND status IN ('confirmed','scheduled') AND scheduled_departure <= ($1::timestamptz + interval '24 hours') AND scheduled_departure >= ($1::timestamptz - interval '1 hour'))`,
    [current],
  )
}

export async function assertVehicleAvailableForMaintenance(input: {
  vehicleId: string
  startDate: string
  endDate: string
  excludeRecordId?: string
}) {
  const conflicts = await q<{ trip_no: string }>(
    `SELECT trip_no FROM trips
     WHERE vehicle_id = $1 AND status NOT IN ('cancelled','missed','completed')
       AND scheduled_departure::date <= $3::date AND COALESCE(expected_arrival, scheduled_departure)::date >= $2::date
       ${input.excludeRecordId ? 'AND id <> $4' : ''}
     LIMIT 1`,
    input.excludeRecordId
      ? [input.vehicleId, input.startDate, input.endDate, input.excludeRecordId]
      : [input.vehicleId, input.startDate, input.endDate],
  )
  if (conflicts.length > 0) {
    throw new ApiError(
      409,
      `Vehicle has scheduled trip ${conflicts[0].trip_no} in this maintenance window`,
      'SCHEDULE_CONFLICT',
    )
  }
}

export async function getVehicleShiftStats(vehicleId: string, from: string, to: string) {
  const hours = await one<{ hours: string; trips: string }>(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(expected_arrival, scheduled_departure) - scheduled_departure))/3600),0) AS hours,
            COUNT(*) AS trips
     FROM trips WHERE vehicle_id = $1 AND status = 'completed'
       AND scheduled_departure::date BETWEEN $2::date AND $3::date`,
    [vehicleId, from, to],
  )
  return { hours: Number(hours?.hours ?? 0), trips: Number(hours?.trips ?? 0) }
}
