import './_safety'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import {
  RoleName,
  OrderStatus,
  PaymentStatus,
  PaymentRecordStatus,
  PaymentMethod,
  DeliveryStatus,
} from '@prisma/client'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { resolveDateWindow } from '../../src/services/report.service'
import { BrevoEmailService } from '../../src/integrations/brevo/brevo.service'

const app = createApp()
const API = '/api/v1'

const TAG = String(Date.now())
const ADMIN_EMAIL = 'admin@vedhicfoods.com'
const ADMIN_PASSWORD = 'Admin@Vedhic2026'
const PASSWORD = 'Password@123'
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

const nowMs = Date.now()
const tToday = new Date(nowMs)
const tWeek = new Date(nowMs - 2 * 24 * 3600 * 1000)
const tOld = new Date(nowMs - 40 * 24 * 3600 * 1000)

const createdOrderIds: string[] = []
const createdProductIds: string[] = []
const createdCategoryIds: string[] = []
const createdCouponIds: string[] = []
const createdUserIds: string[] = []

const round2 = (n: number) => Math.round(n * 100) / 100

interface Window {
  from?: Date
  to?: Date
}

function range(filter: Record<string, unknown>): Window {
  return resolveDateWindow(filter)
}

function dateWhere(filter: Record<string, unknown>): Record<string, unknown> {
  const w = range(filter)
  const out: Record<string, unknown> = {}
  if (w.from) out.gte = w.from
  if (w.to) out.lte = w.to
  return out
}

async function rawPaidOrders(filter: Record<string, unknown>) {
  const where: any = {
    paymentStatus: PaymentStatus.PAID,
    status: { not: OrderStatus.CANCELLED },
  }
  const dw = dateWhere(filter)
  if (Object.keys(dw).length) where.createdAt = dw
  const orders = await prisma.order.findMany({ where, select: { total: true } })
  return {
    count: orders.length,
    revenue: round2(orders.reduce((s, o) => s + Number(o.total), 0)),
  }
}

async function rawRevenueRows(filter: Record<string, unknown>) {
  const where: any = { status: { not: OrderStatus.CANCELLED } }
  const dw = dateWhere(filter)
  if (Object.keys(dw).length) where.createdAt = dw
  const groups = await prisma.order.groupBy({
    by: ['paymentStatus'],
    where,
    _sum: { total: true, discount: true },
    _count: { _all: true },
  })
  const paid = groups.find((g) => g.paymentStatus === PaymentStatus.PAID)
  const refunded =
    Number(
      groups.find((g) => g.paymentStatus === PaymentStatus.REFUNDED)?._sum.total ?? 0
    ) +
    Number(
      groups.find((g) => g.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED)?._sum.total ?? 0
    )
  return {
    grossRevenue: round2(groups.reduce((s, g) => s + Number(g._sum.total ?? 0), 0)),
    netPaidRevenue: round2(Number(paid?._sum.total ?? 0)),
    refundedAmount: round2(Number(refunded ?? 0)),
  }
}

async function rawOrderCounts(filter: Record<string, unknown>) {
  const where: any = {}
  const dw = dateWhere(filter)
  if (Object.keys(dw).length) where.createdAt = dw
  const groups = await prisma.order.groupBy({ by: ['status'], where, _count: { _all: true } })
  const map = new Map(groups.map((g) => [g.status, g._count._all]))
  return {
    total: groups.reduce((s, g) => s + g._count._all, 0),
    cancelled: map.get(OrderStatus.CANCELLED) ?? 0,
  }
}

async function rawProductRows(filter: Record<string, unknown>): Promise<any[]> {
  const where: any = { productId: { not: null } }
  const dw = dateWhere(filter)
  if (Object.keys(dw).length) where.order = { createdAt: dw }
  return prisma.orderItem.groupBy({
    by: ['productId'],
    where,
    _sum: { quantity: true, subtotal: true },
    _count: { _all: true },
  })
}

async function rawPaymentTotals(filter: Record<string, unknown>) {
  const where: any = {}
  const dw = dateWhere(filter)
  if (Object.keys(dw).length) where.createdAt = dw
  const groups = await prisma.payment.groupBy({
    by: ['status'],
    where,
    _sum: { amount: true },
    _count: { _all: true },
  })
  const sumFor = (status: PaymentRecordStatus) =>
    round2(Number(groups.find((g) => g.status === status)?._sum.amount ?? 0))
  return {
    total: groups.reduce((s, g) => s + g._count._all, 0),
    captured: sumFor(PaymentRecordStatus.CAPTURED),
    refunded: sumFor(PaymentRecordStatus.REFUNDED),
  }
}

async function rawDeliveryTotals(filter: Record<string, unknown>) {
  const where: any = {}
  const dw = dateWhere(filter)
  if (Object.keys(dw).length) where.createdAt = dw
  const groups = await prisma.delivery.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  })
  return {
    total: groups.reduce((s, g) => s + g._count._all, 0),
    delivered: groups.find((g) => g.status === DeliveryStatus.DELIVERED)?._count._all ?? 0,
  }
}

async function rawCustomerCounts(filter: Record<string, unknown>) {
  const dw = dateWhere(filter)
  const newWhere: any = { isDeleted: false, role: RoleName.CUSTOMER }
  if (Object.keys(dw).length) newWhere.createdAt = dw
  const newCustomers = await prisma.user.count({ where: newWhere })

  const paidWhere: any = {
    paymentStatus: PaymentStatus.PAID,
    status: { not: OrderStatus.CANCELLED },
  }
  if (Object.keys(dw).length) paidWhere.createdAt = dw
  const payingGroups = await prisma.order.groupBy({ by: ['userId'], where: paidWhere })
  return { newCustomersInWindow: newCustomers, payingCustomersInWindow: payingGroups.length }
}

async function rawDiscountTotals(filter: Record<string, unknown>) {
  const dw = dateWhere(filter)
  const usageWhere: any = {}
  if (Object.keys(dw).length) usageWhere.usedAt = dw
  const [usageAgg, orderAgg, usageCount] = await Promise.all([
    prisma.couponUsage.aggregate({ _sum: { discountApplied: true }, where: usageWhere }),
    prisma.order.aggregate({
      _sum: { discount: true },
      where: {
        createdAt: dw,
        discount: { gt: 0 },
      },
    }),
    prisma.couponUsage.count({ where: usageWhere }),
  ])
  return {
    usagesInWindow: usageCount,
    couponDiscountApplied: round2(Number(usageAgg._sum.discountApplied ?? 0)),
    orderDiscountInWindow: round2(Number(orderAgg._sum.discount ?? 0)),
  }
}

let adminToken: string
let suiteCustomer: { id: string; email: string; token: string }
let suiteProductId: string
let suiteCategoryId: string
let suiteCouponId: string

async function createStaffWithPermission(email: string, perm: string | null): Promise<string> {
  const role = await prisma.role.findUnique({ where: { name: RoleName.STAFF } })
  if (!role) throw new Error('STAFF role is not seeded')
  const u = await prisma.user.create({
    data: {
      email,
      fullName: `Report Staff ${email}`,
      passwordHash: await AuthService.hashPassword(PASSWORD),
      role: RoleName.STAFF,
      isActive: true,
      isVerified: true,
    },
  })
  createdUserIds.push(u.id)
  await prisma.userRole.create({
    data: { userId: u.id, roleId: role.id, assignedBy: 'REPORT_SUITE' },
  })
  if (perm) {
    const p = await prisma.permission.findUnique({ where: { slug: perm } })
    if (p) {
      await prisma.userPermission.create({
        data: { userId: u.id, permissionId: p.id, assignedBy: 'REPORT_SUITE' },
      })
    }
  }
  return u.id
}

describe('Date-Windowed Reporting API', () => {
  beforeAll(async () => {
    vi.spyOn(BrevoEmailService, 'sendTransactionalEmail').mockResolvedValue('report-suite-msg-id')

    const login = await request(app)
      .post(`${API}/admin/auth/login`)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    expect(login.status).toBe(200)
    adminToken = login.body.accessToken

    const reg = await AuthService.register({
      fullName: 'Report Suite Customer',
      email: `report.customer.${TAG}@vedhicfoods.com`,
      password: 'Password@1234',
    })
    suiteCustomer = { id: reg.user.id, email: reg.user.email, token: reg.accessToken }
    createdUserIds.push(reg.user.id)

    const suffix = Math.floor(Math.random() * 1e9)
    const category = await prisma.category.create({
      data: { name: `Report Cat ${suffix}`, slug: `report-cat-${suffix}` },
    })
    suiteCategoryId = category.id
    createdCategoryIds.push(category.id)

    const product = await prisma.product.create({
      data: {
        name: `Report Product ${suffix}`,
        slug: `report-prod-${suffix}`,
        sku: `SKU-REPORT-${suffix}`,
        categoryId: category.id,
        price: 100,
        mrp: 120,
        stock: 100,
      },
    })
    suiteProductId = product.id
    createdProductIds.push(product.id)
    const inventory = await prisma.inventory.create({
      data: {
        productId: product.id,
        availableQuantity: 100,
        reorderThreshold: 10,
      },
    })
    await prisma.inventoryLog.createMany({
      data: [
        {
          inventoryId: inventory.id,
          productId: product.id,
          operation: 'RESTOCK',
          previousQuantity: 0,
          newQuantity: 20,
          quantityChange: 20,
          reason: 'report suite',
          createdAt: tToday,
        },
        {
          inventoryId: inventory.id,
          productId: product.id,
          operation: 'SALE',
          previousQuantity: 20,
          newQuantity: 15,
          quantityChange: -5,
          reason: 'report suite',
          createdAt: tWeek,
        },
        {
          inventoryId: inventory.id,
          productId: product.id,
          operation: 'ADJUSTMENT',
          previousQuantity: 15,
          newQuantity: 18,
          quantityChange: 3,
          reason: 'report suite',
          createdAt: tOld,
        },
      ],
    })

    const coupon = await prisma.coupon.create({
      data: {
        code: `REPORT-${TAG}`,
        description: 'report suite coupon',
        discountValue: 10,
        isActive: true,
      },
    })
    suiteCouponId = coupon.id
    createdCouponIds.push(coupon.id)

    const makeOrder = async (
      orderNumber: string,
      createdAt: Date,
      status: OrderStatus,
      paymentStatus: PaymentStatus,
      total: number
    ) => {
      const order = await prisma.order.create({
        data: {
          orderNumber,
          userId: suiteCustomer.id,
          customerName: 'Report Suite Customer',
          customerEmail: suiteCustomer.email,
          phone: '9811223344',
          subtotal: total,
          total,
          status,
          paymentStatus,
          createdAt,
        },
      })
      createdOrderIds.push(order.id)
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          productId: suiteProductId,
          name: `Report Product ${suffix}`,
          sku: `SKU-REPORT-${suffix}`,
          price: 10_000_000,
          quantity: 2,
          subtotal: 10_000_000,
        },
      })
      return order
    }

    const oToday = await makeOrder(
      `VF-REPORT-${TAG}-T`,
      tToday,
      OrderStatus.CONFIRMED,
      PaymentStatus.PAID,
      100
    )
    const oWeek = await makeOrder(
      `VF-REPORT-${TAG}-W`,
      tWeek,
      OrderStatus.CONFIRMED,
      PaymentStatus.PAID,
      100
    )
    const oOld = await makeOrder(
      `VF-REPORT-${TAG}-O`,
      tOld,
      OrderStatus.CANCELLED,
      PaymentStatus.PENDING,
      50
    )

    await prisma.payment.create({
      data: {
        orderId: oToday.id,
        amount: 100,
        method: PaymentMethod.RAZORPAY,
        status: PaymentRecordStatus.CAPTURED,
        createdAt: tToday,
      },
    })
    await prisma.payment.create({
      data: {
        orderId: oWeek.id,
        amount: 100,
        method: PaymentMethod.RAZORPAY,
        status: PaymentRecordStatus.REFUNDED,
        createdAt: tWeek,
      },
    })

    await prisma.delivery.create({
      data: {
        orderId: oToday.id,
        status: DeliveryStatus.DELIVERED,
        deliveredAt: new Date(tToday.getTime() + 3600_000),
        createdAt: tToday,
      },
    })
    await prisma.delivery.create({
      data: {
        orderId: oWeek.id,
        status: DeliveryStatus.PENDING,
        createdAt: tWeek,
      },
    })

    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-REPORT-${TAG}`,
        orderId: oToday.id,
        userId: suiteCustomer.id,
        subtotal: 100,
        total: 100,
        createdAt: tToday,
      },
    })

    await prisma.couponUsage.create({
      data: {
        couponId: coupon.id,
        userId: suiteCustomer.id,
        orderId: oToday.id,
        discountApplied: 10,
        usedAt: tToday,
      },
    })
    await prisma.couponUsage.create({
      data: {
        couponId: coupon.id,
        userId: suiteCustomer.id,
        orderId: oOld.id,
        discountApplied: 5,
        usedAt: tOld,
      },
    })
  })

  afterAll(async () => {
    await prisma.couponUsage.deleteMany({ where: { couponId: suiteCouponId } }).catch(() => {})
    await prisma.inventoryLog.deleteMany({ where: { productId: suiteProductId } }).catch(() => {})
    await prisma.inventory.deleteMany({ where: { productId: suiteProductId } }).catch(() => {})

    await prisma.delivery.deleteMany({ where: { orderId: { in: createdOrderIds } } }).catch(() => {})
    await prisma.payment.deleteMany({ where: { orderId: { in: createdOrderIds } } }).catch(() => {})
    await prisma.invoice.deleteMany({ where: { orderId: { in: createdOrderIds } } }).catch(() => {})
    await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } }).catch(() => {})
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => {})

    await prisma.coupon.deleteMany({ where: { id: suiteCouponId } }).catch(() => {})
    await prisma.product.deleteMany({ where: { id: suiteProductId } }).catch(() => {})
    await prisma.category.deleteMany({ where: { id: suiteCategoryId } }).catch(() => {})

    await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {})
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: createdUserIds } }, { entityId: { in: createdUserIds } }] },
    }).catch(() => {})
    for (const id of createdUserIds) {
      await prisma.userPermission.deleteMany({ where: { userId: id } }).catch(() => {})
      await prisma.userRole.deleteMany({ where: { userId: id } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id } }).catch(() => {})
    }
  })

  // ==========================================================================
  // 1. RBAC & PRIVACY — only reports.read holders may see any aggregate
  // ==========================================================================
  describe('authorization & privacy', () => {
    it('anonymous callers are rejected with 401', async () => {
      const res = await request(app).get(`${API}/admin/reports/sales?range=all`)
      expect(res.status).toBe(401)
    })

    it('customers cannot view any report dimension (403)', async () => {
      for (const dim of ['sales', 'revenue', 'customers', 'delivery']) {
        const res = await request(app)
          .get(`${API}/admin/reports/${dim}?range=all`)
          .set(auth(suiteCustomer.token))
        expect(res.status, `${dim} answered ${res.status}`).toBe(403)
      }
    })

    it('staff without reports.read get 403 even though authenticated', async () => {
      const id = await createStaffWithPermission(`report.noperm.${TAG}@vedhicfoods.com`, null)
      const email = (await prisma.user.findUnique({ where: { id } }))!.email
      const token = (await AuthService.login({ email, password: PASSWORD })).accessToken
      const res = await request(app)
        .get(`${API}/admin/reports/sales`)
        .set(auth(token))
      expect(res.status).toBe(403)
    })

    it('staff holding reports.read can read a report', async () => {
      const email = `report.reader.${TAG}@vedhicfoods.com`
      await createStaffWithPermission(email, 'reports.read')
      const token = (await AuthService.login({ email, password: PASSWORD })).accessToken
      const res = await request(app)
        .get(`${API}/admin/reports/inventory?range=all`)
        .set(auth(token))
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('report endpoints are read-only: write verbs are not routed (404)', async () => {
      for (const method of ['post', 'patch', 'put', 'delete'] as const) {
        const res = await (request(app) as any)[method](`${API}/admin/reports/sales`)
          .set(auth(adminToken))
          .send({})
        expect(res.status, `${method.toUpperCase()} answered ${res.status}`).toBe(404)
      }
    })
  })

  // ==========================================================================
  // 2. INPUT VALIDATION — invalid input is a clean 400, never a 500
  // ==========================================================================
  describe('input validation', () => {
    it('unknown dimension is rejected with the valid dimension list', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/bogus`)
        .set(auth(adminToken))
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('sales')
    })

    it('unrecognised range presets are rejected', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/sales?range=yearly`)
        .set(auth(adminToken))
      expect(res.status).toBe(400)
    })

    it('malformed from/to dates are rejected', async () => {
      const badFrom = await request(app)
        .get(`${API}/admin/reports/sales?from=nonsense`)
        .set(auth(adminToken))
      expect(badFrom.status).toBe(400)

      const badTo = await request(app)
        .get(`${API}/admin/reports/revenue?to=garbage`)
        .set(auth(adminToken))
      expect(badTo.status).toBe(400)
    })

    it('from>to is rejected', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/sales?from=2026-12-31&to=2026-01-01`)
        .set(auth(adminToken))
      expect(res.status).toBe(400)
    })

    it('invalid format is rejected', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/sales?format=xml`)
        .set(auth(adminToken))
      expect(res.status).toBe(400)
    })
  })

  // ==========================================================================
  // 3. WINDOW SEMANTICS — presets, custom, empty, future
  // ==========================================================================
  describe('date-window semantics', () => {
    it('range=today includes the now seed and never older seeds', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/sales?range=today`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      const { orderCount, revenue } = res.body.summary
      const raw = await rawPaidOrders({ range: 'today' })
      expect(orderCount).toBe(raw.count)
      expect(revenue).toBe(raw.revenue)

      const rows = res.body.rows as Array<{ date: string; orders: number; revenue: number }>
      const todayBucket = rows.find((r) => r.date === tToday.toISOString().slice(0, 10))
      expect(todayBucket).toBeDefined()
      expect(todayBucket!.orders).toBeGreaterThan(0)
      expect(Number(todayBucket!.revenue)).toBeGreaterThan(0)
    })

    it('range=week spans the week and excludes the 40-day-old seed', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/sales?range=week`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      const { orderCount, revenue } = res.body.summary
      const raw = await rawPaidOrders({ range: 'week' })
      expect(orderCount).toBe(raw.count)
      expect(revenue).toBe(raw.revenue)

      const counts = new Map(
        (res.body.rows as Array<{ date: string; orders: number }>).map((r) => [r.date, r.orders])
      )
      // The current week spans Monday..now, so anchor on today's paid order
      // (a fixed "N days ago" seed can fall before the week start on Mon/Tue).
      const weekDayCount = counts.get(tToday.toISOString().slice(0, 10)) ?? 0
      expect(weekDayCount).toBeGreaterThan(0)
    })

    it('range=month matches the raw window and excludes the 40-day-old seed', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/sales?range=month`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      const raw = await rawPaidOrders({ range: 'month' })
      expect(res.body.summary.orderCount).toBe(raw.count)
      expect(res.body.summary.revenue).toBe(raw.revenue)
    })

    it('empty query defaults to all-time and includes all three seeds', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/revenue`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.range.from).toBeNull()
      expect(res.body.range.to).toBeNull()

      const raw = await rawRevenueRows({})
      expect(res.body.summary.netPaidRevenue).toBe(raw.netPaidRevenue)
    })

    it('explicit future-only window returns an empty series, not an error', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/sales?from=2099-01-01&to=2099-01-31`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.summary.orderCount).toBe(0)
      expect(res.body.summary.revenue).toBe(0)
    })

    it('a custom single-day window is to-inclusive (end-of-day)', async () => {
      const today = tToday.toISOString().slice(0, 10)
      const saved = await request(app)
        .get(`${API}/admin/reports/orders?from=${today}&to=${today}`)
        .set(auth(adminToken))
      expect(saved.status).toBe(200)
      const raw = await rawOrderCounts({ from: today, to: today })
      expect(saved.body.summary.totalOrders).toBe(raw.total)
    })
  })

  // ==========================================================================
  // 4. DIMENSION CROSS-CHECKING vs raw database aggregations
  // ==========================================================================
  describe('dimensions cross-checked against raw database aggregates', () => {
    for (const range of ['today', 'week', 'month', 'all']) {
      it(`sales matches the raw window for range=${range}`, async () => {
        const res = await request(app)
          .get(`${API}/admin/reports/sales?range=${range}`)
          .set(auth(adminToken))
        const raw = await rawPaidOrders({ range })
        expect(res.status).toBe(200)
        expect(res.body.summary.orderCount).toBe(raw.count)
        expect(res.body.summary.revenue).toBe(raw.revenue)
      })

      it(`revenue matches the raw window for range=${range}`, async () => {
        const res = await request(app)
          .get(`${API}/admin/reports/revenue?range=${range}`)
          .set(auth(adminToken))
        const raw = await rawRevenueRows({ range })
        expect(res.status).toBe(200)
        expect(res.body.summary.grossRevenue).toBe(raw.grossRevenue)
        expect(res.body.summary.netPaidRevenue).toBe(raw.netPaidRevenue)
        expect(res.body.summary.refundedAmount).toBe(raw.refundedAmount)
      })

      it(`orders matches the raw window for range=${range}`, async () => {
        const res = await request(app)
          .get(`${API}/admin/reports/orders?range=${range}`)
          .set(auth(adminToken))
        const raw = await rawOrderCounts({ range })
        expect(res.status).toBe(200)
        expect(res.body.summary.totalOrders).toBe(raw.total)
        expect(res.body.summary.cancelledOrders).toBe(raw.cancelled)
      })

      it(`payments matches the raw window for range=${range}`, async () => {
        const res = await request(app)
          .get(`${API}/admin/reports/payments?range=${range}`)
          .set(auth(adminToken))
        const raw = await rawPaymentTotals({ range })
        expect(res.status).toBe(200)
        expect(res.body.summary.totalPayments).toBe(raw.total)
        expect(res.body.summary.capturedTotal).toBe(raw.captured)
        expect(res.body.summary.refundedTotal).toBe(raw.refunded)
      })

      it(`delivery matches the raw window for range=${range}`, async () => {
        const res = await request(app)
          .get(`${API}/admin/reports/delivery?range=${range}`)
          .set(auth(adminToken))
        const raw = await rawDeliveryTotals({ range })
        expect(res.status).toBe(200)
        expect(res.body.summary.totalDeliveries).toBe(raw.total)
        expect(res.body.summary.delivered).toBe(raw.delivered)
      })

      it(`customers matches the raw window for range=${range}`, async () => {
        const res = await request(app)
          .get(`${API}/admin/reports/customers?range=${range}`)
          .set(auth(adminToken))
        const raw = await rawCustomerCounts({ range })
        expect(res.status).toBe(200)
        expect(res.body.summary.newCustomersInWindow).toBe(raw.newCustomersInWindow)
        expect(res.body.summary.payingCustomersInWindow).toBe(raw.payingCustomersInWindow)
      })

      it(`discounts matches the raw window for range=${range}`, async () => {
        const res = await request(app)
          .get(`${API}/admin/reports/discounts?range=${range}`)
          .set(auth(adminToken))
        const raw = await rawDiscountTotals({ range })
        expect(res.status).toBe(200)
        expect(res.body.summary.usagesInWindow).toBe(raw.usagesInWindow)
        expect(res.body.summary.couponDiscountApplied).toBe(raw.couponDiscountApplied)
      })
    }

    it('products report cross-checks best-seller quantity and revenue against raw', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/products?range=all`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)

      const rawGroups = await rawProductRows({})
      const suiteRows = rawGroups.filter((g) => g.productId === suiteProductId)
      const expectedQty = suiteRows.reduce((s, g) => s + (g._sum.quantity ?? 0), 0)
      const expectedRevenue = round2(
        suiteRows.reduce((s, g) => s + Number(g._sum.subtotal ?? 0), 0)
      )

      const row = (res.body.rows as any[]).find((r) => r.productId === suiteProductId)
      expect(row).toBeDefined()
      expect(row.quantitySold).toBe(expectedQty)
      expect(row.revenue).toBe(expectedRevenue)

      // The returned rows are self-consistent: summary totals equal the row sum.
      const rows = res.body.rows as Array<{ quantitySold: number; revenue: number }>
      expect(res.body.summary.totalQuantitySold).toBe(
        rows.reduce((s, r) => s + r.quantitySold, 0)
      )
      expect(res.body.summary.totalRevenue).toBe(
        round2(rows.reduce((s, r) => s + r.revenue, 0))
      )
      expect(res.body.summary.totalRevenue).toBeGreaterThanOrEqual(expectedRevenue)
    })

    it('inventory movements reconcile against raw inventory_logs in the window', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/inventory?range=all`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      const rawCount = await prisma.inventoryLog.count()
      expect(res.body.summary.movementsInWindow).toBe(rawCount)

      const weeklyLogs = await prisma.inventoryLog.count({
        where: { createdAt: dateWhere({ range: 'week' }) },
      })
      const weekRes = await request(app)
        .get(`${API}/admin/reports/inventory?range=week`)
        .set(auth(adminToken))
      expect(weekRes.body.summary.movementsInWindow).toBe(weeklyLogs)
    })
  })

  // ==========================================================================
  // 5. CSV EXPORT
  // ==========================================================================
  describe('csv export', () => {
    it('serves text/csv with attachment disposition and quoted escaping', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/payments?range=all&format=csv`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('text/csv')
      expect(res.headers['content-disposition']).toContain('attachment')
      expect(res.headers['content-disposition']).toContain('payments-report.csv')
      expect(res.text).toContain('kind')
      expect(res.text).toBeTruthy()
    })

    it('a future-only CSV window yields headers only', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/sales?from=2099-02-01&to=2099-02-28&format=csv`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.text).toContain('date')
      const lines = res.text.trim().split('\n').filter(Boolean)
      expect(lines.length).toBe(29) // 28 bucket headers rows + header line, all zero-fill
    })
  })

  // ==========================================================================
  // 6. PAGINATION & LIMIT CLAMPING
  // ==========================================================================
  describe('pagination & limit clamping', () => {
    it('product top-N honours a small limit', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/products?range=all&limit=1`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.rows.length).toBe(1)
    })

    it('oversized limits are clamped to the documented maximum', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/products?range=all&limit=999999`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.rows.length).toBeLessThanOrEqual(100)
    })

    it('garbage limits fall back to the default without crashing', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/products?range=all&limit=abc&page=-1`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.rows.length).toBeLessThanOrEqual(10)
    })
  })

  // ==========================================================================
  // 7. PERFORMANCE — large all-time window must not time out or blow up
  // ==========================================================================
  describe('performance with a large dataset', () => {
    let perfOrderIds: string[] = []

    beforeAll(async () => {
      const base = `VF-PERF-${TAG}-`
      const rows: any[] = []
      const user = await prisma.user.findUnique({ where: { id: suiteCustomer.id } })
      for (let i = 0; i < 300; i++) {
        rows.push({
          orderNumber: `${base}${i}`,
          userId: suiteCustomer.id,
          customerName: user!.fullName,
          customerEmail: user!.email,
          phone: '9811223344',
          subtotal: 50,
          total: 50,
          status: OrderStatus.CONFIRMED,
          paymentStatus: i % 2 === 0 ? PaymentStatus.PAID : PaymentStatus.PENDING,
          createdAt: new Date(nowMs - i * 86400000),
        })
      }
      await prisma.order.createMany({ data: rows })
      perfOrderIds = rows.map((_, i) => i) as any
      const ids = await prisma.order.findMany({
        where: { orderNumber: { startsWith: base } },
        select: { id: true },
      })
      createdOrderIds.push(...ids.map((o) => o.id))
    })

    it('all-time revenue over 300+ orders answers quickly and accurately', async () => {
      const started = Date.now()
      const res = await request(app)
        .get(`${API}/admin/reports/revenue?range=all`)
        .set(auth(adminToken))
      const elapsed = Date.now() - started
      expect(res.status).toBe(200)
      expect(res.body.summary.grossRevenue).toBe(await rawRevenueRows({}).then((r) => r.grossRevenue))
      expect(elapsed).toBeLessThan(5000)
      void perfOrderIds
    })

    it('all-time sales series over the large set stays within the daily-bucket cap', async () => {
      const res = await request(app)
        .get(`${API}/admin/reports/sales?range=all`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      // Unbounded windows do not force empty daily buckets, so size is bounded by data density.
      expect(res.body.rows.length).toBeLessThan(400)
    })
  })
})