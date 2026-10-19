import './_safety'
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentRecordStatus,
  RoleName,
} from '@prisma/client'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { BrevoEmailService } from '../../src/integrations/brevo/brevo.service'
import { OrderEmailService } from '../../src/services/order-email.service'
import { razorpayClient, clearRazorpayCredentialCache } from '../../src/integrations/razorpay/razorpay.client'

/**
 * Refund coverage for the admin order surface:
 *   POST /api/v1/admin/orders/:id/refund
 *
 * The gateway is a test double — no network call is ever made. The suite pins
 * the credential cache to the environment client (the object the double spies
 * on) and asserts the money movement, the resulting order/payment state, the
 * audit entry and the authorization boundaries.
 */

const app = createApp()
const API = '/api/v1'
const TAG = String(Date.now())
const ADMIN_EMAIL = 'admin@vedhicfoods.com'
const ADMIN_PASSWORD = 'Admin@Vedhic2026'
const STAFF_PASSWORD = 'Staff@Vedhic2026'

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

const createdOrderIds = new Set<string>()
const createdUserIds = new Set<string>()
const createdStaffIds = new Set<string>()
const createdProductIds = new Set<string>()
const createdCategoryIds = new Set<string>()

let adminToken: string
let adminId: string
let customerId: string
let customerToken: string
let categoryId: string
let productId: string

async function createOrderWithPayment(opts: {
  amount: number
  paymentStatus?: PaymentRecordStatus
  orderPaymentStatus?: PaymentStatus
  razorpayPaymentId?: string | null
  orderNumber?: string
}): Promise<{ orderId: string; paymentId: string }> {
  const suffix = `${TAG}-${Math.floor(Math.random() * 1e9)}`
  const order = await prisma.order.create({
    data: {
      orderNumber: opts.orderNumber ?? `VF-REFUND-${suffix}`,
      userId: customerId,
      customerName: `Refund Customer ${suffix}`,
      customerEmail: `refund.${suffix}@vedhicfoods.com`,
      phone: '9876500077',
      subtotal: opts.amount,
      total: opts.amount,
      shipping: 0,
      tax: 0,
      discount: 0,
      currency: 'INR',
      status: OrderStatus.CONFIRMED,
      paymentStatus: opts.orderPaymentStatus ?? PaymentStatus.PAID,
      paymentMethod: PaymentMethod.RAZORPAY,
      items: {
        create: [
          {
            productId,
            name: 'Refund Line',
            sku: 'SKU-REFUND-LINE',
            price: opts.amount,
            quantity: 1,
            subtotal: opts.amount,
          },
        ],
      },
      payment: {
        create: {
          status: opts.paymentStatus ?? PaymentRecordStatus.CAPTURED,
          method: PaymentMethod.RAZORPAY,
          amount: opts.amount,
          currency: 'INR',
          razorpayOrderId: `order_refund_${suffix}`,
          razorpayPaymentId:
            opts.razorpayPaymentId === undefined ? `pay_refund_${suffix}` : opts.razorpayPaymentId,
          razorpaySignature: 'refund-signature',
          verifiedAt: new Date(),
        },
      },
    },
    include: { payment: true },
  })
  createdOrderIds.add(order.id)
  return { orderId: order.id, paymentId: order.payment!.id }
}

describe('Admin Order Refunds', () => {
  let refundSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    await prisma.paymentSettings.deleteMany({ where: { id: 'default' } }).catch(() => {})
    clearRazorpayCredentialCache()

    vi.spyOn(BrevoEmailService, 'sendTransactionalEmail').mockResolvedValue('refund-suite')
    vi.spyOn(OrderEmailService, 'refundProcessed').mockResolvedValue(undefined as any)

    const adminLogin = await AuthService.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    adminToken = adminLogin.accessToken
    adminId = adminLogin.user.id

    const reg = await AuthService.register({
      fullName: 'Refund Customer',
      email: `refund.customer.${TAG}@vedhicfoods.com`,
      password: 'RefundCustomer@Vedhic2026!',
    })
    customerId = reg.user.id
    customerToken = reg.accessToken
    createdUserIds.add(customerId)

    const category = await prisma.category.create({
      data: { name: `Refund Cat ${TAG}`, slug: `refund-cat-${TAG}` },
    })
    categoryId = category.id
    createdCategoryIds.add(category.id)

    const product = await prisma.product.create({
      data: {
        name: `Refund Product ${TAG}`,
        slug: `refund-prod-${TAG}`,
        sku: `SKU-REFUND-${TAG}`,
        categoryId,
        price: 100,
        mrp: 120,
        stock: 100,
        unit: 'kg',
        isActive: true,
        status: 'PUBLISHED',
        inventory: { create: { availableQuantity: 100 } },
      },
    })
    productId = product.id
    createdProductIds.add(product.id)
  }, 120000)

  afterAll(async () => {
    vi.restoreAllMocks()
    const orderIds = [...createdOrderIds]
    await prisma.deliveryHistory.deleteMany({ where: { delivery: { orderId: { in: orderIds } } } }).catch(() => {})
    await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {})
    await prisma.invoice.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {})
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {})
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {})
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { entityId: { in: orderIds } } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [adminId, ...createdUserIds, ...createdStaffIds] } } }).catch(() => {})
    await prisma.userPermission.deleteMany({ where: { userId: { in: [...createdStaffIds] } } }).catch(() => {})
    await prisma.userRole.deleteMany({ where: { userId: { in: [...createdStaffIds] } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: [...createdStaffIds] } } }).catch(() => {})
    await prisma.userPermission.deleteMany({ where: { userId: { in: [...createdUserIds] } } }).catch(() => {})
    await prisma.userRole.deleteMany({ where: { userId: { in: [...createdUserIds] } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: [...createdUserIds] } } }).catch(() => {})
    await prisma.inventoryLog.deleteMany({ where: { productId: { in: [...createdProductIds] } } }).catch(() => {})
    await prisma.inventory.deleteMany({ where: { productId: { in: [...createdProductIds] } } }).catch(() => {})
    await prisma.product.deleteMany({ where: { id: { in: [...createdProductIds] } } }).catch(() => {})
    await prisma.category.deleteMany({ where: { id: { in: [...createdCategoryIds] } } }).catch(() => {})
  }, 120000)

  beforeEach(() => {
    refundSpy = vi.spyOn(razorpayClient.payments, 'refund').mockImplementation(async (_id: string, options: any) => ({
      id: `rfnd_${TAG}`,
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

  describe('full refund', () => {
    it('refunds the whole captured amount, marks the payment REFUNDED and writes the audit trail', async () => {
      const { orderId, paymentId } = await createOrderWithPayment({ amount: 500 })

      const res = await request(app)
        .post(`${API}/admin/orders/${orderId}/refund`)
        .set(auth(adminToken))
        .send({ reason: 'Customer returned the product' })
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toMatchObject({ orderId, amount: 500, status: 'processed' })
      expect(res.body.data.refundId).toBeTruthy()

      // Gateway received the amount in paise.
      expect(refundSpy).toHaveBeenCalledTimes(1)
      const [calledPaymentId, calledOptions] = refundSpy.mock.calls[0]
      expect(calledPaymentId).toBeTruthy()
      expect(calledOptions).toMatchObject({ amount: 50000 })
      expect(calledOptions.notes).toMatchObject({ reason: 'Customer returned the product' })

      const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
      expect(payment?.status).toBe('REFUNDED')

      const order = await prisma.order.findUnique({ where: { id: orderId } })
      expect(order?.paymentStatus).toBe('REFUNDED')

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: paymentId, action: 'PAYMENT_REFUNDED' },
      })
      expect(audit).not.toBeNull()
      expect(audit!.actorId).toBe(adminId)
      expect(audit!.metadata).toMatchObject({
        orderId,
        fullRefund: true,
        refundAmount: 500,
      })
    })

    it('accepts an order number in place of the id', async () => {
      const orderNumber = `VF-REFUND-BYNUM-${TAG}`
      const { orderId } = await createOrderWithPayment({ amount: 300, orderNumber })

      const res = await request(app)
        .post(`${API}/admin/orders/${orderNumber}/refund`)
        .set(auth(adminToken))
        .send({})
      expect(res.status).toBe(200)
      expect(res.body.data.orderId).toBe(orderId)

      const order = await prisma.order.findUnique({ where: { id: orderId } })
      expect(order?.paymentStatus).toBe('REFUNDED')
    })
  })

  describe('partial refund', () => {
    it('refunds only the requested amount and leaves the payment CAPTURED', async () => {
      const { orderId, paymentId } = await createOrderWithPayment({ amount: 500 })

      const res = await request(app)
        .post(`${API}/admin/orders/${orderId}/refund`)
        .set(auth(adminToken))
        .send({ amount: 200, reason: 'Goodwill credit' })
      expect(res.status).toBe(200)
      expect(res.body.data.amount).toBe(200)

      expect(refundSpy).toHaveBeenCalledTimes(1)
      expect(refundSpy.mock.calls[0][1]).toMatchObject({ amount: 20000 })

      const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
      expect(payment?.status).toBe('CAPTURED')
      expect((payment?.metadata as any)?.refundAmount).toBe(200)
      expect((payment?.metadata as any)?.refundReason).toBe('Goodwill credit')

      const order = await prisma.order.findUnique({ where: { id: orderId } })
      expect(order?.paymentStatus).toBe('PARTIALLY_REFUNDED')

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: paymentId, action: 'PAYMENT_REFUNDED' },
      })
      expect(audit!.metadata).toMatchObject({ fullRefund: false, refundAmount: 200 })
    })
  })

  describe('validation', () => {
    it('rejects a refund larger than the captured amount (400) without calling the gateway', async () => {
      const { orderId, paymentId } = await createOrderWithPayment({ amount: 500 })

      const res = await request(app)
        .post(`${API}/admin/orders/${orderId}/refund`)
        .set(auth(adminToken))
        .send({ amount: 600 })
      expect(res.status).toBe(400)
      expect(refundSpy).not.toHaveBeenCalled()

      const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
      expect(payment?.status).toBe('CAPTURED')
      const order = await prisma.order.findUnique({ where: { id: orderId } })
      expect(order?.paymentStatus).toBe('PAID')
    })

    it('rejects a non-positive amount (400)', async () => {
      const { orderId } = await createOrderWithPayment({ amount: 500 })

      for (const amount of [0, -50, 'abc']) {
        const res = await request(app)
          .post(`${API}/admin/orders/${orderId}/refund`)
          .set(auth(adminToken))
          .send({ amount })
        expect(res.status, `amount=${amount}`).toBe(400)
      }
      expect(refundSpy).not.toHaveBeenCalled()
    })

    it('rejects refunding an uncaptured payment (400)', async () => {
      const pending = await createOrderWithPayment({
        amount: 400,
        paymentStatus: PaymentRecordStatus.PENDING,
        orderPaymentStatus: PaymentStatus.PENDING,
      })
      const res = await request(app)
        .post(`${API}/admin/orders/${pending.orderId}/refund`)
        .set(auth(adminToken))
        .send({})
      expect(res.status).toBe(400)
      expect(refundSpy).not.toHaveBeenCalled()

      const payment = await prisma.payment.findUnique({ where: { id: pending.paymentId } })
      expect(payment?.status).toBe('PENDING')
    })

    it('refuses to refund an already-refunded payment (400)', async () => {
      const { orderId, paymentId } = await createOrderWithPayment({
        amount: 400,
        paymentStatus: PaymentRecordStatus.REFUNDED,
        orderPaymentStatus: PaymentStatus.REFUNDED,
      })
      const res = await request(app)
        .post(`${API}/admin/orders/${orderId}/refund`)
        .set(auth(adminToken))
        .send({})
      expect(res.status).toBe(400)
      expect(refundSpy).not.toHaveBeenCalled()

      const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
      expect(payment?.status).toBe('REFUNDED')
    })

    it('refuses to refund an order with no payment record (400)', async () => {
      const order = await prisma.order.create({
        data: {
          orderNumber: `VF-REFUND-NOPAY-${TAG}`,
          userId: customerId,
          customerName: 'No Pay',
          customerEmail: `nopay.${TAG}@vedhicfoods.com`,
          phone: '9876500088',
          subtotal: 100,
          total: 100,
          status: OrderStatus.CONFIRMED,
          paymentStatus: PaymentStatus.PENDING,
          paymentMethod: PaymentMethod.RAZORPAY,
        },
      })
      createdOrderIds.add(order.id)

      const res = await request(app)
        .post(`${API}/admin/orders/${order.id}/refund`)
        .set(auth(adminToken))
        .send({})
      expect(res.status).toBe(400)
      expect(refundSpy).not.toHaveBeenCalled()
    })

    it('returns 404 for a nonexistent order', async () => {
      const res = await request(app)
        .post(`${API}/admin/orders/00000000-0000-0000-0000-000000000000/refund`)
        .set(auth(adminToken))
        .send({})
      expect(res.status).toBe(404)
    })
  })

  describe('gateway failure', () => {
    it('surfaces a 500 and leaves both order and payment untouched', async () => {
      refundSpy.mockImplementation(async () => {
        throw new Error('Razorpay API unreachable')
      })
      const { orderId, paymentId } = await createOrderWithPayment({ amount: 500 })

      const res = await request(app)
        .post(`${API}/admin/orders/${orderId}/refund`)
        .set(auth(adminToken))
        .send({})
      expect(res.status).toBe(500)

      const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
      expect(payment?.status).toBe('CAPTURED')
      const order = await prisma.order.findUnique({ where: { id: orderId } })
      expect(order?.paymentStatus).toBe('PAID')

      // A failed attempt must never be recorded as a completed refund.
      const audit = await prisma.auditLog.findFirst({
        where: { entityId: paymentId, action: 'PAYMENT_REFUNDED' },
      })
      expect(audit).toBeNull()
    })
  })

  describe('authorization', () => {
    it('rejects anonymous callers with 401', async () => {
      const { orderId } = await createOrderWithPayment({ amount: 200 })
      const res = await request(app).post(`${API}/admin/orders/${orderId}/refund`).send({})
      expect(res.status).toBe(401)
    })

    it('rejects a customer with 403', async () => {
      const { orderId } = await createOrderWithPayment({ amount: 200 })
      const res = await request(app)
        .post(`${API}/admin/orders/${orderId}/refund`)
        .set(auth(customerToken))
        .send({})
      expect(res.status).toBe(403)
      expect(refundSpy).not.toHaveBeenCalled()
    })

    it('rejects a staff member without orders.update with 403', async () => {
      const email = `refund.staff.readonly.${TAG}@vedhicfoods.com`
      const staff = await prisma.user.create({
        data: {
          email,
          fullName: 'Refund Readonly Staff',
          passwordHash: await AuthService.hashPassword(STAFF_PASSWORD),
          role: RoleName.STAFF,
          isActive: true,
          isVerified: true,
        },
      })
      createdStaffIds.add(staff.id)
      const readPerm = await prisma.permission.findUnique({ where: { slug: 'orders.read' } })
      if (readPerm) {
        await prisma.userPermission.create({
          data: { userId: staff.id, permissionId: readPerm.id, assignedBy: 'REFUND_SUITE' },
        })
      }
      const token = (await AuthService.login({ email, password: STAFF_PASSWORD })).accessToken

      const { orderId } = await createOrderWithPayment({ amount: 200 })
      const res = await request(app)
        .post(`${API}/admin/orders/${orderId}/refund`)
        .set(auth(token))
        .send({})
      expect(res.status).toBe(403)
      expect(refundSpy).not.toHaveBeenCalled()
    })
  })
})
