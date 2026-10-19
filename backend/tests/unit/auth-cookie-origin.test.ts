import type { Request } from 'express'
import { describe, expect, it } from 'vitest'
import { hasTrustedOrigin } from '../../src/utils/auth-cookie'

function requestWithOrigin(origin: string): Request {
  return { get: (name: string) => name.toLowerCase() === 'origin' ? origin : undefined } as unknown as Request
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
