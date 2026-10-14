import { Request, Response, NextFunction } from 'express'
import { prisma } from '../config/database'
import { OrderStatus, PaymentStatus, RoleName } from '@prisma/client'
import { ValidationError } from '../utils/errors'

import { clampPageNumber, clampPageSize } from '../utils/pagination'

export class AdminController {
  public static async getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const [
        totalOrders,
        pendingOrders,
        deliveredOrders,
        cancelledOrders,
        totalCustomers,
        totalProducts,
        lowStock,
        totalRevenue,
        recentOrders,
        recentPayments,
        totalDiscounts,
        totalInventory,
        totalDeliveries,
        invoiceStats,
      ] = await Promise.all([
        prisma.order.count(),
        prisma.order.count({ where: { status: OrderStatus.PENDING } }),
        prisma.order.count({ where: { status: OrderStatus.DELIVERED } }),
        prisma.order.count({ where: { status: OrderStatus.CANCELLED } }),
        prisma.user.count({ where: { isDeleted: false, role: RoleName.CUSTOMER } }),
        prisma.product.count({ where: { isActive: true } }),
        prisma.product.count({ where: { stock: { lte: 10, gt: 0 } } }),
        prisma.order.aggregate({
          _sum: { total: true },
          where: { paymentStatus: PaymentStatus.PAID, status: { not: OrderStatus.CANCELLED } },
        }),
        prisma.order.findMany({
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            items: true,
            user: { select: { fullName: true, email: true } },
          },
        }),
        prisma.payment.findMany({
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            order: { select: { orderNumber: true, customerName: true, total: true } },
          },
        }),
        prisma.coupon.count({ where: { isActive: true } }),
        prisma.product.aggregate({ _sum: { stock: true } }),
        prisma.delivery.count(),
        prisma.invoice.aggregate({ _count: true, _sum: { total: true } }),
      ])

      res.status(200).json({
        success: true,
        data: {
          overview: {
            totalOrders,
            revenue: Number(totalRevenue._sum.total || 0),
            pendingOrders,
            deliveredOrders,
            cancelledOrders,
            totalCustomers,
            totalProducts,
            lowStock,
            totalDiscounts,
            totalInventory: Number(totalInventory._sum.stock || 0),
            totalDeliveries,
          },
          recentOrders,
          recentPayments,
          invoiceStats: {
            count: invoiceStats._count,
            total: Number(invoiceStats._sum.total || 0),
          },
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
