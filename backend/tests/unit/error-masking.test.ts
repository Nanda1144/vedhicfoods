import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'

/**
 * The masking rules in `sendControllerError` are environment-dependent: in
 * production an unexpected failure must collapse to a generic message, while
 * development keeps the real message for debugging. The suite below therefore
 * pins `NODE_ENV=production` so the production branch is the one under test —
 * the default test environment would exercise the other branch and pass even
 * if the production mask were removed.
 */
vi.mock('../../src/config/env', async () => {
  const actual = await vi.importActual<typeof import('../../src/config/env')>('../../src/config/env')
  return {
    ...actual,
    env: { ...actual.env, NODE_ENV: 'production' },
  }
})

import { sendControllerError } from '../../src/utils/api-response'
import { AppError, UnauthorizedError, ServiceUnavailableError } from '../../src/utils/errors'
import { HTTP_STATUS, ERROR_CODES } from '../../src/constants'

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as Record<string, unknown> | undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: Record<string, unknown>) {
      this.body = payload
      return this
    },
  }
  return res as unknown as typeof res & { statusCode: number; body?: Record<string, unknown> }
}

describe('sendControllerError in production', () => {
  it('masks an infrastructure failure and returns 500', () => {
    const res = makeRes()
    const dbError = new Error(
      "Can't reach database server at `db.internal:5432`\nPlease make sure your database server is running at `db.internal:5432`."
    )

    sendControllerError(res, dbError, 'Failed to list inventory', 'req-1')

    expect(res.statusCode).toBe(500)
    expect(res.body?.error).toBe('Failed to list inventory')
    expect(res.body?.message).toBe('Failed to list inventory')
    expect(JSON.stringify(res.body)).not.toContain('db.internal')
    expect(JSON.stringify(res.body)).not.toContain('database server')
    expect(JSON.stringify(res.body)).not.toContain('    at ')
  })

  it('never forwards a stack trace', () => {
    const res = makeRes()
    sendControllerError(res, new Error('boom'), 'Something failed', 'req-1')
    expect(JSON.stringify(res.body)).not.toContain('stack')
    expect(JSON.stringify(res.body)).not.toContain('.ts:')
  })

  it('preserves the status and message of a typed operational error', () => {
    const res = makeRes()
    sendControllerError(res, new UnauthorizedError('Invalid email or password.'), 'fallback', 'req-1')

    expect(res.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED)
    expect(res.body?.error).toBe('Invalid email or password.')
  })

  it('withholds structured details from a typed error in production', () => {
    const res = makeRes()
    sendControllerError(res, new AppError('Nope', 400, ERROR_CODES.BAD_REQUEST, { sql: 'SELECT *' }), 'fallback', 'req-1')

    expect(res.statusCode).toBe(400)
    expect(res.body?.details).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain('SELECT')
  })

  it('maps a schema violation to 400 instead of 500', () => {
    const res = makeRes()
    const schema = z.object({ limit: z.coerce.number().int().min(1) })

    const parsed = schema.safeParse({ limit: 0 })
    expect(parsed.success).toBe(false)

    sendControllerError(res, (parsed as { error: z.ZodError }).error, 'Failed to list inventory', 'req-1')

    expect(res.statusCode).toBe(400)
    expect(res.body?.code).toBe(ERROR_CODES.VALIDATION_ERROR)
    expect(res.body?.success).toBe(false)
    expect(Array.isArray(res.body?.details)).toBe(true)
  })

  it('reports a service outage as 503 with a client-safe message', () => {
    const res = makeRes()
    sendControllerError(res, new ServiceUnavailableError(), 'fallback', 'req-1')

    expect(res.statusCode).toBe(503)
    expect(res.body?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE)
    expect(res.body?.success).toBe(false)
  })

  it('includes the request id so a caller can quote it to support', () => {
    const res = makeRes()
    sendControllerError(res, new Error('boom'), 'Something failed', 'abc-123')
    expect(res.body?.requestId).toBe('abc-123')
  })
})
