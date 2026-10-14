import { Request, Response } from 'express'
import { CheckoutService } from '../services/checkout.service'
import { checkoutSchema, updateOrderStatusSchema } from '../types/checkout.types'
import { logger } from '../config/logger'
import { sendControllerError } from '../utils/api-response'

export class CheckoutController {
  /**
   * POST /api/v1/checkout
   * Primary transactional checkout endpoint.
   */
  public static async checkout(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required to checkout' })
        return
      }

      const parsed = checkoutSchema.safeParse(req.body)
      if (!parsed.success) {
        const firstError = parsed.error.issues[0]?.message || 'Validation failed'
        res.status(400).json({
          success: false,
          error: firstError,
          details: parsed.error.issues,
        })
        return
      }

      const headerIdempotencyKey =
        (req.headers['idempotency-key'] as string) ||
        (req.headers['x-idempotency-key'] as string) ||
        undefined

      const { response, isIdempotentReplay } = await CheckoutService.processCheckout(
        userId,
        parsed.data,
        headerIdempotencyKey
      )

      if (isIdempotentReplay) {
        res.setHeader('X-Idempotent-Replay', 'true')
        res.status(200).json(response)
        return
      }

      res.status(201).json(response)
    } catch (error: any) {
      logger.error({ error: error.message }, 'Checkout processing failed')
      sendControllerError(res, error, 'Checkout failed', req.id)
    }
  }

  /**
   * PATCH /api/v1/orders/:id/status
   * Strict Order State Machine transition endpoint.
   */
  public static async updateOrderStatus(req: Request, res: Response): Promise<void> {
    try {
      const orderId = String(req.params.id)
      const parsed = updateOrderStatusSchema.safeParse(req.body)

      if (!parsed.success) {
        const firstError = parsed.error.issues[0]?.message || 'Validation failed'
        res.status(400).json({
          success: false,
          error: firstError,
          details: parsed.error.issues,
        })
        return
      }

      const response = await CheckoutService.transitionOrderStatus(
        orderId,
        parsed.data.status,
        parsed.data.notes,
        req.user?.id
      )

      res.status(200).json({
        success: true,
        message: `Order status updated to '${parsed.data.status}'`,
        order: response,
      })
    } catch (error: any) {
      logger.error({ error: error.message, orderId: req.params.id }, 'Failed to transition order status')
      sendControllerError(res, error, 'Failed to update order status', req.id)
    }
  }
}
