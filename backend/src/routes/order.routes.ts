import { Router } from 'express'
import { OrderController } from '../controllers/order.controller'
import { CheckoutController } from '../controllers/checkout.controller'
import { DeliveryController } from '../controllers/delivery.controller'
import { authenticate, optionalAuth, requirePermission } from '../middleware/auth.middleware'
import { authenticateOrderAccess } from '../middleware/order-auth.middleware'
import { checkoutRateLimiter } from '../middleware/rate-limiter.middleware'

const router = Router()

// ============================================================
// GUEST STOREFRONT CHECKOUT
// Unauthenticated by design — the storefront allows guest buyers.
// `optionalAuth` is used rather than no auth so a signed-in customer checking
// out under a different email keeps their own account identity. The handler
// refuses to attach an order to an account the caller has not authenticated as.
// Heavily rate limited because it mints user rows and sends transactional
// email (Brevo) to an attacker-supplied address.
// ============================================================
router.post('/checkout', checkoutRateLimiter, optionalAuth, OrderController.checkout)
router.post('/', checkoutRateLimiter, optionalAuth, OrderController.checkout)

// Current authenticated customer's order history
router.get('/my-orders', authenticate, OrderController.getMyOrders)

// ============================================================
// ORDER STATE MACHINE TRANSITIONS
// SECURITY: previously guarded only by `authenticate`, which meant any
// authenticated customer could advance their own order through the
// fulfilment state machine. `orders.update` is now required.
// ============================================================
router.patch(
  '/:id/status',
  authenticate,
  requirePermission('orders.update'),
  CheckoutController.updateOrderStatus
)

// ============================================================
// ORDER MUTATIONS
// SECURITY: these all ran under `optionalAuth`. Because the in-handler
// ownership checks were nested inside `if (req.user)`, a request with no
// token skipped authorization entirely. They now require a session, and the
// handlers enforce ownership unconditionally.
// ============================================================
router.post('/:id/cancel', authenticateOrderAccess, OrderController.cancelOrder)

// Payment lifecycle. `confirm-payment` verifies the Razorpay HMAC signature
// server-side via RazorpayService; it can never mark an order paid on trust.
router.post('/:id/confirm-payment', authenticate, OrderController.confirmPayment)
router.post('/:id/fail-payment', authenticateOrderAccess, OrderController.failPayment)
router.post('/:id/payment-failed', authenticateOrderAccess, OrderController.failPayment)

// Customer Delivery Tracking (Enforces customer order ownership)
router.get('/:orderNumberOrId/delivery', authenticateOrderAccess, DeliveryController.getCustomerDelivery)

// Order Lookup — customer isolation enforced in the handler
router.get('/:orderNumberOrId', authenticateOrderAccess, OrderController.getOrder)

export { router as orderRoutes }
export default router