import './_safety'
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { env } from '../../src/config/env'

const app = createApp()

/** Values that must never appear in an HTTP response body. */
const SECRETS = [
  env.JWT_SECRET,
  env.ENCRYPTION_KEY,
  env.RAZORPAY_WEBHOOK_SECRET,
  env.RAZORPAY_KEY_SECRET,
  env.DATABASE_URL,
].filter((v): v is string => Boolean(v && v.length > 8))

function bodyText(res: request.Response): string {
  return typeof res.text === 'string' && res.text.length > 0 ? res.text : JSON.stringify(res.body ?? {})
}

describe('Foundation: health checks', () => {
  it('GET /api/v1/health returns a 200 liveness payload', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.status).toBe('healthy')
    expect(res.body.data.service).toBe('vedhicfoods-backend')
    expect(typeof res.body.data.uptimeSeconds).toBe('number')
  })

  it('GET /api/v1/health/ready reports database connectivity', async () => {
    const res = await request(app).get('/api/v1/health/ready')
    expect([200, 503]).toContain(res.status)
    expect(res.body.data.checks.database).toMatch(/connected|disconnected/)
    // Liveness must stay answerable even when a dependency is down: a
    // readiness body is still a well-formed success envelope.
    expect(res.body.success).toBe(true)
  })
})

describe('Foundation: request id tracing', () => {
  it('generates an x-request-id when the caller does not supply one', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.headers['x-request-id']).toBeTruthy()
  })

  it('echoes a caller-supplied x-request-id', async () => {
    const res = await request(app)
      .get('/api/v1/health')
      .set('x-request-id', 'trace-me-12345')
    expect(res.headers['x-request-id']).toBe('trace-me-12345')
  })
})

describe('Foundation: malformed JSON', () => {
  it('rejects a malformed JSON body with 400 and no stack trace', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ')

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(bodyText(res).toLowerCase()).toContain('malformed json')
    expect(bodyText(res)).not.toContain('node_modules')
    expect(bodyText(res)).not.toContain('    at ')
  })

  it('rejects a JSON body above the 1mb limit with 4xx', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.com', pad: 'x'.repeat(2 * 1024 * 1024) }))

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })
})

describe('Foundation: unknown routes and methods', () => {
  it('returns the standard error envelope for an unknown route', async () => {
    const res = await request(app).get('/api/v1/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body.code || res.body.error).toBeDefined()
    expect(bodyText(res)).not.toContain('node_modules')
    expect(bodyText(res)).not.toContain('    at ')
  })

  it('does not reflect the query string back in a 404 body', async () => {
    const res = await request(app).get('/api/v1/does-not-exist?token=deadbeefdeadbeef')
    expect(res.status).toBe(404)
    expect(bodyText(res)).not.toContain('deadbeefdeadbeef')
  })

  it('returns the standard error envelope for an unsupported method', async () => {
    const res = await request(app).delete('/api/v1/health')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })

  it('404s at the API root rather than serving a directory listing', async () => {
    const res = await request(app).get('/api/v1')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })
})

describe('Foundation: CORS', () => {
  it('allows a configured storefront origin', async () => {
    const res = await request(app)
      .options('/api/v1/health')
      .set('Origin', env.FRONTEND_URL)
      .set('Access-Control-Request-Method', 'GET')

    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe(env.FRONTEND_URL)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it('denies an origin that is not on the allowlist', async () => {
    const res = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example.attacker')

    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('permits same-origin / non-browser callers with no Origin header', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.status).toBe(200)
  })
})

describe('Foundation: rate limiting', () => {
  it('advertises standard rate-limit headers on /api responses', async () => {
    const res = await request(app).get('/api/v1/products?limit=1')
    expect(res.headers['ratelimit-limit'] || res.headers['ratelimit-policy']).toBeDefined()
  })

  it('exempts health probes from the shared rate-limit budget', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.status).toBe(200)
    // A skipped request is not counted, so no RateLimit headers are emitted.
    expect(res.headers['ratelimit-limit']).toBeUndefined()
  })
})

describe('Foundation: validation error status codes', () => {
  it('GET /api/v1/products maps an invalid query to 400, not 500', async () => {
    const res = await request(app).get('/api/v1/products?limit=0')
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('GET /api/v1/admin/inventory maps an invalid query to 400, not 500', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@vedhicfoods.com', password: 'Admin@Vedhic2026' })
    expect(login.status).toBe(200)
    const token = login.body.accessToken || login.body.token

    const res = await request(app)
      .get('/api/v1/admin/inventory?limit=0')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(bodyText(res)).not.toContain('node_modules')
    expect(bodyText(res)).not.toContain('ZodError')
  })

  it('POST /api/v1/admin/inventory/:id/adjust maps schema failures to 400', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@vedhicfoods.com', password: 'Admin@Vedhic2026' })
    const token = login.body.accessToken || login.body.token

    const res = await request(app)
      .post('/api/v1/admin/inventory/some-product/adjust')
      .set('Authorization', `Bearer ${token}`)
      .send({ operation: 'NOT_A_REAL_OPERATION', quantity: -5 })

    expect(res.status).toBe(400)
    expect(bodyText(res)).not.toContain('node_modules')
  })
})

describe('Foundation: authentication and authorization failures', () => {
  it('returns 401 with the standard envelope for a protected route', async () => {
    const res = await request(app).get('/api/v1/admin/inventory')
    expect(res.status).toBe(401)
    expect(res.body.success ?? res.body.error).toBeDefined()
    expect(bodyText(res)).not.toContain('node_modules')
    expect(bodyText(res)).not.toContain('    at ')
  })

  it('rejects a garbage bearer token without leaking verification internals', async () => {
    const res = await request(app)
      .get('/api/v1/admin/inventory')
      .set('Authorization', 'Bearer not.a.jwt')
    expect(res.status).toBe(401)
    expect(bodyText(res)).not.toContain('jwt')
    expect(bodyText(res)).not.toContain('node_modules')
  })

  it('rejects a refresh token replayed as a bearer credential', async () => {
    const register = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Foundation QA',
      email: `foundation.qa.${Date.now()}@vedhicfoods.com`,
      password: 'Foundation@2026pass',
    })
    expect(register.status).toBe(201)
    const refreshToken = register.body.refreshToken
    expect(refreshToken).toBeTruthy()

    const res = await request(app)
      .get('/api/v1/admin/inventory')
      .set('Authorization', `Bearer ${refreshToken}`)
    expect(res.status).toBe(401)
  })
})

describe('Foundation: secrets are never returned by the API', () => {
  it('health, settings and catalog payloads contain no configured secret', async () => {
    const responses = await Promise.all([
      request(app).get('/api/v1/health'),
      request(app).get('/api/v1/health/ready'),
      request(app).get('/api/v1/settings'),
      request(app).get('/api/v1/products?limit=5'),
      request(app).post('/api/v1/auth/login').send({ email: 'nobody@vedhicfoods.com', password: 'WrongPass123!' }),
      request(app).post('/api/v1/auth/forgot-password').send({ email: 'nobody@vedhicfoods.com' }),
    ])

    for (const res of responses) {
      const text = bodyText(res)
      for (const secret of SECRETS) {
        expect(text).not.toContain(secret)
      }
      expect(text).not.toContain('passwordHash')
      expect(text).not.toContain('AKIA')
      expect(text).not.toContain('    at ')
    }
  })
})
