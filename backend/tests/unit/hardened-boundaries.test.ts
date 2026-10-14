/**
 * Security Regression Tests — hardened boundaries
 *
 * Each test maps to a specific finding fixed during the audit. These are
 * deliberately DB-free so they run in CI without a live PostgreSQL: they cover
 * the pure logic where the vulnerability lived (byte inspection, key
 * derivation, token validation, secret detection, error masking).
 *
 * Route-level authorization for invoice/reconciliation/order endpoints is
 * covered separately in the integration suite, which needs a real database.
 */

import crypto from 'crypto'
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'

import { S3Service } from '../../src/integrations/aws/s3/s3.service'
import { AuthService } from '../../src/services/auth.service'
import { sendControllerError } from '../../src/utils/api-response'
import { getRawBody, requiresRawBody } from '../../src/utils/raw-body'
import { INSECURE_PLACEHOLDER_SECRETS, env } from '../../src/config/env'
import { AppError, BadRequestError } from '../../src/utils/errors'
import { RoleName } from '@prisma/client'

// Minimal response double — sendControllerError only touches status()/json().
function mockRes() {
  const state: { statusCode?: number; body?: any } = {}
  return {
    state,
    status(code: number) {
      state.statusCode = code
      return this
    },
    json(payload: any) {
      state.body = payload
      return this
    },
  } as any
}

// ============================================================
// 1. S3 — magic-byte inspection must fail closed
// ============================================================

describe('S3Service.assertRealImageBytes', () => {
  it('accepts a genuine PNG signature', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
    expect(() => S3Service.assertRealImageBytes('image/png', png)).not.toThrow()
  })

  it('accepts a genuine JPEG signature', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(() => S3Service.assertRealImageBytes('image/jpeg', jpeg)).not.toThrow()
  })

  it('accepts a WebP signature at its non-zero offset', () => {
    const webp = Buffer.concat([
      Buffer.from([0x52, 0x49, 0x46, 0x46]), // "RIFF"
      Buffer.from([0x1a, 0x00, 0x00, 0x00]), // length
      Buffer.from([0x57, 0x45, 0x42, 0x50]), // "WEBP" at offset 8
    ])
    expect(() => S3Service.assertRealImageBytes('image/webp', webp)).not.toThrow()
  })

  it('accepts a PDF header for the invoice document path', () => {
    const pdf = Buffer.from('%PDF-1.7\n%....\n', 'ascii')
    expect(() => S3Service.assertRealImageBytes('application/pdf', pdf)).not.toThrow()
  })

  it('rejects an HTML payload declared as image/png', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>', 'utf-8')
    expect(() => S3Service.assertRealImageBytes('image/png', html)).toThrow(
      /do not match the declared file type/i
    )
  })

  it('rejects an SVG declared as image/png (stored XSS vector)', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
    expect(() => S3Service.assertRealImageBytes('image/png', svg)).toThrow()
  })

  it('rejects an executable disguised as image/jpeg', () => {
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01])
    expect(() => S3Service.assertRealImageBytes('image/jpeg', elf)).toThrow()
  })

  it('rejects an empty body rather than treating it as valid', () => {
    expect(() => S3Service.assertRealImageBytes('image/png', Buffer.alloc(0))).toThrow(/empty/i)
  })

  it('rejects a truncated buffer that cannot carry the signature', () => {
    expect(() => S3Service.assertRealImageBytes('image/png', Buffer.from([0x89]))).toThrow(
      /truncated/i
    )
  })

  // Regression: the previous implementation wrapped the whole check in
  // `if (buf.length <= MAX_FILE_SIZE)`, so an oversized buffer skipped
  // validation entirely.
  it('does not skip validation for buffers over the size limit', () => {
    const oversizedHtml = Buffer.concat([
      Buffer.from('<html><script>alert(1)</script>'),
      Buffer.alloc(6 * 1024 * 1024),
    ])
    expect(() => S3Service.assertRealImageBytes('image/png', oversizedHtml)).toThrow()
  })
})

// ============================================================
// 2. S3 — object key extension must come from the MIME type
// ============================================================

describe('S3Service.generateProductImageKey', () => {
  it('derives the extension from the validated MIME type, not the filename', () => {
    const key = S3Service.generateProductImageKey('prod-1', 'image/png')
    expect(key).toMatch(/^products\/prod-1\/\d+-[0-9a-f-]{36}\.png$/)
  })

  it('refuses a type outside the allow-list, so no .html/.svg key can be minted', () => {
    expect(() => S3Service.generateProductImageKey('prod-1', 'image/svg+xml')).toThrow()
    expect(() => S3Service.generateProductImageKey('prod-1', 'text/html')).toThrow()
    expect(() => S3Service.generateProductImageKey('prod-1', 'application/x-msdownload')).toThrow()
  })

  it('cannot be used to traverse out of the products/ prefix', () => {
    const key = S3Service.generateProductImageKey('../../etc', 'image/png')
    expect(key.startsWith('products/')).toBe(true)
    expect(key).not.toContain('..')
  })

  it('mints unique keys for repeated uploads of the same product', () => {
    const a = S3Service.generateProductImageKey('prod-1', 'image/png')
    const b = S3Service.generateProductImageKey('prod-1', 'image/png')
    expect(a).not.toBe(b)
  })
})

// ============================================================
// 3. S3 — invoice PDFs must remain uploadable
// ============================================================

describe('S3Service.validateDocument', () => {
  it('accepts application/pdf', () => {
    expect(() => S3Service.validateDocument('application/pdf', 1024)).not.toThrow()
  })

  it('rejects non-PDF documents', () => {
    expect(() => S3Service.validateDocument('text/html', 1024)).toThrow()
    expect(() => S3Service.validateDocument('image/png', 1024)).toThrow()
  })

  it('rejects an oversized document', () => {
    expect(() => S3Service.validateDocument('application/pdf', 6 * 1024 * 1024)).toThrow()
  })
})

// ============================================================
// 4. JWT — algorithm pinning and token-type separation
// ============================================================

describe('AuthService.generateAccessToken', () => {
  const user = {
    id: 'user-1',
    email: 'user@example.com',
    role: RoleName.CUSTOMER,
    roles: [RoleName.CUSTOMER],
    permissions: ['orders.read'],
  }

  it('marks the token as an access token', () => {
    const token = AuthService.generateAccessToken(user)
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf-8'))
    expect(payload.tokenType).toBe('access')
    expect(payload.userId).toBe('user-1')
  })

  it('signs with HS256 only', () => {
    const token = AuthService.generateAccessToken(user)
    expect(JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf-8')).alg).toBe(
      'HS256'
    )
  })

  it('never embeds the password hash or any secret', () => {
    const token = AuthService.generateAccessToken(user)
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf-8'))
    expect(payload).not.toHaveProperty('passwordHash')
    expect(payload).not.toHaveProperty('password')
  })
})

// ============================================================
// 5. Password comparison — legacy SHA-256 must be constant-time
// ============================================================

describe('AuthService.verifyPassword', () => {
  it('accepts a correct bcrypt password', async () => {
    const bcrypt = await import('bcryptjs')
    const hash = await bcrypt.default.hash('correct horse battery', 12)
    await expect(AuthService.verifyPassword('correct horse battery', hash)).resolves.toBe(true)
  })

  it('rejects an incorrect bcrypt password', async () => {
    const bcrypt = await import('bcryptjs')
    const hash = await bcrypt.default.hash('correct horse battery', 12)
    await expect(AuthService.verifyPassword('wrong password', hash)).resolves.toBe(false)
  })

  it('does not accept the legacy guest_account marker as a valid hash', async () => {
    // Regression: guest checkout stored the literal string 'guest_account'.
    await expect(AuthService.verifyPassword('guest_account', 'guest_account')).resolves.toBe(false)
    await expect(AuthService.verifyPassword('anything', 'guest_account')).resolves.toBe(false)
  })

  it('handles a malformed hex digest without throwing', async () => {
    await expect(AuthService.verifyPassword('x', 'zzzz-not-hex')).resolves.toBe(false)
  })

  it('handles an empty stored hash without throwing', async () => {
    await expect(AuthService.verifyPassword('x', '')).resolves.toBe(false)
  })
})

// ============================================================
// 6. Webhook raw-body preservation
// ============================================================

describe('webhook raw body capture', () => {
  it('identifies the webhook path regardless of query string or mount prefix', () => {
    expect(requiresRawBody({ originalUrl: '/api/v1/payments/razorpay/webhook' })).toBe(true)
    expect(
      requiresRawBody({ originalUrl: '/api/v1/payments/razorpay/webhook?foo=bar' })
    ).toBe(true)
  })

  it('does not capture bodies for ordinary endpoints', () => {
    expect(requiresRawBody({ originalUrl: '/api/v1/orders/checkout' })).toBe(false)
    expect(requiresRawBody({ originalUrl: '/api/v1/auth/login' })).toBe(false)
    // A look-alike path must not be treated as the webhook.
    expect(requiresRawBody({ originalUrl: '/api/v1/payments/razorpay/webhookX' })).toBe(false)
  })

  it('returns undefined rather than a reconstructed body when capture failed', () => {
    expect(getRawBody({} as any)).toBeUndefined()
    expect(getRawBody({ rawBody: '' } as any)).toBeUndefined()
  })

  it('round-trips a captured buffer', () => {
    // Returns the exact bytes, not a decoded string.
    const body = Buffer.from('{"event":"payment.captured"}', 'utf-8')
    const req = { rawBody: body } as any
    expect(getRawBody(req)).toEqual(body)
    expect(Buffer.isBuffer(getRawBody(req))).toBe(true)
  })

  it('ignores a string-valued rawBody so the HMAC is never taken over re-encoded bytes', () => {
    // A string here would mean the bytes were decoded and are about to be re-encoded
    // before hashing, which is lossy for any non-UTF-8 payload. Fail closed instead.
    const req = { rawBody: '{"event":"payment.captured"}' } as any
    expect(getRawBody(req)).toBeUndefined()
  })
})

// ============================================================
// 7. Razorpay HMAC — exact-byte requirement
// ============================================================

describe('RazorpayService.verifyWebhookSignature', () => {
  // Imported lazily: the module reads env at load time.
  let RazorpayService: typeof import('../../src/integrations/razorpay/razorpay.service').RazorpayService
  let webhookSecret: string

  beforeAll(async () => {
    const envMod = await import('../../src/config/env')
    webhookSecret = envMod.env.RAZORPAY_WEBHOOK_SECRET
    const mod = await import('../../src/integrations/razorpay/razorpay.service')
    RazorpayService = mod.RazorpayService
  })

  it('accepts a signature over the exact bytes Razorpay sent', () => {
    const raw = '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_1"}}}}'
    const sig = crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex')
    expect(RazorpayService.verifyWebhookSignature(raw, sig)).toBe(true)
  })

  it('rejects a signature computed over re-serialized JSON', () => {
    // This is precisely what happens when the raw body is lost and the handler
    // falls back to JSON.stringify(req.body). Razorpay's payloads contain keys
    // whose order and spacing do not survive a parse/stringify round trip, so
    // the recomputed digest differs and verification must fail.
    const original = '{"event":"payment.captured", "payload":{"payment":{"entity":{"id":"pay_1"}}}}'
    const reSerialized = JSON.stringify(JSON.parse(original))
    expect(reSerialized).not.toBe(original) // sanity: the round trip really changed bytes
    const sig = crypto.createHmac('sha256', webhookSecret).update(original).digest('hex')
    expect(RazorpayService.verifyWebhookSignature(reSerialized, sig)).toBe(false)
  })

  it('rejects a tampered payload', () => {
    const raw = '{"event":"payment.captured","amount":100}'
    const sig = crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex')
    expect(RazorpayService.verifyWebhookSignature('{"event":"payment.captured","amount":1}', sig)).toBe(
      false
    )
  })

  it('rejects a wrong secret', () => {
    const raw = '{"event":"payment.captured"}'
    const sig = crypto.createHmac('sha256', 'attacker-guessed-secret').update(raw).digest('hex')
    expect(RazorpayService.verifyWebhookSignature(raw, sig)).toBe(false)
  })

  it('rejects a malformed signature without throwing', () => {
    expect(RazorpayService.verifyWebhookSignature('{}', 'not-hex')).toBe(false)
    expect(RazorpayService.verifyWebhookSignature('{}', '')).toBe(false)
    expect(RazorpayService.verifyWebhookSignature('{}', 'ab')).toBe(false)
  })
})

// ============================================================
// 8. Production secret placeholders
// ============================================================

describe('INSECURE_PLACEHOLDER_SECRETS', () => {
  it('lists every secret that used to ship in source control', () => {
    expect(INSECURE_PLACEHOLDER_SECRETS).toContain(
      'vedhicfoods_jwt_secret_must_be_at_least_32_characters_long_in_production'
    )
    expect(INSECURE_PLACEHOLDER_SECRETS).toContain('vedhicfoods_secure_32bit_key_2026_aes!')
    expect(INSECURE_PLACEHOLDER_SECRETS).toContain('rzp_test_placeholder_secret')
    expect(INSECURE_PLACEHOLDER_SECRETS).toContain('rzp_webhook_secret_placeholder')
  })

  it('covers both Razorpay key id and secret so neither can be left as a placeholder', () => {
    // Regression: RAZORPAY_KEY_SECRET was guarded by a conditional that skipped
    // the check when it began with the placeholder prefix.
    expect(INSECURE_PLACEHOLDER_SECRETS).toContain('rzp_test_placeholder_key')
  })
})

// ============================================================
// 9. Error responses must not leak internals in production
// ============================================================

describe('sendControllerError', () => {
  // `sendControllerError` reads the already-validated env singleton at call
  // time, so production behaviour must be exercised by switching that value
  // rather than stubbing process.env (which would have no effect).
  let originalNodeEnv: string

  beforeEach(() => {
    originalNodeEnv = env.NODE_ENV
  })

  afterEach(() => {
    env.NODE_ENV = originalNodeEnv
  })

  it('preserves the status and message of an operational AppError', () => {
    const res = mockRes()
    sendControllerError(res, new BadRequestError('Insufficient stock for SKU ABC'), 'Failed')
    expect(res.state.statusCode).toBe(400)
    expect(res.state.body.error).toBe('Insufficient stock for SKU ABC')
  })

  it('withholds AppError details in production', () => {
    env.NODE_ENV = 'production'
    const res = mockRes()
    const err = new AppError('Upstream failure', 502, 'UPSTREAM', {
      sql: 'SELECT * FROM "PaymentSettings" WHERE id = $1',
      bucketKey: 'invoices/user-123/INV-001.pdf',
    })
    sendControllerError(res, err, 'Failed')
    const serialized = JSON.stringify(res.state.body)
    expect(serialized).not.toContain('PaymentSettings')
    expect(serialized).not.toContain('INV-001')
    // The safe message is still returned so the UI can render something useful.
    expect(res.state.body.error).toBe('Upstream failure')
  })

  it('masks an unexpected error message in production', () => {
    env.NODE_ENV = 'production'
    const res = mockRes()
    sendControllerError(
      res,
      new Error('connect ECONNREFUSED 10.0.1.5:5432 (password=hunter2)'),
      'Checkout failed'
    )
    const serialized = JSON.stringify(res.state.body)
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('10.0.1.5')
    expect(res.state.body.error).toBe('Checkout failed')
  })

  it('surfaces the real message outside production for debugging', () => {
    env.NODE_ENV = 'development'
    const res = mockRes()
    sendControllerError(res, new Error('prisma: P2002 unique constraint'), 'Checkout failed')
    expect(res.state.body.error).toContain('P2002')
  })

  it('does not downgrade the status code of an operational error in production', () => {
    env.NODE_ENV = 'production'
    const res = mockRes()
    sendControllerError(res, new BadRequestError('Card was declined'), 'Failed')
    expect(res.state.statusCode).toBe(400)
  })

  it('returns 500 for an unrecognized error', () => {
    const res = mockRes()
    sendControllerError(res, new Error('boom'), 'Checkout failed')
    expect(res.state.statusCode).toBe(500)
  })

  it('includes a quotable request id for support', () => {
    const res = mockRes()
    sendControllerError(res, new Error('boom'), 'Checkout failed', 'req-abc123')
    expect(res.state.body.requestId).toBe('req-abc123')
  })

  it('normalizes a numeric request id', () => {
    const res = mockRes()
    sendControllerError(res, new Error('boom'), 'Checkout failed', 42)
    expect(res.state.body.requestId).toBe('42')
  })

  it('omits the request id when none was supplied', () => {
    const res = mockRes()
    sendControllerError(res, new Error('boom'), 'Checkout failed')
    expect(res.state.body).not.toHaveProperty('requestId')
  })
})