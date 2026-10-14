import { describe, it, expect, vi } from 'vitest'

/**
 * Regression coverage for the rate-limiter's behaviour when the shared Redis
 * store is unreachable.
 *
 * The node-redis client queues commands issued while it is reconnecting and
 * never settles them, so before the command timeout was added a dead Redis left
 * `store.increment()` pending forever: every request to `/api/*` hung until the
 * HTTP server tore the socket down, and the health probe hung with it.
 *
 * `REDIS_URL` is pointed at a closed local port for this file so the failure
 * path is exercised against a genuinely unreachable endpoint.
 */
vi.mock('../../src/config/env', async () => {
  const actual = await vi.importActual<typeof import('../../src/config/env')>('../../src/config/env')
  return {
    ...actual,
    env: {
      ...actual.env,
      NODE_ENV: 'test',
      REDIS_URL: 'redis://127.0.0.1:6399',
    },
  }
})

import { apiRateLimiter, rateLimitStoreHealth } from '../../src/middleware/rate-limiter.middleware'
import { ServiceUnavailableError } from '../../src/utils/errors'

function buildRequest(url: string) {
  return {
    method: 'GET',
    url,
    originalUrl: url,
    headers: {} as Record<string, string>,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    app: { get: () => false },
    get(name: string) {
      return this.headers[name.toLowerCase()]
    },
  } as any
}

function buildResponse() {
  return {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    setHeader: () => undefined,
    getHeader: () => undefined,
    on: () => undefined,
  } as any
}

function runLimiter(url: string): Promise<unknown> {
  return new Promise(resolve => {
    apiRateLimiter(buildRequest(url), buildResponse(), (error?: unknown) => resolve(error))
  })
}

describe('Rate limiter resilience against an unreachable Redis store', () => {
  it('answers within the command timeout instead of hanging forever', async () => {
    const started = Date.now()
    const error = await Promise.race([
      runLimiter('/api/v1/products'),
      new Promise<'hang'>(resolve => setTimeout(() => resolve('hang'), 5000)),
    ])
    const elapsed = Date.now() - started

    expect(error).not.toBe('hang')
    expect(elapsed).toBeLessThan(4000)
  }, 10000)

  it('fails closed with a typed 503 rather than a raw driver error', async () => {
    const error = (await runLimiter('/api/v1/products')) as ServiceUnavailableError

    expect(error).toBeInstanceOf(ServiceUnavailableError)
    expect(error.statusCode).toBe(503)
    expect(error.isOperational).toBe(true)
    expect(error.message).not.toContain('ECONNREFUSED')
    expect(error.message).not.toContain('127.0.0.1')
    expect(error.stack ?? '').not.toContain('sendCommand')
  }, 10000)

  it('skips health probes so liveness stays answerable during the outage', async () => {
    const error = await runLimiter('/api/v1/health')
    expect(error).toBeUndefined()
  }, 10000)

  it('reports the store as disconnected for the readiness probe', async () => {
    await runLimiter('/api/v1/products')
    expect(rateLimitStoreHealth()).toBe('disconnected')
  }, 10000)
})
