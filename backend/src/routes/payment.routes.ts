import { Router } from 'express'
import { PaymentController } from '../controllers/payment.controller'
import { authenticateOrderAccess } from '../middleware/order-auth.middleware'

const router = Router()

/**
 * GET /api/v1/payments/config
 *
 * Public payment availability for the storefront checkout. Contains no secrets.
 */
router.get('/config', PaymentController.getPaymentConfig)

// ==========================================
// RAZORPAY WEBHOOK (No auth — Razorpay calls this directly)
// Raw body capture is critical for HMAC signature verification.
// ==========================================

/**
 * POST /api/v1/payments/razorpay/webhook
 *
 * Receives independent payment events from Razorpay servers.
 * Signature verified via RAZORPAY_WEBHOOK_SECRET (HMAC-SHA256).
 * Handles: payment.captured, payment.failed, order.paid
 *
 * The byte-exact body is captured by the `verify` hook of the global
 * `express.json()` parser in `app.ts` (see `utils/raw-body.ts`). A route-level
 * `express.raw()` is NOT used: the global parser runs before this router and
 * has already drained the request stream by the time this handler is reached,
 * so `express.raw()` would find nothing left to read and every genuine
 * Razorpay delivery would fail signature verification.
 */
router.post('/razorpay/webhook', PaymentController.handleWebhook)

// ==========================================
// AUTHENTICATED PAYMENT ROUTES
// ==========================================

/**
 * POST /api/v1/payments/razorpay/order
 *
 * Initiates a Razorpay payment session for an existing order.
 * Request body: { orderId: string }
 *
 * Amount and currency are ALWAYS fetched from DB — never trusted from frontend.
 * Returns the Razorpay order ID, public key, and prefill data needed by the frontend SDK.
 */
router.post(
  '/razorpay/order',
  authenticateOrderAccess,
  PaymentController.createRazorpayOrder
)

/**
 * POST /api/v1/payments/razorpay/verify
 *
 * Verifies Razorpay payment signature and confirms the order.
 * This is the PRIMARY confirmation path (frontend-triggered after payment).
 *
 * Request body:
 * - razorpayOrderId: string   (order_XXX from Razorpay)
 * - razorpayPaymentId: string (pay_XXX from Razorpay)
 * - razorpaySignature: string (HMAC signature from Razorpay)
 *
 * SECURITY: Signature is verified server-side. Frontend amounts are IGNORED.
 */
router.post(
  '/razorpay/verify',
  authenticateOrderAccess,
  PaymentController.verifyPayment
)

/**
 * GET /api/v1/payments/status/:orderId
 *
 * Returns payment and order status for the authenticated customer's order.
 * Customers can only query their own orders.
 */
router.get(
  '/status/:orderId',
  authenticateOrderAccess,
  PaymentController.getPaymentStatus
)

export default router
