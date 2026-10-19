import { z } from 'zod'

export enum DiscountTypeEnum {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
}

// ==========================================
// 1. COUPON VALIDATION SCHEMAS
// ==========================================

export const createCouponSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Coupon code must be at least 2 characters')
    .max(50, 'Coupon code cannot exceed 50 characters')
    .regex(/^[A-Za-z0-9_-]+$/, 'Coupon code can only contain letters, numbers, hyphens, and underscores')
    .transform((val) => val.toUpperCase()),
  description: z.string().trim().max(500).optional().nullable(),
  discountType: z.nativeEnum(DiscountTypeEnum).default(DiscountTypeEnum.PERCENTAGE),
  discountValue: z
    .number()
    .positive('Discount value must be greater than 0')
    .refine((val) => val > 0, 'Discount value must be greater than 0'),
  minOrderValue: z.number().min(0, 'Minimum order value cannot be negative').default(0),
  maxDiscount: z.number().positive('Maximum discount must be positive').optional().nullable(),
  maxUses: z.number().int().positive('Max uses must be a positive integer').default(1000),
  perUserLimit: z.number().int().positive('Per-user limit must be a positive integer').default(1),
  startsAt: z
    .string()
    .datetime({ offset: true })
    .or(z.date())
    .optional()
    .nullable()
    .transform((val) => (val ? new Date(val) : null)),
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .or(z.date())
    .optional()
    .nullable()
    .transform((val) => (val ? new Date(val) : null)),
  isActive: z.boolean().default(true),
  productIds: z.array(z.string().uuid()).default([]),
  categoryIds: z.array(z.string().uuid()).default([]),
}).refine(
  (data) => {
    if (data.discountType === DiscountTypeEnum.PERCENTAGE && data.discountValue > 100) {
      return false
    }
    return true
  },
  {
    message: 'Percentage discount cannot exceed 100%',
    path: ['discountValue'],
  }
).refine(
  (data) => {
    if (data.startsAt && data.expiresAt && data.startsAt > data.expiresAt) {
      return false
    }
    return true
  },
  {
    message: 'Expiration date must be after start date',
    path: ['expiresAt'],
  }
)

export type CreateCouponInput = z.infer<typeof createCouponSchema>

export const updateCouponSchema = z.object({
  description: z.string().trim().max(500).optional().nullable(),
  discountType: z.nativeEnum(DiscountTypeEnum).optional(),
  discountValue: z.number().positive('Discount value must be greater than 0').optional(),
  minOrderValue: z.number().min(0, 'Minimum order value cannot be negative').optional(),
  maxDiscount: z.number().positive('Maximum discount must be positive').optional().nullable(),
  maxUses: z.number().int().positive('Max uses must be a positive integer').optional(),
  perUserLimit: z.number().int().positive('Per-user limit must be a positive integer').optional(),
  startsAt: z
    .union([z.string().datetime({ offset: true }), z.date(), z.null()])
    .optional()
    .transform((val) => (val === undefined ? undefined : val ? new Date(val) : null)),
  expiresAt: z
    .union([z.string().datetime({ offset: true }), z.date(), z.null()])
    .optional()
    .transform((val) => (val === undefined ? undefined : val ? new Date(val) : null)),
  isActive: z.boolean().optional(),
  productIds: z.array(z.string().uuid()).optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
}).refine(
  (data) => {
    if (data.discountType === DiscountTypeEnum.PERCENTAGE && data.discountValue && data.discountValue > 100) {
      return false
    }
    return true
  },
  {
    message: 'Percentage discount cannot exceed 100%',
    path: ['discountValue'],
  }
).refine(
  (data) => {
    if (data.startsAt && data.expiresAt && data.startsAt > data.expiresAt) {
      return false
    }
    return true
  },
  {
    message: 'Expiration date must be after start date',
    path: ['expiresAt'],
  }
)

export type UpdateCouponInput = z.infer<typeof updateCouponSchema>

export const applyCouponSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Coupon code must be at least 2 characters')
    .max(50, 'Coupon code cannot exceed 50 characters')
    .transform((val) => val.toUpperCase()),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
      })
    )
    .optional(),
})

export type ApplyCouponInput = z.infer<typeof applyCouponSchema>

// ==========================================
// 2. PROMOTIONAL CAMPAIGN SCHEMAS
// ==========================================

export const createPromotionSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase alphanumeric characters and hyphens')
    .optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(120).optional().nullable(),
  subtitle: z.string().trim().max(300).optional().nullable(),
  bannerImageUrl: z.string().url().optional().nullable().or(z.string().max(500)),
  destinationUrl: z.string().trim().max(500).optional().nullable(),
  ctaLabel: z.string().trim().max(40).optional().nullable(),
  discountType: z.nativeEnum(DiscountTypeEnum).default(DiscountTypeEnum.PERCENTAGE),
  discountValue: z.number().positive('Discount value must be greater than 0'),
  minOrderValue: z.number().min(0).default(0).optional(),
  maxDiscount: z.number().positive().optional().nullable(),
  startDate: z
    .string()
    .datetime({ offset: true })
    .or(z.date())
    .transform((val) => new Date(val)),
  endDate: z
    .string()
    .datetime({ offset: true })
    .or(z.date())
    .transform((val) => new Date(val)),
  isActive: z.boolean().default(true),
  priority: z.number().int().default(0),
  termsAndConditions: z.string().max(2000).optional().nullable(),
  productIds: z.array(z.string().uuid()).default([]),
  categoryIds: z.array(z.string().uuid()).default([]),
}).refine(
  (data) => {
    if (data.discountType === DiscountTypeEnum.PERCENTAGE && data.discountValue > 100) {
      return false
    }
    return true
  },
  {
    message: 'Percentage discount cannot exceed 100%',
    path: ['discountValue'],
  }
).refine(
  (data) => {
    if (data.startDate > data.endDate) {
      return false
    }
    return true
  },
  {
    message: 'End date must be after start date',
    path: ['endDate'],
  }
)

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>

export const updatePromotionSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase alphanumeric characters and hyphens')
    .optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  title: z.string().trim().min(2).max(120).optional().nullable(),
  subtitle: z.string().trim().max(300).optional().nullable(),
  bannerImageUrl: z.string().url().optional().nullable().or(z.string().max(500)),
  destinationUrl: z.string().trim().max(500).optional().nullable(),
  ctaLabel: z.string().trim().max(40).optional().nullable(),
  discountType: z.nativeEnum(DiscountTypeEnum).optional(),
  discountValue: z.number().positive('Discount value must be greater than 0').optional(),
  minOrderValue: z.number().min(0).optional().nullable(),
  maxDiscount: z.number().positive().optional().nullable(),
  startDate: z
    .string()
    .datetime({ offset: true })
    .or(z.date())
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  endDate: z
    .string()
    .datetime({ offset: true })
    .or(z.date())
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  isActive: z.boolean().optional(),
  priority: z.number().int().optional(),
  termsAndConditions: z.string().max(2000).optional().nullable(),
  productIds: z.array(z.string().uuid()).optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
}).refine(
  (data) => {
    if (data.discountType === DiscountTypeEnum.PERCENTAGE && data.discountValue && data.discountValue > 100) {
      return false
    }
    return true
  },
  {
    message: 'Percentage discount cannot exceed 100%',
    path: ['discountValue'],
  }
).refine(
  (data) => {
    if (data.startDate && data.endDate && data.startDate > data.endDate) {
      return false
    }
    return true
  },
  {
    message: 'End date must be after start date',
    path: ['endDate'],
  }
)

export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>

// ==========================================
// 3. CALCULATION & EVALUATION INTERFACES
// ==========================================

export interface DiscountableItem {
  productId: string
  categoryId?: string | null
  price: number
  quantity: number
  name?: string
}

export interface CouponEvaluationResult {
  isValid: boolean
  couponId: string
  code: string
  discountType: DiscountTypeEnum
  discountValue: number
  discountAmount: number
  subtotal: number
  eligibleSubtotal: number
  minOrderValue: number
  maxDiscount: number | null
  message: string
  eligibleProductIds: string[]
}
