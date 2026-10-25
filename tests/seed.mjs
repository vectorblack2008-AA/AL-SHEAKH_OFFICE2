/**
 * Loads the demo dataset through the public API.
 *
 * The test suites mutate and reset the workspace, so `npm test` seeds before
 * each suite to keep the checks deterministic.
 */
const BASE = process.env.API_URL || 'http://localhost:3001/api'

async function main() {
  const loginResponse = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@alsheikh.eg', password: 'Admin@12345' }),
  })

  if (!loginResponse.ok) {
    console.error(`Seed failed: admin login returned ${loginResponse.status}`)
    return 1
  }

  const cookie = (loginResponse.headers.getSetCookie?.() || [])
    .map((value) => value.split(';')[0])
    .join('; ')

  const seedResponse = await fetch(`${BASE}/demo/seed`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: '{}',
  })

  if (seedResponse.ok) {
    console.log('PASS  demo data loaded')
    return 0
  }

  const body = await seedResponse.json().catch(() => ({}))
  if (seedResponse.status === 409 && body.code === 'DEMO_ALREADY_LOADED') {
    console.log('PASS  demo data already loaded')
    return 0
  }

  console.error(`Seed failed: ${seedResponse.status} ${JSON.stringify(body)}`)
  return 1
}

// Set the exit code instead of calling `process.exit()`: cutting the process off
// while fetch sockets are still closing trips a libuv assertion on Windows.
process.exitCode = await main()
