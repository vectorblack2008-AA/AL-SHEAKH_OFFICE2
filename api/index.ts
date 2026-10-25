import type { IncomingMessage, ServerResponse } from 'node:http'
import { createApp } from '../server/app.js'
import { initializeDatabase } from '../server/db.js'

/**
 * Vercel serverless entry point.
 *
 * The Express app is reused across invocations of the same warm function, and
 * database initialisation is memoised so the schema is only applied once per
 * instance. Production deployments must provide `DATABASE_URL` pointing at a
 * hosted PostgreSQL database (Neon, Supabase, ...); the local PGlite engine
 * cannot persist data on a serverless filesystem.
 */
const app = createApp()

let ready: Promise<void> | null = null

function ensureReady(): Promise<void> {
  if (!ready) {
    ready = initializeDatabase().catch((error) => {
      ready = null
      throw error
    })
  }
  return ready
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ensureReady()

  // The rewrite in vercel.json forwards the original path as `__path` because a
  // serverless invocation does not always preserve the request URL. Rebuild the
  // Express path from it, falling back to the URL that arrived.
  const requestUrl = req.url || '/'
  const parsed = new URL(requestUrl, 'http://localhost')
  const forwardedPath = parsed.searchParams.get('__path')
  if (forwardedPath !== null) {
    parsed.searchParams.delete('__path')
    const query = parsed.searchParams.toString()
    req.url = `/api/${forwardedPath.replace(/^\/+/, '')}${query ? `?${query}` : ''}`
  } else if (!requestUrl.startsWith('/api')) {
    req.url = `/api${requestUrl.startsWith('/') ? '' : '/'}${requestUrl}`
  }

  return (app as unknown as (request: IncomingMessage, response: ServerResponse) => void)(req, res)
}
