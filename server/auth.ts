import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { one, q } from './db.js'

export interface AuthUser {
  id: string
  email: string
  full_name: string
  role_id: string
  role_key: 'admin' | 'viewer' | string
  language: 'en' | 'ar'
  theme: 'dark' | 'light'
  permissions: string[]
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

const COOKIE_NAME = 'alsheikh_session'
const DEV_SECRET = 'al-sheikh-office-local-dev-secret-change-me'
const JWT_SECRET = process.env.JWT_SECRET?.trim() || (process.env.NODE_ENV === 'production' ? '' : DEV_SECRET)
const TOKEN_TTL = '14d'

if (!JWT_SECRET) {
  throw new Error(
    '[security] JWT_SECRET must be set in production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
  )
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: TOKEN_TTL })
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 14 * 24 * 60 * 60 * 1000,
    path: '/',
  })
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/' })
}

async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const user = await one<{
    id: string
    email: string
    full_name: string
    role_id: string
    role_key: string
    language: 'en' | 'ar'
    theme: 'dark' | 'light'
    is_active: boolean
  }>(
    `SELECT u.id, u.email, u.full_name, u.role_id, r.key AS role_key, u.language, u.theme, u.is_active
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [userId],
  )
  if (!user || !user.is_active) return null

  const base = await q<{ key: string }>(
    `SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`,
    [user.role_id],
  )
  const overrides = await q<{ key: string; effect: 'allow' | 'deny' }>(
    `SELECT p.key, up.effect FROM user_permissions up
     JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = $1`,
    [user.id],
  )
  const set = new Set(base.map((row) => row.key))
  for (const row of overrides) {
    if (row.effect === 'allow') set.add(row.key)
    else set.delete(row.key)
  }

  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role_id: user.role_id,
    role_key: user.role_key,
    language: user.language,
    theme: user.theme,
    permissions: [...set],
  }
}

export async function authRequired(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE_NAME] || req.headers.authorization?.replace(/^Bearer\s+/i, '')
    if (!token) return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' })
    const payload = jwt.verify(token, JWT_SECRET) as { sub?: string }
    if (!payload.sub) return res.status(401).json({ error: 'Invalid session', code: 'AUTH_INVALID' })
    const user = await loadAuthUser(payload.sub)
    if (!user) return res.status(401).json({ error: 'Session is no longer valid', code: 'AUTH_INVALID' })
    req.user = user
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session', code: 'AUTH_INVALID' })
  }
}

export function can(user: AuthUser | undefined, permission: string): boolean {
  return Boolean(user?.permissions.includes(permission))
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' })
    if (!can(req.user, permission)) {
      return res.status(403).json({
        error: 'You do not have permission to perform this action',
        code: 'FORBIDDEN',
        permission,
      })
    }
    next()
  }
}

export { COOKIE_NAME, loadAuthUser }
