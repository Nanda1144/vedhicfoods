import { Request, Response, NextFunction } from 'express'
import { DiscountService } from '../services/discount.service'
import { CartService } from '../services/cart.service'
import { prisma } from '../config/database'
import {
  createCouponSchema,
  updateCouponSchema,
  applyCouponSchema,
  createPromotionSchema,
  updatePromotionSchema,
  DiscountableItem,
} from '../types/discount.types'
import { sendSuccess } from '../utils/api-response'
import { BadRequestError } from '../utils/errors'

import { clampPageSize } from '../utils/pagination'
export class DiscountController {
  // ==========================================
  // CUSTOMER / STOREFRONT ENDPOINTS
  // ==========================================

  /**
   * POST /api/v1/coupons/apply
   * Evaluates coupon code authoritatively against provided items or current user's cart.
   * Never trusts any discount numbers sent from frontend.
   */
  public static async applyCoupon(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code, items } = applyCouponSchema.parse(req.body)
      const userId = req.user?.id

      let discountableItems: DiscountableItem[] = []

      if (items && items.length > 0) {
        // Authoritatively query products from database to get real prices and category IDs
        const productIds = items.map((i) => i.productId)
        const products = await prisma.product.findMany({
          where: {
            id: { in: productIds },
            isActive: true,
            isDeleted: false,
          },
          select: {
            id: true,
            categoryId: true,
            price: true,
            name: true,
          },
        })

        const productMap = new Map(products.map((p) => [p.id, p]))

        for (const item of items) {
          const product = productMap.get(item.productId)
          if (!product) {
            throw new BadRequestError(`Product with ID '${item.productId}' is invalid or unavailable`)
          }
          discountableItems.push({
            productId: product.id,
            categoryId: product.categoryId,
            price: Number(product.price),
            quantity: item.quantity,
            name: product.name,
          })
        }
      } else if (userId) {
        // Fetch customer's active PostgreSQL cart
        const cart = await CartService.getCart(userId)
        if (!cart || !cart.items || cart.items.length === 0) {
          throw new BadRequestError('Your cart is empty. Add items before applying a coupon.')
        }

        discountableItems = cart.items.map((ci: any) => ({
          productId: ci.productId,
          price: Number(ci.priceSnapshot || ci.product?.price || 0),
          quantity: Number(ci.quantity),
          categoryId: ci.product?.categoryId || null,
          name: ci.productName || ci.product?.name,
        }))
      } else {
        throw new BadRequestError('Please provide cart items to validate the coupon.')
      }

      const result = await DiscountService.validateAndCalculateCoupon({
        code,
        items: discountableItems,
        userId,
      })

      sendSuccess(res, result, result.message)
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/v1/promotions/active
   * Returns currently active festive campaigns and promotions for storefront banners and sales.
   */
  public static async listActivePromotions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const promotions = await DiscountService.getActivePromotions()
      sendSuccess(res, promotions, 'Active promotions retrieved successfully')
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/v1/promotions/:slug
   * Returns details of a specific promotional campaign by slug.
   *
   * SECURITY: this route is unauthenticated, and it used to read the campaign
   * with a bare `findUnique({ where: { slug } })` — no `isActive` and no date
   * window, unlike `GET /promotions/active` which filters on all three. Any
   * unpublished, scheduled or expired campaign was therefore enumerable by
   * guessing slugs, disclosing the discount value, its window and exactly which
   * products and categories it targets before the campaign was meant to be
   * public. The same active-campaign predicate the listing endpoint uses is now
   * applied here, and a non-public campaign is indistinguishable from one that
   * does not exist.
   */
  public static async getPromotionBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const slug = String(req.params.slug)
      const now = new Date()
      const promotion = await prisma.promotion.findFirst({
        where: {
          slug,
          isActive: true,
          startDate: { lte: now },
          endDate: { gte: now },
        },
        include: {
          products: {
            include: {
              product: {
                select: { id: true, name: true, slug: true, price: true, mrp: true },
              },
            },
          },
          categories: {
            include: {
              category: {
                select: { id: true, name: true, slug: true },
              },
            },
          },
        },
      })

      if (!promotion) {
        throw new BadRequestError(`Promotion '${slug}' not found`)
      }

      sendSuccess(
        res,
        {
          ...promotion,
          discountValue: Number(promotion.discountValue),
          minOrderValue: promotion.minOrderValue ? Number(promotion.minOrderValue) : 0,
          maxDiscount: promotion.maxDiscount ? Number(promotion.maxDiscount) : null,
        },
        'Promotion retrieved successfully'
      )
    } catch (error) {
      next(error)
    }
  }

  // ==========================================
  // ADMIN COUPON CRUD ENDPOINTS
  // ==========================================

  /**
   * GET /api/v1/admin/discounts/coupons
   */
  public static async listAdminCoupons(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = req.query.page ? parseInt(String(req.query.page), 10) : 1
      const limit = clampPageSize(req.query.limit, 20)
      const search = req.query.search ? String(req.query.search) : undefined
      const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined

      const result = await DiscountService.listCoupons({ page, limit, search, isActive })
      res.status(200).json({
        success: true,
        message: 'Coupons retrieved successfully',
        ...result,
      })
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/v1/admin/discounts/coupons/:id
   */
  public static async getAdminCoupon(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const coupon = await DiscountService.getCouponById(id)
      sendSuccess(res, coupon, 'Coupon retrieved successfully')
    } catch (error) {
      next(error)
    }
  }

  /**
   * POST /api/v1/admin/discounts/coupons
   */
  public static async createAdminCoupon(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createCouponSchema.parse(req.body)
      const actor = {
        id: req.user?.id || 'SYSTEM',
        email: req.user?.email || 'system@vedhicfoods.com',
      }
      const coupon = await DiscountService.createCoupon(input, actor, req)
      sendSuccess(res, coupon, `Coupon '${coupon.code}' created successfully`, 201)
    } catch (error) {
      next(error)
    }
  }

  /**
   * PATCH /api/v1/admin/discounts/coupons/:id
   */
  public static async updateAdminCoupon(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const input = updateCouponSchema.parse(req.body)
      const actor = {
        id: req.user?.id || 'SYSTEM',
        email: req.user?.email || 'system@vedhicfoods.com',
      }
      const coupon = await DiscountService.updateCoupon(id, input, actor, req)
      sendSuccess(res, coupon, `Coupon '${coupon.code}' updated successfully`)
    } catch (error) {
      next(error)
    }
  }

  /**
   * PATCH /api/v1/admin/discounts/coupons/:id/status
   */
  public static async toggleCouponStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const { isActive } = req.body
      if (typeof isActive !== 'boolean') {
        throw new BadRequestError('isActive must be a boolean')
      }
      const actor = {
        id: req.user?.id || 'SYSTEM',
        email: req.user?.email || 'system@vedhicfoods.com',
      }
      const coupon = await DiscountService.toggleCouponStatus(id, isActive, actor, req)
      sendSuccess(
        res,
        coupon,
        `Coupon '${coupon.code}' ${isActive ? 'enabled' : 'disabled'} successfully`
      )
    } catch (error) {
      next(error)
    }
  }

  /**
   * DELETE /api/v1/admin/discounts/coupons/:id
   */
  public static async deleteAdminCoupon(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const actor = {
        id: req.user?.id || 'SYSTEM',
        email: req.user?.email || 'system@vedhicfoods.com',
      }
      const result = await DiscountService.deleteCoupon(id, actor, req)
      sendSuccess(res, result, result.message)
    } catch (error) {
      next(error)
    }
  }

  // ==========================================
  // ADMIN PROMOTION / CAMPAIGN CRUD ENDPOINTS
  // ==========================================

  /**
   * GET /api/v1/admin/discounts/promotions
   */
  public static async listAdminPromotions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = req.query.page ? parseInt(String(req.query.page), 10) : 1
      const limit = clampPageSize(req.query.limit, 20)
      const activeOnly = req.query.activeOnly === 'true'

      const result = await DiscountService.listPromotions({ page, limit, activeOnly })
      res.status(200).json({
        success: true,
        message: 'Promotions retrieved successfully',
        ...result,
      })
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/v1/admin/discounts/promotions/:id
   */
  public static async getAdminPromotion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const promotion = await DiscountService.getPromotionById(id)
      sendSuccess(res, promotion, 'Promotion retrieved successfully')
    } catch (error) {
      next(error)
    }
  }

  /**
   * POST /api/v1/admin/discounts/promotions
   */
  public static async createAdminPromotion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createPromotionSchema.parse(req.body)
      const actor = {
        id: req.user?.id || 'SYSTEM',
        email: req.user?.email || 'system@vedhicfoods.com',
      }
      const promotion = await DiscountService.createPromotion(input, actor, req)
      sendSuccess(res, promotion, `Promotion '${promotion.name}' created successfully`, 201)
    } catch (error) {
      next(error)
    }
  }

  /**
   * PATCH /api/v1/admin/discounts/promotions/:id
   */
  public static async updateAdminPromotion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const input = updatePromotionSchema.parse(req.body)
      const actor = {
        id: req.user?.id || 'SYSTEM',
        email: req.user?.email || 'system@vedhicfoods.com',
      }
      const promotion = await DiscountService.updatePromotion(id, input, actor, req)
      sendSuccess(res, promotion, `Promotion '${promotion.name}' updated successfully`)
    } catch (error) {
      next(error)
    }
  }

  /**
   * PATCH /api/v1/admin/discounts/promotions/:id/status
   */
  public static async togglePromotionStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const { isActive } = req.body
      if (typeof isActive !== 'boolean') {
        throw new BadRequestError('isActive must be a boolean')
      }
      const actor = {
        id: req.user?.id || 'SYSTEM',
        email: req.user?.email || 'system@vedhicfoods.com',
      }
      const promotion = await DiscountService.togglePromotionStatus(id, isActive, actor, req)
      sendSuccess(
        res,
        promotion,
        `Promotion '${promotion.name}' ${isActive ? 'enabled' : 'disabled'} successfully`
      )
    } catch (error) {
      next(error)
    }
  }

  /**
   * DELETE /api/v1/admin/discounts/promotions/:id
   */
  public static async deleteAdminPromotion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const actor = {
        id: req.user?.id || 'SYSTEM',
        email: req.user?.email || 'system@vedhicfoods.com',
      }
      const result = await DiscountService.deletePromotion(id, actor, req)
      sendSuccess(res, result, result.message)
    } catch (error) {
      next(error)
    }
  }
}
