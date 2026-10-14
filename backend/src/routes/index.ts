import { Router } from 'express'
import { healthRoutes } from './health.routes'
import { authRoutes } from './auth.routes'
import { productRoutes } from './product.routes'
import { categoryRoutes } from './category.routes'
import { orderRoutes } from './order.routes'
import { cartRoutes } from './cart.routes'
import { checkoutRoutes } from './checkout.routes'
import { customerRoutes } from './customer.routes'
import { adminRoutes } from './admin.routes'
import { couponCustomerRoutes, promotionCustomerRoutes } from './discount.routes'
import paymentRoutes from './payment.routes'
import { invoiceRoutes } from './invoice.routes'
import { reconciliationRoutes, invoiceReconciliationRoutes } from './reconciliation.routes'
import { publicSettingsRoutes } from './settings.routes'
import { contactRoutes, ticketRoutes } from './support.routes'
import { emailWebhookRoutes } from './email-webhook.routes'
import { notificationRoutes } from './notification.routes'
import { contentRoutes } from './content.routes'
import { eventRoutes } from './events.routes'

const router = Router()

// Health Checks
router.use('/health', healthRoutes)

// Authentication & Identity Routes
router.use('/auth', authRoutes)

// Centralized Settings (public, safe subset only)
router.use('/settings', publicSettingsRoutes)

// Public Contact Form (unauthenticated, rate limited)
router.use('/contact', contactRoutes)

// Customer Support Tickets (authenticated, ownership enforced in service layer)
router.use('/support', ticketRoutes)

// In-app Notification Centre (authenticated, strictly owner-scoped)
router.use('/notifications', notificationRoutes)

// Editorial content (testimonials, FAQs, approved reviews) + newsletter subscribe
router.use('/content', contentRoutes)

// Server-Sent Events real-time stream (identity-scoped channel prefixes)
router.use('/events', eventRoutes)

// Public Storefront & Customer Routes
router.use('/products', productRoutes)
router.use('/categories', categoryRoutes)
router.use('/cart', cartRoutes)
router.use('/checkout', checkoutRoutes)
router.use('/orders', orderRoutes)
router.use('/customer', customerRoutes)
router.use('/coupons', couponCustomerRoutes)
router.use('/promotions', promotionCustomerRoutes)

// Razorpay Payment Routes
// Webhook MUST be mounted here (raw body middleware within payment.routes.ts handles it)
router.use('/payments', paymentRoutes)

// Inbound provider webhooks (SES bounce/complaint via SNS; unauthenticated,
// authenticated by message signature inside the handler).
router.use('/webhooks', emailWebhookRoutes)

// Payment Reconciliation Routes (authenticated + reports.read).
// NOTE: mount the reconciliation sub-path BEFORE `/invoices`, otherwise
// `invoiceRoutes.get('/:id')` matches the literal segment "reconciliation" and
// the reconciliation handlers are never reached.
router.use('/payments/reconciliation', reconciliationRoutes)
router.use('/invoices/reconciliation', invoiceReconciliationRoutes)

// Invoice Routes (customer + admin)
router.use('/invoices', invoiceRoutes)

// Admin Dashboard Routes
router.use('/admin', adminRoutes)

export const apiV1Router = router
