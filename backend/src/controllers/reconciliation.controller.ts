import { Request, Response, NextFunction } from 'express'
import { ReconciliationService } from '../services/reconciliation.service'
import { AppError } from '../utils/errors'
import { HTTP_STATUS, ERROR_CODES } from '../constants'

export class ReconciliationController {
  /**
   * GET /api/payments/reconciliation
   * Run reconciliation report for payments (admin only)
   */
  public static async getReconciliationReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { from, to, status } = req.query

      // Parse dates
      const fromDate = from ? new Date(from as string) : undefined
      const toDate = to ? new Date(to as string) : undefined

      // Validate dates
      if (fromDate && isNaN(fromDate.getTime())) {
        throw new AppError('Invalid "from" date format', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.BAD_REQUEST)
      }
      if (toDate && isNaN(toDate.getTime())) {
        throw new AppError('Invalid "to" date format', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.BAD_REQUEST)
      }

      const report = await ReconciliationService.reconcilePayments({
        from: fromDate,
        to: toDate,
        status: status as any,
      })

      res.json({
        success: true,
        data: report,
      })
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/payments/reconciliation/:razorpayOrderId
   * Reconcile a single order by Razorpay order ID (admin only)
   */
  public static async reconcileSingleOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const razorpayOrderId = typeof req.params.razorpayOrderId === 'string' ? req.params.razorpayOrderId : ''

      if (!razorpayOrderId) {
        throw new AppError('Razorpay order ID is required', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.BAD_REQUEST)
      }

      const result = await ReconciliationService.reconcileSingleOrder(razorpayOrderId)

      res.json({
        success: true,
        data: result,
      })
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/invoices/reconciliation
   * Run reconciliation report for invoices (admin only)
   */
  public static async getInvoiceReconciliation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { from, to } = req.query

      const fromDate = from ? new Date(from as string) : undefined
      const toDate = to ? new Date(to as string) : undefined

      if (fromDate && isNaN(fromDate.getTime())) {
        throw new AppError('Invalid "from" date format', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.BAD_REQUEST)
      }
      if (toDate && isNaN(toDate.getTime())) {
        throw new AppError('Invalid "to" date format', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.BAD_REQUEST)
      }

      const result = await ReconciliationService.reconcileInvoices({
        from: fromDate,
        to: toDate,
      })

      res.json({
        success: true,
        data: result,
      })
    } catch (error) {
      next(error)
    }
  }
}