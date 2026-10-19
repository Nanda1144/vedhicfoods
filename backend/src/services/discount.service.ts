import { Request } from 'express'
import { prisma } from '../config/database'
import { BadRequestError, NotFoundError, ConflictError } from '../utils/errors'
import { AuditService } from './audit.service'
import { NotificationCenterService } from './notification-center.service'
import { NotificationType, RoleName, Prisma } from '@prisma/client'
import {
  CreateCouponInput,
  UpdateCouponInput,
  CreatePromotionInput,
  UpdatePromotionInput,
  DiscountableItem,
  CouponEvaluationResult,
  DiscountTypeEnum,
} from '../types/discount.types'

export class DiscountService {
  /**
   * Authoritatively validates a coupon against cart/checkout items and user eligibility.
   * Calculates the exact discount amount on backend. NEVER trust frontend discount!
   */
  public static async validateAndCalculateCoupon(params: {
    code: string
    items: DiscountableItem[]
    userId?: string
  }): Promise<CouponEvaluationResult> {
    const code = params.code.trim().toUpperCase()

    const coupon = await prisma.coupon.findUnique({
      where: { code },
      include: {
        products: {
          select: { productId: true },
        },
        categories: {
          select: { categoryId: true },
        },
      },
    })

    if (!coupon) {
      throw new BadRequestError(`Coupon '${code}' is invalid`)
    }

    if (!coupon.isActive) {
      throw new BadRequestError(`Coupon '${code}' is disabled`)
    }

    const now = new Date()
    if (coupon.startsAt && coupon.startsAt > now) {
      throw new BadRequestError(`Coupon '${code}' has not started yet`)
    }

    if (coupon.expiresAt && coupon.expiresAt < now) {
      throw new BadRequestError(`Coupon '${code}' has expired`)
    }

    if (coupon.usedCount >= coupon.maxUses) {
      throw new BadRequestError(`Coupon '${code}' has reached its global usage limit`)
    }

    // Check per-user usage limit if customer is authenticated
    if (params.userId) {
      const userUsageCount = await prisma.couponUsage.count({
        where: {
          couponId: coupon.id,
          userId: params.userId,
        },
      })

      if (userUsageCount >= coupon.perUserLimit) {
        throw new BadRequestError(`You have reached the maximum usage limit for coupon '${code}'`)
      }
    }

    if (!params.items || params.items.length === 0) {
      throw new BadRequestError('Cart must have items to evaluate coupon')
    }

    // Enrich items with category IDs if missing
    const enrichedItems: DiscountableItem[] = []
    const itemsNeedingCategory = params.items.filter((i) => !i.categoryId)

    let productCategoryMap = new Map<string, string>()
    if (itemsNeedingCategory.length > 0) {
      const productIds = itemsNeedingCategory.map((i) => i.productId)
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, categoryId: true },
      })
      productCategoryMap = new Map(products.map((p) => [p.id, p.categoryId]))
    }

    for (const item of params.items) {
      const categoryId = item.categoryId || productCategoryMap.get(item.productId) || null
      enrichedItems.push({
        ...item,
        categoryId,
      })
    }

    const totalCartSubtotal = enrichedItems.reduce((acc, item) => acc + item.price * item.quantity, 0)

    // Determine Product and Category eligibility
    const restrictedProductIds = new Set(coupon.products.map((p) => p.productId))
    const restrictedCategoryIds = new Set(coupon.categories.map((c) => c.categoryId))

    const hasProductFilter = restrictedProductIds.size > 0
    const hasCategoryFilter = restrictedCategoryIds.size > 0

    let eligibleItems: DiscountableItem[] = []

    if (!hasProductFilter && !hasCategoryFilter) {
      // Storewide coupon applies to all items
      eligibleItems = enrichedItems
    } else {
      // Filter items that match either product filter or category filter
      eligibleItems = enrichedItems.filter((item) => {
        const matchesProduct = hasProductFilter && restrictedProductIds.has(item.productId)
        const matchesCategory =
          hasCategoryFilter && item.categoryId && restrictedCategoryIds.has(item.categoryId)
        return matchesProduct || matchesCategory
      })
    }

    if (eligibleItems.length === 0) {
      throw new BadRequestError(`Coupon '${code}' is not applicable to any products or categories in your cart`)
    }

    const eligibleSubtotal = eligibleItems.reduce((acc, item) => acc + item.price * item.quantity, 0)
    const minOrderVal = Number(coupon.minOrderValue)

    if (eligibleSubtotal < minOrderVal) {
      throw new BadRequestError(
        `Coupon '${code}' requires a minimum order value of ₹${minOrderVal} on eligible items (current: ₹${eligibleSubtotal.toFixed(2)})`
      )
    }

    // Calculate Discount
    let rawDiscount = 0
    const discountVal = Number(coupon.discountValue)
    const maxDiscountVal = coupon.maxDiscount ? Number(coupon.maxDiscount) : null

    if (coupon.discountType === 'PERCENTAGE') {
      rawDiscount = (eligibleSubtotal * discountVal) / 100
      if (maxDiscountVal !== null && rawDiscount > maxDiscountVal) {
        rawDiscount = maxDiscountVal
      }
    } else {
      // FIXED_AMOUNT discount cannot exceed eligible subtotal
      rawDiscount = Math.min(eligibleSubtotal, discountVal)
    }

    // Final security check: discount cannot exceed eligible subtotal or total cart subtotal
    const safeDiscount = Math.min(rawDiscount, eligibleSubtotal, totalCartSubtotal)
    const discountAmount = Math.max(0, Math.round(safeDiscount * 100) / 100)

    return {
      isValid: true,
      couponId: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType as DiscountTypeEnum,
      discountValue: discountVal,
      discountAmount,
      subtotal: Math.round(totalCartSubtotal * 100) / 100,
      eligibleSubtotal: Math.round(eligibleSubtotal * 100) / 100,
      minOrderValue: minOrderVal,
      maxDiscount: maxDiscountVal,
      message: `Coupon '${coupon.code}' applied successfully. Saved ₹${discountAmount.toFixed(2)}`,
      eligibleProductIds: eligibleItems.map((i) => i.productId),
    }
  }

  /**
   * Atomically records coupon usage, increments global usedCount safely preventing race conditions,
   * enforces per-user limit inside transaction, and tracks COUPON_USED audit log.
   */
  public static async recordCouponUsage(
    params: {
      couponId: string
      userId: string
      orderId: string
      discountApplied: number
      actorEmail?: string
      req?: Request
    },
    tx: Prisma.TransactionClient
  ): Promise<void> {
    const coupon = await tx.coupon.findUnique({
      where: { id: params.couponId },
    })

    if (!coupon) {
      throw new BadRequestError('Coupon not found for usage recording')
    }

    // Atomic race-condition safe increment: only succeeds if usedCount < maxUses and isActive
    const updateResult = await tx.coupon.updateMany({
      where: {
        id: params.couponId,
        usedCount: { lt: coupon.maxUses },
        isActive: true,
      },
      data: {
        usedCount: { increment: 1 },
      },
    })

    if (updateResult.count === 0) {
      throw new BadRequestError(`Coupon '${coupon.code}' usage limit has been reached`)
    }

    // Verify per-user limit inside transaction
    const userUsageCount = await tx.couponUsage.count({
      where: {
        couponId: params.couponId,
        userId: params.userId,
      },
    })

    if (userUsageCount >= coupon.perUserLimit) {
      throw new BadRequestError(
        `You have already reached the maximum allowed usage limit (${coupon.perUserLimit}) for coupon '${coupon.code}'`
      )
    }

    await tx.couponUsage.create({
      data: {
        couponId: params.couponId,
        userId: params.userId,
        orderId: params.orderId,
        discountApplied: params.discountApplied,
      },
    })

    // Record COUPON_USED audit log
    await AuditService.record({
      actorId: params.userId,
      actorEmail: params.actorEmail || null,
      action: 'COUPON_USED',
      entity: 'Coupon',
      entityId: params.couponId,
      metadata: {
        couponCode: coupon.code,
        orderId: params.orderId,
        discountApplied: params.discountApplied,
      },
      req: params.req,
      tx,
    })
  }

  // ==========================================
  // ADMIN COUPON CRUD APIS
  // ==========================================

  public static async listCoupons(query: {
    page?: number
    limit?: number
    search?: string
    isActive?: boolean
  }) {
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 20))
    const skip = (page - 1) * limit

    const where: Prisma.CouponWhereInput = {}

    if (query.search) {
      where.code = { contains: query.search.trim().toUpperCase(), mode: 'insensitive' }
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive
    }

    const [total, coupons] = await Promise.all([
      prisma.coupon.count({ where }),
      prisma.coupon.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          products: {
            include: {
              product: {
                select: { id: true, name: true, sku: true, price: true },
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
          _count: {
            select: { usages: true },
          },
        },
      }),
    ])

    return {
      data: coupons.map((c) => ({
        ...c,
        discountValue: Number(c.discountValue),
        minOrderValue: Number(c.minOrderValue),
        maxDiscount: c.maxDiscount ? Number(c.maxDiscount) : null,
        usageCount: c.usedCount,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  public static async getCouponById(id: string) {
    const coupon = await prisma.coupon.findUnique({
      where: { id },
      include: {
        products: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, price: true },
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
        usages: {
          take: 50,
          orderBy: { usedAt: 'desc' },
          include: {
            user: {
              select: { id: true, fullName: true, email: true },
            },
          },
        },
      },
    })

    if (!coupon) {
      throw new NotFoundError(`Coupon with ID '${id}' not found`)
    }

    return {
      ...coupon,
      discountValue: Number(coupon.discountValue),
      minOrderValue: Number(coupon.minOrderValue),
      maxDiscount: coupon.maxDiscount ? Number(coupon.maxDiscount) : null,
    }
  }

  public static async createCoupon(
    input: CreateCouponInput,
    actor: { id: string; email: string },
    req?: Request
  ) {
    const existing = await prisma.coupon.findUnique({
      where: { code: input.code },
    })

    if (existing) {
      throw new ConflictError(`Coupon with code '${input.code}' already exists`)
    }

    const coupon = await prisma.coupon.create({
      data: {
        code: input.code,
        description: input.description,
        discountType: input.discountType,
        discountValue: input.discountValue,
        minOrderValue: input.minOrderValue,
        maxDiscount: input.maxDiscount,
        maxUses: input.maxUses,
        perUserLimit: input.perUserLimit,
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        isActive: input.isActive,
        products: {
          create: input.productIds.map((productId) => ({ productId })),
        },
        categories: {
          create: input.categoryIds.map((categoryId) => ({ categoryId })),
        },
      },
      include: {
        products: true,
        categories: true,
      },
    })

    await AuditService.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'PROMOTION_CREATED',
      entity: 'Coupon',
      entityId: coupon.id,
      metadata: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: Number(coupon.discountValue),
        minOrderValue: Number(coupon.minOrderValue),
      },
      req,
    })

    return {
      ...coupon,
      discountValue: Number(coupon.discountValue),
      minOrderValue: Number(coupon.minOrderValue),
      maxDiscount: coupon.maxDiscount ? Number(coupon.maxDiscount) : null,
    }
  }

  public static async updateCoupon(
    id: string,
    input: UpdateCouponInput,
    actor: { id: string; email: string },
    req?: Request
  ) {
    const existing = await prisma.coupon.findUnique({
      where: { id },
    })

    if (!existing) {
      throw new NotFoundError(`Coupon with ID '${id}' not found`)
    }

    // BUG-DIS-1/2: the update schema can only cross-validate fields present in
    // the same request body, so a partial PATCH could push a stored PERCENTAGE
    // discount above 100% or move a date outside the stored window. Validate
    // against the DB-merged (effective) state instead of the request body alone.
    const effectiveType: string = input.discountType ?? existing.discountType
    const effectiveValue =
      input.discountValue !== undefined ? input.discountValue : Number(existing.discountValue)
    if (effectiveType === DiscountTypeEnum.PERCENTAGE && effectiveValue > 100) {
      throw new BadRequestError('Percentage discount cannot exceed 100%')
    }

    const effectiveStartsAt = input.startsAt !== undefined ? input.startsAt : existing.startsAt
    const effectiveExpiresAt = input.expiresAt !== undefined ? input.expiresAt : existing.expiresAt
    if (effectiveStartsAt && effectiveExpiresAt && effectiveStartsAt > effectiveExpiresAt) {
      throw new BadRequestError('Expiration date must be after start date')
    }

    const updated = await prisma.$transaction(async (tx) => {
      // If productIds supplied, replace
      if (input.productIds !== undefined) {
        await tx.couponProduct.deleteMany({ where: { couponId: id } })
        if (input.productIds.length > 0) {
          await tx.couponProduct.createMany({
            data: input.productIds.map((productId) => ({ couponId: id, productId })),
          })
        }
      }

      // If categoryIds supplied, replace
      if (input.categoryIds !== undefined) {
        await tx.couponCategory.deleteMany({ where: { couponId: id } })
        if (input.categoryIds.length > 0) {
          await tx.couponCategory.createMany({
            data: input.categoryIds.map((categoryId) => ({ couponId: id, categoryId })),
          })
        }
      }

      return tx.coupon.update({
        where: { id },
        data: {
          description: input.description !== undefined ? input.description : undefined,
          discountType: input.discountType,
          discountValue: input.discountValue !== undefined ? input.discountValue : undefined,
          minOrderValue: input.minOrderValue !== undefined ? input.minOrderValue : undefined,
          maxDiscount: input.maxDiscount !== undefined ? input.maxDiscount : undefined,
          maxUses: input.maxUses !== undefined ? input.maxUses : undefined,
          perUserLimit: input.perUserLimit !== undefined ? input.perUserLimit : undefined,
          startsAt: input.startsAt !== undefined ? input.startsAt : undefined,
          expiresAt: input.expiresAt !== undefined ? input.expiresAt : undefined,
          isActive: input.isActive !== undefined ? input.isActive : undefined,
        },
        include: {
          products: true,
          categories: true,
        },
      })
    })

    await AuditService.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'PROMOTION_UPDATED',
      entity: 'Coupon',
      entityId: updated.id,
      metadata: {
        code: updated.code,
        changes: input,
      },
      req,
    })

    return {
      ...updated,
      discountValue: Number(updated.discountValue),
      minOrderValue: Number(updated.minOrderValue),
      maxDiscount: updated.maxDiscount ? Number(updated.maxDiscount) : null,
    }
  }

  public static async toggleCouponStatus(
    id: string,
    isActive: boolean,
    actor: { id: string; email: string },
    req?: Request
  ) {
    const existing = await prisma.coupon.findUnique({
      where: { id },
    })

    if (!existing) {
      throw new NotFoundError(`Coupon with ID '${id}' not found`)
    }

    const updated = await prisma.coupon.update({
      where: { id },
      data: { isActive },
    })

    const action = isActive ? 'PROMOTION_ENABLED' : 'PROMOTION_DISABLED'
    await AuditService.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action,
      entity: 'Coupon',
      entityId: id,
      metadata: { code: existing.code, isActive },
      req,
    })

    return {
      id: updated.id,
      code: updated.code,
      isActive: updated.isActive,
    }
  }

  public static async deleteCoupon(
    id: string,
    actor: { id: string; email: string },
    req?: Request
  ) {
    const existing = await prisma.coupon.findUnique({
      where: { id },
      include: {
        _count: { select: { usages: true } },
      },
    })

    if (!existing) {
      throw new NotFoundError(`Coupon with ID '${id}' not found`)
    }

    // If coupon has been used in orders, soft-deactivate instead of hard deleting to preserve historical record integrity
    if (existing._count.usages > 0) {
      await prisma.coupon.update({
        where: { id },
        data: { isActive: false },
      })
    } else {
      await prisma.coupon.delete({
        where: { id },
      })
    }

    await AuditService.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'PROMOTION_DISABLED',
      entity: 'Coupon',
      entityId: id,
      metadata: { code: existing.code, usagesCount: existing._count.usages },
      req,
    })

    return { success: true, message: `Coupon '${existing.code}' removed successfully` }
  }

  // ==========================================
  // FESTIVAL CAMPAIGNS & PROMOTIONS CRUD
  // ==========================================

  public static async listPromotions(query: {
    page?: number
    limit?: number
    activeOnly?: boolean
  }) {
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 20))
    const skip = (page - 1) * limit

    const where: Prisma.PromotionWhereInput = {}
    if (query.activeOnly) {
      const now = new Date()
      where.isActive = true
      where.startDate = { lte: now }
      where.endDate = { gte: now }
    }

    const [total, promotions] = await Promise.all([
      prisma.promotion.count({ where }),
      prisma.promotion.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: {
          products: {
            include: {
              product: {
                select: { id: true, name: true, sku: true, price: true, mrp: true },
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
      }),
    ])

    return {
      data: promotions.map((p) => ({
        ...p,
        discountValue: Number(p.discountValue),
        minOrderValue: p.minOrderValue ? Number(p.minOrderValue) : 0,
        maxDiscount: p.maxDiscount ? Number(p.maxDiscount) : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  public static async getActivePromotions() {
    const now = new Date()
    const promotions = await prisma.promotion.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: { priority: 'desc' },
      // PERFORMANCE / DoS: this is a public, unauthenticated endpoint that
      // previously returned every active promotion with all of its product and
      // category relations expanded. Each promotion fans out to one row per
      // linked product/category, so the response grew without bound and could be
      // used to amplify load cheaply. Capped, and the nested relation is capped
      // too so no single promotion can dominate the payload.
      take: 50,
      include: {
        products: {
          take: 100,
          include: {
            product: {
              select: { id: true, name: true, slug: true, price: true, mrp: true, images: { take: 1 } },
            },
          },
        },
        categories: {
          take: 100,
          include: {
            category: {
              select: { id: true, name: true, slug: true },
            },
          },
        },
      },
    })

    return promotions.map((p) => ({
      ...p,
      discountValue: Number(p.discountValue),
      minOrderValue: p.minOrderValue ? Number(p.minOrderValue) : 0,
      maxDiscount: p.maxDiscount ? Number(p.maxDiscount) : null,
    }))
  }

  public static async getPromotionById(id: string) {
    const promotion = await prisma.promotion.findUnique({
      where: { id },
      include: {
        products: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, price: true, mrp: true },
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
      throw new NotFoundError(`Promotion with ID '${id}' not found`)
    }

    return {
      ...promotion,
      discountValue: Number(promotion.discountValue),
      minOrderValue: promotion.minOrderValue ? Number(promotion.minOrderValue) : 0,
      maxDiscount: promotion.maxDiscount ? Number(promotion.maxDiscount) : null,
    }
  }

  public static async createPromotion(
    input: CreatePromotionInput,
    actor: { id: string; email: string },
    req?: Request
  ) {
    const slug =
      input.slug ||
      input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')

    const existing = await prisma.promotion.findUnique({
      where: { slug },
    })

    if (existing) {
      throw new ConflictError(`Promotion with slug '${slug}' already exists`)
    }

    const promotion = await prisma.promotion.create({
      data: {
        name: input.name,
        slug,
        description: input.description,
        title: input.title,
        subtitle: input.subtitle,
        bannerImageUrl: input.bannerImageUrl,
        destinationUrl: input.destinationUrl,
        ctaLabel: input.ctaLabel,
        discountType: input.discountType,
        discountValue: input.discountValue,
        minOrderValue: input.minOrderValue,
        maxDiscount: input.maxDiscount,
        startDate: input.startDate,
        endDate: input.endDate,
        isActive: input.isActive,
        priority: input.priority,
        termsAndConditions: input.termsAndConditions,
        products: {
          create: input.productIds.map((productId) => ({ productId })),
        },
        categories: {
          create: input.categoryIds.map((categoryId) => ({ categoryId })),
        },
      },
      include: {
        products: true,
        categories: true,
      },
    })

    await AuditService.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'PROMOTION_CREATED',
      entity: 'Promotion',
      entityId: promotion.id,
      metadata: {
        name: promotion.name,
        slug: promotion.slug,
        discountType: promotion.discountType,
        discountValue: Number(promotion.discountValue),
      },
      req,
    })

    if (input.isActive) {
      await NotificationCenterService.broadcastToRoleActors({
        roles: [RoleName.CUSTOMER],
        type: NotificationType.PROMOTION,
        title: 'New promotion available',
        message: `${promotion.name} is now live — check it out on the promotions page.`,
        eventKey: `promotion_published:${promotion.id}`,
        metadata: { promotionId: promotion.id, promotionName: promotion.name },
      })
    }

    return {
      ...promotion,
      discountValue: Number(promotion.discountValue),
      minOrderValue: promotion.minOrderValue ? Number(promotion.minOrderValue) : 0,
      maxDiscount: promotion.maxDiscount ? Number(promotion.maxDiscount) : null,
    }
  }

  public static async updatePromotion(
    id: string,
    input: UpdatePromotionInput,
    actor: { id: string; email: string },
    req?: Request
  ) {
    const existing = await prisma.promotion.findUnique({
      where: { id },
    })

    if (!existing) {
      throw new NotFoundError(`Promotion with ID '${id}' not found`)
    }

    // BUG-DIS-1/2: partial updates cannot be cross-validated by the schema
    // (which only sees the fields in this one request). Validate against the
    // DB-merged state so a PERCENTAGE promotion can never be pushed above 100%
    // and its window can never be inverted by a single-field PATCH.
    const effectiveType: string = input.discountType ?? existing.discountType
    const effectiveValue =
      input.discountValue !== undefined ? input.discountValue : Number(existing.discountValue)
    if (effectiveType === DiscountTypeEnum.PERCENTAGE && effectiveValue > 100) {
      throw new BadRequestError('Percentage discount cannot exceed 100%')
    }

    const effectiveStart = input.startDate !== undefined ? input.startDate : existing.startDate
    const effectiveEnd = input.endDate !== undefined ? input.endDate : existing.endDate
    if (effectiveStart && effectiveEnd && effectiveStart > effectiveEnd) {
      throw new BadRequestError('End date must be after start date')
    }

    if (input.slug && input.slug !== existing.slug) {
      const slugTaken = await prisma.promotion.findUnique({ where: { slug: input.slug } })
      if (slugTaken) {
        throw new ConflictError(`Promotion with slug '${input.slug}' already exists`)
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (input.productIds !== undefined) {
        await tx.promotionProduct.deleteMany({ where: { promotionId: id } })
        if (input.productIds.length > 0) {
          await tx.promotionProduct.createMany({
            data: input.productIds.map((productId) => ({ promotionId: id, productId })),
          })
        }
      }

      if (input.categoryIds !== undefined) {
        await tx.promotionCategory.deleteMany({ where: { promotionId: id } })
        if (input.categoryIds.length > 0) {
          await tx.promotionCategory.createMany({
            data: input.categoryIds.map((categoryId) => ({ promotionId: id, categoryId })),
          })
        }
      }

      return tx.promotion.update({
        where: { id },
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description !== undefined ? input.description : undefined,
          title: input.title,
          subtitle: input.subtitle,
          bannerImageUrl: input.bannerImageUrl !== undefined ? input.bannerImageUrl : undefined,
          destinationUrl: input.destinationUrl,
          ctaLabel: input.ctaLabel,
          discountType: input.discountType,
          discountValue: input.discountValue !== undefined ? input.discountValue : undefined,
          minOrderValue: input.minOrderValue !== undefined ? input.minOrderValue : undefined,
          maxDiscount: input.maxDiscount !== undefined ? input.maxDiscount : undefined,
          startDate: input.startDate,
          endDate: input.endDate,
          isActive: input.isActive !== undefined ? input.isActive : undefined,
          priority: input.priority !== undefined ? input.priority : undefined,
          termsAndConditions:
            input.termsAndConditions !== undefined ? input.termsAndConditions : undefined,
        },
        include: {
          products: true,
          categories: true,
        },
      })
    })

    await AuditService.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'PROMOTION_UPDATED',
      entity: 'Promotion',
      entityId: updated.id,
      metadata: { name: updated.name, changes: input },
      req,
    })

    return {
      ...updated,
      discountValue: Number(updated.discountValue),
      minOrderValue: updated.minOrderValue ? Number(updated.minOrderValue) : 0,
      maxDiscount: updated.maxDiscount ? Number(updated.maxDiscount) : null,
    }
  }

  public static async togglePromotionStatus(
    id: string,
    isActive: boolean,
    actor: { id: string; email: string },
    req?: Request
  ) {
    const existing = await prisma.promotion.findUnique({
      where: { id },
    })

    if (!existing) {
      throw new NotFoundError(`Promotion with ID '${id}' not found`)
    }

    const updated = await prisma.promotion.update({
      where: { id },
      data: { isActive },
    })

    const action = isActive ? 'PROMOTION_ENABLED' : 'PROMOTION_DISABLED'
    await AuditService.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action,
      entity: 'Promotion',
      entityId: id,
      metadata: { name: existing.name, isActive },
      req,
    })

    if (isActive) {
      await NotificationCenterService.broadcastToRoleActors({
        roles: [RoleName.CUSTOMER],
        type: NotificationType.PROMOTION,
        title: 'New promotion available',
        message: `${existing.name} is now live — check it out on the promotions page.`,
        eventKey: `promotion_published:${id}`,
        metadata: { promotionId: id, promotionName: existing.name },
      })
    }

    return {
      id: updated.id,
      name: updated.name,
      isActive: updated.isActive,
    }
  }

  public static async deletePromotion(
    id: string,
    actor: { id: string; email: string },
    req?: Request
  ) {
    const existing = await prisma.promotion.findUnique({
      where: { id },
    })

    if (!existing) {
      throw new NotFoundError(`Promotion with ID '${id}' not found`)
    }

    await prisma.promotion.delete({
      where: { id },
    })

    await AuditService.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'PROMOTION_DISABLED',
      entity: 'Promotion',
      entityId: id,
      metadata: { name: existing.name },
      req,
    })

    return { success: true, message: `Promotion '${existing.name}' deleted successfully` }
  }
}
