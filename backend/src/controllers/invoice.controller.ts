import { Request, Response, NextFunction } from 'express'
import { InvoiceService } from '../services/invoice.service'
import { AppError } from '../utils/errors'
import { HTTP_STATUS, ERROR_CODES } from '../constants'
import { InvoiceStatus, RoleName } from '@prisma/client'
import { clampPageNumber, clampPageSize, clampSearchTerm } from '../utils/pagination'
import { orderAccessTokenMatchesOrder } from '../utils/order-token'

/**
 * Returns true when the authenticated user may act on invoices across the
 * platform. OWNER/ADMIN always qualify; staff must hold `invoices.create`.
 */
function canManageInvoices(user: any): boolean {
  if (!user) return false
  if (Array.isArray(user.roles)) {
    if (user.roles.includes(RoleName.OWNER) || user.roles.includes(RoleName.ADMIN)) return true
  }
  if (user.role === RoleName.OWNER || user.role === RoleName.ADMIN) return true
  return Array.isArray(user.permissions) && user.permissions.includes('invoices.create')
}

/**
 * Returns true when the authenticated user may read invoices across tenants.
 *
 * SECURITY: this used to be `isAdmin()` — OWNER/ADMIN only — while the admin
 * console gates the Invoices page on the `invoices.read` permission slug and
 * the seed grants that slug to STAFF. The two disagreed: a staff operator with
 * `invoices.read` was shown a platform-wide invoice list by the UI and then
 * silently received an empty, self-scoped result from the API, because a staff
 * account owns no invoices. A permission that the UI trusts and the API ignores
 * is a control operators believe they have granted and revoked but have not.
 *
 * It is now: OWNER/ADMIN, or any account holding `invoices.read`.
 *
 * It deliberately does NOT open up for customers — the CUSTOMER role holds no
 * permissions, so a storefront user still only ever sees invoices whose
 * `userId` matches their own. That narrowing is enforced per-row below, not by
 * this predicate.
 */
function canViewAllInvoices(user: any): boolean {
  if (!user) return false
  if (Array.isArray(user.roles)) {
    if (user.roles.includes(RoleName.OWNER) || user.roles.includes(RoleName.ADMIN)) return true
  }
  if (user.role === RoleName.OWNER || user.role === RoleName.ADMIN) return true
  return Array.isArray(user.permissions) && user.permissions.includes('invoices.read')
}

/** Normalizes a potentially string|string[] route param into a single string. */
function param(req: Request, key: string): string {
  const value = req.params[key]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0]
  return ''
}

export class InvoiceController {
  /**
   * GET /api/invoices
   * List invoices with pagination and filters
   */
  public static async listInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id

      // Defensive: the router enforces authentication, but never build an
      // unscoped query. An absent userId must fail loudly, not silently widen
      // the result set to every invoice on the platform.
      if (!userId) {
        throw new AppError('Authentication required', HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED)
      }

      const admin = canViewAllInvoices(req.user)

      const {
        page = '1',
        limit = '20',
        status,
        search,
        startDate,
        endDate,
      } = req.query

      // Non-admin users can only see their own invoices
      const filterUserId = admin ? undefined : userId

      // PERFORMANCE / SECURITY: `limit` was passed through as a raw
      // `parseInt`, so `?limit=1000000` was honoured and `?limit=abc` became
      // `NaN`, which Prisma then coerced unpredictably. This was the only list
      // endpoint in the codebase not routed through `clampPageSize`. Values are
      // now bounded to `MAX_PAGE_SIZE` (100) and non-numeric input falls back to
      // a sane default instead of propagating `NaN`.
      const result = await InvoiceService.listInvoices({
        userId: filterUserId,
        orderId: req.orderAccess?.orderId,
        status: status as InvoiceStatus | undefined,
        page: clampPageNumber(page, 1),
        limit: clampPageSize(limit, 20),
        search: clampSearchTerm(search),
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      })

      res.json({
        success: true,
        data: result.invoices,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      })
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/invoices/:id
   * Get a single invoice by ID
   */
  public static async getInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = param(req, 'id')
      const userId = req.user?.id
      if (!userId) {
        throw new AppError('Authentication required', HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED)
      }
      const admin = canViewAllInvoices(req.user)

      const invoice = await InvoiceService.getInvoiceById(id)

      if (!invoice) {
        throw new AppError('Invoice not found', HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND)
      }

      if (!orderAccessTokenMatchesOrder(req.orderAccess, invoice.orderId)) {
        throw new AppError('This order access token does not match the invoice.', HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN)
      }

      // Authorization: users can only view their own invoices
      if (!admin && invoice.userId !== userId) {
        throw new AppError('Unauthorized to access this invoice', HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN)
      }

      res.json({
        success: true,
        data: invoice,
      })
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/invoices/order/:orderId
   * Get invoice by order ID
   */
  public static async getInvoiceByOrderId(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orderId = param(req, 'orderId')
      const userId = req.user?.id
      if (!userId) {
        throw new AppError('Authentication required', HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED)
      }
      const admin = canViewAllInvoices(req.user)

      const invoice = await InvoiceService.getInvoiceByOrderId(orderId)

      if (!invoice) {
        throw new AppError('Invoice not found for this order', HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND)
      }

      if (!orderAccessTokenMatchesOrder(req.orderAccess, invoice.orderId)) {
        throw new AppError('This order access token does not match the invoice.', HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN)
      }

      if (!admin && invoice.userId !== userId) {
        throw new AppError('Unauthorized to access this invoice', HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN)
      }

      res.json({
        success: true,
        data: invoice,
      })
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/invoices/:id/download
   * Get a signed download URL for the invoice PDF
   */
  public static async getInvoiceDownloadUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = param(req, 'id')
      const userId = req.user?.id
      if (!userId) {
        throw new AppError('Authentication required', HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED)
      }
      const admin = canViewAllInvoices(req.user)

    const invoice = await InvoiceService.getInvoiceById(id)

    if (!invoice) {
      throw new AppError('Invoice not found', HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND)
    }

    if (!orderAccessTokenMatchesOrder(req.orderAccess, invoice.orderId)) {
      throw new AppError('This order access token does not match the invoice.', HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN)
    }

    if (!admin && invoice.userId !== userId) {
      throw new AppError('Unauthorized to access this invoice', HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN)
    }

    // Audit invoice download
    try {
      await (await import('../services/audit.service')).AuditService.record({
        action: 'INVOICE_DOWNLOADED',
        entity: 'Invoice',
        entityId: invoice.id,
        metadata: { invoiceNumber: invoice.invoiceNumber },
        req,
      })
    } catch {}

    const downloadUrl = await InvoiceService.getInvoiceDownloadUrl(id, userId!, admin)

      res.json({
        success: true,
        data: {
          downloadUrl,
          expiresIn: 3600, // 1 hour
          filename: `${invoice.invoiceNumber}.pdf`,
        },
      })
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/invoices/:id/pdf
   * Streams the generated invoice PDF directly from the API.
   *
   * Preferred over the S3 signed URL for in-app "View"/"Download": it does not
   * depend on object storage being reachable or the bucket existing, which is
   * what produced a raw S3 `NoSuchBucket` XML response in development.
   */
  public static async downloadInvoicePdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = param(req, 'id')
      const userId = req.user?.id
      if (!userId) {
        throw new AppError('Authentication required', HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED)
      }
      const admin = canViewAllInvoices(req.user)

      const invoice = await InvoiceService.getInvoiceById(id)

      if (!invoice) {
        throw new AppError('Invoice not found', HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND)
      }

      if (!orderAccessTokenMatchesOrder(req.orderAccess, invoice.orderId)) {
        throw new AppError('This order access token does not match the invoice.', HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN)
      }

      if (!admin && invoice.userId !== userId) {
        throw new AppError('Unauthorized to access this invoice', HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN)
      }

      const { buffer, filename } = await InvoiceService.getInvoicePdf(id)

      try {
        await (await import('../services/audit.service')).AuditService.record({
          action: 'INVOICE_DOWNLOADED',
          entity: 'Invoice',
          entityId: invoice.id,
          metadata: { invoiceNumber: invoice.invoiceNumber },
          req,
        })
      } catch {}

      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.setHeader('Content-Length', String(buffer.length))
      res.setHeader('Cache-Control', 'private, no-store')
      res.send(buffer)
    } catch (error) {
      next(error)
    }
  }

  /**
   * POST /api/invoices/:id/regenerate
   * Regenerate invoice PDF (admin only)
   */
  public static async regenerateInvoicePdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = param(req, 'id')

      if (!canManageInvoices(req.user)) {
        throw new AppError('Admin access required', HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN)
      }

    const invoice = await InvoiceService.regenerateInvoicePdf(id)
    try {
      await (await import('../services/audit.service')).AuditService.record({
        action: 'INVOICE_REGENERATED',
        entity: 'Invoice',
        entityId: invoice.id,
        metadata: { invoiceNumber: invoice.invoiceNumber },
        req,
      })
    } catch {}

    res.json({
        success: true,
        data: invoice,
        message: 'Invoice PDF regenerated successfully',
      })
    } catch (error) {
      next(error)
    }
  }

  /**
   * POST /api/invoices/:id/cancel
   * Cancel/void an invoice (admin only)
   */
  public static async cancelInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = param(req, 'id')
      const { reason } = req.body

      if (!canManageInvoices(req.user)) {
        throw new AppError('Admin access required', HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN)
      }

      if (!reason || String(reason).trim().length < 3) {
        throw new AppError('Cancellation reason is required (min 3 characters)', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.BAD_REQUEST)
      }

    const invoice = await InvoiceService.cancelInvoice(id, String(reason).trim())
    try {
      await (await import('../services/audit.service')).AuditService.record({
        action: 'INVOICE_CANCELLED',
        entity: 'Invoice',
        entityId: invoice.id,
        metadata: { invoiceNumber: invoice.invoiceNumber, reason },
        req,
      })
    } catch {}

    res.json({
        success: true,
        data: invoice,
        message: 'Invoice cancelled successfully',
      })
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/invoices/daily-pdf?date=YYYY-MM-DD
   * Streams every invoice issued on a business day as one PDF (one invoice per
   * page). Used by the admin console to print a delivery run.
   */
  public static async downloadDailyInvoicesPdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!canViewAllInvoices(req.user)) {
        throw new AppError('Admin access required', HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN)
      }

      const rawDate = req.query.date
      const date =
        typeof rawDate === 'string' && rawDate.trim()
          ? rawDate.trim()
          : InvoiceService.todayBusinessDate()

      const { buffer, filename, count } = await InvoiceService.getDailyInvoicesPdf(date)

      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.setHeader('X-Invoice-Count', String(count))
      res.setHeader('Cache-Control', 'no-store')
      res.send(buffer)
    } catch (error) {
      next(error)
    }
  }
}
