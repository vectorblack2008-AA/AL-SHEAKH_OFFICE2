/**
 * Verifies the hosted-PostgreSQL code path without a PostgreSQL installation.
 *
 * PGlite is exposed over the PostgreSQL wire protocol on a local port and the
 * API is started with DATABASE_URL pointing at it, so the `pg` driver, its
 * transaction handling and the schema bootstrapping are all exercised for real.
 *
 * Usage (temporary check, not part of `npm test`):
 *   node tests/postgres-driver.mjs
 */
import { spawn } from 'node:child_process'
import { PGlite } from '@electric-sql/pglite'

const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket')

const PORT = 54329
const API_PORT = 3002
const base = `http://localhost:${API_PORT}`

const memory = new PGlite()
const server = new PGLiteSocketServer({ db: memory, port: PORT, host: '127.0.0.1' })
await server.start()
console.log(`socket server ready on ${PORT}`)

const child = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
  env: {
    ...process.env,
    PORT: String(API_PORT),
    NODE_ENV: 'production',
    JWT_SECRET: 'postgres-driver-verification-secret-0123456789',
    // Production first-run requires an explicit, strong bootstrap password.
    INITIAL_ADMIN_PASSWORD: 'PostgresDriver@2026!',
    DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres?sslmode=disable`,
    // The PGlite socket harness serialises connections; a real server does not.
    PGPOOL_MAX: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

child.stdout.on('data', (chunk) => process.stdout.write(`[api] ${chunk}`))
child.stderr.on('data', (chunk) => process.stderr.write(`[api] ${chunk}`))

let exitCode = 1
try {
  let health = null
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`)
      health = await response.json()
      if (health.status === 'ok') break
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  console.log('health:', health)
  if (health?.status !== 'ok') throw new Error('API did not become healthy')

  const info = await (await fetch(`${base}/api/auth/public/config`)).json()
  console.log('public config:', info.companyNameEn, info.currency)

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@alsheikh.eg', password: 'PostgresDriver@2026!' }),
  })
  console.log('login status:', login.status)
  if (login.status !== 200) throw new Error('Login failed on the pg driver')

  const cookie = login.headers.getSetCookie()[0].split(';')[0]
  const seed = await fetch(`${base}/api/demo/seed`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: '{}',
  })
  console.log('seed status:', seed.status)
  if (seed.status !== 201) throw new Error(`Seeding failed: ${await seed.text()}`)

  const dashboard = await (
    await fetch(`${base}/api/dashboard?from=2026-07-01&to=2026-10-31`, { headers: { cookie } })
  ).json()
  console.log('dashboard revenue:', dashboard.kpis.recognizedRevenue, 'trips:', dashboard.kpis.totalTrips)

  const trips = await (await fetch(`${base}/api/trips?pageSize=5`, { headers: { cookie } })).json()
  console.log('trips listed:', trips.total)

  if (!(dashboard.kpis.totalTrips > 0) || !(trips.total > 0)) {
    throw new Error('No demo records were created on the pg driver')
  }

  console.log('\nPASS  hosted PostgreSQL driver path verified')
  exitCode = 0
} catch (error) {
  console.error('\nFAIL ', error.message)
} finally {
  child.kill()
  await new Promise((resolve) => setTimeout(resolve, 500))
  await server.stop()
  await memory.close()
  process.exit(exitCode)
}
