// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ADMIN_SESSION_EXPIRED_EVENT,
  clearAdminSession,
  hasAdminSession,
  persistAdminSession,
} from '@/services/adminSessionStore'
import { apiFetchRaw } from '@/services/http'
import type { AdminSession } from '@/services/adminAuthService'

/**
 * A 400 from `/admin/auth/refresh` means the request carried no usable refresh
 * credential ("Refresh token is required"). That is unrecoverable, so the
 * session must be cleared and the original request must reject instead of
 * bouncing between the original 401 and a refresh that can never succeed.
 */

const SESSION: AdminSession = {
  id: 'usr_1',
  name: 'Vedhic Krishnan',
  email: 'vedhic@vedhifoods.example',
  role: 'owner',
  title: 'Owner',
  permissions: [],
  token: 'opaque-access-token',
  remember: true,
  signedInAt: new Date(0).toISOString(),
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('admin session refresh rejection', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clearAdminSession()
    persistAdminSession(SESSION, true)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    clearAdminSession()
    vi.unstubAllGlobals()
  })

  it('clears the session and rejects the original 401 when refresh returns 400', async () => {
    const expired = vi.fn()
    window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, expired)

    try {
      fetchMock
        .mockResolvedValueOnce(response(401, { error: 'Unauthorized' }))
        .mockResolvedValueOnce(response(400, { error: 'Refresh token is required' }))

      await expect(apiFetchRaw('/admin/promotions')).rejects.toMatchObject({ code: '401' })

      // Original request + exactly one refresh attempt: no retry loop.
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/admin/promotions')
      expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/admin/auth/refresh')

      expect(hasAdminSession()).toBe(false)
      expect(expired).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, expired)
    }
  })
})
