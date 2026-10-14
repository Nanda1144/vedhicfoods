import { Router } from 'express'
import { RoleName } from '@prisma/client'
import { PaymentSettingsController } from '../controllers/payment-settings.controller'
import { ProductController } from '../controllers/product.controller'
import { CategoryController } from '../controllers/category.controller'
import { OrderController } from '../controllers/order.controller'
import { AuthController } from '../controllers/auth.controller'
import { StaffController } from '../controllers/staff.controller'
import { AdminController } from '../controllers/admin.controller'
import { staffRoutes } from './staff.routes'
import { reportRoutes } from './report.routes'
import { inventoryRoutes } from './inventory.routes'
import { deliveryRoutes } from './delivery.routes'
import { discountAdminRoutes } from './discount.routes'
import { adminSettingsRoutes } from './settings.routes'
import { staffSupportRoutes } from './staff-support.routes'
import { adminContentRoutes } from './content.routes'
import { authenticate, requirePermission, requireRole } from '../middleware/auth.middleware'
import { authRateLimiter } from '../middleware/rate-limiter.middleware'

const router = Router()

// Admin Authentication (Public Login, Protected Me)
//
// SECURITY: this is the only unauthenticated route under `/admin` and it must
// stay above the router-wide guards below.
router.post('/auth/login', authRateLimiter, AuthController.adminLogin)

// ============================================================================
// ADMIN CONSOLE BOUNDARY.
//
// Everything below is the staff-facing console API. Two router-wide guards run
// before any route handler, and both are deliberate:
//
//   1. `authenticate` — resolved identity. Several routes previously relied on
//      `requirePermission` alone and were protected only by that middleware's
//      implicit 401 when `req.user` is absent. A guard whose protection is a
//      side-effect of a null check fails the moment it is reordered, replaced
//      or forgotten on a new route. The check is now explicit and unconditional.
//
//   2. `requireRole(OWNER, ADMIN, STAFF)` — a *role* gate independent of the
//      permission slugs. The permission model is role-derived, so a slug that
//      is granted to a storefront role (e.g. `products.read` seeded onto
//      CUSTOMER) let any registered customer reach admin-catalog reads such as
//      `GET /admin/products`, which returns soft-deleted and unpublished rows
//      plus internal fields the public catalog never exposes. Permission slugs
//      answer "what may this account do"; this gate answers "may this account
//      be in the console at all". Neither alone is sufficient.
//
// Owner-only operations are additionally bounded by `assertCanManageStaffAccount`
// in the controllers, so this gate is the outer wall, not the only one.
// ============================================================================
router.use(authenticate)
router.use(requireRole(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF))

router.get('/auth/me', authenticate, AuthController.getProfile)

// Roles & Permissions Directory
router.get('/roles', authenticate, requirePermission('staff.read'), StaffController.listRoles)
router.get('/permissions', authenticate, requirePermission('staff.read'), StaffController.listPermissions)

// Staff Management Sub-router
router.use('/staff', staffRoutes)

// Warehouse Inventory Management Sub-router
router.use('/inventory', inventoryRoutes)

// Delivery & Logistics Management Sub-router
router.use('/delivery', deliveryRoutes)

// Customer Support & Contact Subsystem Sub-router
// Every route below is gated by requirePermission('support.*' / 'contacts.*')
// and additionally re-checks the permission inside the service layer.
router.use('/support', staffSupportRoutes)

// Website Content Management Sub-router
// Testimonials + FAQs CRUD, review moderation, newsletter subscriber management.
router.use('/content', adminContentRoutes)

// Dashboard
// SECURITY: these required `analytics.read`, which is not a seeded permission
// slug. OWNER/ADMIN bypass the check, so the typo was invisible for them while
// every STAFF role silently received 403 on the dashboard. `reports.read` is the
// slug the seed actually grants for sales/revenue analytics.
//
// SECURITY: these three routes previously had `requirePermission` but no
// `authenticate`. They were not anonymously reachable only because
// `requirePermission` 401s on a missing `req.user` — an accidental property of
// the middleware, not an explicit guard. Both are now declared.
router.get('/dashboard', authenticate, requirePermission('reports.read'), AdminController.getDashboard)
router.get('/analytics', authenticate, requirePermission('reports.read'), AdminController.getDashboard)

// Customers
// SECURITY: required `users.read`, also not a seeded slug (the module is
// `customers`), so staff could not list customers. Same silent-403 failure.
router.get('/customers', authenticate, requirePermission('customers.read'), AdminController.getCustomers)

// Discounts, Coupons & Promotional Campaigns Sub-router
router.use('/discounts', discountAdminRoutes)
router.use('/coupons', discountAdminRoutes)
router.use('/promotions', discountAdminRoutes)

// Payment Gateway Settings (32-byte AES Encrypted)
router.get('/payment-settings', authenticate, requirePermission('settings.read'), PaymentSettingsController.getSettings)
router.put('/payment-settings', authenticate, requirePermission('settings.update'), PaymentSettingsController.updateSettings)

// Centralized Platform Settings (business, shipping, invoice, tax, store & maintenance status)
router.use('/settings', adminSettingsRoutes)

// ==========================================
// CATEGORY CATALOG ADMINISTRATION
// ==========================================
router.get('/categories', authenticate, requirePermission('categories.read'), CategoryController.listAdminCategories)
router.get('/categories/:id', authenticate, requirePermission('categories.read'), CategoryController.getCategory)
router.post('/categories', authenticate, requirePermission('categories.create'), CategoryController.createCategory)
router.patch('/categories/:id', authenticate, requirePermission('categories.update'), CategoryController.updateCategory)
router.put('/categories/:id', authenticate, requirePermission('categories.update'), CategoryController.updateCategory)
router.delete('/categories/:id', authenticate, requirePermission('categories.delete'), CategoryController.deleteCategory)

// ==========================================
// PRODUCT CATALOG ADMINISTRATION
// ==========================================
router.get('/products', authenticate, requirePermission('products.read'), ProductController.listAdminProducts)
router.get('/products/:id', authenticate, requirePermission('products.read'), ProductController.getAdminProduct)
router.post('/products', authenticate, requirePermission('products.create'), ProductController.createProduct)
router.patch('/products/:id', authenticate, requirePermission('products.update'), ProductController.updateProduct)
router.put('/products/:id', authenticate, requirePermission('products.update'), ProductController.updateProduct)
router.delete('/products/:id', authenticate, requirePermission('products.delete'), ProductController.deleteProduct)

// ==========================================
// PRODUCT S3 IMAGE ADMINISTRATION
// ==========================================
router.post('/products/:id/images/presigned-url', authenticate, requirePermission('products.update'), ProductController.generateImagePresignedUrl)
router.post('/products/:id/images', authenticate, requirePermission('products.update'), ProductController.addImage)
router.patch('/products/:id/images/:imageId/primary', authenticate, requirePermission('products.update'), ProductController.setPrimaryImage)
router.patch('/products/:id/images/reorder', authenticate, requirePermission('products.update'), ProductController.reorderImages)
router.delete('/products/:id/images/:imageId', authenticate, requirePermission('products.update'), ProductController.deleteImage)

// ==========================================
// ORDER ADMINISTRATION & FULFILLMENT
// ==========================================
router.get('/orders', authenticate, requirePermission('orders.read'), OrderController.listOrders)
router.put('/orders/:id/status', authenticate, requirePermission('orders.update'), OrderController.updateOrderStatus)
// Money-moving: refund a captured payment (full or partial) and notify the customer.
router.post('/orders/:id/refund', authenticate, requirePermission('orders.update'), OrderController.refundOrder)

// ==========================================
// AUDIT LOGS
// ==========================================
router.get('/audit-logs', authenticate, requirePermission('audit_logs.read'), AdminController.getAuditLogs)

// ==========================================
// DATE-WINDOWED REPORTS (sales, revenue, orders, products, inventory,
// customers, discounts, payments, delivery + CSV export)
// ==========================================
router.use('/reports', reportRoutes)

export const adminRoutes = router
