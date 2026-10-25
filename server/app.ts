import express, { type NextFunction, type Request, type Response } from 'express'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import fs from 'node:fs'
import { q } from './db.js'
import { authRequired } from './auth.js'
import { ApiError } from './lib.js'
import { authRouter } from './routes/auth.js'
import { dashboardRouter } from './routes/dashboard.js'
import { fleetRouter } from './routes/fleet.js'
import { operationsRouter } from './routes/operations.js'
import { financeRouter } from './routes/finance.js'
import { reportsRouter } from './routes/reports.js'
import { adminRouter } from './routes/admin.js'

const projectRoot = process.cwd()
const isProduction = process.env.NODE_ENV === 'production'

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
].join('; ')

/**
 * Builds the Express application. Kept separate from the HTTP listener so the
 * exact same app can be started as a long-running server (local, Docker, Render)
 * or wrapped by a serverless runtime (Vercel).
 */
export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none')
    if (isProduction) res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    next()
  })

  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: false, limit: '1mb' }))
  app.use(cookieParser())

  // Financial data must never be cached by browsers, proxies or CDNs.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  app.get('/api/health', async (_req, res) => {
    try {
      await q(`SELECT 1`)
      res.json({ status: 'ok', database: 'connected', time: new Date().toISOString() })
    } catch (error) {
      res.status(503).json({
        status: 'degraded',
        database: 'unavailable',
        error: error instanceof Error ? error.message : 'Database unavailable',
      })
    }
  })

  app.use('/api/auth', authRouter)

  // Every operational endpoint requires an authenticated, active session.
  app.use('/api', authRequired)
  app.use('/api', dashboardRouter)
  app.use('/api', fleetRouter)
  app.use('/api', operationsRouter)
  app.use('/api', financeRouter)
  app.use('/api', reportsRouter)
  app.use('/api', adminRouter)

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Endpoint not found', code: 'NOT_FOUND' })
  })

  // Serve the production build. In development Vite serves the SPA on :5173.
  const distPath = path.join(projectRoot, 'dist')
  if (fs.existsSync(distPath)) {
    app.use('/assets', express.static(path.join(distPath, 'assets'), { maxAge: '1y', immutable: true }))
    app.use(express.static(distPath, { index: false, maxAge: '1h' }))
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } })
    })
  } else if (isProduction) {
    console.warn('[server] dist/ not found. Run `npm run build` before starting in production.')
  }

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: err.message, code: err.code, details: err.details })
    }
    if (err && typeof err === 'object' && 'type' in err) {
      const type = (err as { type?: string }).type
      if (type === 'entity.too.large') {
        return res.status(413).json({ error: 'The request payload is too large', code: 'PAYLOAD_TOO_LARGE' })
      }
      if (type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Malformed JSON body', code: 'INVALID_JSON' })
      }
    }
    const message = err instanceof Error ? err.message : 'Unexpected server error'
    // Unique constraint violations get a helpful, non-leaky response.
    if (/duplicate key value|unique constraint/i.test(message)) {
      return res
        .status(409)
        .json({ error: 'A record with the same unique value already exists', code: 'DUPLICATE' })
    }
    if (/foreign key constraint/i.test(message)) {
      return res.status(409).json({
        error: 'This record is referenced by other records and cannot be changed',
        code: 'CONSTRAINT',
      })
    }
    console.error(`[api] ${req.method} ${req.originalUrl}`, err)
    res.status(500).json({ error: 'An unexpected error occurred', code: 'INTERNAL_ERROR' })
  })

  return app
}
