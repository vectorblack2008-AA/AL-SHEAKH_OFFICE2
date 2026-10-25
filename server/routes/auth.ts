import { Router } from 'express'
import { compare } from 'bcryptjs'
import { z } from 'zod'
import { authRequired, clearSessionCookie, loadAuthUser, setSessionCookie, signToken } from '../auth.js'
import { one, q } from '../db.js'
import { ApiError, asyncHandler, audit, parseBody } from '../lib.js'

export const authRouter = Router()

const LOGIN_WINDOW_MS = 10 * 60_000
const LOGIN_MAX_ATTEMPTS = 8
const LOGIN_MAX_ATTEMPTS_PER_IP = 30

type LoginAttempt = { count: number; resetAt: number }

const loginAttempts = new Map<string, LoginAttempt>()
let lastSweep = 0

/**
 * In-memory throttle. It intentionally stores nothing in the database, and the
 * map is swept on write so a long-running process cannot grow it without bound.
 * Deployments with many instances should also rate limit at the edge.
 */
function sweepAttempts(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, attempt] of loginAttempts) {
    if (attempt.resetAt <= now) loginAttempts.delete(key)
  }
}

function attemptKeys(ip: string | undefined, email: string): string[] {
  const address = ip || 'local'
  return [`ip:${address}`, `email:${address}:${email.toLowerCase()}`]
}

function isRateLimited(keys: string[], now: number): boolean {
  return keys.some((key) => {
    const attempt = loginAttempts.get(key)
    if (!attempt || attempt.resetAt <= now) return false
    return attempt.count >= (key.startsWith('ip:') ? LOGIN_MAX_ATTEMPTS_PER_IP : LOGIN_MAX_ATTEMPTS)
  })
}

function recordFailure(keys: string[], now: number) {
  for (const key of keys) {
    const current = loginAttempts.get(key)
    const active = current && current.resetAt > now
    loginAttempts.set(key, {
      count: active ? current.count + 1 : 1,
      resetAt: active ? current.resetAt : now + LOGIN_WINDOW_MS,
    })
  }
}

authRouter.get(
  '/public/config',
  asyncHandler(async (_req, res) => {
    const settings = await one<{
      company_name_en: string
      company_name_ar: string
      logo_url: string | null
      demo_mode: boolean
      currency: string
    }>(
      `SELECT company_name_en, company_name_ar, logo_url, demo_mode, currency FROM business_settings WHERE id = 1`,
    )
    res.json({
      companyNameEn: settings?.company_name_en ?? 'Al-Sheikh Office',
      companyNameAr: settings?.company_name_ar ?? 'مكتب الشيخ',
      logoUrl: settings?.logo_url ?? null,
      demoMode: settings?.demo_mode ?? false,
      currency: settings?.currency ?? 'EGP',
      showDemoCredentials: process.env.NODE_ENV !== 'production',
    })
  }),
)

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        email: z.string().email().max(200),
        password: z.string().min(1).max(200),
      }),
      req.body,
    )
    const now = Date.now()
    sweepAttempts(now)
    const keys = attemptKeys(req.ip, body.email)
    if (isRateLimited(keys, now)) {
      throw new ApiError(429, 'Too many login attempts. Try again in a few minutes.', 'RATE_LIMITED')
    }

    const user = await one<{
      id: string
      email: string
      password_hash: string
      is_active: boolean
      full_name: string
      role_key: string
    }>(
      `SELECT u.id, u.email, u.password_hash, u.is_active, u.full_name, r.key AS role_key
       FROM users u JOIN roles r ON r.id = u.role_id WHERE lower(u.email) = lower($1)`,
      [body.email],
    )
    if (!user || !(await compare(body.password, user.password_hash))) {
      recordFailure(keys, now)
      throw new ApiError(401, 'Invalid email or password', 'INVALID_CREDENTIALS')
    }
    if (!user.is_active) throw new ApiError(403, 'This account has been deactivated', 'ACCOUNT_DISABLED')

    for (const key of keys) loginAttempts.delete(key)
    await q(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id])
    const authUser = await loadAuthUser(user.id)
    if (!authUser) throw new ApiError(403, 'This account is unavailable', 'ACCOUNT_DISABLED')
    const token = signToken(user.id)
    setSessionCookie(res, token)
    req.user = authUser
    await audit(req, 'login', 'user', user.id, null, { email: user.email, role: user.role_key })
    res.json({ user: authUser })
  }),
)

authRouter.post(
  '/logout',
  authRequired,
  asyncHandler(async (req, res) => {
    await audit(req, 'logout', 'user', req.user?.id ?? null, null, null)
    clearSessionCookie(res)
    res.json({ ok: true })
  }),
)

authRouter.get(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user })
  }),
)

authRouter.patch(
  '/preferences',
  authRequired,
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        language: z.enum(['en', 'ar']).optional(),
        theme: z.enum(['dark', 'light']).optional(),
      }),
      req.body,
    )
    if (!body.language && !body.theme) throw new ApiError(400, 'No preferences supplied', 'VALIDATION_ERROR')
    await q(
      `UPDATE users SET language = COALESCE($2, language), theme = COALESCE($3, theme) WHERE id = $1`,
      [req.user!.id, body.language ?? null, body.theme ?? null],
    )
    const user = await loadAuthUser(req.user!.id)
    res.json({ user })
  }),
)
