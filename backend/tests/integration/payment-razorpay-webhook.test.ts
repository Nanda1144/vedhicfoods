/**
 * Razorpay Webhook Suite — genuine confirmation path.
 *
 * Unlike the checkout-verify route, the webhook path never calls the gateway:
 * Razorpay signs the payload and our server verifies that HMAC over the exact
 * bytes received. That makes the FULL payment-confirmation pipeline — signature
 * → amount/currency reconciliation → order PAID → inventory deduction → invoice
 * generation + customer/admin email — testable here with real cryptography and
 * zero gateway stubs. Nothing in this file fabricates a successful capture.
 *
 * Covered:
 *   - signature rejection (invalid, missing, and byte-exactness/raw-body)
 *   - payment.captured  → CONFIRMED + PAID + inventory sold + invoice emitted
 *   - idempotent replay (no double deduction / single invoice)
 *   - out-of-order payment.failed after capture is ignored
 *   - payment.failed     → PAYMENT_FAILED + reservation released
 *   - captured amount / currency mismatch → order left unconfirmed + anomaly
 *   - order.paid          → idempotent no-op
 */

import './_safety'
import request from 'supertest'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import {
  clearRazorpayCredentialCache,
  resolveRazorpayCredentials,
} from '../../src/integrations/razorpay/razorpay.client'
import { webhookSignature } from './helpers/razorpay-testkit'

const app = createApp()
const ts = Date.now()

let token: string
let userId: string
let addressId: string
let categoryId: string
let productId: string
let webhookSecret: string

async function createRazorpayOrder(): Promise<{
  orderId: string
  orderNumber: string
  totalRupees: number
  razorpayOrderId: string
}> {
  const res = await request(app)
    .post('/api/v1/checkout')
    .set('Authorization', `Bearer ${token}`)
    .send({
      addressId,
      paymentMethod: 'RAZORPAY',
      items: [{ productId, quantity: 1 }],
    })
  expect(res.status).toBe(201)
  const razorpayOrderId = `order_wh_${ts}_${Math.random().toString(36).slice(2, 8)}`
  await prisma.payment.update({
    where: { orderId: res.body.orderId },
    data: { razorpayOrderId },
  })
  return {
    orderId: res.body.orderId,
    orderNumber: res.body.orderNumber,
    totalRupees: res.body.total,
    razorpayOrderId,
  }
}

function capturedBody(params: {
  razorpayOrderId: string
  paymentId: string
  amountPaise: number
  currency?: string
  method?: string
}): string {
  return JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: params.paymentId,
          order_id: params.razorpayOrderId,
          amount: params.amountPaise,
          currency: params.currency ?? 'INR',
          status: 'captured',
          method: params.method ?? 'upi',
        },
      },
    },
  })
}

async function postWebhook(body: string, signature?: string) {
  const req = request(app)
    .post('/api/v1/payments/razorpay/webhook')
    .set('Content-Type', 'application/json')
  if (signature !== undefined) req.set('x-razorpay-signature', signature)
  return req.send(body)
}

beforeAll(async () => {
  await prisma.paymentSettings.deleteMany({ where: { id: 'default' } }).catch(() => {})
  clearRazorpayCredentialCache()
  webhookSecret = (await resolveRazorpayCredentials(true)).webhookSecret

  const phone = `93${(ts % 100000000).toString().padStart(8, '0')}`
  const reg = await AuthService.register({
    fullName: 'Webhook Customer',
    email: `pay_wh_${ts}@vedhictest.com`,
    phone,
    password: 'SecurePassword123!',
  })
  token = reg.accessToken
  userId = reg.user.id

  const addr = await prisma.address.create({
    data: {
      userId,
      fullName: 'Webhook Customer',
      phone: '9999999903',
      line1: '3 Webhook Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      isDefault: true,
    },
  })
  addressId = addr.id

  const cat = await prisma.category.create({
    data: { name: `Webhook Cat ${ts}`, slug: `wh-cat-${ts}` },
  })
  categoryId = cat.id

  const product = await prisma.product.create({
    data: {
      name: `Webhook Product ${ts}`,
      slug: `wh-product-${ts}`,
      sku: `WH-${ts}`,
      price: 750,
      mrp: 900,
      stock: 200,
      categoryId,
      unit: 'kg',
      isActive: true,
      status: 'PUBLISHED',
      inventory: {
        create: { availableQuantity: 200, reservedQuantity: 0, soldQuantity: 0 },
      },
    },
  })
  productId = product.id
})

afterAll(async () => {
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

describe('Webhook signature security', () => {
  it('rejects a webhook with no x-razorpay-signature header (400)', async () => {
    const res = await postWebhook(JSON.stringify({ event: 'payment.captured' }))
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('rejects a webhook with an invalid signature (401)', async () => {
    const body = capturedBody({
      razorpayOrderId: 'order_x',
      paymentId: 'pay_x',
      amountPaise: 100,
    })
    const res = await postWebhook(body, 'deadbeef')
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('verifies the signature over the EXACT bytes received (raw-body integrity)', async () => {
    const { razorpayOrderId, totalRupees } = await createRazorpayOrder()
    const signed = capturedBody({
      razorpayOrderId,
      paymentId: `pay_bytes_${ts}`,
      amountPaise: Math.round(totalRupees * 100),
    })
    const signature = webhookSignature(signed, webhookSecret)

    // Same logical event, one extra property — different bytes, same signature.
    // A JSON re-serialisation would (wrongly) accept this; raw-byte hashing must not.
    const tampered = JSON.stringify({ ...JSON.parse(signed), injected: true })
    const res = await postWebhook(tampered, signature)
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })
})

describe('payment.captured — genuine confirmation + invoice', () => {
  it('confirms the order, deducts inventory and emits the tax invoice', async () => {
    const { orderId, razorpayOrderId, totalRupees } = await createRazorpayOrder()
    const paymentId = `pay_cap_${ts}`

    const before = await prisma.inventory.findFirst({ where: { productId } })

    const body = capturedBody({
      razorpayOrderId,
      paymentId,
      amountPaise: Math.round(totalRupees * 100),
    })
    const res = await postWebhook(body, webhookSignature(body, webhookSecret))
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const orderDb = await prisma.order.findUnique({ where: { id: orderId } })
    expect(orderDb?.status).toBe('CONFIRMED')
    expect(orderDb?.paymentStatus).toBe('PAID')

    const paymentDb = await prisma.payment.findUnique({ where: { orderId } })
    expect(paymentDb?.status).toBe('CAPTURED')
    expect(paymentDb?.razorpayPaymentId).toBe(paymentId)

    // Inventory genuinely moved from reserved → sold.
    const after = await prisma.inventory.findFirst({ where: { productId } })
    expect(Number(after?.soldQuantity)).toBe(Number(before?.soldQuantity) + 1)
    expect(Number(after?.reservedQuantity)).toBeLessThan(Number(before?.reservedQuantity))

    // Tax invoice generated for the paid order (customer + admin copies emailed,
    // simulated under NODE_ENV=test).
    const invoice = await prisma.invoice.findUnique({ where: { orderId } })
    expect(invoice).not.toBeNull()
    expect(invoice?.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/)
    expect(Number(invoice?.total)).toBeCloseTo(Number(orderDb?.total), 2)
    expect(invoice?.paymentStatus).toBe('PAID')
  })

  it('is idempotent on replay — no double deduction, single invoice', async () => {
    const { orderId, razorpayOrderId, totalRupees } = await createRazorpayOrder()
    const paymentId = `pay_replay_${ts}`
    const body = capturedBody({
      razorpayOrderId,
      paymentId,
      amountPaise: Math.round(totalRupees * 100),
    })
    const sig = webhookSignature(body, webhookSecret)

    const before = await prisma.inventory.findFirst({ where: { productId } })
    await postWebhook(body, sig)
    const mid = await prisma.inventory.findFirst({ where: { productId } })
    await postWebhook(body, sig)
    const after = await prisma.inventory.findFirst({ where: { productId } })

    // Second delivery must be a no-op.
    expect(Number(after?.soldQuantity)).toBe(Number(mid?.soldQuantity))
    expect(Number(mid?.soldQuantity)).toBe(Number(before?.soldQuantity) + 1)

    const invoices = await prisma.invoice.findMany({ where: { orderId } })
    expect(invoices).toHaveLength(1)
  })

  it('ignores a late payment.failed that arrives after capture (out of order)', async () => {
    const { orderId, razorpayOrderId, totalRupees } = await createRazorpayOrder()
    const paymentId = `pay_ooo_${ts}`
    const captureBody = capturedBody({
      razorpayOrderId,
      paymentId,
      amountPaise: Math.round(totalRupees * 100),
    })
    await postWebhook(captureBody, webhookSignature(captureBody, webhookSecret))

    const failBody = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: razorpayOrderId,
            status: 'failed',
            error_code: 'GATEWAY_ERROR',
            error_description: 'late failure',
          },
        },
      },
    })
    const res = await postWebhook(failBody, webhookSignature(failBody, webhookSecret))
    expect(res.status).toBe(200)

    const orderDb = await prisma.order.findUnique({ where: { id: orderId } })
    expect(orderDb?.status).toBe('CONFIRMED')
    expect(orderDb?.paymentStatus).toBe('PAID')
    const paymentDb = await prisma.payment.findUnique({ where: { orderId } })
    expect(paymentDb?.status).toBe('CAPTURED')
  })
})

describe('payment.captured — reconciliation rejects', () => {
  it('leaves the order unconfirmed when the captured amount is short', async () => {
    const { orderId, razorpayOrderId, totalRupees } = await createRazorpayOrder()
    const body = capturedBody({
      razorpayOrderId,
      paymentId: `pay_short_${ts}`,
      amountPaise: Math.round(totalRupees * 100) - 100,
    })
    const res = await postWebhook(body, webhookSignature(body, webhookSecret))
    expect(res.status).toBe(200)

    const orderDb = await prisma.order.findUnique({ where: { id: orderId } })
    expect(orderDb?.status).toBe('PENDING_PAYMENT')
    expect(orderDb?.paymentStatus).toBe('PENDING')
    expect(await prisma.invoice.findUnique({ where: { orderId } })).toBeNull()

    const anomaly = await prisma.auditLog.findFirst({
      where: { action: 'PAYMENT_GATEWAY_AMOUNT_MISMATCH' },
      orderBy: { createdAt: 'desc' },
    })
    expect(anomaly).not.toBeNull()
  })

  it('leaves the order unconfirmed on a currency mismatch', async () => {
    const { orderId, razorpayOrderId, totalRupees } = await createRazorpayOrder()
    const body = capturedBody({
      razorpayOrderId,
      paymentId: `pay_ccy_${ts}`,
      amountPaise: Math.round(totalRupees * 100),
      currency: 'USD',
    })
    const res = await postWebhook(body, webhookSignature(body, webhookSecret))
    expect(res.status).toBe(200)

    const orderDb = await prisma.order.findUnique({ where: { id: orderId } })
    expect(orderDb?.status).toBe('PENDING_PAYMENT')

    const anomaly = await prisma.auditLog.findFirst({
      where: { action: 'PAYMENT_GATEWAY_CURRENCY_MISMATCH' },
      orderBy: { createdAt: 'desc' },
    })
    expect(anomaly).not.toBeNull()
  })
})

describe('payment.failed — genuine failure path', () => {
  it('marks the order PAYMENT_FAILED and releases the inventory reservation', async () => {
    const { orderId, razorpayOrderId } = await createRazorpayOrder()
    const before = await prisma.inventory.findFirst({ where: { productId } })

    const body = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: `pay_fail_${ts}`,
            order_id: razorpayOrderId,
            status: 'failed',
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'Payment declined by bank',
          },
        },
      },
    })
    const res = await postWebhook(body, webhookSignature(body, webhookSecret))
    expect(res.status).toBe(200)

    const orderDb = await prisma.order.findUnique({ where: { id: orderId } })
    expect(orderDb?.status).toBe('PAYMENT_FAILED')
    expect(orderDb?.paymentStatus).toBe('FAILED')

    const paymentDb = await prisma.payment.findUnique({ where: { orderId } })
    expect(paymentDb?.status).toBe('FAILED')
    expect(paymentDb?.failureCode).toBe('BAD_REQUEST_ERROR')

    const after = await prisma.inventory.findFirst({ where: { productId } })
    expect(Number(after?.reservedQuantity)).toBeLessThan(Number(before?.reservedQuantity))
  })
})

describe('order.paid — idempotent no-op', () => {
  it('accepts the event without erroring', async () => {
    const body = JSON.stringify({
      event: 'order.paid',
      payload: {
        payment: { entity: { id: `pay_op_${ts}`, order_id: `order_op_${ts}`, amount: 100 } },
      },
    })
    const res = await postWebhook(body, webhookSignature(body, webhookSecret))
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})
