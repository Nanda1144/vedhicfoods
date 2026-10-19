import { Request, Response, NextFunction } from 'express'
import { prisma } from '../config/database'
import { OrderStatus, PaymentStatus, Prisma, RoleName } from '@prisma/client'
import { ValidationError } from '../utils/errors'

import { clampPageNumber, clampPageSize } from '../utils/pagination'

/**
 * Human-readable labels for the status breakdown widget. Exported so the
 * console can stay in lock-step if it ever needs the same vocabulary.
 */
const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  PENDING_PAYMENT: 'Pending payment',
  PAYMENT_FAILED: 'Payment failed',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
}

export class AdminController {
  /**
   * GET /api/v1/admin/dashboard
   *
   * Returns every dashboard widget in one aggregate payload.
   *
   * CORRECTNESS: this previously returned only raw counts plus the 10 most
   * recent orders, and the console derived revenue, the weekly series, top
   * products and category performance in the browser from a *bounded* slice of
   * the data. The result was several silently-wrong figures — most visibly a
   * "last 30 days" revenue card backed by an all-time, unbounded aggregate.
   * Every widget is now computed here against the full dataset with an explicit
   * date window.
   *
   * PERFORMANCE: all primary reads run in one `Promise.all`. The dashboard no
   * longer forces the console into a chain of paginated `fetchAll` calls (up to
   * ~22 sequential requests that routinely exceeded the 60s client timeout).
   */
  public static async getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const now = new Date()
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      const tenWeeksAgo = new Date(now.getTime() - 70 * 24 * 60 * 60 * 1000)

      const [
        totalOrders,
        totalCustomers,
        totalProducts,
        lowStock,
        revenueAgg,
        revenue30dAgg,
        pendingOrders,
        recentOrders,
        statusGroups,
        recentCustomers,
        topItems,
        categoryGroups,
        categories,
        weeklyOrders,
      ] = await Promise.all([
        prisma.order.count(),
        prisma.user.count({ where: { isDeleted: false, role: RoleName.CUSTOMER } }),
        prisma.product.count({ where: { isActive: true, isDeleted: false } }),
        prisma.product.count({ where: { isActive: true, isDeleted: false, stock: { gt: 0, lte: 10 } } }),
        prisma.order.aggregate({
          _sum: { total: true },
          where: { paymentStatus: PaymentStatus.PAID, status: { not: OrderStatus.CANCELLED } },
        }),
        prisma.order.aggregate({
          _sum: { total: true },
          where: {
            paymentStatus: PaymentStatus.PAID,
            status: { not: OrderStatus.CANCELLED },
            createdAt: { gte: thirtyDaysAgo },
          },
        }),
        prisma.order.count({
          where: { status: { in: [OrderStatus.PENDING, OrderStatus.PENDING_PAYMENT, OrderStatus.PAYMENT_FAILED] } },
        }),
        prisma.order.findMany({
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            items: true,
            user: { select: { id: true, fullName: true, email: true } },
          },
        }),
        prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.user.findMany({
          where: { isDeleted: false, role: RoleName.CUSTOMER },
          take: 8,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            isActive: true,
            isVerified: true,
            lastLoginAt: true,
            createdAt: true,
            _count: { select: { orders: true } },
          },
        }),
        prisma.orderItem.groupBy({
          by: ['productId'],
          where: { productId: { not: null } },
          _sum: { quantity: true, subtotal: true },
          orderBy: { _sum: { quantity: 'desc' } },
          take: 5,
        }),
        prisma.product.groupBy({
          by: ['categoryId'],
          where: { isDeleted: false },
          _count: { _all: true },
          _sum: { stock: true },
        }),
        prisma.category.findMany({ select: { id: true, name: true } }),
        prisma.$queryRaw<Array<{ weekStart: Date; orders: number; revenue: Prisma.Decimal }>>`
          SELECT
            date_trunc('week', "createdAt") AS "weekStart",
            COUNT(*)::integer AS "orders",
            COALESCE(
              SUM(CASE WHEN "paymentStatus" = 'PAID' AND "status" <> 'CANCELLED' THEN "total" ELSE 0 END),
              0
            ) AS "revenue"
          FROM orders
          WHERE "createdAt" >= ${tenWeeksAgo}
          GROUP BY date_trunc('week', "createdAt")
          ORDER BY date_trunc('week', "createdAt") ASC
        `,
      ])

      const revenue = Number(revenueAgg._sum.total ?? 0)
      const revenue30d = Number(revenue30dAgg._sum.total ?? 0)

      const statusCount = (status: OrderStatus): number =>
        statusGroups.find((group) => group.status === status)?._count._all ?? 0

      const orderStatusBreakdown = statusGroups
        .map((group) => ({
          label: ORDER_STATUS_LABELS[group.status] ?? group.status,
          value: group._count._all,
        }))
        .sort((a, b) => b.value - a.value)

      // PostgreSQL returns one row per week, so application memory stays
      // bounded to at most eleven buckets regardless of order volume.
      const revenueSeries = weeklyOrders.slice(-10).map((bucket, index) => ({
        label: `Wk ${index + 1}`,
        revenue: Math.round(Number(bucket.revenue)),
        orders: Number(bucket.orders),
      }))

      // Top products across the whole catalogue of order items.
      const topProductIds = topItems
        .map((item) => item.productId)
        .filter((id): id is string => Boolean(id))
      const topProductDetails = topProductIds.length
        ? await prisma.product.findMany({ where: { id: { in: topProductIds } }, select: { id: true, name: true } })
        : []
      const productNameById = new Map(topProductDetails.map((product) => [product.id, product.name]))
      const topProducts = topItems
        .filter((item) => item.productId)
        .map((item) => ({
          productId: item.productId as string,
          name: productNameById.get(item.productId as string) ?? 'Product',
          image: '',
          unitsSold: item._sum.quantity ?? 0,
          revenue: Math.round(Number(item._sum.subtotal ?? 0)),
        }))

      // Lifetime spend for the recent-customer cards.
      const customerIds = recentCustomers.map((customer) => customer.id)
      const spendGroups = customerIds.length
        ? await prisma.order.groupBy({
            by: ['userId'],
            where: { userId: { in: customerIds }, paymentStatus: PaymentStatus.PAID },
            _sum: { total: true },
          })
        : []
      const spendByUser = new Map(spendGroups.map((group) => [group.userId, Number(group._sum.total ?? 0)]))
      const recentCustomersPayload = recentCustomers.map((customer) => ({
        id: customer.id,
        fullName: customer.fullName,
        email: customer.email,
        phone: customer.phone,
        isActive: customer.isActive,
        isVerified: customer.isVerified,
        lastLoginAt: customer.lastLoginAt,
        createdAt: customer.createdAt,
        orderCount: customer._count.orders,
        totalSpent: spendByUser.get(customer.id) ?? 0,
      }))

      // Category performance, shared by stock and count.
      const categoryNameById = new Map(categories.map((category) => [category.id, category.name]))
      const totalStock = categoryGroups.reduce((sum, group) => sum + (group._sum.stock ?? 0), 0) || 1
      const categoryPerformance = categoryGroups
        .map((group) => {
          const stock = group._sum.stock ?? 0
          return {
            name: categoryNameById.get(group.categoryId) ?? 'Uncategorised',
            count: group._count._all,
            stock,
            value: stock,
            share: Math.round((stock / totalStock) * 100),
          }
        })
        .sort((a, b) => b.value - a.value)
        .slice(0, 6)

      res.status(200).json({
        success: true,
        data: {
          overview: {
            totalOrders,
            revenue,
            revenue30d,
            pendingOrders,
            deliveredOrders: statusCount(OrderStatus.DELIVERED),
            cancelledOrders: statusCount(OrderStatus.CANCELLED),
            totalCustomers,
            totalProducts,
            lowStock,
          },
          recentOrders,
          recentCustomers: recentCustomersPayload,
          topProducts,
          revenueSeries,
          orderStatusBreakdown,
          categoryPerformance,
          lowStockCount: lowStock,
        },
      })
    } catch (error) {
      next(error)
    }
  }

public static async getCustomers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = clampPageNumber(req.query.page, 1)
      const limit = clampPageSize(req.query.limit, 20)
      const search = req.query.search as string
      const status = req.query.status as string

      const where: any = {
        isDeleted: false,
        role: RoleName.CUSTOMER,
      }

      if (search) {
        where.OR = [
          { fullName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ]
      }
      if (status === 'active') where.isActive = true
      if (status === 'inactive') where.isActive = false
      if (status === 'verified') where.isVerified = true
      if (status === 'unverified') where.isVerified = false

      const [customers, total] = await Promise.all([
        prisma.user.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            isActive: true,
            isVerified: true,
            lastLoginAt: true,
            createdAt: true,
            _count: {
              select: {
                orders: true,
              },
            },
          },
        }),
        prisma.user.count({ where }),
      ])

      res.status(200).json({
        success: true,
        data: customers.map((c: any) => ({
          id: c.id,
          fullName: c.fullName,
          email: c.email,
          phone: c.phone,
          isActive: c.isActive,
          isVerified: c.isVerified,
          lastLoginAt: c.lastLoginAt,
          createdAt: c.createdAt,
          orderCount: c._count.orders,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/v1/admin/audit-logs
   * Fetches audit trail with filtering, pagination, search.
   */
  public static async getAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = clampPageNumber(req.query.page, 1)
      const limit = clampPageSize(req.query.limit, 20, 100)
      const search = String(req.query.search || '').trim()
      const actorId = req.query.actorId ? String(req.query.actorId) : undefined
      const actor = req.query.actor ? String(req.query.actor) : undefined
      const action = req.query.action ? String(req.query.action) : undefined
      const entity = req.query.entity ? String(req.query.entity) : undefined
      const from = req.query.from ? String(req.query.from) : undefined
      const to = req.query.to ? String(req.query.to) : undefined

      // SECURITY/ROBUSTNESS: an unparseable date previously produced `new Date(x)`
      // → `Invalid Date`, which Prisma translated into a 500 on every audit-log
      // read with a malformed `from`/`to`. Reject the request cleanly instead of
      // letting garbage input reach the query planner.
      const fromDate = from ? new Date(from) : undefined
      if (from && (fromDate === undefined || Number.isNaN(fromDate.getTime()))) {
        throw new ValidationError('Invalid `from` date. Use an ISO-8601 or YYYY-MM-DD value.')
      }
      const toDate = to ? new Date(to) : undefined
      if (to && (toDate === undefined || Number.isNaN(toDate.getTime()))) {
        throw new ValidationError('Invalid `to` date. Use an ISO-8601 or YYYY-MM-DD value.')
      }
      if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
        throw new ValidationError('`from` must be before or equal to `to`.')
      }

      const where: any = {}
      if (actorId) where.actorId = actorId
      if (actor) where.actorEmail = { contains: actor, mode: 'insensitive' }
      if (action) where.action = action
      if (entity) where.entity = entity
      if (fromDate || toDate) {
        where.createdAt = {}
        if (fromDate) where.createdAt.gte = fromDate
        if (toDate) {
          const d = new Date(toDate)
          d.setHours(23, 59, 59, 999)
          where.createdAt.lte = d
        }
      }
      if (search) {
        where.OR = [
          { actorEmail: { contains: search, mode: 'insensitive' } },
          { action: { contains: search, mode: 'insensitive' } },
          { entity: { contains: search, mode: 'insensitive' } },
          { entityId: { contains: search, mode: 'insensitive' } },
        ]
      }

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            actor: {
              select: { id: true, fullName: true, email: true },
            },
          },
        }),
        prisma.auditLog.count({ where }),
      ])

      res.status(200).json({
        success: true,
        data: logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    } catch (error) {
      next(error)
    }
  }
}
