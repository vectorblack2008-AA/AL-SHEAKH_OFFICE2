import { hash } from 'bcryptjs'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Paths are resolved from the working directory so the server can be bundled by
 * a serverless builder without relying on `import.meta.url`. The process is
 * always started from the project root (`npm start`, Docker `WORKDIR`).
 */
const projectRoot = process.cwd()

/**
 * The application speaks a tiny subset of PostgreSQL through `Queryable`.
 * Two engines implement it:
 *
 * - `postgres` — any hosted PostgreSQL (Neon, Supabase, RDS, ...). Used whenever
 *   `DATABASE_URL` is present. Required in serverless environments such as Vercel,
 *   where the filesystem is read-only and ephemeral.
 * - `pglite` — an embedded PostgreSQL compiled to WASM. Used for local development
 *   and single-machine installs so `npm run dev` works with zero configuration.
 *
 * Both engines return the same shapes, so services and routes never branch on it.
 */
export type Queryable = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

export type DatabaseDriver = 'pglite' | 'postgres'

export type Database = Queryable & {
  readonly driver: DatabaseDriver
  exec(sql: string): Promise<void>
  close(): Promise<void>
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
}

const connectionString = process.env.DATABASE_URL?.trim()
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)

let engine: Database | null = null
let enginePromise: Promise<Database> | null = null
let initPromise: Promise<void> | null = null

function schemaPath(): string {
  const candidates = [
    path.join(projectRoot, 'server', 'schema.sql'),
    path.join(projectRoot, 'schema.sql'),
    path.join(projectRoot, 'dist', 'server', 'schema.sql'),
  ]
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) throw new Error('[db] schema.sql was not found. Run the server from the project root.')
  return found
}

function sslFor(url: string) {
  if (process.env.PGSSLMODE === 'disable' || /[?&]sslmode=disable/.test(url)) return undefined
  // Local PostgreSQL usually runs without TLS; hosted providers require it.
  if (/(^|@)(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url)) return undefined
  return { rejectUnauthorized: false }
}

async function createPostgresDatabase(url: string): Promise<Database> {
  const { default: pg } = await import('pg')

  // int8 (COUNT/nextval) as a JS number, and DATE as a plain `YYYY-MM-DD` string
  // so date-only values never shift by a day when the server timezone is UTC.
  pg.types.setTypeParser(20, (value) => Number(value))
  pg.types.setTypeParser(1082, (value) => value)

  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.PGPOOL_MAX || (isServerless ? 3 : 10)),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    ssl: sslFor(url),
  })

  pool.on('error', (error) => {
    console.error('[db] idle PostgreSQL client error', error.message)
  })

  return {
    driver: 'postgres',
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const result = await pool.query(sql, params as never[])
      return { rows: result.rows as T[] }
    },
    async exec(sql: string) {
      await pool.query(sql)
    },
    async close() {
      await pool.end()
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const tx: Queryable = {
          async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []) {
            const result = await client.query(sql, params as never[])
            return { rows: result.rows as R[] }
          },
        }
        const result = await fn(tx)
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },
  }
}

async function createPgliteDatabase(): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite')
  const dataPath = path.resolve(process.env.DATABASE_PATH || './data/alsheikh')
  fs.mkdirSync(path.dirname(dataPath), { recursive: true })
  const client = new PGlite(dataPath)
  await client.waitReady

  return {
    driver: 'pglite',
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const result = await client.query<T>(sql, params as never[])
      return { rows: result.rows }
    },
    async exec(sql: string) {
      await client.exec(sql)
    },
    async close() {
      await client.close()
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      return client.transaction(async (tx) => fn(tx as unknown as Queryable)) as Promise<T>
    },
  }
}

async function getEngine(): Promise<Database> {
  if (engine) return engine
  if (!enginePromise) {
    if (connectionString) {
      enginePromise = createPostgresDatabase(connectionString)
    } else if (isServerless) {
      throw new Error(
        '[db] DATABASE_URL is required in serverless environments. ' +
          'Create a PostgreSQL database (Neon or Supabase) and set DATABASE_URL before deploying.',
      )
    } else {
      enginePromise = createPgliteDatabase()
    }
  }
  engine = await enginePromise
  return engine
}

/**
 * Lazily initialised database handle. The underlying engine is only started on
 * the first query, which keeps CLI scripts and cold starts cheap.
 */
export const db: Database = {
  get driver(): DatabaseDriver {
    return connectionString ? 'postgres' : 'pglite'
  },
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const active = await getEngine()
    return active.query<T>(sql, params)
  },
  async exec(sql: string) {
    const active = await getEngine()
    await active.exec(sql)
  },
  async close() {
    if (engine) {
      await engine.close()
      engine = null
      enginePromise = null
    }
  },
  async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
    const active = await getEngine()
    return active.transaction(fn)
  },
}

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query<T>(sql, params)
  return result.rows
}

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params)
  return rows[0] ?? null
}

export async function transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return db.transaction(fn)
}

export async function nextSequence(name: string, runner: Queryable = db): Promise<number> {
  const result = await runner.query<{ value: string }>(`SELECT nextval($1::regclass) AS value`, [`${name}_seq`])
  return Number(result.rows[0]?.value ?? 1)
}

export function code(prefix: string, seq: number, width = 4): string {
  return `${prefix}-${String(seq).padStart(width, '0')}`
}

export const PERMISSIONS = [
  ['view_dashboard', 'Overview', 'View dashboard', 'عرض لوحة التحكم'],
  ['view_fleet', 'Fleet', 'View fleet', 'عرض الأسطول'],
  ['manage_fleet', 'Fleet', 'Manage fleet', 'إدارة الأسطول'],
  ['view_drivers', 'Drivers', 'View drivers', 'عرض السائقين'],
  ['manage_drivers', 'Drivers', 'Manage drivers', 'إدارة السائقين'],
  ['view_routes', 'Routes', 'View routes', 'عرض المسارات'],
  ['manage_routes', 'Routes', 'Manage routes', 'إدارة المسارات'],
  ['view_trips', 'Trips', 'View trips', 'عرض الرحلات'],
  ['manage_trips', 'Trips', 'Manage trips', 'إدارة الرحلات'],
  ['view_contracts', 'Contracts', 'View contracts', 'عرض العقود'],
  ['manage_contracts', 'Contracts', 'Manage contracts', 'إدارة العقود'],
  ['view_finance', 'Finance', 'View finance', 'عرض المالية'],
  ['manage_finance', 'Finance', 'Manage invoices & payments', 'إدارة الفواتير والمدفوعات'],
  ['view_expenses', 'Expenses', 'View expenses', 'عرض المصروفات'],
  ['manage_expenses', 'Expenses', 'Manage expenses', 'إدارة المصروفات'],
  ['view_maintenance', 'Maintenance', 'View maintenance', 'عرض الصيانة'],
  ['manage_maintenance', 'Maintenance', 'Manage maintenance', 'إدارة الصيانة'],
  ['view_reports', 'Reports', 'View reports', 'عرض التقارير'],
  ['export_reports', 'Reports', 'Export reports', 'تصدير التقارير'],
  ['view_users', 'Administration', 'View users', 'عرض المستخدمين'],
  ['manage_users', 'Administration', 'Manage users', 'إدارة المستخدمين'],
  ['view_settings', 'Administration', 'View settings', 'عرض الإعدادات'],
  ['manage_settings', 'Administration', 'Manage settings', 'إدارة الإعدادات'],
  ['view_audit', 'Administration', 'View audit log', 'عرض سجل التدقيق'],
  ['manage_notifications', 'Notifications', 'Manage notifications', 'إدارة الإشعارات'],
  ['view_driver_compensation', 'Sensitive', 'View driver compensation', 'عرض رواتب السائقين'],
  ['view_sensitive_finance', 'Sensitive', 'View sensitive financial details', 'عرض التفاصيل المالية الحساسة'],
] as const

const VIEWER_PERMISSIONS = [
  'view_dashboard',
  'view_fleet',
  'view_drivers',
  'view_routes',
  'view_trips',
  'view_contracts',
  'view_finance',
  'view_expenses',
  'view_maintenance',
  'view_reports',
  'export_reports',
  'view_settings',
]

const EXPENSE_CATEGORIES = [
  ['fuel', 'Fuel', 'وقود', true],
  ['driver_compensation', 'Driver compensation', 'بدل السائقين', true],
  ['maintenance', 'Maintenance', 'الصيانة', true],
  ['insurance', 'Insurance', 'التأمين', true],
  ['licensing', 'Licensing', 'التراخيص', true],
  ['operating_fees', 'Operating fees', 'رسوم التشغيل', true],
  ['administration', 'Administration', 'مصروفات إدارية', true],
  ['miscellaneous', 'Miscellaneous', 'متنوعة', true],
  ['acquisition', 'Vehicle acquisition', 'شراء مركبات', false],
  ['financing', 'Financing', 'التمويل', false],
  ['depreciation', 'Depreciation', 'الإهلاك', false],
] as const

/**
 * Creates the schema and the built-in rows exactly once per process. The promise
 * is cached so concurrent requests (and serverless cold starts) never run the
 * migration twice; a failure is retried on the next call.
 */
export function initializeDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const schema = fs.readFileSync(schemaPath(), 'utf8')
      await db.exec(schema)
      await seedBaseData()
    })().catch((error) => {
      initPromise = null
      throw error
    })
  }
  return initPromise
}

const isProductionRuntime = process.env.NODE_ENV === 'production'

/**
 * Local-development convenience passwords. Production never falls back to
 * these: the first administrator must be created with an explicit
 * `INITIAL_ADMIN_PASSWORD`, and the optional viewer with
 * `INITIAL_VIEWER_PASSWORD`.
 */
const DEV_ADMIN_PASSWORD = 'Admin@12345'
const DEV_VIEWER_PASSWORD = 'Viewer@12345'

function readInitialPassword(envKey: string): string | null {
  const value = process.env[envKey]
  return value && value.trim() ? value : null
}

/** Rejects weak bootstrap passwords so a fresh deployment cannot be guessed. */
function assertStrongPassword(envKey: string, password: string): string {
  const strong =
    password.length >= 12 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)

  if (!strong) {
    throw new Error(
      `[security] ${envKey} must be at least 12 characters and include upper-case, lower-case, a number and a symbol.`,
    )
  }
  return password
}

export async function seedBaseData() {
  const adminRoleId = 'role-admin'
  const viewerRoleId = 'role-viewer'

  await db.query(
    `INSERT INTO roles (id, key, name_en, name_ar, description) VALUES
      ($1, 'admin', 'Administrator', 'مدير النظام', 'Full access to operations, finance and administration'),
      ($2, 'viewer', 'Viewer', 'مشاهد', 'Read-only access to authorized operational information')
     ON CONFLICT (key) DO NOTHING`,
    [adminRoleId, viewerRoleId],
  )

  for (const [key, module, nameEn, nameAr] of PERMISSIONS) {
    const id = `perm-${key}`
    await db.query(
      `INSERT INTO permissions (id, key, module, name_en, name_ar)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO NOTHING`,
      [id, key, module, nameEn, nameAr],
    )
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [adminRoleId, id],
    )
    if (VIEWER_PERMISSIONS.includes(key)) {
      await db.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [viewerRoleId, id],
      )
    }
  }

  for (const [key, nameEn, nameAr, isOperating] of EXPENSE_CATEGORIES) {
    await db.query(
      `INSERT INTO expense_categories (id, key, name_en, name_ar, is_operating, is_system)
       VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (key) DO NOTHING`,
      [`cat-${key}`, key, nameEn, nameAr, isOperating],
    )
  }

  await db.query(
    `INSERT INTO business_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
  )

  // Idempotent Egypt migration for databases created before the locale correction.
  await db.query(
    `UPDATE users SET email = replace(email, '@alsheikh.sa', '@alsheikh.eg') WHERE email LIKE '%@alsheikh.sa'`,
  )
  await db.query(`UPDATE business_settings SET currency = 'EGP' WHERE currency = 'SAR'`)
  await db.query(`UPDATE business_settings SET timezone = 'Africa/Cairo' WHERE timezone = 'Asia/Riyadh'`)
  await db.query(`UPDATE business_settings SET vat_rate = 14 WHERE vat_rate = 0 OR vat_rate = 15`)

  const existingAdmin = await one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, ['admin@alsheikh.eg'])
  if (!existingAdmin) {
    const configuredAdminPassword = readInitialPassword('INITIAL_ADMIN_PASSWORD')

    if (!configuredAdminPassword && isProductionRuntime) {
      throw new Error(
        '[security] INITIAL_ADMIN_PASSWORD must be set to create the first administrator during production first-run. ' +
          'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(18).toString(\'base64url\'))"',
      )
    }

    const adminPassword = configuredAdminPassword
      ? isProductionRuntime
        ? assertStrongPassword('INITIAL_ADMIN_PASSWORD', configuredAdminPassword)
        : configuredAdminPassword
      : DEV_ADMIN_PASSWORD
    const passwordHash = await hash(adminPassword, 12)
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role_id, language, theme)
       VALUES ($1, $2, $3, $4, $5, 'en', 'dark')`,
      [randomUUID(), 'admin@alsheikh.eg', passwordHash, 'Office Administrator', adminRoleId],
    )
  }

  // The read-only account is optional in production: only create it when an
  // explicit password is supplied so deployments are not seeded with a known
  // default credential. Local development keeps both demo accounts.
  const existingViewer = await one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, ['viewer@alsheikh.eg'])
  if (!existingViewer) {
    const configuredViewerPassword = readInitialPassword('INITIAL_VIEWER_PASSWORD')

    if (!configuredViewerPassword && isProductionRuntime) {
      // No viewer account on this deployment; the administrator can add one later.
    } else {
      const viewerPassword = configuredViewerPassword
        ? isProductionRuntime
          ? assertStrongPassword('INITIAL_VIEWER_PASSWORD', configuredViewerPassword)
          : configuredViewerPassword
        : DEV_VIEWER_PASSWORD
      const passwordHash = await hash(viewerPassword, 12)
      await db.query(
        `INSERT INTO users (id, email, password_hash, full_name, role_id, language, theme)
         VALUES ($1, $2, $3, $4, $5, 'en', 'dark')`,
        [randomUUID(), 'viewer@alsheikh.eg', passwordHash, 'Operations Viewer', viewerRoleId],
      )
    }
  }

  await db.query(
    `INSERT INTO app_meta (key, value) VALUES ('schema_version', '1') ON CONFLICT (key) DO UPDATE SET value = '1'`,
  )
}
