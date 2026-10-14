/**
 * Razorpay verify-path suite.
 *
 * Two concerns:
 *
 * A. `POST /payments/razorpay/verify` reconciliation is FAIL-CLOSED. The checkout
 *    signature only proves a payment *attempt* belongs to our order; it binds
 *    neither amount nor capture status. The gateway is asked for the truth, and
 *    every adverse answer must be REFUSED with no state change. The gateway is
 *    stubbed here ONLY to simulate failures/mismatches — never a success.
 *
 * B. Admin-supplied credentials, stored encrypted in `payment_settings` from the
 *    admin dashboard, are the runtime source of truth. This proves, without any
 *    network call, that rotation in the dashboard reaches the gateway session
 *    (resolver), the webhook verifier, and the checkout key id handed to the
 *    storefront.
 */

import './_safety'
import request from 'supertest'
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import {
  razorpayClient,
  resolveRazorpayCredentials,
  clearRazorpayCredentialCache,
} from '../../src/integrations/razorpay/razorpay.client'
import { paymentSignature, webhookSignature } from './helpers/razorpay-testkit'

const app = createApp()
const ts = Date.now()

let token: string
let userId: string
let addressId: string
let categoryId: string
let productId: string
let adminToken: string
let envKeySecret: string
let envWebhookSecret: string

async function newOrder(qty = 1) {
  const res = await request(app)
    .post('/api/v1/checkout')
    .set('Authorization', `Bearer ${token}`)
    .send({ addressId, paymentMethod: 'RAZORPAY', items: [{ productId, quantity: qty }] })
  expect(res.status).toBe(201)
  const razorpayOrderId = `order_v_${ts}_${Math.random().toString(36).slice(2, 8)}`
  await prisma.payment.update({
    where: { orderId: res.body.orderId },
    data: { razorpayOrderId },
  })
  return { orderId: res.body.orderId as string, totalRupees: res.body.total as number, razorpayOrderId }
}

async function verifyPayment(razorpayOrderId: string, paymentId: string, secret: string) {
  return request(app)
    .post('/api/v1/payments/razorpay/verify')
    .set('Authorization', `Bearer ${token}`)
    .send({
      razorpayOrderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: paymentSignature(razorpayOrderId, paymentId, secret),
    })
}

beforeAll(async () => {
  await prisma.paymentSettings.deleteMany({ where: { id: 'default' } }).catch(() => {})
  clearRazorpayCredentialCache()
  const envSession = await resolveRazorpayCredentials(true)
  envKeySecret = envSession.keySecret
  envWebhookSecret = envSession.webhookSecret

  const adminLogin = await AuthService.login({
    email: 'admin@vedhicfoods.com',
    password: 'Admin@Vedhic2026',
  })
  adminToken = adminLogin.accessToken

  const phone = `94${(ts % 100000000).toString().padStart(8, '0')}`
  const reg = await AuthService.register({
    fullName: 'Verify Customer',
    email: `pay_v_${ts}@vedhictest.com`,
    phone,
    password: 'SecurePassword123!',
  })
  token = reg.accessToken
  userId = reg.user.id

  const addr = await prisma.address.create({
    data: {
      userId,
      fullName: 'Verify Customer',
      phone: '9999999904',
      line1: '4 Verify Street',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
      isDefault: true,
    },
  })
  addressId = addr.id

  const cat = await prisma.category.create({ data: { name: `Verify Cat ${ts}`, slug: `v-cat-${ts}` } })
  categoryId = cat.id

  const product = await prisma.product.create({
    data: {
      name: `Verify Product ${ts}`,
      slug: `v-product-${ts}`,
      sku: `V-${ts}`,
      price: 600,
      mrp: 700,
      stock: 50,
      categoryId,
      unit: 'kg',
      isActive: true,
      status: 'PUBLISHED',
      inventory: { create: { availableQuantity: 50, reservedQuantity: 0, soldQuantity: 0 } },
    },
  })
  productId = product.id
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await prisma.paymentSettings.deleteMany({ where: { id: 'default' } }).catch(() => {})
  clearRazorpayCredentialCache()

  await prisma.invoice.deleteMany({ where: { userId } }).catch(() => {})
  await prisma.deliveryHistory.deleteMany({ where: { delivery: { order: { userId } } } }).catch(() => {})
  await prisma.delivery.deleteMany({ where: { order: { userId } } }).catch(() => {})
  await prisma.couponUsage.deleteMany({ where: { userId } }).catch(() => {})
  await prisma.inventoryLog.deleteMany({ where: { productId } }).catch(() => {})
  await prisma.orderItem.deleteMany({ where: { order: { userId } } }).catch(() => {})
  await prisma.payment.deleteMany({ where: { order: { userId } } }).catch(() => {})
  await prisma.order.deleteMany({ where: { userId } }).catch(() => {})
  await prisma.cartItem.deleteMany({ where: { cart: { userId } } }).catch(() => {})
  await prisma.cart.deleteMany({ where: { userId } }).catch(() => {})
  await prisma.inventory.deleteMany({ where: { productId } }).catch(() => {})
  await prisma.address.deleteMany({ where: { userId } }).catch(() => {})
  await prisma.product.deleteMany({ where: { id: productId } }).catch(() => {})
  await prisma.category.deleteMany({ where: { id: categoryId } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorId: userId } }).catch(() => {})
  await prisma.userRole.deleteMany({ where: { userId } }).catch(() => {})
  await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {})
})

describe('Verify reconciliation is fail-closed (gateway test doubles simulate failure only)', () => {
  it('unreachable gateway → 503, order untouched', async () => {
    const { orderId, razorpayOrderId } = await newOrder()
    vi.spyOn(razorpayClient.payments, 'fetch').mockRejectedValue(new Error('ENOTFOUND'))

    const res = await verifyPayment(razorpayOrderId, `pay_na_${ts}`, envKeySecret)
    expect(res.status).toBe(503)

    const orderDb = await prisma.order.findUnique({ where: { id: orderId } })
    expect(orderDb?.status).toBe('PENDING_PAYMENT')
    expect(orderDb?.paymentStatus).toBe('PENDING')
  })

  it('payment only AUTHORIZED (not settled) → 400 + anomaly, order untouched', async () => {
    const { orderId, totalRupees, razorpayOrderId } = await newOrder()
    vi.spyOn(razorpayClient.payments, 'fetch').mockResolvedValue({
      id: `pay_auth_${ts}`,
      amount: Math.round(totalRupees * 100),
      currency: 'INR',
      status: 'authorized',
      order_id: razorpayOrderId,
    } as any)

    const res = await verifyPayment(razorpayOrderId, `pay_auth_${ts}`, envKeySecret)
    expect(res.status).toBe(400)

    const orderDb = await prisma.order.findUnique({ where: { id: orderId } })
    expect(orderDb?.paymentStatus).toBe('PENDING')
    const anomaly = await prisma.auditLog.findFirst({
      where: { action: 'PAYMENT_GATEWAY_NOT_SETTLED' },
      orderBy: { createdAt: 'desc' },
    })
    expect(anomaly).not.toBeNull()
  })

  it('captured but amount is short → 400 + amount anomaly', async () => {
    const { totalRupees, razorpayOrderId } = await newOrder()
    vi.spyOn(razorpayClient.payments, 'fetch').mockResolvedValue({
      id: `pay_short_${ts}`,
      amount: Math.round(totalRupees * 100) - 100,
      currency: 'INR',
      status: 'captured',
      order_id: razorpayOrderId,
    } as any)

    const res = await verifyPayment(razorpayOrderId, `pay_short_${ts}`, envKeySecret)
    expect(res.status).toBe(400)
    const anomaly = await prisma.auditLog.findFirst({
      where: { action: 'PAYMENT_GATEWAY_AMOUNT_MISMATCH' },
      orderBy: { createdAt: 'desc' },
    })
    expect(anomaly).not.toBeNull()
  })

  it('captured payment bound to a different order → 400 + order anomaly', async () => {
    const { totalRupees, razorpayOrderId } = await newOrder()
    vi.spyOn(razorpayClient.payments, 'fetch').mockResolvedValue({
      id: `pay_wrong_${ts}`,
      amount: Math.round(totalRupees * 100),
      currency: 'INR',
      status: 'captured',
      order_id: `order_someone_else_${ts}`,
    } as any)

    const res = await verifyPayment(razorpayOrderId, `pay_wrong_${ts}`, envKeySecret)
    expect(res.status).toBe(400)
    const anomaly = await prisma.auditLog.findFirst({
      where: { action: 'PAYMENT_GATEWAY_ORDER_MISMATCH' },
      orderBy: { createdAt: 'desc' },
    })
    expect(anomaly).not.toBeNull()
  })

  it('captured with a currency mismatch → 400 + currency anomaly', async () => {
    const { totalRupees, razorpayOrderId } = await newOrder()
    vi.spyOn(razorpayClient.payments, 'fetch').mockResolvedValue({
      id: `pay_ccy_${ts}`,
      amount: Math.round(totalRupees * 100),
      currency: 'USD',
      status: 'captured',
      order_id: razorpayOrderId,
    } as any)

    const res = await verifyPayment(razorpayOrderId, `pay_ccy_${ts}`, envKeySecret)
    expect(res.status).toBe(400)
    const anomaly = await prisma.auditLog.findFirst({
      where: { action: 'PAYMENT_GATEWAY_CURRENCY_MISMATCH' },
      orderBy: { createdAt: 'desc' },
    })
    expect(anomaly).not.toBeNull()
  })
})

describe('Admin-configured DB credentials drive the runtime', () => {
  const dbKeyId = `rzp_test_DBKEY${ts % 100000}`
  const dbKeySecret = `db_key_secret_${ts}_abcdef`
  const dbWebhookSecret = `db_webhook_secret_${ts}_abcdef`

  it('stores credentials via the admin dashboard and resolves them from the DB', async () => {
    const put = await request(app)
      .put('/api/v1/admin/payment-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        razorpayKeyId: dbKeyId,
        razorpayKeySecret: dbKeySecret,
        webhookSecret: dbWebhookSecret,
        testMode: true,
      })
    expect(put.status).toBe(200)
    expect(put.body.razorpayKeyId).toBe(dbKeyId)

    // The row is encrypted at rest.
    const row = await prisma.paymentSettings.findUnique({ where: { id: 'default' } })
    expect(row?.encryptedKeySecret).toBeTruthy()
    expect(row?.encryptedKeySecret).not.toContain(dbKeySecret)

    // Cache was invalidated by the update, so the resolver picks the DB values.
    const session = await resolveRazorpayCredentials()
    expect(session.source).toBe('database')
    expect(session.dbConfigured).toBe(true)
    expect(session.keyId).toBe(dbKeyId)
    expect(session.keySecret).toBe(dbKeySecret)
    expect(session.webhookSecret).toBe(dbWebhookSecret)
    // A dedicated client is used once the DB supplies credentials.
    expect(session.client).not.toBe(razorpayClient)
  })

  it('verifies webhooks against the DB webhook secret, not the env secret', async () => {
    const body = JSON.stringify({
      event: 'order.paid',
      payload: { payment: { entity: { id: `pay_dbc_${ts}`, order_id: `order_dbc_${ts}`, amount: 100 } } },
    })

    const withDbSecret = webhookSignature(body, dbWebhookSecret)
    const ok = await request(app)
      .post('/api/v1/payments/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', withDbSecret)
      .send(body)
    expect(ok.status).toBe(200)

    const withEnvSecret = webhookSignature(body, envWebhookSecret)
    const bad = await request(app)
      .post('/api/v1/payments/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', withEnvSecret)
      .send(body)
    expect(bad.status).toBe(401)
  })

  it('hands the DB key id to the storefront on payment initiation (idempotent replay, no gateway call)', async () => {
    const res = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ addressId, paymentMethod: 'RAZORPAY', items: [{ productId, quantity: 1 }] })
    expect(res.status).toBe(201)

    await prisma.payment.update({
      where: { orderId: res.body.orderId },
      data: { razorpayOrderId: `order_idem_${ts}` },
    })

    const init = await request(app)
      .post('/api/v1/payments/razorpay/order')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId: res.body.orderId })

    expect(init.status).toBe(200)
    expect(init.body.data?.keyId ?? init.body.keyId).toBe(dbKeyId)
  })

  it('reflects a credential rotation immediately (cache invalidation)', async () => {
    const rotatedKeyId = `rzp_test_ROTATED${ts % 100000}`

    const put = await request(app)
      .put('/api/v1/admin/payment-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ razorpayKeyId: rotatedKeyId })

    expect(put.status).toBe(200)

    const session = await resolveRazorpayCredentials()
    expect(session.keyId).toBe(rotatedKeyId)
    // Untouched secrets are preserved across the rotation.
    expect(session.keySecret).toBe(dbKeySecret)
    expect(session.webhookSecret).toBe(dbWebhookSecret)
  })
})
