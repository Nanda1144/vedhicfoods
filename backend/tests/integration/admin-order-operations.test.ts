import './_safety'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
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
import { BrevoEmailService } from '../../src/integrations/brevo/brevo.service'

/**
 * Admin order-console operations.
 *
 * Focused on the parts of the admin order surface the existing
 * `admin-order-management` suite does NOT pin down:
 *   - search by order number and by customer name (not just email)
 *   - several facets combined at once (status + payment method + payment status)
 *   - the `startDate`/`endDate` aliases and the inverted-window 400
 *   - an unrecognised `status` facet must be IGNORED, never a 500
 *     (the payment facets already tolerate this; status did not)
 *   - sorting by orderNumber / status, and the ascending default direction
 *   - the default page size and an out-of-range page
 *   - payment / customer / delivery projection in both the list row and the
 *     order detail, including that the stored gateway signature never leaks
 *
 * Fixtures are created directly on the database and tracked by a unique ref so
 * the shared, un-truncated test database never leaks into an assertion.
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
let owner: { id: string; email: string; token: string }
let categoryId: string

const ORDER_PREFIX = `VF-OPS-${TAG}`

async function createProduct(stock = 500, price = 100): Promise<string> {
  const suffix = Math.floor(Math.random() * 1e9)
  const product = await prisma.product.create({
    data: {
      name: `Ops Product ${suffix}`,
      slug: `ops-prod-${suffix}`,
      sku: `SKU-OPS-${suffix}`,
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
  ref: string
  customerName: string
  customerEmail?: string
  status?: OrderStatus
  paymentStatus?: PaymentStatus
  paymentMethod?: PaymentMethod
  total: number
  createdAt: Date
  productId?: string
  quantity?: number
  payment?: {
    status: PaymentRecordStatus
    amount?: number
    razorpayOrderId?: string | null
    razorpayPaymentId?: string | null
    razorpaySignature?: string | null
    failureReason?: string | null
    verifiedAt?: Date | null
  }
  delivery?: {
    status?: DeliveryStatus
    courierPartner?: string
    trackingNumber?: string
    estimatedDelivery?: Date
    recipientName?: string
    recipientPhone?: string
  }
}

async function createOrder(opts: CreateOrderOptions): Promise<string> {
  const order = await prisma.order.create({
    data: {
      orderNumber: `${ORDER_PREFIX}-${opts.ref}`,
      userId: owner.id,
      customerName: opts.customerName,
      customerEmail: opts.customerEmail ?? `${opts.ref}.${TAG}@vedhicfoods.com`,
      phone: '9876500099',
      subtotal: opts.total,
      total: opts.total,
      shipping: 0,
      tax: 0,
      discount: 0,
      currency: 'INR',
      status: opts.status ?? OrderStatus.PENDING,
      paymentStatus: opts.paymentStatus ?? PaymentStatus.PENDING,
      paymentMethod: opts.paymentMethod ?? PaymentMethod.RAZORPAY,
      createdAt: opts.createdAt,
      items: {
        create: [
          {
            productId: opts.productId ?? null,
            name: 'Ops Line',
            sku: 'SKU-OPS-LINE',
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
                razorpaySignature: opts.payment.razorpaySignature ?? null,
                failureReason: opts.payment.failureReason ?? null,
                verifiedAt: opts.payment.verifiedAt ?? null,
              },
            },
          }
        : {}),
      ...(opts.delivery
        ? {
            delivery: {
              create: {
                status: opts.delivery.status ?? DeliveryStatus.PENDING,
                courierPartner: opts.delivery.courierPartner ?? 'Delhivery Ops',
                trackingNumber: opts.delivery.trackingNumber ?? null,
                estimatedDelivery: opts.delivery.estimatedDelivery ?? null,
                recipientName: opts.delivery.recipientName ?? 'Ops Recipient',
                recipientPhone: opts.delivery.recipientPhone ?? '9876500099',
              },
            },
          }
        : {}),
    },
  })
  createdOrderIds.push(order.id)
  return order.id
}

const SEARCH = ORDER_PREFIX

describe('Admin Order Operations', () => {
  const day = 24 * 3600 * 1000
  const base = Date.now()

  let idA: string
  let idB: string
  let idC: string
  let idD: string
  let idE: string

  beforeAll(async () => {
    vi.spyOn(BrevoEmailService, 'sendTransactionalEmail').mockResolvedValue('ops-suite')

    const adminLogin = await AuthService.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    adminToken = adminLogin.accessToken

    const reg = await AuthService.register({
      fullName: `Ops Owner ${TAG}`,
      email: `ops.owner.${TAG}@vedhicfoods.com`,
      password: 'OpsOwner@Vedhic2026!',
    })
    owner = { id: reg.user.id, email: reg.user.email, token: reg.accessToken }
    createdUserIds.push(owner.id)

    const category = await prisma.category.create({
      data: { name: `Ops Cat ${TAG}`, slug: `ops-cat-${TAG}` },
    })
    categoryId = category.id
    createdCategoryIds.push(category.id)

    const productId = await createProduct(100, 100)

    // A: confirmed / paid razorpay, oldest. Carries payment + delivery detail.
    idA = await createOrder({
      ref: 'A',
      customerName: `Ops Alpha ${TAG}`,
      customerEmail: `ops.alpha.${TAG}@vedhicfoods.com`,
      status: OrderStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PAID,
      paymentMethod: PaymentMethod.RAZORPAY,
      total: 111,
      createdAt: new Date(base - 4 * day),
      productId,
      payment: {
        status: PaymentRecordStatus.CAPTURED,
        amount: 111,
        razorpayOrderId: `order_ops_a_${TAG}`,
        razorpayPaymentId: `pay_ops_a_${TAG}`,
        razorpaySignature: 'ops-secret-signature-a',
        verifiedAt: new Date(base - 4 * day),
      },
      delivery: {
        status: DeliveryStatus.SHIPPED,
        courierPartner: 'Delhivery Ops',
        trackingNumber: `TRK-OPS-${TAG}`,
        estimatedDelivery: new Date(base + day),
        recipientName: `Ops Alpha ${TAG}`,
        recipientPhone: '9876500011',
      },
    })

    // B: shipped / pending COD.
    idB = await createOrder({
      ref: 'B',
      customerName: `Ops Beta ${TAG}`,
      status: OrderStatus.SHIPPED,
      paymentStatus: PaymentStatus.PENDING,
      paymentMethod: PaymentMethod.COD,
      total: 222,
      createdAt: new Date(base - 3 * day),
      productId,
    })

    // C: delivered / paid COD, newest of the "old" set.
    idC = await createOrder({
      ref: 'C',
      customerName: `Ops Gamma ${TAG}`,
      status: OrderStatus.DELIVERED,
      paymentStatus: PaymentStatus.PAID,
      paymentMethod: PaymentMethod.COD,
      total: 333,
      createdAt: new Date(base - 2 * day),
      productId,
    })

    // D: cancelled / failed razorpay, with a failure reason.
    idD = await createOrder({
      ref: 'D',
      customerName: `Ops Delta ${TAG}`,
      status: OrderStatus.CANCELLED,
      paymentStatus: PaymentStatus.FAILED,
      paymentMethod: PaymentMethod.RAZORPAY,
      total: 444,
      createdAt: new Date(base - day),
      productId,
      payment: {
        status: PaymentRecordStatus.FAILED,
        amount: 444,
        razorpayOrderId: `order_ops_d_${TAG}`,
        failureReason: 'card_declined_ops',
      },
    })

    // E: the newest, still awaiting payment.
    idE = await createOrder({
      ref: 'E',
      customerName: `Ops Epsilon ${TAG}`,
      status: OrderStatus.PENDING_PAYMENT,
      paymentStatus: PaymentStatus.PENDING,
      paymentMethod: PaymentMethod.RAZORPAY,
      total: 555,
      createdAt: new Date(base),
      productId,
      payment: {
        status: PaymentRecordStatus.PENDING,
        amount: 555,
        razorpayOrderId: `order_ops_e_${TAG}`,
      },
    })
  }, 120000)

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
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } }).catch(() => {})
    await prisma.userPermission.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {})
    await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {})
    await prisma.inventoryLog.deleteMany({ where: { productId: { in: createdProductIds } } }).catch(() => {})
    await prisma.inventory.deleteMany({ where: { productId: { in: createdProductIds } } }).catch(() => {})
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } }).catch(() => {})
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } }).catch(() => {})
  }, 120000)

  function list(query: string) {
    return request(app)
      .get(`${API}/admin/orders?search=${encodeURIComponent(SEARCH)}${query}`)
      .set(auth(adminToken))
  }

  // =========================================================================
  // SEARCH
  // =========================================================================
  describe('search', () => {
    it('finds a single order by its order number', async () => {
      const res = await request(app)
        .get(`${API}/admin/orders?search=${encodeURIComponent(`${ORDER_PREFIX}-A`)}`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.pagination.total).toBe(1)
      expect(res.body.items[0].id).toBe(idA)
      expect(res.body.items[0].orderNumber).toBe(`${ORDER_PREFIX}-A`)
    })

    it('finds a single order by the customer name', async () => {
      const res = await request(app)
        .get(`${API}/admin/orders?search=${encodeURIComponent(`Ops Gamma ${TAG}`)}`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.pagination.total).toBe(1)
      expect(res.body.items[0].id).toBe(idC)
      expect(res.body.items[0].customerName).toBe(`Ops Gamma ${TAG}`)
    })

    it('finds a single order by the customer email', async () => {
      const res = await request(app)
        .get(`${API}/admin/orders?search=${encodeURIComponent(`ops.alpha.${TAG}@vedhicfoods.com`)}`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.pagination.total).toBe(1)
      expect(res.body.items[0].id).toBe(idA)
    })
  })

  // =========================================================================
  // COMBINED FACETS
  // =========================================================================
  describe('combined facet filtering', () => {
    it('applies status + payment method + payment status together', async () => {
      const res = await list('&status=DELIVERED&paymentMethod=COD&paymentStatus=PAID')
      expect(res.status).toBe(200)
      expect(res.body.pagination.total).toBe(1)
      expect(res.body.items[0].id).toBe(idC)
    })

    it('returns nothing when the facets cannot be satisfied together', async () => {
      // Beta is SHIPPED but COD, not RAZORPAY.
      const res = await list('&status=SHIPPED&paymentMethod=RAZORPAY')
      expect(res.status).toBe(200)
      expect(res.body.pagination.total).toBe(0)
      expect(res.body.items).toHaveLength(0)
    })

    it('ignores an unrecognised status facet instead of failing the query', async () => {
      // Regression: an unknown enum value was handed straight to Prisma and
      // surfaced as a 500. It must be ignored (like the payment facets).
      const res = await list('&status=BANANA')
      expect(res.status).toBe(200)
      expect(res.body.pagination.total).toBe(5)
    })

    it('ignores unrecognised payment method / status facets', async () => {
      const method = await list('&paymentMethod=BITCOIN')
      expect(method.status).toBe(200)
      expect(method.body.pagination.total).toBe(5)

      const status = await list('&paymentStatus=TELEPORTED')
      expect(status.status).toBe(200)
      expect(status.body.pagination.total).toBe(5)
    })
  })

  // =========================================================================
  // DATE WINDOW
  // =========================================================================
  describe('date window', () => {
    it('accepts the startDate/endDate aliases', async () => {
      const from = new Date(base - 3.5 * day).toISOString()
      const to = new Date(base - 0.5 * day).toISOString()
      const res = await list(
        `&startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}&limit=100`
      )
      expect(res.status).toBe(200)
      // B (-3d), C (-2d), D (-1d)
      expect(res.body.pagination.total).toBe(3)
      const ids = res.body.items.map((o: any) => o.id)
      expect(ids.sort()).toEqual([idB, idC, idD].sort())
    })

    it('produces the same window with the from/to aliases', async () => {
      const from = new Date(base - 3.5 * day).toISOString()
      const to = new Date(base - 0.5 * day).toISOString()
      const aliases = await list(
        `&startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}&limit=100`
      )
      const canonical = await list(
        `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`
      )
      expect(canonical.status).toBe(200)
      expect(canonical.body.pagination.total).toBe(aliases.body.pagination.total)
      expect(canonical.body.items.map((o: any) => o.id).sort()).toEqual(
        aliases.body.items.map((o: any) => o.id).sort()
      )
    })

    it('rejects an inverted window (from after to) with 400', async () => {
      const res = await list(`&from=2030-01-01&to=2020-01-01`)
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/from/i)
    })

    it('accepts an open-ended lower bound only', async () => {
      const from = new Date(base - day).toISOString()
      const res = await list(`&from=${encodeURIComponent(from)}`)
      expect(res.status).toBe(200)
      // D (-1d) and E (now) are within the window (>= base - 1d).
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(1)
      for (const o of res.body.items) {
        expect(new Date(o.createdAt).getTime()).toBeGreaterThanOrEqual(new Date(from).getTime())
      }
    })
  })

  // =========================================================================
  // SORTING
  // =========================================================================
  describe('sorting', () => {
    it('sorts by orderNumber ascending and descending', async () => {
      const asc = await list('&sortBy=orderNumber&sortOrder=asc&limit=100')
      expect(asc.status).toBe(200)
      expect(asc.body.items[0].orderNumber).toBe(`${ORDER_PREFIX}-A`)

      const desc = await list('&sortBy=orderNumber&sortOrder=desc&limit=100')
      expect(desc.status).toBe(200)
      expect(desc.body.items[0].orderNumber).toBe(`${ORDER_PREFIX}-E`)
    })

    it('sorts by status ascending (postgres enum order)', async () => {
      const res = await list('&sortBy=status&sortOrder=asc&limit=100')
      expect(res.status).toBe(200)
      // Postgres orders the enum by its declared order, not alphabetically.
      // Among the fixtures CONFIRMED is earliest and PENDING_PAYMENT latest.
      const statuses = res.body.items.map((o: any) => o.status)
      expect(statuses[0]).toBe('CONFIRMED')
      expect(statuses[statuses.length - 1]).toBe('PENDING_PAYMENT')
    })

    it('defaults to newest-first when no sort is supplied', async () => {
      const res = await list('&limit=100')
      expect(res.status).toBe(200)
      expect(res.body.items[0].id).toBe(idE)
    })
  })

  // =========================================================================
  // PAGINATION
  // =========================================================================
  describe('pagination', () => {
    it('uses the default page size of 25 when limit is omitted', async () => {
      const res = await request(app)
        .get(`${API}/admin/orders?search=${encodeURIComponent(SEARCH)}`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.pagination.limit).toBe(25)
      expect(res.body.pagination.total).toBe(5)
    })

    it('returns an empty page for a page beyond the end without erroring', async () => {
      const res = await list('&page=99&limit=2')
      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(0)
      expect(res.body.pagination).toMatchObject({ page: 99, limit: 2, total: 5, totalPages: 3 })
    })

    it('reports totalPages for a non-divisible total', async () => {
      const first = await list('&page=1&limit=2')
      expect(first.body.pagination.totalPages).toBe(3)
      const last = await list('&page=3&limit=2')
      expect(last.body.items).toHaveLength(1)
    })
  })

  // =========================================================================
  // LIST PROJECTION
  // =========================================================================
  describe('list row projection', () => {
    it('exposes payment, item and customer detail on each row', async () => {
      const res = await list('&limit=100')
      expect(res.status).toBe(200)
      const rowA = res.body.items.find((o: any) => o.id === idA)
      expect(rowA).toBeDefined()
      expect(rowA.orderNumber).toBe(`${ORDER_PREFIX}-A`)
      expect(rowA.customerEmail).toBe(`ops.alpha.${TAG}@vedhicfoods.com`)
      expect(rowA.payment).toMatchObject({
        status: 'CAPTURED',
        method: 'RAZORPAY',
        razorpayPaymentId: `pay_ops_a_${TAG}`,
      })
      expect(rowA.items.length).toBe(1)
      expect(rowA.user).toMatchObject({ id: owner.id, email: owner.email })
      expect(Number(rowA.total)).toBe(111)
    })

    it('surfaces a stored payment failure reason on the row', async () => {
      const res = await list('&limit=100')
      const rowD = res.body.items.find((o: any) => o.id === idD)
      expect(rowD.payment).toMatchObject({
        status: 'FAILED',
        failureReason: 'card_declined_ops',
      })
    })

    it('never leaks the stored gateway signature anywhere in the response', async () => {
      const res = await list('&limit=100')
      expect(res.status).toBe(200)
      expect(JSON.stringify(res.body)).not.toContain('ops-secret-signature-a')
    })
  })

  // =========================================================================
  // ORDER DETAIL (admin view)
  // =========================================================================
  describe('order detail projection', () => {
    it('returns payment, customer and delivery detail to an admin', async () => {
      const res = await request(app).get(`${API}/orders/${idA}`).set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(idA)
      expect(res.body.payment).toMatchObject({
        status: 'CAPTURED',
        method: 'RAZORPAY',
        razorpayPaymentId: `pay_ops_a_${TAG}`,
        razorpayOrderId: `order_ops_a_${TAG}`,
      })
      expect(res.body.user).toMatchObject({ id: owner.id, email: owner.email })
      expect(res.body.delivery).toMatchObject({
        status: 'SHIPPED',
        courierPartner: 'Delhivery Ops',
        trackingNumber: `TRK-OPS-${TAG}`,
        recipientName: `Ops Alpha ${TAG}`,
        recipientPhone: '9876500011',
      })
      expect(res.body.delivery.estimatedDelivery).toBeTruthy()
      expect(res.body.items).toHaveLength(1)
    })

    it('hides the stored gateway signature from the admin detail too', async () => {
      const res = await request(app).get(`${API}/orders/${idA}`).set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.payment.razorpaySignature).toBeUndefined()
      expect(JSON.stringify(res.body)).not.toContain('ops-secret-signature-a')
    })

    it('resolves the same order by its order number', async () => {
      const res = await request(app)
        .get(`${API}/orders/${ORDER_PREFIX}-A`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(idA)
    })

    it('does not disclose a mismatched order to a different customer', async () => {
      const other = await AuthService.register({
        fullName: 'Ops Other',
        email: `ops.other.${TAG}@vedhicfoods.com`,
        password: 'OpsOther@Vedhic2026!',
      })
      createdUserIds.push(other.user.id)
      const res = await request(app).get(`${API}/orders/${idA}`).set(auth(other.accessToken))
      expect(res.status).toBe(404)
    })
  })
})
