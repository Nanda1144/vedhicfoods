import type { Request, Response } from 'express'
import { describe, expect, it } from 'vitest'
import { env } from '../../src/config/env'
import { clearRefreshCookie, hasTrustedOrigin, setRefreshCookie } from '../../src/utils/auth-cookie'

function requestWithOrigin(origin: string): Request {
  return { get: (name: string) => name.toLowerCase() === 'origin' ? origin : undefined } as unknown as Request
}

function responseCapturingCookies(): { res: Response; cookies: string[] } {
  const cookies: string[] = []
  const res = {
    append: (name: string, value: string) => {
      if (name.toLowerCase() === 'set-cookie') cookies.push(value)
    },
  } as unknown as Response
  return { res, cookies }
}

describe('refresh-cookie origin isolation', () => {
  it('allows the admin SPA to refresh its own cookie', () => {
    expect(hasTrustedOrigin(requestWithOrigin('http://localhost:5174'), 'adminRefreshToken')).toBe(true)
  })

  it('does not let the storefront origin mint an admin access token', () => {
    expect(hasTrustedOrigin(requestWithOrigin('http://localhost:5173'), 'adminRefreshToken')).toBe(false)
  })

  it('does not let the admin origin refresh the customer cookie', () => {
    expect(hasTrustedOrigin(requestWithOrigin('http://localhost:5174'), 'refreshToken')).toBe(false)
  })
})

describe('refresh-cookie attributes', () => {
  it('sets strict, non-secure cookies with the owning path outside production', () => {
    const admin = responseCapturingCookies()
    setRefreshCookie(admin.res, 'adminRefreshToken', 'admin-token')

    expect(admin.cookies).toHaveLength(1)
    expect(admin.cookies[0]).toContain('adminRefreshToken=admin-token')
    expect(admin.cookies[0]).toContain('Path=/api/v1/admin/auth')
    expect(admin.cookies[0]).toContain('HttpOnly')
    expect(admin.cookies[0]).toContain('SameSite=Strict')
    expect(admin.cookies[0]).not.toMatch(/;\s*Secure/i)

    const customer = responseCapturingCookies()
    setRefreshCookie(customer.res, 'refreshToken', 'customer-token')

    expect(customer.cookies).toHaveLength(1)
    expect(customer.cookies[0]).toContain('refreshToken=customer-token')
    expect(customer.cookies[0]).toContain('Path=/api/v1/auth')
    expect(customer.cookies[0]).toContain('HttpOnly')
    expect(customer.cookies[0]).toContain('SameSite=Strict')
    expect(customer.cookies[0]).not.toMatch(/;\s*Secure/i)
  })

  it('clears cookies with Max-Age=0, the owning path and the same SameSite policy', () => {
    const admin = responseCapturingCookies()
    clearRefreshCookie(admin.res, 'adminRefreshToken')

    expect(admin.cookies).toHaveLength(1)
    expect(admin.cookies[0]).toContain('adminRefreshToken=;')
    expect(admin.cookies[0]).toContain('Path=/api/v1/admin/auth')
    expect(admin.cookies[0]).toContain('Max-Age=0')
    expect(admin.cookies[0]).toContain('HttpOnly')
    expect(admin.cookies[0]).toContain('SameSite=Strict')
    expect(admin.cookies[0]).not.toMatch(/;\s*Secure/i)

    const customer = responseCapturingCookies()
    clearRefreshCookie(customer.res, 'refreshToken')

    expect(customer.cookies).toHaveLength(1)
    expect(customer.cookies[0]).toContain('refreshToken=;')
    expect(customer.cookies[0]).toContain('Path=/api/v1/auth')
    expect(customer.cookies[0]).toContain('Max-Age=0')
    expect(customer.cookies[0]).toContain('HttpOnly')
    expect(customer.cookies[0]).toContain('SameSite=Strict')
    expect(customer.cookies[0]).not.toMatch(/;\s*Secure/i)
  })

  it('sets cross-site cookies with SameSite=None, Secure and HttpOnly in production', () => {
    const mutableEnv = env as unknown as { NODE_ENV: string }
    const originalNodeEnv = mutableEnv.NODE_ENV

    try {
      mutableEnv.NODE_ENV = 'production'

      const admin = responseCapturingCookies()
      setRefreshCookie(admin.res, 'adminRefreshToken', 'admin-token')

      expect(admin.cookies).toHaveLength(1)
      expect(admin.cookies[0]).toContain('adminRefreshToken=admin-token')
      expect(admin.cookies[0]).toContain('Path=/api/v1/admin/auth')
      expect(admin.cookies[0]).toContain('SameSite=None')
      expect(admin.cookies[0]).toContain('; Secure')
      expect(admin.cookies[0]).toContain('HttpOnly')

      const customer = responseCapturingCookies()
      setRefreshCookie(customer.res, 'refreshToken', 'customer-token')

      expect(customer.cookies).toHaveLength(1)
      expect(customer.cookies[0]).toContain('refreshToken=customer-token')
      expect(customer.cookies[0]).toContain('Path=/api/v1/auth')
      expect(customer.cookies[0]).toContain('SameSite=None')
      expect(customer.cookies[0]).toContain('; Secure')
      expect(customer.cookies[0]).toContain('HttpOnly')

      const cleared = responseCapturingCookies()
      clearRefreshCookie(cleared.res, 'adminRefreshToken')

      expect(cleared.cookies).toHaveLength(1)
      expect(cleared.cookies[0]).toContain('Max-Age=0')
      expect(cleared.cookies[0]).toContain('SameSite=None')
      expect(cleared.cookies[0]).toContain('; Secure')
      expect(cleared.cookies[0]).toContain('HttpOnly')
    } finally {
      mutableEnv.NODE_ENV = originalNodeEnv
    }
  })
})
