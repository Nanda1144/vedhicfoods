import './_safety'
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentRecordStatus,
  DeliveryStatus,
} from '@prisma/client'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { CheckoutService } from '../../src/services/checkout.service'
import { BrevoEmailService } from '../../src/integrations/brevo/brevo.service'
import { OrderEmailService } from '../../src/services/order-email.service'
import {
  razorpayClient,
  clearRazorpayCredentialCache,
  resolveRazorpayCredentials,
} from '../../src/integrations/razorpay/razorpay.client'
import { webhookSignature } from './helpers/razorpay-testkit'

/**
 * Order lifecycle & payment integrity.
 *
 * Complements `admin-order-management` / `refund-order` / `delivery-extended`
 * with the end-to-end path those suites leave open:
 *   - a genuine payment.captured webhook drives PENDING_PAYMENT → CONFIRMED,
 *     then the admin walks the order to DELIVERED with an audit entry per step
 *   - the two transition endpoints disagree by design: the admin `PUT` answers
 *     409 (with the legal set) while the state-machine `PATCH` answers 400; both
 *     leave the row untouched
 *   - a genuine payment.failed webhook and its reservation release, then a retry
 *   - cancellation inventory disposition for a deducted order (restock), a
 *     FAILED order (inert) and a never-reserved PENDING order (inert)
 *   - refunds do not mutate the captured amount / gateway ids; a duplicate
 *     refund is refused
 *   - delivery failure/recovery and the COD capture that happens on DELIVERED,
 *     including that a terminal delivery cannot recapture the payment
 *   - a duplicate capture webhook cannot overwrite an already-captured record
 */

const app = createApp()
const API = '/api/v1'
const TAG = String(Date.now())
const ADMIN_EMAIL = 'admin@vedhicfoods.com'
const ADMIN_PASSWORD = 'Admin@Vedhic2026'

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

const createdOrderIds: string[] = []
const createdUserIds: string[] = []
const createdProductIds: string[] = []
const createdCategoryIds: string[] = []

let adminToken: string
let adminId: string
let owner: { id: string; email: string; token: string }
let categoryId: string
let webhookSecret: string

const inlineAddress = {
  fullName: 'Lifecycle Customer',
  phone: '9876500033',
  line1: '33 Lifecycle Street',
  city: 'Hyderabad',
  state: 'Telangana',
  pincode: '500001',
  country: 'India',
}

async function createProduct(stock = 100, price = 250): Promise<string> {
  const suffix = Math.floor(Math.random() * 1e9)
  const product = await prisma.product.create({
    data: {
      name: `Lifecycle Product ${suffix}`,
      slug: `lifecycle-prod-${suffix}`,
      sku: `SKU-LC-${suffix}`,
      categoryId,
      price,
      mrp: price + 25,
      stock,
      unit: 'kg',
      isActive: true,
      status: 'PUBLISHED',
      inventory: {
        create: { availableQuantity: stock, reservedQuantity: 0, soldQuantity: 0 },
      },
    },
  })
  createdProductIds.push(product.id)
  return product.id
}

async function checkout(
  productId: string,
  quantity: number,
  paymentMethod: PaymentMethod
): Promise<{ orderId: string; orderNumber: string; total: number }> {
  const { response } = await CheckoutService.processCheckout(owner.id, {
    address: inlineAddress,
    items: [{ productId, quantity }],
    paymentMethod,
  })
  createdOrderIds.push(response.orderId)
  return { orderId: response.orderId, orderNumber: response.orderNumber, total: response.total }
}

interface DirectOrderOptions {
  ref: string
  status: OrderStatus
  paymentStatus: PaymentStatus
  paymentMethod?: PaymentMethod
  total: number
  productId?: string
  quantity?: number
  payment?: {
    status: PaymentRecordStatus
    amount?: number
    razorpayOrderId?: string | null
    razorpayPaymentId?: string | null
    verifiedAt?: Date | null
  }
}

async function createDirectOrder(opts: DirectOrderOptions): Promise<{ orderId: string; paymentId?: string }> {
  const order = await prisma.order.create({
    data: {
      orderNumber: `VF-LC-${TAG}-${opts.ref}`,
      userId: owner.id,
      customerName: `Lifecycle ${opts.ref}`,
      customerEmail: `lifecycle.${opts.ref}.${TAG}@vedhicfoods.com`,
      phone: '9876500033',
      subtotal: opts.total,
      total: opts.total,
      shipping: 0,
      tax: 0,
      discount: 0,
      currency: 'INR',
      status: opts.status,
      paymentStatus: opts.paymentStatus,
      paymentMethod: opts.paymentMethod ?? PaymentMethod.RAZORPAY,
      items: {
        create: [
          {
            productId: opts.productId ?? null,
            name: 'Lifecycle Line',
            sku: 'SKU-LC-LINE',
            price: opts.total,
            quantity: opts.quantity ?? 1,
            subtotal: opts.total,
          },
        ],
      },
      ...(opts.payment
        ? {
            payment: {
              create: {
                status: opts.payment.status,
                method: opts.paymentMethod ?? PaymentMethod.RAZORPAY,
                amount: opts.payment.amount ?? opts.total,
                currency: 'INR',
                razorpayOrderId: opts.payment.razorpayOrderId ?? null,
                razorpayPaymentId: opts.payment.razorpayPaymentId ?? null,
                verifiedAt: opts.payment.verifiedAt ?? null,
              },
            },
          }
        : {}),
    },
    include: { payment: true },
  })
  createdOrderIds.push(order.id)
  return { orderId: order.id, paymentId: order.payment?.id }
}

function capturedBody(params: {
  razorpayOrderId: string
  paymentId: string
  amountPaise: number
}): string {
  return JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: params.paymentId,
          order_id: params.razorpayOrderId,
          amount: params.amountPaise,
          currency: 'INR',
          status: 'captured',
          method: 'upi',
        },
      },
    },
  })
}

async function postWebhook(body: string, signature: string) {
  return request(app)
    .post(`${API}/payments/razorpay/webhook`)
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', signature)
    .send(body)
}

function orderAudits(orderId: string, action?: string) {
  return prisma.auditLog.findMany({
    where: { entityId: orderId, ...(action ? { action } : {}) },
    orderBy: { createdAt: 'asc' },
  })
}

describe('Order Lifecycle & Payments', () => {
  let refundSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    await prisma.paymentSettings.deleteMany({ where: { id: 'default' } }).catch(() => {})
    clearRazorpayCredentialCache()
    webhookSecret = (await resolveRazorpayCredentials(true)).webhookSecret

    vi.spyOn(BrevoEmailService, 'sendTransactionalEmail').mockResolvedValue('lifecycle-suite')
    vi.spyOn(OrderEmailService, 'paymentConfirmed').mockResolvedValue(undefined as any)
    vi.spyOn(OrderEmailService, 'notifyAdminPaidOrder').mockResolvedValue(undefined as any)
    vi.spyOn(OrderEmailService, 'paymentFailed').mockResolvedValue(undefined as any)
    vi.spyOn(OrderEmailService, 'orderCancelled').mockResolvedValue(undefined as any)
    vi.spyOn(OrderEmailService, 'refundProcessed').mockResolvedValue(undefined as any)
    vi.spyOn(OrderEmailService, 'deliveryUpdate').mockResolvedValue(undefined as any)

    const adminLogin = await AuthService.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    adminToken = adminLogin.accessToken
    adminId = adminLogin.user.id

    const reg = await AuthService.register({
      fullName: 'Lifecycle Owner',
      email: `lifecycle.owner.${TAG}@vedhicfoods.com`,
      password: 'Lifecycle@Vedhic2026!',
    })
    owner = { id: reg.user.id, email: reg.user.email, token: reg.accessToken }
    createdUserIds.push(owner.id)

    const category = await prisma.category.create({
      data: { name: `Lifecycle Cat ${TAG}`, slug: `lifecycle-cat-${TAG}` },
    })
    categoryId = category.id
    createdCategoryIds.push(category.id)
  }, 180000)

  afterAll(async () => {
    vi.restoreAllMocks()
    const orderIds = [...new Set(createdOrderIds)]
    await prisma.deliveryHistory.deleteMany({ where: { delivery: { orderId: { in: orderIds } } } }).catch(() => {})
    await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {})
    await prisma.invoice.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {})
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {})
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {})
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { entityId: { in: orderIds } } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [...createdUserIds, adminId] } } }).catch(() => {})
    await prisma.userPermission.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {})
    await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {})
    await prisma.inventoryLog.deleteMany({ where: { productId: { in: createdProductIds } } }).catch(() => {})
    await prisma.inventory.deleteMany({ where: { productId: { in: createdProductIds } } }).catch(() => {})
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } }).catch(() => {})
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } }).catch(() => {})
  }, 180000)

  // =========================================================================
  // 1. FULL LIFECYCLE VIA PAYMENT CAPTURE + ADMIN WALK
  // =========================================================================
  describe('capture then fulfilment walk', () => {
    let orderId: string
    let productId: string
    let total: number

    beforeAll(async () => {
      productId = await createProduct(50, 250)
      const result = await checkout(productId, 2, PaymentMethod.RAZORPAY)
      orderId = result.orderId
      total = result.total
      await prisma.payment.update({
        where: { orderId },
        data: { razorpayOrderId: `order_lc_${TAG}` },
      })
    })

    it('starts PENDING_PAYMENT with a reservation only', async () => {
      const order = await prisma.order.findUnique({ where: { id: orderId } })
      expect(order?.status).toBe('PENDING_PAYMENT')
      expect(order?.paymentStatus).toBe('PENDING')
      const inv = await prisma.inventory.findUnique({ where: { productId } })
      expect(Number(inv?.reservedQuantity)).toBe(2)
      expect(Number(inv?.soldQuantity)).toBe(0)
    })

    it('a signed payment.captured webhook confirms the order and moves reserved → sold', async () => {
      const body = capturedBody({
        razorpayOrderId: `order_lc_${TAG}`,
        paymentId: `pay_lc_${TAG}`,
        amountPaise: Math.round(total * 100),
      })
      const res = await postWebhook(body, webhookSignature(body, webhookSecret))
      expect(res.status).toBe(200)

      const order = await prisma.order.findUnique({ where: { id: orderId } })
      expect(order?.status).toBe('CONFIRMED')
      expect(order?.paymentStatus).toBe('PAID')

      const payment = await prisma.payment.findUnique({ where: { orderId } })
      expect(payment?.status).toBe('CAPTURED')
      expect(payment?.razorpayPaymentId).toBe(`pay_lc_${TAG}`)

      const inv = await prisma.inventory.findUnique({ where: { productId } })
      expect(Number(inv?.soldQuantity)).toBe(2)
      expect(Number(inv?.reservedQuantity)).toBe(0)

      const invoice = await prisma.invoice.findUnique({ where: { orderId } })
      expect(invoice).not.toBeNull()

      // The capture is audited against the Payment entity.
      const audits = await prisma.auditLog.findMany({
        where: { entityId: payment!.id, action: 'PAYMENT_CONFIRMED' },
      })
      expect(audits.length).toBeGreaterThanOrEqual(1)
      expect(audits[0].metadata).toMatchObject({
        source: 'razorpay_webhook',
        event: 'payment.captured',
        razorpayPaymentId: `pay_lc_${TAG}`,
        razorpayOrderId: `order_lc_${TAG}`,
      })

      // Keep the money trail honest: the signature is never stored in the API
      // projection, but the record exists in the DB as the gateway artifact.
      expect(payment?.razorpaySignature).toBeNull()
    })

    it('walks CONFIRMED → PROCESSING → PACKED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED with an audit per step', async () => {
      const sequence: OrderStatus[] = [
        OrderStatus.PROCESSING,
        OrderStatus.PACKED,
        OrderStatus.SHIPPED,
        OrderStatus.OUT_FOR_DELIVERY,
        OrderStatus.DELIVERED,
      ]
      let previous: OrderStatus = OrderStatus.CONFIRMED
      for (const target of sequence) {
        const res = await request(app)
          .put(`${API}/admin/orders/${orderId}/status`)
          .set(auth(adminToken))
          .send({ status: target })
        expect(res.status, `${previous} -> ${target}`).toBe(200)
        expect(res.body.status).toBe(target)

        const db = await prisma.order.findUnique({ where: { id: orderId } })
        expect(db?.status).toBe(target)

        const audit = await orderAudits(orderId, 'ORDER_STATUS_UPDATED')
        expect(
          audit.find(
            (a) =>
              (a.metadata as any).previousStatus === previous &&
              (a.metadata as any).newStatus === target
          ),
          `audit ${previous} -> ${target}`
        ).toBeDefined()
        previous = target
      }
      expect(await orderAudits(orderId, 'ORDER_STATUS_UPDATED')).toHaveLength(5)
    })

    it('rejects an illegal transition after DELIVERED with 409 and no state/audit change', async () => {
      const auditsBefore = await orderAudits(orderId, 'ORDER_STATUS_UPDATED')
      const res = await request(app)
        .put(`${API}/admin/orders/${orderId}/status`)
        .set(auth(adminToken))
        .send({ status: OrderStatus.PROCESSING })
      expect(res.status).toBe(409)
      expect(res.body.allowedTransitions).toEqual([])

      const db = await prisma.order.findUnique({ where: { id: orderId } })
      expect(db?.status).toBe('DELIVERED')
      expect(await orderAudits(orderId, 'ORDER_STATUS_UPDATED')).toHaveLength(auditsBefore.length)
    })

    it('rejects the same illegal transition on the state-machine endpoint with 400 and no state/audit change', async () => {
      const auditsBefore = await orderAudits(orderId, 'ORDER_STATUS_UPDATED')
      const res = await request(app)
        .patch(`${API}/orders/${orderId}/status`)
        .set(auth(adminToken))
        .send({ status: OrderStatus.PROCESSING })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/invalid order status transition/i)

      const db = await prisma.order.findUnique({ where: { id: orderId } })
      expect(db?.status).toBe('DELIVERED')
      expect(await orderAudits(orderId, 'ORDER_STATUS_UPDATED')).toHaveLength(auditsBefore.length)
    })
  })

  // =========================================================================
  // 2. PAYMENT FAILURE VIA WEBHOOK + RETRY
  // =========================================================================
  describe('payment failure', () => {
    it('a payment.failed webhook marks the order PAYMENT_FAILED and releases the reservation', async () => {
      const productId = await createProduct(20, 100)
      const { orderId } = await checkout(productId, 3, PaymentMethod.RAZORPAY)
      await prisma.payment.update({
        where: { orderId },
        data: { razorpayOrderId: `order_pf_${TAG}` },
      })

      const before = await prisma.inventory.findUnique({ where: { productId } })
      expect(Number(before?.reservedQuantity)).toBe(3)

      const body = JSON.stringify({
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: `pay_pf_${TAG}`,
              order_id: `order_pf_${TAG}`,
              status: 'failed',
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'Payment declined by bank',
            },
          },
        },
      })
      const res = await postWebhook(body, webhookSignature(body, webhookSecret))
      expect(res.status).toBe(200)

      const order = await prisma.order.findUnique({ where: { id: orderId } })
      expect(order?.status).toBe('PAYMENT_FAILED')
      expect(order?.paymentStatus).toBe('FAILED')

      const payment = await prisma.payment.findUnique({ where: { orderId } })
      expect(payment?.status).toBe('FAILED')
      expect(payment?.failureCode).toBe('BAD_REQUEST_ERROR')

      const after = await prisma.inventory.findUnique({ where: { productId } })
      expect(Number(after?.reservedQuantity)).toBe(Number(before?.reservedQuantity) - 3)
      expect(Number(after?.soldQuantity)).toBe(0)
    })

    it('permits a retry (PAYMENT_FAILED → PENDING_PAYMENT) through the admin endpoint', async () => {
      const productId = await createProduct(20, 100)
      const { orderId } = await checkout(productId, 1, PaymentMethod.RAZORPAY)
      await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.PAYMENT_FAILED } })

      const res = await request(app)
        .put(`${API}/admin/orders/${orderId}/status`)
        .set(auth(adminToken))
        .send({ status: OrderStatus.PENDING_PAYMENT })
      expect(res.status).toBe(200)

      const db = await prisma.order.findUnique({ where: { id: orderId } })
      expect(db?.status).toBe('PENDING_PAYMENT')
      const audits = await orderAudits(orderId, 'ORDER_STATUS_UPDATED')
      expect(audits.some((a) => (a.metadata as any).newStatus === 'PENDING_PAYMENT')).toBe(true)
    })
  })

  // =========================================================================
  // 3. CANCELLATION INVENTORY DISPOSITION
  // =========================================================================
  describe('cancellation inventory disposition', () => {
    it('restocks a shipped (deducted) order and cancels its delivery', async () => {
      const productId = await createProduct(30, 150)
      const base = await prisma.inventory.findUnique({ where: { productId } })
      const { orderId } = await checkout(productId, 4, PaymentMethod.COD)

      // Move it onto the road through the admin state machine.
      for (const status of [OrderStatus.PACKED, OrderStatus.SHIPPED]) {
        const r = await request(app)
          .put(`${API}/admin/orders/${orderId}/status`)
          .set(auth(adminToken))
          .send({ status })
        expect(r.status).toBe(200)
      }

      const deducted = await prisma.inventory.findUnique({ where: { productId } })
      expect(Number(deducted?.soldQuantity)).toBe(4)

      const res = await request(app)
        .post(`${API}/orders/${orderId}/cancel`)
        .set(auth(owner.token))
        .send({ reason: 'Customer cancelled on the road' })
      expect(res.status).toBe(200)

      const inv = await prisma.inventory.findUnique({ where: { productId } })
      expect(Number(inv?.soldQuantity)).toBe(Number(base?.soldQuantity))
      expect(Number(inv?.availableQuantity)).toBe(Number(base?.availableQuantity))

      const restock = await prisma.inventoryLog.findFirst({ where: { orderId, operation: 'RESTOCK' } })
      expect(restock).not.toBeNull()

      const delivery = await prisma.delivery.findUnique({ where: { orderId } })
      expect(delivery?.status).toBe('CANCELLED')

      const audit = await orderAudits(orderId, 'ORDER_CANCELLED')
      expect(audit).toHaveLength(1)
      expect(audit[0].metadata).toMatchObject({ previousStatus: 'SHIPPED' })

      const again = await request(app)
        .post(`${API}/orders/${orderId}/cancel`)
        .set(auth(owner.token))
        .send({})
      expect(again.status).toBe(400)
    })

    it('leaves a FAILED order inert on cancellation (stock was already disposed of)', async () => {
      const productId = await createProduct(10, 100)
      const before = await prisma.inventory.findUnique({ where: { productId } })
      const { orderId } = await createDirectOrder({
        ref: `FAILED-${Math.floor(Math.random() * 1e9)}`,
        status: OrderStatus.FAILED,
        paymentStatus: PaymentStatus.FAILED,
        total: 100,
        productId,
        quantity: 2,
        payment: { status: PaymentRecordStatus.FAILED },
      })

      const res = await request(app)
        .post(`${API}/orders/${orderId}/cancel`)
        .set(auth(owner.token))
        .send({ reason: 'cleanup' })
      expect(res.status).toBe(200)

      const db = await prisma.order.findUnique({ where: { id: orderId } })
      expect(db?.status).toBe('CANCELLED')

      const after = await prisma.inventory.findUnique({ where: { productId } })
      expect(Number(after?.availableQuantity)).toBe(Number(before?.availableQuantity))
      expect(Number(after?.soldQuantity)).toBe(Number(before?.soldQuantity))
      const restock = await prisma.inventoryLog.findFirst({ where: { orderId, operation: 'RESTOCK' } })
      expect(restock).toBeNull()
      const release = await prisma.inventoryLog.findFirst({
        where: { orderId, operation: 'RELEASE_RESERVATION' },
      })
      expect(release).toBeNull()
    })

    it('never credits inventory for a PENDING order that reserved nothing', async () => {
      const productId = await createProduct(10, 100)
      const before = await prisma.inventory.findUnique({ where: { productId } })
      const { orderId } = await createDirectOrder({
        ref: `PENDING-${Math.floor(Math.random() * 1e9)}`,
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.PENDING,
        total: 100,
        productId,
        quantity: 3,
      })

      const res = await request(app)
        .post(`${API}/orders/${orderId}/cancel`)
        .set(auth(owner.token))
        .send({})
      expect(res.status).toBe(200)

      const db = await prisma.order.findUnique({ where: { id: orderId } })
      expect(db?.status).toBe('CANCELLED')

      const after = await prisma.inventory.findUnique({ where: { productId } })
      expect(Number(after?.availableQuantity)).toBe(Number(before?.availableQuantity))
      expect(Number(after?.soldQuantity)).toBe(Number(before?.soldQuantity))
      expect(Number(after?.reservedQuantity)).toBe(Number(before?.reservedQuantity))
      const restock = await prisma.inventoryLog.findFirst({ where: { orderId, operation: 'RESTOCK' } })
      expect(restock).toBeNull()
    })
  })

  // =========================================================================
  // 4. REFUNDS & PAYMENT IMMUTABILITY
  // =========================================================================
  describe('refund workflow & payment immutability', () => {
    beforeEach(() => {
      refundSpy = vi
        .spyOn(razorpayClient.payments, 'refund')
        .mockImplementation(async (_id: string, options: any) => ({
          id: `rfnd_lc_${TAG}`,
          entity: 'refund',
          amount: options?.amount,
          currency: 'INR',
          payment_id: _id,
          status: 'processed',
          speed_processed: 'normal',
          created_at: Math.floor(Date.now() / 1000),
        } as any))
    })

    afterEach(() => {
      refundSpy?.mockRestore()
    })

    it('a full refund marks the payment REFUNDED without altering the captured amount or gateway ids', async () => {
      const verifiedAt = new Date(Date.now() - 3600_000)
      const { orderId, paymentId } = await createDirectOrder({
        ref: `RF-${Math.floor(Math.random() * 1e9)}`,
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        total: 800,
        payment: {
          status: PaymentRecordStatus.CAPTURED,
          amount: 800,
          razorpayOrderId: `order_lcrf_${TAG}`,
          razorpayPaymentId: `pay_lcrf_${TAG}`,
          verifiedAt,
        },
      })
      const before = await prisma.payment.findUnique({ where: { id: paymentId! } })

      const res = await request(app)
        .post(`${API}/admin/orders/${orderId}/refund`)
        .set(auth(adminToken))
        .send({ reason: 'Customer returned the item' })
      expect(res.status).toBe(200)
      expect(res.body.data).toMatchObject({ orderId, amount: 800 })

      const after = await prisma.payment.findUnique({ where: { id: paymentId! } })
      expect(after?.status).toBe('REFUNDED')
      // History is immutable: amount and gateway identifiers are untouched.
      expect(Number(after?.amount)).toBe(Number(before?.amount))
      expect(after?.razorpayOrderId).toBe(before?.razorpayOrderId)
      expect(after?.razorpayPaymentId).toBe(before?.razorpayPaymentId)
      expect(after?.verifiedAt?.toISOString()).toBe(before?.verifiedAt?.toISOString())

      const order = await prisma.order.findUnique({ where: { id: orderId } })
      expect(order?.paymentStatus).toBe('REFUNDED')
      expect(Number(order?.total)).toBe(800)

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: paymentId!, action: 'PAYMENT_REFUNDED' },
      })
      expect(audit).not.toBeNull()
      expect(audit!.actorId).toBe(adminId)
      expect(audit!.metadata).toMatchObject({ orderId, fullRefund: true, refundAmount: 800 })
    })

    it('refuses a second refund and records no second audit entry', async () => {
      const { orderId, paymentId } = await createDirectOrder({
        ref: `RF2-${Math.floor(Math.random() * 1e9)}`,
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        total: 400,
        payment: {
          status: PaymentRecordStatus.CAPTURED,
          amount: 400,
          razorpayOrderId: `order_lcrf2_${TAG}`,
          razorpayPaymentId: `pay_lcrf2_${TAG}`,
        },
      })

      const first = await request(app)
        .post(`${API}/admin/orders/${orderId}/refund`)
        .set(auth(adminToken))
        .send({})
      expect(first.status).toBe(200)

      const second = await request(app)
        .post(`${API}/admin/orders/${orderId}/refund`)
        .set(auth(adminToken))
        .send({})
      expect(second.status).toBe(400)

      const payment = await prisma.payment.findUnique({ where: { id: paymentId! } })
      expect(payment?.status).toBe('REFUNDED')
      const audits = await prisma.auditLog.findMany({
        where: { entityId: paymentId!, action: 'PAYMENT_REFUNDED' },
      })
      expect(audits).toHaveLength(1)
    })

    it('a partial refund leaves the payment CAPTURED and the captured amount untouched', async () => {
      const { orderId, paymentId } = await createDirectOrder({
        ref: `RF3-${Math.floor(Math.random() * 1e9)}`,
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        total: 600,
        payment: {
          status: PaymentRecordStatus.CAPTURED,
          amount: 600,
          razorpayOrderId: `order_lcrf3_${TAG}`,
          razorpayPaymentId: `pay_lcrf3_${TAG}`,
        },
      })

      const res = await request(app)
        .post(`${API}/admin/orders/${orderId}/refund`)
        .set(auth(adminToken))
        .send({ amount: 250, reason: 'Goodwill' })
      expect(res.status).toBe(200)
      expect(res.body.data.amount).toBe(250)

      const payment = await prisma.payment.findUnique({ where: { id: paymentId! } })
      expect(payment?.status).toBe('CAPTURED')
      expect(Number(payment?.amount)).toBe(600)
      expect((payment?.metadata as any)?.refundAmount).toBe(250)

      const order = await prisma.order.findUnique({ where: { id: orderId } })
      expect(order?.paymentStatus).toBe('PARTIALLY_REFUNDED')
      expect(Number(order?.total)).toBe(600)
    })

    it('refuses to refund an uncaptured payment without touching the gateway', async () => {
      const { orderId, paymentId } = await createDirectOrder({
        ref: `RF4-${Math.floor(Math.random() * 1e9)}`,
        status: OrderStatus.PENDING_PAYMENT,
        paymentStatus: PaymentStatus.PENDING,
        total: 300,
        payment: {
          status: PaymentRecordStatus.PENDING,
          amount: 300,
          razorpayOrderId: `order_lcrf4_${TAG}`,
        },
      })

      const res = await request(app)
        .post(`${API}/admin/orders/${orderId}/refund`)
        .set(auth(adminToken))
        .send({})
      expect(res.status).toBe(400)
      expect(refundSpy).not.toHaveBeenCalled()

      const payment = await prisma.payment.findUnique({ where: { id: paymentId! } })
      expect(payment?.status).toBe('PENDING')
    })
  })

  // =========================================================================
  // 5. DELIVERY FAILURE, RECOVERY & COD CAPTURE
  // =========================================================================
  describe('delivery failure, recovery & COD capture', () => {
    async function transition(orderNumberOrId: string, status: DeliveryStatus, notes?: string) {
      return request(app)
        .patch(`${API}/admin/delivery/${orderNumberOrId}/status`)
        .set(auth(adminToken))
        .send({ status, ...(notes ? { notes } : {}) })
    }

    it('fails from SHIPPED (order unchanged), recovers, and captures COD on DELIVERED', async () => {
      const productId = await createProduct(10, 175)
      const { orderId, orderNumber } = await checkout(productId, 1, PaymentMethod.COD)

      expect((await transition(orderNumber, DeliveryStatus.PACKED)).status).toBe(200)
      expect((await transition(orderNumber, DeliveryStatus.SHIPPED)).status).toBe(200)

      const failed = await transition(
        orderNumber,
        DeliveryStatus.FAILED,
        'Courier reported a failed attempt'
      )
      expect(failed.status).toBe(200)

      const delivery = await prisma.delivery.findUnique({ where: { orderId } })
      expect(delivery?.status).toBe('FAILED')

      // A failed attempt does not release stock and does not move the order.
      const orderAfterFail = await prisma.order.findUnique({ where: { id: orderId } })
      expect(orderAfterFail?.status).toBe('SHIPPED')
      const inv = await prisma.inventory.findUnique({ where: { productId } })
      expect(Number(inv?.soldQuantity)).toBe(1)

      const history = await prisma.deliveryHistory.findFirst({
        where: { deliveryId: delivery!.id, status: 'FAILED' },
      })
      expect(history).not.toBeNull()
      const failAudit = await prisma.auditLog.findFirst({
        where: { entityId: delivery!.id, action: 'DELIVERY_STATUS_CHANGED' },
        orderBy: { createdAt: 'desc' },
      })
      expect(failAudit!.metadata).toMatchObject({ from: 'SHIPPED', to: 'FAILED' })

      // Recovery.
      expect((await transition(orderNumber, DeliveryStatus.OUT_FOR_DELIVERY)).status).toBe(200)
      const delivered = await transition(orderNumber, DeliveryStatus.DELIVERED)
      expect(delivered.status).toBe(200)

      const finalDelivery = await prisma.delivery.findUnique({ where: { orderId } })
      expect(finalDelivery?.status).toBe('DELIVERED')
      expect(finalDelivery?.deliveredAt).toBeTruthy()

      const finalOrder = await prisma.order.findUnique({ where: { id: orderId } })
      expect(finalOrder?.status).toBe('DELIVERED')
      expect(finalOrder?.paymentStatus).toBe('PAID')

      const payment = await prisma.payment.findUnique({ where: { orderId } })
      expect(payment?.status).toBe('CAPTURED')
      expect(payment?.verifiedAt).toBeTruthy()
    })

    it('treats a delivered delivery as terminal and never recaptures the payment', async () => {
      const productId = await createProduct(10, 175)
      const { orderId, orderNumber } = await checkout(productId, 1, PaymentMethod.COD)

      for (const status of [
        DeliveryStatus.PACKED,
        DeliveryStatus.SHIPPED,
        DeliveryStatus.OUT_FOR_DELIVERY,
        DeliveryStatus.DELIVERED,
      ]) {
        expect((await transition(orderNumber, status)).status).toBe(200)
      }

      const captured = await prisma.payment.findUnique({ where: { orderId } })
      expect(captured?.status).toBe('CAPTURED')

      const res = await transition(orderNumber, DeliveryStatus.SHIPPED)
      expect(res.status).toBe(400)

      const after = await prisma.payment.findUnique({ where: { orderId } })
      expect(after?.status).toBe('CAPTURED')
      expect(after?.verifiedAt?.toISOString()).toBe(captured?.verifiedAt?.toISOString())
      const delivery = await prisma.delivery.findUnique({ where: { orderId } })
      expect(delivery?.status).toBe('DELIVERED')
    })

    it('a duplicate capture webhook cannot overwrite an already-captured payment', async () => {
      const productId = await createProduct(10, 175)
      const { orderId, total } = await checkout(productId, 1, PaymentMethod.RAZORPAY)
      await prisma.payment.update({
        where: { orderId },
        data: { razorpayOrderId: `order_dup_${TAG}` },
      })

      const firstBody = capturedBody({
        razorpayOrderId: `order_dup_${TAG}`,
        paymentId: `pay_dup_first_${TAG}`,
        amountPaise: Math.round(total * 100),
      })
      expect((await postWebhook(firstBody, webhookSignature(firstBody, webhookSecret))).status).toBe(200)

      const captured = await prisma.payment.findUnique({ where: { orderId } })
      expect(captured?.razorpayPaymentId).toBe(`pay_dup_first_${TAG}`)
      const verifiedAt = captured?.verifiedAt?.toISOString()

      // A second, divergent capture for the same order must be ignored.
      const secondBody = capturedBody({
        razorpayOrderId: `order_dup_${TAG}`,
        paymentId: `pay_dup_second_${TAG}`,
        amountPaise: Math.round(total * 100),
      })
      expect((await postWebhook(secondBody, webhookSignature(secondBody, webhookSecret))).status).toBe(200)

      const after = await prisma.payment.findUnique({ where: { orderId } })
      expect(after?.razorpayPaymentId).toBe(`pay_dup_first_${TAG}`)
      expect(Number(after?.amount)).toBe(Number(captured?.amount))
      expect(after?.verifiedAt?.toISOString()).toBe(verifiedAt)
      expect(after?.status).toBe('CAPTURED')

      // Inventory was deducted exactly once.
      const inv = await prisma.inventory.findUnique({ where: { productId } })
      expect(Number(inv?.soldQuantity)).toBe(1)
    })
  })
})
