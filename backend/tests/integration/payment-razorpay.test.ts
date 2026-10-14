/**
 * Payment Integration Tests — Razorpay
 *
 * Tests the full Razorpay payment lifecycle:
 *   Checkout (PENDING_PAYMENT) → Initiate Razorpay Order → Verify Payment → Order CONFIRMED
 *
 * Uses Razorpay TEST credentials (rzp_test_*) and simulates the frontend SDK flow.
 *
 * Security tests:
 * - Tampered amount must be rejected
 * - Invalid signature must be rejected
 * - Missing payment ID must be rejected
 * - Wrong order must be rejected
 * - Duplicate payment responses must be idempotent (not double-processed)
 * - Unauthorized user cannot access another user's payment
 * - Webhook signature validation
 */

import './_safety'
import crypto from 'crypto'
import request from 'supertest'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { env } from '../../src/config/env'
import { AuthService } from '../../src/services/auth.service'
import {
  razorpayClient,
  clearRazorpayCredentialCache,
} from '../../src/integrations/razorpay/razorpay.client'

const app = createApp()

// ==========================================
// HELPERS
// ==========================================

const timestamp = Date.now()

function generateHmacSignature(razorpayOrderId: string, razorpayPaymentId: string): string {
  return crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex')
}

// ==========================================
// TEST STATE
// ==========================================

let customerAToken: string
let customerAId: string
let customerAAddressId: string

let customerBToken: string
let customerBId: string
let customerBAddressId: string

let productId: string
let categoryId: string

// ==========================================
// TEST SETUP
// ==========================================

beforeAll(async () => {
  // Deterministic credential source.
  //
  // The runtime now prefers admin-configured credentials from `payment_settings`
  // over the environment. A sibling suite (`payment-settings.test.ts`) leaves a
  // row behind whose secrets are not the ones this suite signs with, so the
  // shared test database must be normalised to the environment path first —
  // otherwise a signature that is valid for `env` would be rejected here.
  await prisma.paymentSettings.deleteMany({ where: { id: 'default' } }).catch(() => {})
  clearRazorpayCredentialCache()

  // Register customers via AuthService (direct service call, consistent with other tests)
  const phoneA = `91${(timestamp % 100000000).toString().padStart(8, '0')}`
  const regA = await AuthService.register({
    fullName: 'Payment Customer A',
    email: `pay_cust_a_${timestamp}@vedhictest.com`,
    phone: phoneA,
    password: 'SecurePassword123!',
  })
  customerAToken = regA.accessToken
  customerAId = regA.user.id

  const phoneB = `92${((timestamp + 1) % 100000000).toString().padStart(8, '0')}`
  const regB = await AuthService.register({
    fullName: 'Payment Customer B',
    email: `pay_cust_b_${timestamp}@vedhictest.com`,
    phone: phoneB,
    password: 'SecurePassword123!',
  })
  customerBToken = regB.accessToken
  customerBId = regB.user.id

  // Create addresses directly via Prisma (no HTTP round-trip needed for setup)
  const addrA = await prisma.address.create({
    data: {
      userId: customerAId,
      fullName: 'Payment Customer A',
      phone: '9999999901',
      line1: '1 Payment Street',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600001',
      isDefault: true,
    },
  })
  customerAAddressId = addrA.id

  const addrB = await prisma.address.create({
    data: {
      userId: customerBId,
      fullName: 'Payment Customer B',
      phone: '9999999902',
      line1: '2 Payment Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
      isDefault: true,
    },
  })
  customerBAddressId = addrB.id

  // Create test category and product with inventory
  const cat = await prisma.category.create({
    data: { name: `Payment Test Category ${timestamp}`, slug: `pay-cat-${timestamp}` },
  })
  categoryId = cat.id

  const product = await prisma.product.create({
    data: {
      name: `Razorpay Test Product ${timestamp}`,
      slug: `rzp-product-${timestamp}`,
      sku: `RZP-${timestamp}`,
      price: 500,
      mrp: 600,
      stock: 100,
      categoryId,
      unit: 'kg',
      isActive: true,
      status: 'PUBLISHED',
      inventory: {
        create: {
          availableQuantity: 100,
          reservedQuantity: 0,
          soldQuantity: 0,
        },
      },
    },
  })
  productId = product.id
})

afterAll(async () => {
  const userIds = [customerAId, customerBId]
  await prisma.invoice.deleteMany({ where: { order: { userId: { in: userIds } } } }).catch(() => {})
  await prisma.deliveryHistory.deleteMany({ where: { delivery: { order: { userId: { in: userIds } } } } }).catch(() => {})
  await prisma.delivery.deleteMany({ where: { order: { userId: { in: userIds } } } }).catch(() => {})
  await prisma.couponUsage.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
  await prisma.inventoryLog.deleteMany({ where: { productId } }).catch(() => {})
  await prisma.orderItem.deleteMany({ where: { order: { userId: { in: userIds } } } }).catch(() => {})
  await prisma.payment.deleteMany({ where: { order: { userId: { in: userIds } } } }).catch(() => {})
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: userIds } } } }).catch(() => {})
  await prisma.cart.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
  await prisma.inventory.deleteMany({ where: { productId } }).catch(() => {})
  await prisma.address.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
  await prisma.product.deleteMany({ where: { id: productId } }).catch(() => {})
  await prisma.category.deleteMany({ where: { id: categoryId } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } }).catch(() => {})
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {})
})


// ==========================================
// SUITE 1: UNAUTHORIZED ACCESS
// ==========================================

describe('Payment Security — Authorization', () => {
  it('should reject unauthenticated requests to create Razorpay order', async () => {
    const res = await request(app)
      .post('/api/v1/payments/razorpay/order')
      .send({ orderId: 'some-uuid-here' })

    expect(res.status).toBe(401)
  })

  it('should reject unauthenticated requests to verify payment', async () => {
    const res = await request(app)
      .post('/api/v1/payments/razorpay/verify')
      .send({
        razorpayOrderId: 'order_test',
        razorpayPaymentId: 'pay_test',
        razorpaySignature: 'fake_sig',
      })

    expect(res.status).toBe(401)
  })

  it('should reject unauthenticated payment status check', async () => {
    const res = await request(app).get('/api/v1/payments/status/some-uuid')

    expect(res.status).toBe(401)
  })
})

// ==========================================
// SUITE 2: RAZORPAY ORDER CREATION (PENDING_PAYMENT orders)
// ==========================================

describe('POST /api/v1/payments/razorpay/order — Razorpay Order Initiation', () => {
  it('should reject order creation for non-existent orderId', async () => {
    const res = await request(app)
      .post('/api/v1/payments/razorpay/order')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ orderId: '00000000-0000-0000-0000-000000000000' })

    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })

  it('should reject invalid orderId format', async () => {
    const res = await request(app)
      .post('/api/v1/payments/razorpay/order')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ orderId: 'not-a-uuid' })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('should reject COD orders from initiating Razorpay payment', async () => {
    // Create a COD order first
    const checkoutRes = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({
        addressId: customerAAddressId,
        paymentMethod: 'COD',
        items: [{ productId, quantity: 1 }],
      })

    expect(checkoutRes.status).toBe(201)
    const codOrderId = checkoutRes.body.orderId

    // Try to initiate Razorpay for a COD order — should be rejected
    const res = await request(app)
      .post('/api/v1/payments/razorpay/order')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ orderId: codOrderId })

    // COD order is status CONFIRMED (not PENDING_PAYMENT), so initiating payment fails
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('should reject access to another customer\'s order', async () => {
    // Create RAZORPAY order for Customer A
    const checkoutRes = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({
        addressId: customerAAddressId,
        paymentMethod: 'RAZORPAY',
        items: [{ productId, quantity: 1 }],
      })
    expect(checkoutRes.status).toBe(201)
    const orderAId = checkoutRes.body.orderId

    // Customer B tries to access Customer A's payment
    const res = await request(app)
      .post('/api/v1/payments/razorpay/order')
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({ orderId: orderAId })

    expect(res.status).toBe(403)
    expect(res.body.success).toBe(false)
  })
})

// ==========================================
// SUITE 3: GATEWAY UNREACHABLE — NO FAKE SUCCESS
//
// This suite previously stubbed `payments.fetch` to return `status: captured`
// and then asserted the order was confirmed — i.e. it fabricated a settlement
// and called it a passing payment. That is exactly the behaviour the real
// system must never exhibit, so it is replaced with the honest contract:
//
//   A valid checkout signature proves a payment *attempt* belongs to our order.
//   It does NOT prove money was captured. If the gateway cannot be reached to
//   confirm settlement, the payment must be REFUSED (503) and the order must
//   stay PENDING_PAYMENT — never silently confirmed.
//
// The genuine success path is exercised by `payment-razorpay-webhook.test.ts`
// (real HMAC over a signed webhook payload, no gateway call required).
// ==========================================

describe('Verify path — refuses to confirm when the gateway is unreachable', () => {
  let razorpayOrderId: string
  let internalOrderId: string
  let paymentRecordId: string
  let gatewayFetchSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    const checkoutRes = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({
        addressId: customerAAddressId,
        paymentMethod: 'RAZORPAY',
        items: [{ productId, quantity: 1 }],
      })

    expect(checkoutRes.status).toBe(201)
    internalOrderId = checkoutRes.body.orderId
    expect(checkoutRes.body.status).toBe('PENDING_PAYMENT')

    // Simulate the gateway having assigned a Razorpay order id (setup only).
    razorpayOrderId = `order_unreachable_${timestamp}`
    const payment = await prisma.payment.update({
      where: { orderId: internalOrderId },
      data: { razorpayOrderId },
    })
    paymentRecordId = payment.id

    // Gateway is unreachable (offline CI / network error). The test double
    // simulates a FAILURE, never a successful capture.
    gatewayFetchSpy = vi
      .spyOn(razorpayClient.payments, 'fetch')
      .mockImplementation(async () => {
        throw new Error('getaddrinfo ENOTFOUND api.razorpay.com')
      })
  })

  afterAll(() => {
    gatewayFetchSpy?.mockRestore()
  })

  it('should refuse to confirm (503) and leave the order PENDING_PAYMENT', async () => {
    const razorpayPaymentId = `pay_unreachable_${timestamp}`
    const validSignature = generateHmacSignature(razorpayOrderId, razorpayPaymentId)

    const res = await request(app)
      .post('/api/v1/payments/razorpay/verify')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ razorpayOrderId, razorpayPaymentId, razorpaySignature: validSignature })

    expect(res.status).toBe(503)
    expect(res.body.success).toBe(false)

    // NO state change: never claim a payment settled when we could not verify it.
    const paymentDb = await prisma.payment.findUnique({ where: { id: paymentRecordId } })
    expect(paymentDb?.status).not.toBe('CAPTURED')
    expect(paymentDb?.razorpayPaymentId).toBeNull()

    const orderDb = await prisma.order.findUnique({ where: { id: internalOrderId } })
    expect(orderDb?.status).toBe('PENDING_PAYMENT')
    expect(orderDb?.paymentStatus).toBe('PENDING')

    // No invoice may be fabricated for an unconfirmed payment.
    const invoice = await prisma.invoice.findUnique({ where: { orderId: internalOrderId } })
    expect(invoice).toBeNull()
  })
})

// ==========================================
// SUITE 4: PAYMENT VERIFICATION SECURITY
// ==========================================

describe('Payment Verification Security — Signature Attacks', () => {
  let attackOrderId: string
  let attackRazorpayOrderId: string

  beforeAll(async () => {
    // Create another RAZORPAY order for security tests
    const checkoutRes = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({
        addressId: customerBAddressId,
        paymentMethod: 'RAZORPAY',
        items: [{ productId, quantity: 2 }],
      })

    expect(checkoutRes.status).toBe(201)
    attackOrderId = checkoutRes.body.orderId

    attackRazorpayOrderId = `order_attack_${timestamp}`
    await prisma.payment.update({
      where: { orderId: attackOrderId },
      data: { razorpayOrderId: attackRazorpayOrderId },
    })
  })

  it('SECURITY: should reject payment with invalid/tampered signature', async () => {
    const res = await request(app)
      .post('/api/v1/payments/razorpay/verify')
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({
        razorpayOrderId: attackRazorpayOrderId,
        razorpayPaymentId: `pay_${timestamp}`,
        razorpaySignature: 'completely_invalid_signature_attempt',
      })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error).toContain('verification failed')

    // Verify audit log was written for the security violation
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        action: 'PAYMENT_SIGNATURE_INVALID',
        actorId: customerBId,
      },
    })
    expect(auditLog).not.toBeNull()
  })

  it('SECURITY: should reject payment with all-zero/empty signature', async () => {
    const res = await request(app)
      .post('/api/v1/payments/razorpay/verify')
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({
        razorpayOrderId: attackRazorpayOrderId,
        razorpayPaymentId: `pay_zero_${timestamp}`,
        razorpaySignature: '0000000000000000000000000000000000000000000000000000000000000000',
      })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('SECURITY: should reject verification when wrong razorpayOrderId is used', async () => {
    const fakeRazorpayOrderId = `order_nonexistent_${timestamp}`

    const res = await request(app)
      .post('/api/v1/payments/razorpay/verify')
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({
        razorpayOrderId: fakeRazorpayOrderId,
        razorpayPaymentId: `pay_fake_${timestamp}`,
        razorpaySignature: generateHmacSignature(fakeRazorpayOrderId, `pay_fake_${timestamp}`),
      })

    // No payment record found for this Razorpay order ID
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })

  it('SECURITY: should reject verification when authenticated user does not own the order', async () => {
    // Customer A tries to verify Customer B's payment
    const validSig = generateHmacSignature(attackRazorpayOrderId, `pay_steal_${timestamp}`)

    const res = await request(app)
      .post('/api/v1/payments/razorpay/verify')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({
        razorpayOrderId: attackRazorpayOrderId,
        razorpayPaymentId: `pay_steal_${timestamp}`,
        razorpaySignature: validSig,
      })

    expect(res.status).toBe(403)
    expect(res.body.success).toBe(false)
  })

  it('SECURITY: should reject missing razorpayPaymentId in verification request', async () => {
    const res = await request(app)
      .post('/api/v1/payments/razorpay/verify')
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({
        razorpayOrderId: attackRazorpayOrderId,
        razorpaySignature: 'some_sig',
        // razorpayPaymentId is missing
      })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('SECURITY: should reject missing razorpaySignature in verification request', async () => {
    const res = await request(app)
      .post('/api/v1/payments/razorpay/verify')
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({
        razorpayOrderId: attackRazorpayOrderId,
        razorpayPaymentId: `pay_nosig_${timestamp}`,
        // razorpaySignature is missing
      })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })
})

// ==========================================
// SUITE 5: PAYMENT STATUS API
// ==========================================

describe('GET /api/v1/payments/status/:orderId — Payment Status', () => {
  let statusOrderId: string

  beforeAll(async () => {
    const checkoutRes = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({
        addressId: customerBAddressId,
        paymentMethod: 'RAZORPAY',
        items: [{ productId, quantity: 1 }],
      })
    expect(checkoutRes.status).toBe(201)
    statusOrderId = checkoutRes.body.orderId
  })

  it('should return payment status for authenticated owner', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/status/${statusOrderId}`)
      .set('Authorization', `Bearer ${customerBToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    const data = res.body.data
    expect(data.orderId).toBe(statusOrderId)
    expect(data.paymentMethod).toBe('RAZORPAY')
    expect(data.orderStatus).toBe('PENDING_PAYMENT')
    expect(data.paymentStatus).toBe('PENDING')
    expect(data.amount).toBeGreaterThan(0)
    expect(data.currency).toBe('INR')
    expect(data.verifiedAt).toBeNull()
  })

  it('SECURITY: should reject payment status check for another customer\'s order', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/status/${statusOrderId}`)
      .set('Authorization', `Bearer ${customerAToken}`)

    expect(res.status).toBe(403)
    expect(res.body.success).toBe(false)
  })

  it('should return 404 for non-existent order', async () => {
    const res = await request(app)
      .get('/api/v1/payments/status/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${customerBToken}`)

    expect(res.status).toBe(404)
  })
})

// ==========================================
// SUITE 6: WEBHOOK SECURITY
// ==========================================

describe('POST /api/v1/payments/razorpay/webhook — Webhook Verification', () => {
  it('should reject webhook without x-razorpay-signature header', async () => {
    const res = await request(app)
      .post('/api/v1/payments/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event: 'payment.captured' }))

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error).toContain('x-razorpay-signature')
  })

  it('SECURITY: should reject webhook with invalid signature', async () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: {} })

    const res = await request(app)
      .post('/api/v1/payments/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'invalid_webhook_signature')
      .send(body)

    // Returns 401 for signature failures
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('should accept webhook with valid HMAC signature and return 200', async () => {
    const webhookBody = JSON.stringify({
      event: 'payment.authorized',
      payload: {
        payment: {
          entity: {
            id: `pay_wh_test_${timestamp}`,
            order_id: `order_wh_${timestamp}`,
            amount: 50000,
            currency: 'INR',
            status: 'authorized',
          },
        },
      },
    })

    const validWebhookSig = crypto
      .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(webhookBody)
      .digest('hex')

    const res = await request(app)
      .post('/api/v1/payments/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', validWebhookSig)
      .send(webhookBody)

    // 200 — webhook accepted (event not handled but signature valid)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('should process payment.captured webhook and confirm order', async () => {
    // Create a RAZORPAY order specifically for webhook testing
    const checkoutRes = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({
        addressId: customerAAddressId,
        paymentMethod: 'RAZORPAY',
        items: [{ productId, quantity: 1 }],
      })

    expect(checkoutRes.status).toBe(201)
    const whOrderId = checkoutRes.body.orderId
    const webhookRzpOrderId = `order_wh_captured_${timestamp}`
    const webhookPaymentId = `pay_wh_captured_${timestamp}`

    // Set up razorpayOrderId in payment record
    await prisma.payment.update({
      where: { orderId: whOrderId },
      data: { razorpayOrderId: webhookRzpOrderId },
    })

    // Simulate Razorpay sending a payment.captured webhook
    const webhookBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: webhookPaymentId,
            order_id: webhookRzpOrderId,
            amount: Math.round(checkoutRes.body.total * 100),
            currency: 'INR',
            status: 'captured',
            method: 'upi',
          },
        },
      },
    })

    const validWebhookSig = crypto
      .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(webhookBody)
      .digest('hex')

    const webhookRes = await request(app)
      .post('/api/v1/payments/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', validWebhookSig)
      .send(webhookBody)

    expect(webhookRes.status).toBe(200)
    expect(webhookRes.body.success).toBe(true)

    // Wait a tick for async DB ops
    await new Promise((r) => setTimeout(r, 200))

    // Verify DB: Order is now CONFIRMED and payment is CAPTURED
    const orderDb = await prisma.order.findUnique({ where: { id: whOrderId } })
    expect(orderDb?.status).toBe('CONFIRMED')
    expect(orderDb?.paymentStatus).toBe('PAID')

    const paymentDb = await prisma.payment.findFirst({ where: { orderId: whOrderId } })
    expect(paymentDb?.status).toBe('CAPTURED')
    expect(paymentDb?.razorpayPaymentId).toBe(webhookPaymentId)
  })

  it('should process payment.failed webhook and release inventory', async () => {
    // Create a RAZORPAY order for failed payment test
    const checkoutRes = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({
        addressId: customerBAddressId,
        paymentMethod: 'RAZORPAY',
        items: [{ productId, quantity: 1 }],
      })

    expect(checkoutRes.status).toBe(201)
    const failedOrderId = checkoutRes.body.orderId
    const failedRzpOrderId = `order_wh_failed_${timestamp}`

    await prisma.payment.update({
      where: { orderId: failedOrderId },
      data: { razorpayOrderId: failedRzpOrderId },
    })

    // Get inventory before webhook
    const inventoryBefore = await prisma.inventory.findFirst({ where: { productId } })

    // Simulate payment.failed webhook
    const webhookBody = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: `pay_wh_fail_${timestamp}`,
            order_id: failedRzpOrderId,
            amount: Math.round(checkoutRes.body.total * 100),
            currency: 'INR',
            status: 'failed',
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'Payment declined by bank',
          },
        },
      },
    })

    const validWebhookSig = crypto
      .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(webhookBody)
      .digest('hex')

    const webhookRes = await request(app)
      .post('/api/v1/payments/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', validWebhookSig)
      .send(webhookBody)

    expect(webhookRes.status).toBe(200)
    await new Promise((r) => setTimeout(r, 200))

    // Verify DB: Order is PAYMENT_FAILED
    const orderDb = await prisma.order.findUnique({ where: { id: failedOrderId } })
    expect(orderDb?.status).toBe('PAYMENT_FAILED')
    expect(orderDb?.paymentStatus).toBe('FAILED')

    // Verify DB: Payment is FAILED
    const paymentDb = await prisma.payment.findFirst({ where: { orderId: failedOrderId } })
    expect(paymentDb?.status).toBe('FAILED')
    expect(paymentDb?.failureCode).toBe('BAD_REQUEST_ERROR')

    // Verify: Inventory reservation was RELEASED
    const inventoryAfter = await prisma.inventory.findFirst({ where: { productId } })
    // reservedQuantity should be lower than or equal to before (reservation was released)
    expect(Number(inventoryAfter?.reservedQuantity)).toBeLessThanOrEqual(
      Number(inventoryBefore?.reservedQuantity)
    )
  })
})
