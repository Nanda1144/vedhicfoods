import { prisma } from '../config/database'
import {
  OrderStatus,
  PaymentStatus,
  PaymentRecordStatus,
  RoleName,
  DeliveryStatus,
  Prisma,
} from '@prisma/client'
import { BadRequestError } from '../utils/errors'

export const REPORT_DIMENSIONS = [
  'sales',
  'revenue',
  'orders',
  'products',
  'inventory',
  'customers',
  'discounts',
  'payments',
  'delivery',
] as const

export type ReportDimension = (typeof REPORT_DIMENSIONS)[number]

export interface DateWindow {
  from?: Date
  to?: Date
}

export interface ReportInput {
  dimension: ReportDimension
  window: DateWindow
  limit: number
}

export interface ReportResult {
  summary: Record<string, number | string>
  rows: Array<Record<string, any>>
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function isoDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Resolves the effective date window from query inputs.
 *
 * Semantics (all of which the reporting test suite exercises):
 *   - range=today | week | month  — ISO/UTC-day presets relative to now.
 *   - range=all (default)         — unbounded (all-time), same as the dashboard.
 *   - from/to                     — custom window; `to` is inclusive end-of-day.
 *   - empty                       — all-time (no filter → full dataset).
 *   - future dates                — allowed, yields an empty series.
 *   - invalid / from>to           — clean 400, never a 500.
 */
export function resolveDateWindow(query: Record<string, unknown>): DateWindow {
  const rawRange = query.range ? String(query.range) : ''
  const ranges = ['today', 'week', 'month', 'all']
  if (rawRange !== '' && !ranges.includes(rawRange)) {
    throw new BadRequestError("Invalid `range`. Use 'today', 'week', 'month' or 'all'.")
  }

  const now = new Date()

  if (rawRange === 'today') {
    return { from: startOfDay(now), to: endOfDay(now) }
  }
  if (rawRange === 'week') {
    const monday = startOfDay(now)
    const dayOffset = (now.getDay() + 6) % 7
    monday.setDate(monday.getDate() - dayOffset)
    return { from: monday, to: endOfDay(now) }
  }
  if (rawRange === 'month') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now) }
  }

  const fromRaw = query.from !== undefined ? String(query.from) : ''
  const toRaw = query.to !== undefined ? String(query.to) : ''

  let from: Date | undefined
  let to: Date | undefined

  if (fromRaw) {
    const d = new Date(fromRaw)
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestError('Invalid `from` date. Use ISO-8601 or YYYY-MM-DD.')
    }
    from = startOfDay(d)
  }
  if (toRaw) {
    const d = new Date(toRaw)
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestError('Invalid `to` date. Use ISO-8601 or YYYY-MM-DD.')
    }
    to = endOfDay(d)
  }
  if (from && to && from.getTime() > to.getTime()) {
    throw new BadRequestError('`from` must be before or equal to `to`.')
  }

  return { from, to }
}

/**
 * Builds a Prisma date filter for `field` on the given window. Supports both
 * top-level columns ('createdAt') and relation-relative paths ('order.createdAt').
 * An unbounded window contributes no filter at all (all-time semantics).
 */
function dateFilter(field: string, window: DateWindow): Record<string, any> {
  const dateWhere: Record<string, any> = {}
  if (window.from) dateWhere.gte = window.from
  if (window.to) dateWhere.lte = window.to
  if (!Object.keys(dateWhere).length) return {}

  if (field.includes('.')) {
    const [rel, sub] = field.split('.')
    return { [rel]: { [sub]: dateWhere } }
  }
  return { [field]: dateWhere }
}

function paidOrderFilter(window: DateWindow): Record<string, any> {
  return {
    paymentStatus: PaymentStatus.PAID,
    status: { not: OrderStatus.CANCELLED },
    ...dateFilter('createdAt', window),
  }
}

/**
 * Raw-SQL WHERE clauses for the orders table, mirroring `paidOrderFilter`.
 *
 * Timestamps are bound as plain paremeters (type inferred from the column) so
 * comparisons match Prisma's timestamp(3) semantics exactly — the wall-clock
 * value of the bound instant, not a timezone-shifted one.
 */
function paidOrderWhereSql(window: DateWindow): Prisma.Sql {
  const conds: Prisma.Sql[] = [
    Prisma.sql`o."paymentStatus" = 'PAID'`,
    Prisma.sql`o."status" <> 'CANCELLED'`,
  ]
  if (window.from) conds.push(Prisma.sql`o."createdAt" >= ${window.from}`)
  if (window.to) conds.push(Prisma.sql`o."createdAt" <= ${window.to}`)
  return Prisma.join(conds, ' AND ')
}

/** Same as `paidOrderWhereSql` minus the paid/not-cancelled predicates. */
function orderWhereSql(window: DateWindow): Prisma.Sql {
  const conds: Prisma.Sql[] = []
  if (window.from) conds.push(Prisma.sql`o."createdAt" >= ${window.from}`)
  if (window.to) conds.push(Prisma.sql`o."createdAt" <= ${window.to}`)
  return conds.length ? Prisma.join(conds, ' AND ') : Prisma.sql`TRUE`
}

function buildDailyBuckets(window: DateWindow): string[] {
  if (!window.from || !window.to) return []
  const days: string[] = []
  const cursor = new Date(window.from)
  const last = endOfDay(window.to)
  let guard = 0
  while (cursor.getTime() <= last.getTime() && guard < 400) {
    days.push(isoDay(cursor))
    cursor.setDate(cursor.getDate() + 1)
    guard += 1
  }
  return days
}

interface SalesDayRow {
  day: string
  orders: number
  revenue: number
}

async function reportSales(window: DateWindow): Promise<ReportResult> {
  const where = paidOrderWhereSql(window)

  const [sums, daily] = await Promise.all([
    prisma.$queryRaw<Array<{ cnt: number; revenue: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS cnt, COALESCE(SUM(o."total"), 0)::float8 AS revenue
      FROM "orders" o
      WHERE ${where}
    `),
    prisma.$queryRaw<SalesDayRow[]>(Prisma.sql`
      SELECT
        to_char(date_trunc('day', o."createdAt"), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS orders,
        COALESCE(SUM(o."total"), 0)::float8 AS revenue
      FROM "orders" o
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1
    `),
  ])

  const orderCount = sums[0]?.cnt ?? 0
  const revenue = Number(sums[0]?.revenue ?? 0)

  const byDay = new Map(daily.map((d) => [d.day, { date: d.day, orders: d.orders, revenue: Number(d.revenue) }]))
  const days = buildDailyBuckets(window)
  const rows =
    days.length > 0
      ? days.map((d) => byDay.get(d) ?? { date: d, orders: 0, revenue: 0 })
      : daily.map((d) => ({ date: d.day, orders: d.orders, revenue: Number(d.revenue) }))

  return {
    summary: {
      orderCount,
      revenue: round2(revenue),
      averageOrderValue: orderCount ? round2(revenue / orderCount) : 0,
    },
    rows: rows.map((r) => ({ date: r.date, orders: r.orders, revenue: round2(r.revenue) })),
  }
}

async function reportRevenue(window: DateWindow): Promise<ReportResult> {
  const where = { ...dateFilter('createdAt', window), status: { not: OrderStatus.CANCELLED } }
  const groups = await prisma.order.groupBy({
    by: ['paymentStatus'],
    where,
    _sum: { total: true, discount: true },
    _count: { _all: true },
  })

  const byStatus = new Map(groups.map((g) => [g.paymentStatus, g]))
  const paid = byStatus.get(PaymentStatus.PAID)
  const refunded =
    Number(byStatus.get(PaymentStatus.REFUNDED)?._sum.total ?? 0) +
    Number(byStatus.get(PaymentStatus.PARTIALLY_REFUNDED)?._sum.total ?? 0)

  return {
    summary: {
      grossRevenue: round2(
        groups.reduce((s, g) => s + Number(g._sum.total ?? 0), 0)
      ),
      netPaidRevenue: round2(Number(paid?._sum.total ?? 0)),
      pendingCount:
        (byStatus.get(PaymentStatus.PENDING)?._count._all ?? 0) +
        (byStatus.get(PaymentStatus.PROCESSING)?._count._all ?? 0),
      failedCount: byStatus.get(PaymentStatus.FAILED)?._count._all ?? 0,
      refundedAmount: round2(Number(refunded ?? 0)),
      averageOrderValue: paid && paid._count._all
        ? round2(Number(paid._sum.total ?? 0) / paid._count._all)
        : 0,
    },
    rows: groups.map((g) => ({
      paymentStatus: g.paymentStatus,
      count: g._count._all,
      amount: round2(Number(g._sum.total ?? 0)),
      discountApplied: round2(Number(g._sum.discount ?? 0)),
    })),
  }
}

async function reportOrders(window: DateWindow): Promise<ReportResult> {
  const where = orderWhereSql(window)
  const groups = await prisma.order.groupBy({
    by: ['status'],
    where: dateFilter('createdAt', window),
    _count: { _all: true },
  })

  const byStatus = new Map(groups.map((g) => [g.status, g._count._all]))
  const [totalOrders, dayCounts] = await Promise.all([
    prisma.$queryRaw<Array<{ cnt: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS cnt FROM "orders" o WHERE ${where}
    `),
    prisma.$queryRaw<Array<{ day: string; count: number }>>(Prisma.sql`
      SELECT
        to_char(date_trunc('day', o."createdAt"), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS count
      FROM "orders" o
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1
    `),
  ])

  const byDay = new Map(dayCounts.map((d) => [d.day, d.count]))
  const days = buildDailyBuckets(window)
  const series = days.map((d) => ({ kind: 'day', key: d, count: byDay.get(d) ?? 0 }))

  return {
    summary: {
      totalOrders: totalOrders[0]?.cnt ?? 0,
      pendingOrders: byStatus.get(OrderStatus.PENDING) ?? 0,
      confirmedOrders: byStatus.get(OrderStatus.CONFIRMED) ?? 0,
      deliveredOrders: byStatus.get(OrderStatus.DELIVERED) ?? 0,
      cancelledOrders: byStatus.get(OrderStatus.CANCELLED) ?? 0,
      failedOrders:
        (byStatus.get(OrderStatus.FAILED) ?? 0) + (byStatus.get(OrderStatus.PAYMENT_FAILED) ?? 0),
    },
    rows: [
      ...groups.map((g) => ({ kind: 'status', key: g.status, count: g._count._all })),
      ...series,
    ],
  }
}

async function reportProducts(window: DateWindow, limit: number): Promise<ReportResult> {
  const where: Record<string, any> = { productId: { not: null } }
  const orderFilter = dateFilter('createdAt', window).order
  if (orderFilter) where.order = orderFilter

  const groups = await prisma.orderItem.groupBy({
    by: ['productId'],
    where,
    _sum: { quantity: true, subtotal: true },
    _count: { _all: true },
    orderBy: { _sum: { subtotal: 'desc' } },
    take: limit,
  })

  const ids = groups.map((g) => g.productId).filter(Boolean) as string[]
  const products = ids.length
    ? await prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, sku: true },
      })
    : []
  const byId = new Map(products.map((p) => [p.id, p]))

  const rows = groups.map((g) => {
    const product = byId.get(g.productId as string)
    return {
      productId: g.productId,
      name: product?.name ?? 'Unknown / deleted product',
      sku: product?.sku ?? '',
      quantitySold: g._sum.quantity ?? 0,
      orderItems: g._count._all,
      revenue: round2(Number(g._sum.subtotal ?? 0)),
    }
  })

  return {
    summary: {
      topProductsCount: rows.length,
      totalQuantitySold: rows.reduce((s, r) => s + r.quantitySold, 0),
      totalRevenue: round2(rows.reduce((s, r) => s + r.revenue, 0)),
    },
    rows,
  }
}

async function reportInventory(window: DateWindow): Promise<ReportResult> {
  const [activeProducts, lowStock, outOfStock, stockAgg, logGroups, movementCount] =
    await Promise.all([
      prisma.product.count({ where: { isActive: true } }),
      prisma.product.count({ where: { stock: { lte: 10, gt: 0 } } }),
      prisma.product.count({ where: { stock: 0 } }),
      prisma.product.aggregate({ _sum: { stock: true } }),
      prisma.inventoryLog.groupBy({
        by: ['operation'],
        where: dateFilter('createdAt', window),
        _sum: { quantityChange: true },
        _count: { _all: true },
      }),
      prisma.inventoryLog.count({ where: dateFilter('createdAt', window) }),
    ])

  return {
    summary: {
      activeProducts,
      lowStockItems: lowStock,
      outOfStockItems: outOfStock,
      totalStockUnits: Number(stockAgg._sum.stock ?? 0),
      movementsInWindow: movementCount,
    },
    rows: logGroups.map((g) => ({
      operation: g.operation,
      count: g._count._all,
      netQuantityChange: g._sum.quantityChange ?? 0,
    })),
  }
}

async function reportCustomers(window: DateWindow, limit: number): Promise<ReportResult> {
  const [totalCustomers, newCustomers, payingCount, top] = await Promise.all([
    prisma.user.count({ where: { isDeleted: false, role: RoleName.CUSTOMER } }),
    prisma.user.count({
      where: { isDeleted: false, role: RoleName.CUSTOMER, ...dateFilter('createdAt', window) },
    }),
    prisma.$queryRaw<Array<{ cnt: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT o."userId")::int AS cnt
      FROM "orders" o
      WHERE ${paidOrderWhereSql(window)}
    `),
    prisma.order.groupBy({
      by: ['userId'],
      where: paidOrderFilter(window),
      _sum: { total: true },
      _count: { _all: true },
      orderBy: { _sum: { total: 'desc' } },
      take: limit,
    }),
  ])

  const ids = top.map((t) => t.userId)
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, fullName: true, email: true },
      })
    : []
  const byId = new Map(users.map((u) => [u.id, u]))

  return {
    summary: {
      totalCustomers,
      newCustomersInWindow: newCustomers,
      payingCustomersInWindow: payingCount[0]?.cnt ?? 0,
      topCustomersRevenue: round2(top.reduce((s, t) => s + Number(t._sum.total ?? 0), 0)),
    },
    rows: top.map((t) => ({
      userId: t.userId,
      email: byId.get(t.userId)?.email ?? '',
      name: byId.get(t.userId)?.fullName ?? 'Unknown customer',
      orders: t._count._all,
      revenue: round2(Number(t._sum.total ?? 0)),
    })),
  }
}

async function reportDiscounts(window: DateWindow): Promise<ReportResult> {
  const now = new Date()
  const [
    couponTotal,
    couponsActive,
    promotionsActive,
    usagesCount,
    usagesAgg,
    ordersDiscount,
    usageGroups,
  ] = await Promise.all([
    prisma.coupon.count(),
    prisma.coupon.count({ where: { isActive: true } }),
    prisma.promotion.count({
      where: { isActive: true, startDate: { lte: now }, endDate: { gte: now } },
    }),
    prisma.couponUsage.count({ where: dateFilter('usedAt', window) }),
    prisma.couponUsage.aggregate({
      _sum: { discountApplied: true },
      where: dateFilter('usedAt', window),
    }),
    prisma.order.aggregate({
      _sum: { discount: true },
      where: { ...dateFilter('createdAt', window), discount: { gt: 0 } },
    }),
    prisma.couponUsage.groupBy({
      by: ['couponId'],
      where: dateFilter('usedAt', window),
      _sum: { discountApplied: true },
      _count: { _all: true },
      orderBy: { _sum: { discountApplied: 'desc' } },
      take: 100,
    }),
  ])

  const ids = usageGroups.map((g) => g.couponId)
  const coupons = ids.length
    ? await prisma.coupon.findMany({
        where: { id: { in: ids } },
        select: { id: true, code: true },
      })
    : []
  const byId = new Map(coupons.map((c) => [c.id, c]))

  return {
    summary: {
      totalCoupons: couponTotal,
      activeCoupons: couponsActive,
      activePromotions: promotionsActive,
      usagesInWindow: usagesCount,
      couponDiscountApplied: round2(Number(usagesAgg._sum.discountApplied ?? 0)),
      orderDiscountInWindow: round2(Number(ordersDiscount._sum.discount ?? 0)),
    },
    rows: usageGroups.map((g) => ({
      couponId: g.couponId,
      code: byId.get(g.couponId)?.code ?? '?',
      usages: g._count._all,
      discountApplied: round2(Number(g._sum.discountApplied ?? 0)),
    })),
  }
}

async function reportPayments(window: DateWindow): Promise<ReportResult> {
  const [byStatus, byMethod] = await Promise.all([
    prisma.payment.groupBy({
      by: ['status'],
      where: dateFilter('createdAt', window),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ['method'],
      where: dateFilter('createdAt', window),
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ])

  const statusMap = new Map(byStatus.map((g) => [g.status, g]))
  const captured = statusMap.get(PaymentRecordStatus.CAPTURED)
  const refunded = statusMap.get(PaymentRecordStatus.REFUNDED)
  const failed = statusMap.get(PaymentRecordStatus.FAILED)

  return {
    summary: {
      totalPayments: byStatus.reduce((s, g) => s + g._count._all, 0),
      totalAmount: round2(byStatus.reduce((s, g) => s + Number(g._sum.amount ?? 0), 0)),
      capturedTotal: round2(Number(captured?._sum.amount ?? 0)),
      refundedTotal: round2(Number(refunded?._sum.amount ?? 0)),
      failedCount: failed?._count._all ?? 0,
      pendingCount: statusMap.get(PaymentRecordStatus.PENDING)?._count._all ?? 0,
    },
    rows: [
      ...byStatus.map((g) => ({
        kind: 'status',
        key: g.status,
        count: g._count._all,
        amount: round2(Number(g._sum.amount ?? 0)),
      })),
      ...byMethod.map((g) => ({
        kind: 'method',
        key: g.method,
        count: g._count._all,
        amount: round2(Number(g._sum.amount ?? 0)),
      })),
    ],
  }
}

async function reportDelivery(window: DateWindow): Promise<ReportResult> {
  const [byStatus, delivered] = await Promise.all([
    prisma.delivery.groupBy({
      by: ['status'],
      where: dateFilter('createdAt', window),
      _count: { _all: true },
    }),
    prisma.delivery.findMany({
      where: {
        ...dateFilter('createdAt', window),
        status: DeliveryStatus.DELIVERED,
        deliveredAt: { not: null },
      },
      select: { createdAt: true, deliveredAt: true },
    }),
  ])

  let totalHours = 0
  for (const d of delivered) {
    totalHours += (d.deliveredAt!.getTime() - d.createdAt.getTime()) / 3_600_000
  }
  const averageHours = delivered.length ? totalHours / delivered.length : 0

  const byMap = new Map(byStatus.map((g) => [g.status, g._count._all]))
  const total = byStatus.reduce((s, g) => s + g._count._all, 0)

  return {
    summary: {
      totalDeliveries: total,
      delivered: byMap.get(DeliveryStatus.DELIVERED) ?? 0,
      pending: byMap.get(DeliveryStatus.PENDING) ?? 0,
      inTransit:
        (byMap.get(DeliveryStatus.IN_TRANSIT) ?? 0) +
        (byMap.get(DeliveryStatus.OUT_FOR_DELIVERY) ?? 0) +
        (byMap.get(DeliveryStatus.SHIPPED) ?? 0),
      cancelled: byMap.get(DeliveryStatus.CANCELLED) ?? 0,
      averageDeliveryHours: round2(averageHours),
    },
    rows: byStatus.map((g) => ({ status: g.status, count: g._count._all })),
  }
}

export async function generateReport(input: ReportInput): Promise<ReportResult> {
  switch (input.dimension) {
    case 'sales':
      return reportSales(input.window)
    case 'revenue':
      return reportRevenue(input.window)
    case 'orders':
      return reportOrders(input.window)
    case 'products':
      return reportProducts(input.window, input.limit)
    case 'inventory':
      return reportInventory(input.window)
    case 'customers':
      return reportCustomers(input.window, input.limit)
    case 'discounts':
      return reportDiscounts(input.window)
    case 'payments':
      return reportPayments(input.window)
    case 'delivery':
      return reportDelivery(input.window)
  }
}