import { Router } from 'express'
import { DiscountController } from '../controllers/discount.controller'
import { authenticate, requirePermission, optionalAuth } from '../middleware/auth.middleware'

// ==========================================
// 1. ADMIN DISCOUNT & PROMOTION ROUTER
// ==========================================
const adminRouter = Router()

// All admin discount endpoints require authentication
adminRouter.use(authenticate)

// Coupon Management CRUD
adminRouter.get(
  '/coupons',
  requirePermission('discounts.read'),
  DiscountController.listAdminCoupons
)
adminRouter.get(
  '/coupons/:id',
  requirePermission('discounts.read'),
  DiscountController.getAdminCoupon
)
adminRouter.post(
  '/coupons',
  requirePermission('discounts.create'),
  DiscountController.createAdminCoupon
)
adminRouter.patch(
  '/coupons/:id',
  requirePermission('discounts.update'),
  DiscountController.updateAdminCoupon
)
adminRouter.put(
  '/coupons/:id',
  requirePermission('discounts.update'),
  DiscountController.updateAdminCoupon
)
adminRouter.patch(
  '/coupons/:id/status',
  requirePermission('discounts.update'),
  DiscountController.toggleCouponStatus
)
adminRouter.delete(
  '/coupons/:id',
  requirePermission('discounts.delete'),
  DiscountController.deleteAdminCoupon
)

// Festival Campaigns & Promotions CRUD
adminRouter.get(
  '/promotions',
  requirePermission('discounts.read'),
  DiscountController.listAdminPromotions
)
adminRouter.get(
  '/promotions/:id',
  requirePermission('discounts.read'),
  DiscountController.getAdminPromotion
)
adminRouter.post(
  '/promotions',
  requirePermission('discounts.create'),
  DiscountController.createAdminPromotion
)
adminRouter.patch(
  '/promotions/:id',
  requirePermission('discounts.update'),
  DiscountController.updateAdminPromotion
)
adminRouter.put(
  '/promotions/:id',
  requirePermission('discounts.update'),
  DiscountController.updateAdminPromotion
)
adminRouter.patch(
  '/promotions/:id/status',
  requirePermission('discounts.update'),
  DiscountController.togglePromotionStatus
)
adminRouter.delete(
  '/promotions/:id',
  requirePermission('discounts.delete'),
  DiscountController.deleteAdminPromotion
)

export const discountAdminRoutes = adminRouter

// ==========================================
// 2. STOREFRONT & CUSTOMER COUPON ROUTER
// ==========================================
const couponRouter = Router()
couponRouter.use(optionalAuth)

// POST /api/v1/coupons/apply & /validate
couponRouter.post('/apply', DiscountController.applyCoupon)
couponRouter.post('/validate', DiscountController.applyCoupon)

export const couponCustomerRoutes = couponRouter

// ==========================================
// 3. STOREFRONT & CUSTOMER PROMOTION ROUTER
// ==========================================
const promotionRouter = Router()

// GET /api/v1/promotions/active & /:slug
promotionRouter.get('/active', DiscountController.listActivePromotions)
promotionRouter.get('/:slug', DiscountController.getPromotionBySlug)

export const promotionCustomerRoutes = promotionRouter
