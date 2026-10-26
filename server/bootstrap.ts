import { db, initializeDatabase } from './db.js'
import { setBusinessTimezone } from './lib.js'

/**
 * Shared runtime bootstrap for both the long-running server and the Vercel
 * serverless function.
 *
 * `initializeDatabase()` applies the schema and base rows once per process. The
 * workspace timezone lives in the database, so it must be loaded after the
 * schema exists and kept in sync by the settings endpoint afterwards.
 */
let ready: Promise<void> | null = null

export function ensureRuntime(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await initializeDatabase()
      const settings = await db.query<{ timezone: string }>(
        `SELECT timezone FROM business_settings WHERE id = 1`,
      )
      setBusinessTimezone(settings.rows[0]?.timezone)
    })().catch((error) => {
      ready = null
      throw error
    })
  }
  return ready
}
