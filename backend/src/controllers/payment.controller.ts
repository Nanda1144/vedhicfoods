import { Request, Response } from 'express'
import { RazorpayService } from '../integrations/razorpay/razorpay.service'
import { createRazorpayOrderSchema, verifyPaymentSchema } from '../types/payment.types'
import { logger } from '../config/logger'
import { sendControllerError } from '../utils/api-response'
import { getRawBody } from '../utils/raw-body'
import { env } from '../config/env'

export class PaymentController {
  /**
   * POST /api/v1/payments/razorpay/order
   *
   * Creates a Razorpay gateway order for an existing confirmed Vedhic Foods order.
   * Returns the Razorpay order metadata needed by the frontend checkout SDK.
   *
   * SECURITY:
   * - Amount is always sourced from the database, never from the request body
   * - Currency is always sourced from the database
   * - Only the public Razorpay key ID is returned — secret NEVER exposed
   */
  public static async createRazorpayOrder(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required' })
        return
      }

      const parsed = createRazorpayOrderSchema.safeParse(req.body)
      if (!parsed.success) {
        const firstError = parsed.error.issues[0]?.message || 'Invalid request'
        res.status(400).json({ success: false, error: firstError, details: parsed.error.issues })
        return
      }

      // An anonymous order-token is bound to exactly one order: it may only
      // initiate payment for that order, never any other.
      if (req.orderAccess && req.orderAccess.orderId !== parsed.data.orderId) {
        res
          .status(403)
          .json({ success: false, error: 'This order access token does not match the order.' })
        return
      }

      const paymentData = await RazorpayService.initiatePayment(
        parsed.data.orderId,
        userId
      )

      res.status(200).json({
        success: true,
        data: paymentData,
      })
    } catch (error: any) {
      logger.error(
        { error: error.message, userId: req.user?.id },
        'Failed to create Razorpay order'
      )
      sendControllerError(res, error, 'Failed to initiate payment', req.id)
    }
  }

  /**
   * POST /api/v1/payments/razorpay/verify
   *
   * Verifies the Razorpay payment signature after the customer completes payment.
   * This is the PRIMARY payment confirmation path (frontend-triggered).
   * The HMAC-SHA256 signature is validated server-side using RAZORPAY_KEY_SECRET.
   *
   * SECURITY:
   * - Signature is verified with timing-safe HMAC comparison
   * - Amount is cross-validated against the database
   * - Duplicate payment detection prevents double-processing
   */
  public static async verifyPayment(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required' })
        return
      }

      const parsed = verifyPaymentSchema.safeParse(req.body)
      if (!parsed.success) {
        const firstError = parsed.error.issues[0]?.message || 'Invalid verification payload'
        res.status(400).json({ success: false, error: firstError, details: parsed.error.issues })
        return
      }

      const result = await RazorpayService.verifyAndConfirmPayment(
        {
          razorpayOrderId: parsed.data.razorpayOrderId,
          razorpayPaymentId: parsed.data.razorpayPaymentId,
          razorpaySignature: parsed.data.razorpaySignature,
        },
        userId,
        req.user?.email
      )

      res.status(200).json(result)
    } catch (error: any) {
      logger.error(
        { error: error.message, userId: req.user?.id },
        'Payment verification failed'
      )
      sendControllerError(res, error, 'Payment verification failed', req.id)
    }
  }

  /**
   * POST /api/v1/payments/razorpay/webhook
   *
   * Razorpay webhook endpoint — called INDEPENDENTLY by Razorpay servers.
   * This is the SECONDARY confirmation path and is completely independent of the frontend.
   *
   * SECURITY:
   * - Webhook signature is verified using RAZORPAY_WEBHOOK_SECRET
   * - Raw body must be used for signature verification (not parsed JSON)
   * - Processes idempotently — safe to receive same event multiple times
   * - No authentication middleware — Razorpay calls this directly
   */
  public static async handleWebhook(req: Request, res: Response): Promise<void> {
    // Respond 200 quickly to Razorpay — they retry on timeout
    // Actual processing is done synchronously before response for reliability
    const signature = req.headers['x-razorpay-signature'] as string | undefined

    if (!signature) {
      logger.warn('Razorpay webhook received without signature header')
      res.status(400).json({ success: false, error: 'Missing x-razorpay-signature header' })
      return
    }

    try {
      // Byte-exact body captured by the express.json() `verify` hook. Required
      // for HMAC verification — re-serializing req.body would change key order
      // and whitespace and never match Razorpay's digest.
      const rawBody = getRawBody(req)
      if (!rawBody) {
        logger.error('Razorpay webhook received without a capturable raw body')
        res.status(400).json({ success: false, error: 'Raw body unavailable for webhook verification' })
        return
      }

      const result = await RazorpayService.processWebhookEvent(rawBody, signature)

      res.status(200).json({
        success: true,
        message: `Webhook event '${result.event}' processed`,
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Razorpay webhook processing error')
      // Status codes drive Razorpay's retry behaviour:
      //   401 — signature invalid; the request is not from Razorpay. Never retry.
      //   400 — malformed payload we can never process. Never retry.
      //   5xx — anything else (DB blip, transient dependency failure). Razorpay
      //         MUST retry, otherwise a captured payment silently never confirms
      //         its order/inventory. Processing is idempotent (CAS state gate +
      //         unique constraints), so a retry is safe.
      const statusCode =
        error.statusCode === 401 ? 401 : error.statusCode === 400 ? 400 : 500
      res.status(statusCode).json({
        success: false,
        error:
          env.NODE_ENV === 'production'
            ? 'Webhook processing failed'
            : error.message || 'Webhook processing failed',
      })
    }
  }

  /**
   * GET /api/v1/payments/status/:orderId
   *
   * Returns authoritative payment status for an order.
   * Customers can check their own order's payment state.
   */
  public static async getPaymentStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required' })
        return
      }

      const orderId = String(req.params.orderId)
      if (!orderId) {
        res.status(400).json({ success: false, error: 'orderId parameter is required' })
        return
      }

      // An anonymous order-token is bound to exactly one order: it may only
      // poll the payment status of that order.
      if (req.orderAccess && req.orderAccess.orderId !== orderId) {
        res
          .status(403)
          .json({ success: false, error: 'This order access token does not match the order.' })
        return
      }

      const status = await RazorpayService.getPaymentStatus(orderId, userId)

      res.status(200).json({ success: true, data: status })
    } catch (error: any) {
      logger.error({ error: error.message, orderId: req.params.orderId }, 'Failed to get payment status')
      sendControllerError(res, error, 'Failed to retrieve payment status', req.id)
    }
  }
}
