import type { Request, Response } from 'express'
import { env } from '../config/env'

export type RefreshCookieName = 'refreshToken' | 'adminRefreshToken'

const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function cookiePath(name: RefreshCookieName): string {
  return name === 'adminRefreshToken' ? '/api/v1/admin/auth' : '/api/v1/auth'
}

function secureAttribute(): string {
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test' ? '' : '; Secure'
}

export function readCookie(req: Request, name: RefreshCookieName): string | null {
  const header = req.headers.cookie
  if (!header) return null

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    const value = part.slice(separator + 1).trim()
    try {
      return decodeURIComponent(value) || null
    } catch {
      return null
    }
  }
  return null
}

export function setRefreshCookie(res: Response, name: RefreshCookieName, token: string): void {
  const secure = secureAttribute()
  res.append(
    'Set-Cookie',
    `${name}=${encodeURIComponent(token)}; Path=${cookiePath(name)}; Max-Age=${COOKIE_MAX_AGE_MS / 1000}; HttpOnly; SameSite=Strict${secure}`,
  )
}

export function clearRefreshCookie(res: Response, name: RefreshCookieName): void {
  const secure = secureAttribute()
  res.append('Set-Cookie', `${name}=; Path=${cookiePath(name)}; Max-Age=0; HttpOnly; SameSite=Strict${secure}`)
}

/** A refresh cookie may only be used by the SPA that owns that cookie. */
export function hasTrustedOrigin(req: Request, cookieName: RefreshCookieName): boolean {
  const origin = req.get('Origin')
  if (!origin) return false

  const adminCookie = cookieName === 'adminRefreshToken'
  const allowed = [adminCookie ? env.ADMIN_FRONTEND_URL : env.FRONTEND_URL]
    .map((value) => String(value || '').trim().replace(/\/$/, ''))
    .filter(Boolean)

  if (env.NODE_ENV !== 'production') {
    allowed.push(...(adminCookie
      ? ['http://localhost:5174', 'http://127.0.0.1:5174']
      : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173']))
  }

  return allowed.includes(origin)
}
