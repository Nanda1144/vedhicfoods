import './_safety'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentRecordStatus,
  DeliveryStatus,
  RoleName,
} from '@prisma/client'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { CheckoutService } from '../../src/services/checkout.service'
import { BrevoEmailService } from '../../src/integrations/brevo/brevo.service'
import { OrderEmailService } from '../../src/services/order-email.service'

/**
 * Admin order management coverage.
 *
 * Exercises the admin order surface end to end against a real database:
 *  - list filtering (status / payment method / payment status / date), search,
 *    sorting and pagination
 *  - order detail projection (payment / customer / delivery)
 *  - the fulfilment state machine (valid walks + rejected illegal jumps)
 *  - cancellation inventory disposition (restock vs release)
 *  - client-driven payment failure
 *  - payment-record immutability through admin endpoints
 *  - delivery failure handling
 *  - authorization (anon 401, non-owner 404, permissionless staff 403)
 *  - audit trail for every money/stock-affecting action
 */

const app = createApp()
const API = '/api/v1'
const TAG = String(Date.now())
const ADMIN_EMAIL = 'admin@vedhicfoods.com'
const ADMIN_PASSWORD = 'Admin@Vedhic2026'
const STAFF_PASSWORD = 'Staff@Vedhic2026'

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

const createdOrderIds: string[] = []
const createdUserIds: string[] = []
const createdStaffIds: string[] = []
const createdProductIds: string[] = []
const createdCategoryIds: string[] = []

let adminToken: string
let adminId: string
let owner: { id: string; email: string; token: string }
let other: { id: string; email: string; token: string }
let categoryId: string

async function createProduct(stock = 500, price = 100): Promise<string> {
  const suffix = Math.floor(Math.random() * 1e9)
  const product = await prisma.product.create({
    data: {
      name: `Admin Order Product ${suffix}`,
      slug: `admin-order-prod-${suffix}`,
      sku: `SKU-ADMINORD-${suffix}`,
      categoryId,
      price,
      mrp: price + 20,
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

interface CreateOrderOptions {
  userId: string
  customerEmail?: string
  customerName?: string
  status?: OrderStatus
  paymentStatus?: PaymentStatus
  paymentMethod?: PaymentMethod
  subtotal?: number
  total?: number
  createdAt?: Date
  productId?: string
  quantity?: number
  payment?: {
    status: PaymentRecordStatus
    amount?: number
    razorpayOrderId?: string | null
    razorpayPaymentId?: string | null
    razorpaySignature?: string | null
    verifiedAt?: Date | null
  }
  delivery?: { status: DeliveryStatus; courierPartner?: string }
}

async function createOrder(opts: CreateOrderOptions): Promise<string> {
  const suffix = `${TAG}-${Math.floor(Math.random() * 1e9)}`
  const subtotal = opts.subtotal ?? 250
  const total = opts.total ?? subtotal
  const order = await prisma.order.create({
    data: {
      orderNumber: `VF-ADMIN-${suffix}`,
      userId: opts.userId,
      customerName: opts.customerName ?? `Admin Order ${suffix}`,
      customerEmail: opts.customerEmail ?? `admin.order.${suffix}@vedhicfoods.com`,
      phone: '9876500099',
      subtotal,
      total,
      shipping: 0,
      tax: 0,
      discount: 0,
      currency: 'INR',
      status: opts.status ?? OrderStatus.PENDING,
      paymentStatus: opts.paymentStatus ?? PaymentStatus.PENDING,
      paymentMethod: opts.paymentMethod ?? PaymentMethod.RAZORPAY,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      items: {
        create: [
          {
            productId: opts.productId ?? null,
            name: 'Admin Order Line',
            sku: 'SKU-ADMINORD-LINE',
            price: subtotal,
            quantity: opts.quantity ?? 1,
            subtotal,
          },
        ],
      },
      ...(opts.payment
        ? {
            payment: {
              create: {
                status: opts.payment.status,
                method: opts.paymentMethod ?? PaymentMethod.RAZORPAY,
                amount: opts.payment.amount ?? total,
                currency: 'INR',
                razorpayOrderId: opts.payment.razorpayOrderId ?? null,
                razorpayPaymentId: opts.payment.razorpayPaymentId ?? null,
                razorpaySignature: opts.payment.razorpaySignature ?? null,
                verifiedAt: opts.payment.verifiedAt ?? null,
              },
            },
          }
        : {}),
      ...(opts.delivery
        ? {
            delivery: {
              create: {
                status: opts.delivery.status,
                courierPartner: opts.delivery.courierPartner ?? 'Delhivery Express',
                recipientName: 'Admin Order',
                recipientPhone: '9876500099',
              },
            },
          }
        : {}),
    },
  })
  createdOrderIds.push(order.id)
  return order.id
}

async function createStaff(email: string, permissionSlug?: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email,
      fullName: `Admin Order Staff ${email}`,
      passwordHash: await AuthService.hashPassword(STAFF_PASSWORD),
      role: RoleName.STAFF,
      isActive: true,
      isVerified: true,
    },
  })
  createdStaffIds.push(user.id)
  if (permissionSlug) {
    const perm = await prisma.permission.findUnique({ where: { slug: permissionSlug } })
    if (perm) {
      await prisma.userPermission.create({
        data: { userId: user.id, permissionId: perm.id, assignedBy: 'ADMIN_ORDER_SUITE' },
      })
    }
  }
  return user.id
}

async function findOrderAudits(orderId: string, action?: string) {
  return prisma.auditLog.findMany({
    where: { entityId: orderId, ...(action ? { action } : {}) },
    orderBy: { createdAt: 'asc' },
  })
}

describe('Admin Order Management', () => {
  beforeAll(async () => {
    // Never hit a real mail provider from the suite.
    vi.spyOn(BrevoEmailService, 'sendTransactionalEmail').mockResolvedValue('admin-order-suite')
    vi.spyOn(OrderEmailService, 'orderCancelled').mockResolvedValue(undefined as any)
    vi.spyOn(OrderEmailService, 'paymentFailed').mockResolvedValue(undefined as any)
    vi.spyOn(OrderEmailService, 'deliveryUpdate').mockResolvedValue(undefined as any)
    vi.spyOn(OrderEmailService, 'refundProcessed').mockResolvedValue(undefined as any)

    const adminLogin = await AuthService.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    adminToken = adminLogin.accessToken
    adminId = adminLogin.user.id

    const regOwner = await AuthService.register({
      fullName: 'Admin Order Owner',
      email: `admin.order.owner.${TAG}@vedhicfoods.com`,
      password: 'OwnerOrder@Vedhic2026!',
    })
    owner = { id: regOwner.user.id, email: regOwner.user.email, token: regOwner.accessToken }
    createdUserIds.push(owner.id)

    const regOther = await AuthService.register({
      fullName: 'Admin Order Other',
      email: `admin.order.other.${TAG}@vedhicfoods.com`,
      password: 'OtherOrder@Vedhic2026!',
    })
    other = { id: regOther.user.id, email: regOther.user.email, token: regOther.accessToken }
    createdUserIds.push(other.id)

    const category = await prisma.category.create({
      data: { name: `Admin Order Cat ${TAG}`, slug: `admin-order-cat-${TAG}` },
    })
    categoryId = category.id
    createdCategoryIds.push(category.id)
  }, 120000)

  afterAll(async () => {
    vi.restoreAllMocks()
    for (const id of new Set(createdOrderIds)) {
      await prisma.deliveryHistory.deleteMany({ where: { delivery: { orderId: id } } }).catch(() => {})
      await prisma.delivery.deleteMany({ where: { orderId: id } }).catch(() => {})
      await prisma.invoice.deleteMany({ where: { orderId: id } }).catch(() => {})
      await prisma.payment.deleteMany({ where: { orderId: id } }).catch(() => {})
      await prisma.orderItem.deleteMany({ where: { orderId: id } }).catch(() => {})
      await prisma.order.deleteMany({ where: { id } }).catch(() => {})
    }
    await prisma.userPermission.deleteMany({ where: { userId: { in: createdStaffIds } } }).catch(() => {})
    await prisma.userRole.deleteMany({ where: { userId: { in: createdStaffIds } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: createdStaffIds } } }).catch(() => {})
    await prisma.userPermission.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {})
    await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {})
    await prisma.inventoryLog.deleteMany({ where: { productId: { in: createdProductIds } } }).catch(() => {})
    await prisma.inventory.deleteMany({ where: { productId: { in: createdProductIds } } }).catch(() => {})
    await prisma.cartItem.deleteMany({ where: { productId: { in: createdProductIds } } }).catch(() => {})
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } }).catch(() => {})
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } }).catch(() => {})
    await prisma.auditLog
      .deleteMany({
        where: {
          OR: [
            { entityId: { in: [...new Set(createdOrderIds)] } },
            { actorId: { in: [...new Set([...createdUserIds, ...createdStaffIds])] } },
          ],
        },
      })
      .catch(() => {})
  }, 120000)

  // =========================================================================
  // 1. LIST: FILTERS, SEARCH, SORT, PAGINATION
  // =========================================================================
  describe('order list — filters, search, sorting, pagination', () => {
    const listEmail = `admin.list.${TAG}@vedhicfoods.com`
    let ids: string[] = []

    beforeAll(async () => {
      const base = Date.now()
      const day = 24 * 3600 * 1000
      ids = await Promise.all([
        createOrder({
          userId: owner.id,
          customerEmail: listEmail,
          customerName: `List Customer ${TAG}`,
          status: OrderStatus.CONFIRMED,
          paymentMethod: PaymentMethod.RAZORPAY,
          paymentStatus: PaymentStatus.PAID,
          total: 100,
          createdAt: new Date(base - 5 * day),
        }),
        createOrder({
          userId: owner.id,
          customerEmail: listEmail,
          customerName: `List Customer ${TAG}`,
          status: OrderStatus.PACKED,
          paymentMethod: PaymentMethod.RAZORPAY,
          paymentStatus: PaymentStatus.PAID,
          total: 300,
          createdAt: new Date(base - 4 * day),
        }),
        createOrder({
          userId: owner.id,
          customerEmail: listEmail,
          customerName: `List Customer ${TAG}`,
          status: OrderStatus.SHIPPED,
          paymentMethod: PaymentMethod.COD,
          paymentStatus: PaymentStatus.PENDING,
          total: 200,
          createdAt: new Date(base - 3 * day),
        }),
        createOrder({
          userId: owner.id,
          customerEmail: listEmail,
          customerName: `List Customer ${TAG}`,
          status: OrderStatus.CANCELLED,
          paymentMethod: PaymentMethod.RAZORPAY,
          paymentStatus: PaymentStatus.FAILED,
          total: 400,
          createdAt: new Date(base - 2 * day),
        }),
        createOrder({
          userId: owner.id,
          customerEmail: listEmail,
          customerName: `List Customer ${TAG}`,
          status: OrderStatus.DELIVERED,
          paymentMethod: PaymentMethod.COD,
          paymentStatus: PaymentStatus.PAID,
          total: 500,
          createdAt: new Date(base - 1 * day),
        }),
        createOrder({
          userId: owner.id,
          customerEmail: listEmail,
          customerName: `List Customer ${TAG}`,
          status: OrderStatus.PENDING_PAYMENT,
          paymentMethod: PaymentMethod.RAZORPAY,
          paymentStatus: PaymentStatus.PENDING,
          total: 600,
          createdAt: new Date(base),
        }),
      ])
    })

    it('finds every fixture by the unique customer email via search', async () => {
      const res = await request(app)
        .get(`${API}/admin/orders?search=${encodeURIComponent(listEmail)}&limit=100`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.pagination.total).toBe(6)
      expect(res.body.items).toHaveLength(6)
    })

    it('filters by status', async () => {
      const res = await request(app)
        .get(`${API}/admin/orders?status=PACKED&search=${encodeURIComponent(listEmail)}`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.pagination.total).toBe(1)
      expect(res.body.items[0].status).toBe('PACKED')
    })

    it('filters by payment method', async () => {
      const res = await request(app)
        .get(`${API}/admin/orders?paymentMethod=COD&search=${encodeURIComponent(listEmail)}`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.pagination.total).toBe(2)
      for (const o of res.body.items) expect(o.paymentMethod).toBe('COD')
    })

    it('filters by payment status', async () => {
      const res = await request(app)
        .get(`${API}/admin/orders?paymentStatus=PAID&search=${encodeURIComponent(listEmail)}`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.pagination.total).toBe(3)
      for (const o of res.body.items) expect(o.paymentStatus).toBe('PAID')
    })

    it('filters by a createdAt date window', async () => {
      const now = Date.now()
      const day = 24 * 3600 * 1000
      const from = new Date(now - 3.5 * day).toISOString()
      const to = new Date(now - 0.5 * day).toISOString()
      const res = await request(app)
        .get(
          `${API}/admin/orders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&search=${encodeURIComponent(listEmail)}`
        )
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.pagination.total).toBe(3)
      for (const o of res.body.items) {
        const at = new Date(o.createdAt).getTime()
        expect(at).toBeGreaterThanOrEqual(new Date(from).getTime())
        expect(at).toBeLessThanOrEqual(new Date(to).getTime())
      }
    })

    it('rejects an unparseable date filter with 400', async () => {
      const res = await request(app)
        .get(`${API}/admin/orders?from=not-a-date&search=${encodeURIComponent(listEmail)}`)
        .set(auth(adminToken))
      expect(res.status).toBe(400)
    })

    it('sorts by total ascending and descending', async () => {
      const asc = await request(app)
        .get(
          `${API}/admin/orders?sortBy=total&sortOrder=asc&search=${encodeURIComponent(listEmail)}&limit=100`
        )
        .set(auth(adminToken))
      expect(asc.status).toBe(200)
      expect(Number(asc.body.items[0].total)).toBe(100)

      const desc = await request(app)
        .get(
          `${API}/admin/orders?sortBy=total&sortOrder=desc&search=${encodeURIComponent(listEmail)}&limit=100`
        )
        .set(auth(adminToken))
      expect(desc.status).toBe(200)
      expect(Number(desc.body.items[0].total)).toBe(600)
    })

    it('ignores an unknown sort column and falls back to newest-first', async () => {
      const res = await request(app)
        .get(
          `${API}/admin/orders?sortBy=dropTable&search=${encodeURIComponent(listEmail)}&limit=100`
        )
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(Number(res.body.items[0].total)).toBe(600)
    })

    it('paginates the result set', async () => {
      const first = await request(app)
        .get(`${API}/admin/orders?search=${encodeURIComponent(listEmail)}&page=1&limit=2`)
        .set(auth(adminToken))
      expect(first.status).toBe(200)
      expect(first.body.items).toHaveLength(2)
      expect(first.body.pagination).toMatchObject({ page: 1, limit: 2, total: 6, totalPages: 3 })

      const second = await request(app)
        .get(`${API}/admin/orders?search=${encodeURIComponent(listEmail)}&page=2&limit=2`)
        .set(auth(adminToken))
      expect(second.status).toBe(200)
      expect(second.body.items).toHaveLength(2)
      const firstIds = first.body.items.map((o: any) => o.id)
      const secondIds = second.body.items.map((o: any) => o.id)
      expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false)

      const clamped = await request(app)
        .get(`${API}/admin/orders?search=${encodeURIComponent(listEmail)}&page=abc&limit=99999`)
        .set(auth(adminToken))
      expect(clamped.status).toBe(200)
      expect(clamped.body.pagination.page).toBe(1)
      expect(clamped.body.pagination.limit).toBeLessThanOrEqual(100)
    })

    it('never leaks a platform order that does not match the search', async () => {
      const res = await request(app)
        .get(`${API}/admin/orders?search=${encodeURIComponent(listEmail)}&limit=100`)
        .set(auth(adminToken))
      for (const o of res.body.items) expect(o.customerEmail).toBe(listEmail)
      expect(ids.length).toBe(6)
    })
  })

  // =========================================================================
  // 2. DETAIL: PAYMENT / CUSTOMER / DELIVERY
  // =========================================================================
  describe('order detail projection', () => {
    let orderId: string

    beforeAll(async () => {
      orderId = await createOrder({
        userId: owner.id,
        customerEmail: owner.email,
        customerName: 'Detail Customer',
        status: OrderStatus.CONFIRMED,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.PAID,
        total: 777,
        payment: {
          status: PaymentRecordStatus.CAPTURED,
          amount: 777,
          razorpayOrderId: `order_detail_${TAG}`,
          razorpayPaymentId: `pay_detail_${TAG}`,
          razorpaySignature: 'super-secret-signature',
          verifiedAt: new Date(),
        },
        delivery: { status: DeliveryStatus.ASSIGNED },
      })
    })

    it('returns payment, customer and delivery detail to the owning customer', async () => {
      const res = await request(app).get(`${API}/orders/${orderId}`).set(auth(owner.token))
      expect(res.status).toBe(200)
      expect(res.body.payment).toMatchObject({
        status: 'CAPTURED',
        amount: expect.anything(),
        razorpayPaymentId: `pay_detail_${TAG}`,
      })
      expect(res.body.user).toMatchObject({ id: owner.id, email: owner.email })
      expect(res.body.delivery).toMatchObject({ status: 'ASSIGNED', courierPartner: 'Delhivery Express' })
      expect(res.body.items.length).toBe(1)
    })

    it('never exposes the stored gateway signature', async () => {
      const res = await request(app).get(`${API}/orders/${orderId}`).set(auth(owner.token))
      expect(res.status).toBe(200)
      expect(res.body.payment.razorpaySignature).toBeUndefined()
      expect(JSON.stringify(res.body)).not.toContain('super-secret-signature')
    })

    it('lets an admin read the same detail', async () => {
      const res = await request(app).get(`${API}/orders/${orderId}`).set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(orderId)
    })
  })

  // =========================================================================
  // 3. VALID STATUS TRANSITIONS + AUDIT TIMELINE
  // =========================================================================
  describe('valid status transitions', () => {
    it('walks PENDING → CONFIRMED → PACKED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED, persisting each step and its audit entry', async () => {
      const orderId = await createOrder({
        userId: owner.id,
        status: OrderStatus.PENDING,
        paymentMethod: PaymentMethod.COD,
      })

      const sequence: OrderStatus[] = [
        OrderStatus.CONFIRMED,
        OrderStatus.PACKED,
        OrderStatus.SHIPPED,
        OrderStatus.OUT_FOR_DELIVERY,
        OrderStatus.DELIVERED,
      ]

      let previous: OrderStatus = OrderStatus.PENDING
      for (const target of sequence) {
        const res = await request(app)
          .put(`${API}/admin/orders/${orderId}/status`)
          .set(auth(adminToken))
          .send({ status: target })
        expect(res.status, `transition ${previous} -> ${target}`).toBe(200)
        expect(res.body.status).toBe(target)

        const dbOrder = await prisma.order.findUnique({ where: { id: orderId } })
        expect(dbOrder?.status).toBe(target)

        const audit = await findOrderAudits(orderId, 'ORDER_STATUS_UPDATED')
        const latest = audit.find(
          (a) => (a.metadata as any).previousStatus === previous && (a.metadata as any).newStatus === target
        )
        expect(latest, `audit for ${previous} -> ${target}`).toBeDefined()
        expect(latest!.actorId).toBe(adminId)
        expect(latest!.entity).toBe('Order')
        previous = target
      }

      // One audit row per successful transition.
      const audits = await findOrderAudits(orderId, 'ORDER_STATUS_UPDATED')
      expect(audits).toHaveLength(5)
    })

    it('treats a same-status update as a no-op (200, no new audit row)', async () => {
      const orderId = await createOrder({ userId: owner.id, status: OrderStatus.CONFIRMED })
      const before = await findOrderAudits(orderId, 'ORDER_STATUS_UPDATED')
      const res = await request(app)
        .put(`${API}/admin/orders/${orderId}/status`)
        .set(auth(adminToken))
        .send({ status: OrderStatus.CONFIRMED })
      expect(res.status).toBe(200)
      const after = await findOrderAudits(orderId, 'ORDER_STATUS_UPDATED')
      expect(after).toHaveLength(before.length)
    })
  })

  // =========================================================================
  // 4. INVALID STATUS TRANSITIONS — REJECTED, NO STATE CHANGE
  // =========================================================================
  describe('invalid status transitions', () => {
    async function expectRejected(
      orderId: string,
      target: string,
      expectedStatus: number
    ): Promise<void> {
      const before = await prisma.order.findUnique({ where: { id: orderId } })
      const auditsBefore = await findOrderAudits(orderId, 'ORDER_STATUS_UPDATED')

      const res = await request(app)
        .put(`${API}/admin/orders/${orderId}/status`)
        .set(auth(adminToken))
        .send({ status: target })
      expect(res.status).toBe(expectedStatus)

      const after = await prisma.order.findUnique({ where: { id: orderId } })
      expect(after?.status).toBe(before?.status)
      const auditsAfter = await findOrderAudits(orderId, 'ORDER_STATUS_UPDATED')
      expect(auditsAfter).toHaveLength(auditsBefore.length)
    }

    it('rejects DELIVERED → PENDING (409, terminal)', async () => {
      const orderId = await createOrder({ userId: owner.id, status: OrderStatus.DELIVERED })
      await expectRejected(orderId, OrderStatus.PENDING, 409)
    })

    it('rejects CANCELLED → SHIPPED (409, terminal)', async () => {
      const orderId = await createOrder({ userId: owner.id, status: OrderStatus.CANCELLED })
      await expectRejected(orderId, OrderStatus.SHIPPED, 409)
    })

    it('rejects an illegal skip PENDING_PAYMENT → SHIPPED (409)', async () => {
      const orderId = await createOrder({ userId: owner.id, status: OrderStatus.PENDING_PAYMENT })
      await expectRejected(orderId, OrderStatus.SHIPPED, 409)
    })

    it('rejects an illegal skip CONFIRMED → DELIVERED (409)', async () => {
      const orderId = await createOrder({ userId: owner.id, status: OrderStatus.CONFIRMED })
      await expectRejected(orderId, OrderStatus.DELIVERED, 409)
    })

    it('rejects a backward step SHIPPED → PACKED (409)', async () => {
      const orderId = await createOrder({ userId: owner.id, status: OrderStatus.SHIPPED })
      await expectRejected(orderId, OrderStatus.PACKED, 409)
    })

    it('rejects an unknown status value (400) and lists the valid statuses', async () => {
      const orderId = await createOrder({ userId: owner.id, status: OrderStatus.CONFIRMED })
      const res = await request(app)
        .put(`${API}/admin/orders/${orderId}/status`)
        .set(auth(adminToken))
        .send({ status: 'BANANA' })
      expect(res.status).toBe(400)
      expect(res.body.validStatuses).toContain('CONFIRMED')

      const db = await prisma.order.findUnique({ where: { id: orderId } })
      expect(db?.status).toBe('CONFIRMED')
    })

    it('rejects a missing status (400)', async () => {
      const orderId = await createOrder({ userId: owner.id, status: OrderStatus.CONFIRMED })
      const res = await request(app)
        .put(`${API}/admin/orders/${orderId}/status`)
        .set(auth(adminToken))
        .send({})
      expect(res.status).toBe(400)
    })

    it('returns 404 for a nonexistent order', async () => {
      const res = await request(app)
        .put(`${API}/admin/orders/00000000-0000-0000-0000-000000000000/status`)
        .set(auth(adminToken))
        .send({ status: OrderStatus.CONFIRMED })
      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // 5a. CANCELLATION WORKFLOW + STOCK DISPOSITION
  // =========================================================================
  describe('cancellation workflow & stock disposition', () => {
    const inlineAddress = {
      fullName: 'Cancel Customer',
      phone: '9876500011',
      line1: '11 Cancel Street',
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '500001',
      country: 'India',
    }

    it('restocks a deducted (COD/CONFIRMED) order and audits the cancellation', async () => {
      const stockProduct = await createProduct(50, 100)
      const { response } = await CheckoutService.processCheckout(owner.id, {
        address: inlineAddress,
        items: [{ productId: stockProduct, quantity: 4 }],
        paymentMethod: PaymentMethod.COD,
      })
      const orderId = response.orderId
      createdOrderIds.push(orderId)

      const before = await prisma.inventory.findUnique({ where: { productId: stockProduct } })
      expect(Number(before?.soldQuantity)).toBe(4)
      expect(Number(before?.reservedQuantity)).toBe(0)

      const res = await request(app)
        .post(`${API}/orders/${orderId}/cancel`)
        .set(auth(owner.token))
        .send({ reason: 'Customer changed their mind' })
      expect(res.status).toBe(200)

      const after = await prisma.inventory.findUnique({ where: { productId: stockProduct } })
      expect(Number(after?.availableQuantity)).toBe(Number(before?.availableQuantity) + 4)
      expect(Number(after?.soldQuantity)).toBe(Number(before?.soldQuantity) - 4)

      const restockLog = await prisma.inventoryLog.findFirst({
        where: { orderId, operation: 'RESTOCK' },
      })
      expect(restockLog).not.toBeNull()

      const audit = await findOrderAudits(orderId, 'ORDER_CANCELLED')
      expect(audit).toHaveLength(1)
      expect(audit[0].actorId).toBe(owner.id)
      expect(audit[0].metadata).toMatchObject({
        previousStatus: 'CONFIRMED',
        reason: 'Customer changed their mind',
      })

      const dbOrder = await prisma.order.findUnique({ where: { id: orderId } })
      expect(dbOrder?.status).toBe('CANCELLED')
    })

    it('releases the reservation of an unpaid (RAZORPAY/PENDING_PAYMENT) order without crediting sold stock', async () => {
      const stockProduct = await createProduct(30, 120)
      const { response } = await CheckoutService.processCheckout(owner.id, {
        address: inlineAddress,
        items: [{ productId: stockProduct, quantity: 3 }],
        paymentMethod: PaymentMethod.RAZORPAY,
      })
      const orderId = response.orderId
      createdOrderIds.push(orderId)

      const before = await prisma.inventory.findUnique({ where: { productId: stockProduct } })
      expect(Number(before?.reservedQuantity)).toBe(3)
      expect(Number(before?.soldQuantity)).toBe(0)

      const res = await request(app)
        .post(`${API}/orders/${orderId}/cancel`)
        .set(auth(owner.token))
        .send({ reason: 'Abandoned payment' })
      expect(res.status).toBe(200)

      const after = await prisma.inventory.findUnique({ where: { productId: stockProduct } })
      expect(Number(after?.reservedQuantity)).toBe(Number(before?.reservedQuantity) - 3)
      expect(Number(after?.soldQuantity)).toBe(0)
      expect(Number(after?.availableQuantity)).toBe(Number(before?.availableQuantity) + 3)

      const releaseLog = await prisma.inventoryLog.findFirst({
        where: { orderId, operation: 'RELEASE_RESERVATION' },
      })
      expect(releaseLog).not.toBeNull()
      const restockLog = await prisma.inventoryLog.findFirst({ where: { orderId, operation: 'RESTOCK' } })
      expect(restockLog).toBeNull()
    })

    it('refuses to cancel an already-cancelled order (400)', async () => {
      const orderId = await createOrder({ userId: owner.id, status: OrderStatus.CANCELLED })
      const res = await request(app)
        .post(`${API}/orders/${orderId}/cancel`)
        .set(auth(owner.token))
        .send({})
      expect(res.status).toBe(400)
    })

    it('refuses to cancel a delivered order (400)', async () => {
      const orderId = await createOrder({ userId: owner.id, status: OrderStatus.DELIVERED })
      const res = await request(app)
        .post(`${API}/orders/${orderId}/cancel`)
        .set(auth(owner.token))
        .send({})
      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // 5b. PAYMENT FAILURE HANDLING
  // =========================================================================
  describe('payment failure handling', () => {
    it('marks the order and its payment record FAILED and releases the reservation', async () => {
      const stockProduct = await createProduct(20, 90)
      const { response } = await CheckoutService.processCheckout(owner.id, {
        address: {
          fullName: 'Failed Payment',
          phone: '9876500022',
          line1: '22 Fail Street',
          city: 'Hyderabad',
          state: 'Telangana',
          pincode: '500001',
          country: 'India',
        },
        items: [{ productId: stockProduct, quantity: 2 }],
        paymentMethod: PaymentMethod.RAZORPAY,
      })
      const orderId = response.orderId
      createdOrderIds.push(orderId)

      const before = await prisma.inventory.findUnique({ where: { productId: stockProduct } })

      const res = await request(app)
        .post(`${API}/orders/${orderId}/payment-failed`)
        .set(auth(owner.token))
        .send({ reason: 'User closed the payment sheet' })
      expect(res.status).toBe(200)

      const dbOrder = await prisma.order.findUnique({ where: { id: orderId } })
      expect(dbOrder?.status).toBe('FAILED')
      expect(dbOrder?.paymentStatus).toBe('FAILED')

      const payment = await prisma.payment.findFirst({ where: { orderId } })
      expect(payment?.status).toBe('FAILED')
      expect(payment?.failureReason).toBe('User closed the payment sheet')

      const after = await prisma.inventory.findUnique({ where: { productId: stockProduct } })
      expect(Number(after?.reservedQuantity)).toBe(Number(before?.reservedQuantity) - 2)
      expect(Number(after?.soldQuantity)).toBe(0)

      const audit = await findOrderAudits(orderId, 'ORDER_PAYMENT_FAILED')
      expect(audit).toHaveLength(1)
      expect(audit[0].actorId).toBe(owner.id)
    })

    it('refuses to mark an already-paid order as failed (400)', async () => {
      const orderId = await createOrder({
        userId: owner.id,
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        paymentMethod: PaymentMethod.RAZORPAY,
        payment: { status: PaymentRecordStatus.CAPTURED, razorpayPaymentId: `pay_paid_${TAG}` },
      })
      const res = await request(app)
        .post(`${API}/orders/${orderId}/payment-failed`)
        .set(auth(owner.token))
        .send({ reason: 'Nope' })
      expect(res.status).toBe(400)
      const dbOrder = await prisma.order.findUnique({ where: { id: orderId } })
      expect(dbOrder?.paymentStatus).toBe('PAID')
    })
  })

  // =========================================================================
  // 6. HISTORICAL PAYMENT INFORMATION IS IMMUTABLE THROUGH ADMIN ENDPOINTS
  // =========================================================================
  describe('payment record immutability', () => {
    it('ignores payment/total fields smuggled into a status update', async () => {
      const orderId = await createOrder({
        userId: owner.id,
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        paymentMethod: PaymentMethod.RAZORPAY,
        subtotal: 500,
        total: 500,
        payment: {
          status: PaymentRecordStatus.CAPTURED,
          amount: 500,
          razorpayOrderId: `order_immut_${TAG}`,
          razorpayPaymentId: `pay_immut_${TAG}`,
          verifiedAt: new Date(),
        },
      })

      const paymentBefore = await prisma.payment.findFirst({ where: { orderId } })
      const orderBefore = await prisma.order.findUnique({ where: { id: orderId } })

      const res = await request(app)
        .put(`${API}/admin/orders/${orderId}/status`)
        .set(auth(adminToken))
        .send({
          status: OrderStatus.PROCESSING,
          // Everything below is an attempt to rewrite history.
          amount: 1,
          total: 1,
          subtotal: 1,
          paymentStatus: 'PENDING',
          payment: { amount: 1, razorpayPaymentId: 'pay_tampered', status: 'FAILED' },
        })
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('PROCESSING')

      const paymentAfter = await prisma.payment.findFirst({ where: { orderId } })
      expect(Number(paymentAfter?.amount)).toBe(Number(paymentBefore?.amount))
      expect(paymentAfter?.razorpayPaymentId).toBe(paymentBefore?.razorpayPaymentId)
      expect(paymentAfter?.razorpayOrderId).toBe(paymentBefore?.razorpayOrderId)
      expect(paymentAfter?.status).toBe(paymentBefore?.status)

      const orderAfter = await prisma.order.findUnique({ where: { id: orderId } })
      expect(Number(orderAfter?.total)).toBe(Number(orderBefore?.total))
      expect(Number(orderAfter?.subtotal)).toBe(Number(orderBefore?.subtotal))
      expect(orderAfter?.paymentStatus).toBe('PAID')
    })

    it('exposes no route to mutate a payment record directly', async () => {
      const orderId = await createOrder({ userId: owner.id, status: OrderStatus.CONFIRMED })
      for (const [method, path] of [
        ['patch', `${API}/admin/orders/${orderId}/payment`],
        ['put', `${API}/admin/orders/${orderId}/payment`],
        ['post', `${API}/admin/orders/${orderId}/payment`],
      ] as const) {
        const res = await (request(app) as any)[method](path).set(auth(adminToken)).send({ amount: 1 })
        expect(res.status, `${method} ${path}`).toBe(404)
      }
    })
  })

  // =========================================================================
  // 7. DELIVERY FAILURE HANDLING
  // =========================================================================
  describe('delivery failure handling', () => {
    async function deliveryIdFor(orderId: string): Promise<string> {
      const delivery = await prisma.delivery.findUnique({ where: { orderId } })
      return delivery!.id
    }

    it('marks a SHIPPED delivery FAILED and records history + audit', async () => {
      const orderId = await createOrder({
        userId: owner.id,
        status: OrderStatus.SHIPPED,
        delivery: { status: DeliveryStatus.SHIPPED },
      })
      const deliveryId = await deliveryIdFor(orderId)

      const res = await request(app)
        .patch(`${API}/admin/delivery/${deliveryId}/status`)
        .set(auth(adminToken))
        .send({ status: DeliveryStatus.FAILED, notes: 'Courier reported a failed attempt' })
      expect(res.status).toBe(200)

      const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } })
      expect(delivery?.status).toBe('FAILED')

      const history = await prisma.deliveryHistory.findFirst({ where: { deliveryId, status: 'FAILED' } })
      expect(history).not.toBeNull()

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: deliveryId, action: 'DELIVERY_STATUS_CHANGED' },
        orderBy: { createdAt: 'desc' },
      })
      expect(audit).not.toBeNull()
      expect(audit!.metadata).toMatchObject({ from: 'SHIPPED', to: 'FAILED' })
    })

    it('supports FAILED → OUT_FOR_DELIVERY recovery', async () => {
      const orderId = await createOrder({
        userId: owner.id,
        status: OrderStatus.OUT_FOR_DELIVERY,
        delivery: { status: DeliveryStatus.FAILED },
      })
      const deliveryId = await deliveryIdFor(orderId)
      const res = await request(app)
        .patch(`${API}/admin/delivery/${deliveryId}/status`)
        .set(auth(adminToken))
        .send({ status: DeliveryStatus.OUT_FOR_DELIVERY })
      expect(res.status).toBe(200)
      const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } })
      expect(delivery?.status).toBe('OUT_FOR_DELIVERY')
    })

    it('rejects illegal delivery jumps with 400', async () => {
      const pending = await createOrder({
        userId: owner.id,
        status: OrderStatus.CONFIRMED,
        delivery: { status: DeliveryStatus.PENDING },
      })
      const pendingDelivery = await deliveryIdFor(pending)
      const skip = await request(app)
        .patch(`${API}/admin/delivery/${pendingDelivery}/status`)
        .set(auth(adminToken))
        .send({ status: DeliveryStatus.DELIVERED })
      expect(skip.status).toBe(400)
      const pendingDb = await prisma.delivery.findUnique({ where: { id: pendingDelivery } })
      expect(pendingDb?.status).toBe('PENDING')

      const packed = await createOrder({
        userId: owner.id,
        status: OrderStatus.PACKED,
        delivery: { status: DeliveryStatus.PACKED },
      })
      const packedDelivery = await deliveryIdFor(packed)
      const packedSkip = await request(app)
        .patch(`${API}/admin/delivery/${packedDelivery}/status`)
        .set(auth(adminToken))
        .send({ status: DeliveryStatus.DELIVERED })
      expect(packedSkip.status).toBe(400)
      const packedDb = await prisma.delivery.findUnique({ where: { id: packedDelivery } })
      expect(packedDb?.status).toBe('PACKED')
    })

    it('treats DELIVERED as terminal (400 on further change)', async () => {
      const orderId = await createOrder({
        userId: owner.id,
        status: OrderStatus.DELIVERED,
        delivery: { status: DeliveryStatus.DELIVERED },
      })
      const deliveryId = await deliveryIdFor(orderId)
      const res = await request(app)
        .patch(`${API}/admin/delivery/${deliveryId}/status`)
        .set(auth(adminToken))
        .send({ status: DeliveryStatus.SHIPPED })
      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // 8. AUTHORIZATION
  // =========================================================================
  describe('authorization', () => {
    let targetOrderId: string

    beforeAll(async () => {
      targetOrderId = await createOrder({
        userId: owner.id,
        customerEmail: owner.email,
        status: OrderStatus.CONFIRMED,
        paymentMethod: PaymentMethod.COD,
      })
    })

    it('rejects anonymous callers with 401 across the order surface', async () => {
      const list = await request(app).get(`${API}/admin/orders`)
      expect(list.status).toBe(401)

      const status = await request(app)
        .put(`${API}/admin/orders/${targetOrderId}/status`)
        .send({ status: OrderStatus.PACKED })
      expect(status.status).toBe(401)

      const cancel = await request(app).post(`${API}/orders/${targetOrderId}/cancel`).send({})
      expect(cancel.status).toBe(401)

      const refund = await request(app)
        .post(`${API}/admin/orders/${targetOrderId}/refund`)
        .send({})
      expect(refund.status).toBe(401)

      const detail = await request(app).get(`${API}/orders/${targetOrderId}`)
      expect(detail.status).toBe(401)
    })

    it('rejects a customer from the admin order console with 403', async () => {
      const res = await request(app).get(`${API}/admin/orders`).set(auth(owner.token))
      expect(res.status).toBe(403)
    })

    it('rejects a permissionless staff member with 403', async () => {
      const email = `admin.order.noperm.${TAG}@vedhicfoods.com`
      await createStaff(email)
      const token = (await AuthService.login({ email, password: STAFF_PASSWORD })).accessToken

      const list = await request(app).get(`${API}/admin/orders`).set(auth(token))
      expect(list.status).toBe(403)

      const update = await request(app)
        .put(`${API}/admin/orders/${targetOrderId}/status`)
        .set(auth(token))
        .send({ status: OrderStatus.PACKED })
      expect(update.status).toBe(403)
    })

    it('lets a staff with orders.read list but not mutate', async () => {
      const email = `admin.order.reader.${TAG}@vedhicfoods.com`
      await createStaff(email, 'orders.read')
      const token = (await AuthService.login({ email, password: STAFF_PASSWORD })).accessToken

      const list = await request(app).get(`${API}/admin/orders`).set(auth(token))
      expect(list.status).toBe(200)

      const update = await request(app)
        .put(`${API}/admin/orders/${targetOrderId}/status`)
        .set(auth(token))
        .send({ status: OrderStatus.PACKED })
      expect(update.status).toBe(403)
    })

    it('hides another customer\'s order behind a uniform 404 (read, cancel, fail-payment)', async () => {
      const read = await request(app).get(`${API}/orders/${targetOrderId}`).set(auth(other.token))
      expect(read.status).toBe(404)

      const cancel = await request(app)
        .post(`${API}/orders/${targetOrderId}/cancel`)
        .set(auth(other.token))
        .send({})
      expect(cancel.status).toBe(404)

      const fail = await request(app)
        .post(`${API}/orders/${targetOrderId}/payment-failed`)
        .set(auth(other.token))
        .send({})
      expect(fail.status).toBe(404)

      // The owner can still see it, so the 404 is an authorization mask, not a
      // missing row.
      const ownRead = await request(app).get(`${API}/orders/${targetOrderId}`).set(auth(owner.token))
      expect(ownRead.status).toBe(200)
    })
  })
})
