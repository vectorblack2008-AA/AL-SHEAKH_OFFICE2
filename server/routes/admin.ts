import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { hash } from 'bcryptjs'
import { z } from 'zod'
import { loadAuthUser, requirePermission } from '../auth.js'
import { db, one, q, transaction } from '../db.js'
import {
  ApiError,
  asyncHandler,
  audit,
  BUSINESS_TIMEZONE,
  isValidTimeZone,
  setBusinessTimezone,
  pagination,
  parseBody,
  serialize,
  toDateOnly,
  todayDate,
} from '../lib.js'
import { seedDemoData, resetDemoData, resetWorkspace } from '../seed-data.js'

export const adminRouter = Router()

const userCreateSchema = z.object({
  email: z.string().email().max(200),
  full_name: z.string().trim().min(2).max(120),
  password: z.string().min(8).max(200),
  role_id: z.string().min(1),
  is_active: z.boolean().default(true),
})

const userUpdateSchema = z.object({
  email: z.string().email().max(200).optional(),
  full_name: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(8).max(200).optional(),
  role_id: z.string().optional(),
  is_active: z.boolean().optional(),
})

adminRouter.get(
  '/users',
  requirePermission('view_users'),
  asyncHandler(async (_req, res) => {
    const users = await q(
      `SELECT u.id, u.email, u.full_name, u.role_id, r.key AS role_key, r.name_en AS role_name_en, r.name_ar AS role_name_ar,
        u.is_active, u.language, u.theme, u.last_login_at, u.created_at
       FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.created_at`,
    )
    const roles = await q(`SELECT * FROM roles ORDER BY key`)
    const permissions = await q(
      `SELECT rp.role_id, p.key, p.module, p.name_en, p.name_ar FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id ORDER BY p.module, p.key`,
    )
    res.json(serialize({ data: users, roles, permissions }))
  }),
)

adminRouter.post(
  '/users',
  requirePermission('manage_users'),
  asyncHandler(async (req, res) => {
    const body = parseBody(userCreateSchema, req.body)
    const role = await one<{ id: string }>(`SELECT id FROM roles WHERE id = $1`, [body.role_id])
    if (!role) throw new ApiError(400, 'Invalid role', 'INVALID_ROLE')
    const existing = await one(`SELECT id FROM users WHERE lower(email) = lower($1)`, [body.email])
    if (existing) throw new ApiError(409, 'A user with this email already exists', 'DUPLICATE_USER')
    const passwordHash = await hash(body.password, 12)
    const id = randomUUID()
    await q(
      `INSERT INTO users (id, email, password_hash, full_name, role_id, is_active) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, body.email.toLowerCase(), passwordHash, body.full_name, body.role_id, body.is_active],
    )
    const user = await one(
      `SELECT u.id, u.email, u.full_name, u.role_id, r.key AS role_key, u.is_active, u.created_at
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [id],
    )
    await audit(req, 'create', 'user', id, null, user)
    res.status(201).json(serialize(user))
  }),
)

adminRouter.patch(
  '/users/:id',
  requirePermission('manage_users'),
  asyncHandler(async (req, res) => {
    const body = parseBody(userUpdateSchema, req.body)
    const before = await one<{ id: string; role_id: string; is_active: boolean; email: string }>(
      `SELECT id, role_id, is_active, email FROM users WHERE id = $1`,
      [req.params.id],
    )
    if (!before) throw new ApiError(404, 'User not found', 'NOT_FOUND')
    const adminRole = await one<{ id: string }>(`SELECT id FROM roles WHERE key = 'admin'`)
    if (req.params.id === req.user?.id && (body.is_active === false || (body.role_id && body.role_id !== before.role_id))) {
      throw new ApiError(409, 'You cannot deactivate or change your own role', 'SELF_LOCKOUT')
    }
    if (before.role_id === adminRole?.id && (body.is_active === false || (body.role_id && body.role_id !== adminRole.id))) {
      const admins = await one<{ count: string }>(
        `SELECT COUNT(*) AS count FROM users WHERE role_id = $1 AND is_active = true AND id <> $2`,
        [adminRole.id, req.params.id],
      )
      if (Number(admins?.count ?? 0) === 0) throw new ApiError(409, 'The last active administrator cannot be removed', 'LAST_ADMIN')
    }
    const entries = Object.entries(body).filter(([, value]) => value !== undefined)
    if (!entries.length) throw new ApiError(400, 'No changes supplied', 'VALIDATION_ERROR')
    const assignments: string[] = []
    const params: unknown[] = [req.params.id]
    for (const [key, value] of entries) {
      if (key === 'password') {
        params.push(await hash(String(value), 12))
        assignments.push(`password_hash = $${params.length}`)
      } else {
        params.push(key === 'email' ? String(value).toLowerCase() : value)
        assignments.push(`${key} = $${params.length}`)
      }
    }
    params.push(req.user!.id)
    await q(`UPDATE users SET ${assignments.join(', ')}, updated_at = now() WHERE id = $1`, params.slice(0, -1))
    const user = await one(
      `SELECT u.id, u.email, u.full_name, u.role_id, r.key AS role_key, u.is_active, u.last_login_at
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [req.params.id],
    )
    await audit(req, 'update', 'user', req.params.id, before, { ...user, password_changed: Boolean(body.password) })
    res.json(serialize(user))
  }),
)

adminRouter.patch(
  '/roles/:id/permissions',
  requirePermission('manage_users'),
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ permission_keys: z.array(z.string()) }), req.body)
    const role = await one<{ id: string; key: string }>(`SELECT id, key FROM roles WHERE id = $1`, [req.params.id])
    if (!role) throw new ApiError(404, 'Role not found', 'NOT_FOUND')
    if (role.key === 'admin') throw new ApiError(409, 'Administrator permissions are protected', 'ROLE_PROTECTED')
    const before = await q(`SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`, [role.id])
    await transaction(async (tx) => {
      await tx.query(`DELETE FROM role_permissions WHERE role_id = $1`, [role.id])
      for (const key of body.permission_keys) {
        const perm = await tx.query<{ id: string }>(`SELECT id FROM permissions WHERE key = $1`, [key])
        if (perm.rows[0]) {
          await tx.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)`, [role.id, perm.rows[0].id])
        }
      }
    })
    await audit(req, 'update_permissions', 'role', role.id, before, body.permission_keys)
    res.json({ ok: true })
  }),
)

/* --------------------------------- Settings -------------------------------- */

adminRouter.get(
  '/settings',
  requirePermission('view_settings'),
  asyncHandler(async (_req, res) => {
    const settings = await one(`SELECT * FROM business_settings WHERE id = 1`)
    res.json(serialize(settings))
  }),
)

adminRouter.patch(
  '/settings',
  requirePermission('manage_settings'),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        company_name_en: z.string().trim().min(2).max(120).optional(),
        company_name_ar: z.string().trim().min(2).max(120).optional(),
        logo_url: z.string().max(500).nullable().optional(),
        currency: z.string().trim().length(3).optional(),
        vat_rate: z.coerce.number().min(0).max(100).optional(),
        trip_buffer_minutes: z.coerce.number().int().min(0).max(240).optional(),
        operating_hours_per_day: z.coerce.number().min(1).max(24).optional(),
        timezone: z.string().trim().max(80).refine(isValidTimeZone, 'Invalid timezone').optional(),
        invoice_terms_days: z.coerce.number().int().min(0).max(365).optional(),
      }),
      req.body,
    )
    const entries = Object.entries(body).filter(([, value]) => value !== undefined)
    if (!entries.length) throw new ApiError(400, 'No changes supplied', 'VALIDATION_ERROR')
    const before = await one(`SELECT * FROM business_settings WHERE id = 1`)
    const assignments = entries.map(([key], index) => `${key} = $${index + 2}`)
    await q(
      `UPDATE business_settings SET ${assignments.join(', ')}, updated_by = $${entries.length + 2} WHERE id = 1`,
      [null, ...entries.map(([, value]) => value), req.user!.id],
    )
    const settings = await one<{ timezone?: string }>(`SELECT * FROM business_settings WHERE id = 1`)
    setBusinessTimezone(settings?.timezone)
    await audit(req, 'update', 'settings', '1', before, settings)
    res.json(serialize(settings))
  }),
)

adminRouter.get(
  '/expense-categories',
  requirePermission('view_expenses'),
  asyncHandler(async (_req, res) => {
    res.json(serialize({ data: await q(`SELECT * FROM expense_categories ORDER BY is_system DESC, name_en`) }))
  }),
)

adminRouter.post(
  '/expense-categories',
  requirePermission('manage_settings'),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        key: z.string().trim().regex(/^[a-z0-9_]+$/).max(40),
        name_en: z.string().trim().min(2).max(80),
        name_ar: z.string().trim().min(2).max(80),
        is_operating: z.boolean().default(true),
      }),
      req.body,
    )
    const existing = await one(`SELECT id FROM expense_categories WHERE key = $1`, [body.key])
    if (existing) throw new ApiError(409, 'An expense category with this key already exists', 'DUPLICATE_CATEGORY')
    const id = randomUUID()
    await q(
      `INSERT INTO expense_categories (id, key, name_en, name_ar, is_operating, is_system) VALUES ($1,$2,$3,$4,$5,false)`,
      [id, body.key, body.name_en, body.name_ar, body.is_operating],
    )
    const row = await one(`SELECT * FROM expense_categories WHERE id = $1`, [id])
    await audit(req, 'create', 'expense_category', id, null, row)
    res.status(201).json(serialize(row))
  }),
)

adminRouter.patch(
  '/expense-categories/:id',
  requirePermission('manage_settings'),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        name_en: z.string().trim().min(2).max(80).optional(),
        name_ar: z.string().trim().min(2).max(80).optional(),
        is_operating: z.boolean().optional(),
        is_active: z.boolean().optional(),
      }),
      req.body,
    )
    const before = await one(`SELECT * FROM expense_categories WHERE id = $1`, [req.params.id])
    if (!before) throw new ApiError(404, 'Expense category not found', 'NOT_FOUND')
    const entries = Object.entries(body).filter(([, value]) => value !== undefined)
    if (!entries.length) throw new ApiError(400, 'No changes supplied', 'VALIDATION_ERROR')
    const assignments = entries.map(([key], index) => `${key} = $${index + 2}`)
    await q(`UPDATE expense_categories SET ${assignments.join(', ')} WHERE id = $1`, [
      req.params.id,
      ...entries.map(([, value]) => value),
    ])
    const row = await one(`SELECT * FROM expense_categories WHERE id = $1`, [req.params.id])
    await audit(req, 'update', 'expense_category', req.params.id, before, row)
    res.json(serialize(row))
  }),
)

/* ------------------------------- Notifications ----------------------------- */

adminRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED')
    const onlyUnread = req.query.unread === 'true'
    const rows = await q(
      `SELECT * FROM notifications WHERE user_id = $1 ${onlyUnread ? 'AND is_read = false' : ''} ORDER BY created_at DESC LIMIT 100`,
      [req.user.id],
    )
    const unread = await one<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND is_read = false`,
      [req.user.id],
    )
    res.json(serialize({ data: rows, unread: Number(unread?.count ?? 0) }))
  }),
)

adminRouter.patch(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED')
    await q(`UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id])
    res.json({ ok: true })
  }),
)

adminRouter.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED')
    await q(`UPDATE notifications SET is_read = true WHERE user_id = $1`, [req.user.id])
    res.json({ ok: true })
  }),
)

adminRouter.post(
  '/notifications',
  requirePermission('manage_notifications'),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        title: z.string().trim().min(2).max(160),
        message: z.string().trim().min(2).max(1000),
        type: z.enum(['info','success','warning','danger']).default('info'),
        link: z.string().max(300).nullable().optional(),
        user_id: z.string().nullable().optional(),
      }),
      req.body,
    )
    if (body.user_id) {
      await q(
        `INSERT INTO notifications (id, user_id, title, message, type, link) VALUES ($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), body.user_id, body.title, body.message, body.type, body.link ?? null],
      )
    } else {
      const users = await q<{ id: string }>(`SELECT id FROM users WHERE is_active = true`)
      for (const user of users) {
        await q(
          `INSERT INTO notifications (id, user_id, title, message, type, link) VALUES ($1,$2,$3,$4,$5,$6)`,
          [randomUUID(), user.id, body.title, body.message, body.type, body.link ?? null],
        )
      }
    }
    await audit(req, 'create', 'notification', null, null, body)
    res.status(201).json({ ok: true })
  }),
)

/* --------------------------------- Audit log ------------------------------- */

adminRouter.get(
  '/audit-logs',
  requirePermission('view_audit'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = pagination(req.query)
    const params: unknown[] = []
    const filters: string[] = []
    for (const [key, column] of [
      ['entityType', 'entity_type'],
      ['action', 'action'],
      ['actorId', 'actor_id'],
    ] as const) {
      if (req.query[key]) { params.push(String(req.query[key])); filters.push(`${column} = $${params.length}`) }
    }
    if (req.query.from) { params.push(String(req.query.from)); filters.push(`created_at::date >= $${params.length}::date`) }
    if (req.query.to) { params.push(String(req.query.to)); filters.push(`created_at::date <= $${params.length}::date`) }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const rows = await q(
      `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    )
    const total = await one<{ count: string }>(`SELECT COUNT(*) AS count FROM audit_logs ${where}`, params)
    res.json(serialize({ data: rows, total: Number(total?.count ?? 0), page, pageSize }))
  }),
)

/* ---------------------------------- Demo ----------------------------------- */

adminRouter.post(
  '/demo/seed',
  requirePermission('manage_settings'),
  asyncHandler(async (req, res) => {
    const settings = await one<{ demo_mode: boolean }>(`SELECT demo_mode FROM business_settings WHERE id = 1`)
    if (settings?.demo_mode) throw new ApiError(409, 'Demo data is already loaded', 'DEMO_ALREADY_LOADED')
    const existing = await one<{ count: string }>(`SELECT COUNT(*) AS count FROM vehicles`)
    if (Number(existing?.count ?? 0) > 0) {
      throw new ApiError(409, 'The workspace already contains operational records. Demo data cannot be mixed with real data.', 'WORKSPACE_NOT_EMPTY')
    }
    await seedDemoData(req.user!.id)
    await q(`UPDATE business_settings SET demo_mode = true, updated_by = $1 WHERE id = 1`, [req.user!.id])
    await audit(req, 'seed_demo', 'workspace', null, null, { loaded_at: new Date().toISOString() })
    res.status(201).json({ ok: true })
  }),
)

adminRouter.post(
  '/demo/reset',
  requirePermission('manage_settings'),
  asyncHandler(async (req, res) => {
    const settings = await one<{ demo_mode: boolean }>(`SELECT demo_mode FROM business_settings WHERE id = 1`)
    if (!settings?.demo_mode) throw new ApiError(409, 'This workspace is not in demo mode', 'NOT_DEMO')
    await resetDemoData()
    await seedDemoData(req.user!.id)
    await q(`UPDATE business_settings SET demo_mode = true, updated_by = $1 WHERE id = 1`, [req.user!.id])
    await audit(req, 'reset_demo', 'workspace', null, null, { reset_at: new Date().toISOString() })
    res.json({ ok: true })
  }),
)

adminRouter.post(
  '/workspace/reset',
  requirePermission('manage_settings'),
  asyncHandler(async (req, res) => {
    if (req.user!.role_key !== 'admin') {
      throw new ApiError(403, 'Only an administrator can reset the workspace', 'FORBIDDEN')
    }
    const body = parseBody(
      z.object({
        confirmation: z.string().trim().min(1).max(40),
      }),
      req.body,
    )
    if (body.confirmation.toUpperCase() !== 'RESET') {
      throw new ApiError(400, 'Confirmation phrase does not match', 'CONFIRMATION_MISMATCH')
    }
    await resetWorkspace(req.user!.id)
    await audit(req, 'reset_workspace', 'workspace', null, null, {
      reset_at: new Date().toISOString(),
      demo_mode: false,
    })
    res.json({ ok: true })
  }),
)

adminRouter.get(
  '/system-info',
  requirePermission('view_settings'),
  asyncHandler(async (_req, res) => {
    const counts = await q(
      `SELECT
        (SELECT COUNT(*) FROM vehicles) AS vehicles,
        (SELECT COUNT(*) FROM drivers) AS drivers,
        (SELECT COUNT(*) FROM trips) AS trips,
        (SELECT COUNT(*) FROM contracts) AS contracts,
        (SELECT COUNT(*) FROM invoices) AS invoices,
        (SELECT COUNT(*) FROM payments) AS payments,
        (SELECT COUNT(*) FROM expenses) AS expenses`,
    )
    const settings = await one<{ timezone?: string }>(`SELECT timezone FROM business_settings WHERE id = 1`)
    res.json(
      serialize({
        counts: counts[0],
        database: db.driver === 'postgres' ? 'PostgreSQL (hosted)' : 'PostgreSQL (PGlite embedded engine)',
        timezone: settings?.timezone || BUSINESS_TIMEZONE,
        date: todayDate(),
      }),
    )
  }),
)
